import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID(), name = `cc-uxdate-${run.slice(0, 10)}`, label = 'coffeecito.ux-date.local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 32e6, stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
const sql = body => docker(['exec', '-i', '-e', 'PGOPTIONS=-c statement_timeout=30000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: body });
const file = path => readFileSync(join(root, path), 'utf8');
const request = (user, body) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${body} commit;`);
const pre = 'preflight/202611040001_preflight_networking_history_policy_v1.sql';
const migration = 'migrations/202611040001_networking_history_policy_v1.sql';
const verifier = 'verifiers/202611040001_verify_networking_history_policy_v1.sql';
let identity = '';
let checks = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); checks++; }
function denied(body, pattern) { assert.throws(body, pattern); checks++; }
function session(body, application) {
  const child = spawn('docker', ['exec','-i','-e',`PGAPPNAME=${application}`,name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
  let output = '', errors = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { errors += b; });
  const done = new Promise(resolve => child.on('close', code => resolve({code,output,errors})));
  child.stdin.write("set statement_timeout='15s';\n" + body + '\n');
  return { child, done, output: () => output };
}
async function until(check) {
  const limit = Date.now() + 10000;
  while (!check()) { if (Date.now() > limit) throw new Error('synthetic coordination timeout'); await new Promise(r => setTimeout(r,50)); }
}
try {
  docker(['image', 'inspect', image]);
  identity = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = sql('select 1;') === '1'; } catch { /* disposable startup */ }
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready);
  await new Promise(r => setTimeout(r, 2500));
  const info = JSON.parse(docker(['inspect', name]))[0];
  equal(info.HostConfig.NetworkMode, 'none'); equal(info.Id, identity);
  equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  if (sql("select count(*) from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at';") === '0') {
    docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'supabase_auth_admin', '-d', 'postgres'],
      { input: 'alter table auth.users add column email_confirmed_at timestamptz;' });
  }
  sql(file('bootstrap/preflight_empty.sql'));
  for (const path of readdirSync(join(root, 'migrations')).filter(p => p.endsWith('.sql') && p < '202611040001').sort()) sql(file(`migrations/${path}`));
  for (const path of readdirSync(join(root, 'seeds')).filter(p => p.endsWith('.sql')).sort()) sql(file(`seeds/${path}`));
  equal(JSON.parse(sql(file(pre))).installation_state, 'clean_install');
  const badUser=randomUUID();
  sql(`insert into auth.users(id,email,created_at,updated_at) values('${badUser}','bad-date@example.invalid',now(),now());
    insert into public.networking_cycles(user_id,objective_type,origin,started_at,started_on,timezone_name)
    values('${badUser}','JOB_SEARCH','legacy','-infinity','-infinity','UTC');`);
  equal(JSON.parse(sql(file(pre))).stop_reasons.includes('cycle_start_nonfinite_existing'),true);
  denied(()=>sql(file(migration)),/cycle_start_nonfinite_existing/);
  equal(sql("select to_regclass('public.networking_history_policy') is null;"),'t');
  sql(`delete from public.networking_cycles where user_id='${badUser}'; delete from auth.users where id='${badUser}';`);
  denied(() => sql(file(migration).replace(/commit;\s*$/, "do $$ begin raise exception 'synthetic_abort'; end $$; commit;")), /synthetic_abort/);
  equal(sql("select to_regclass('public.networking_history_policy') is null;"), 't');
  sql('create function public.current_user_history_window_v1(text) returns text language sql as $$ select $1; $$;');
  equal(JSON.parse(sql(file(pre))).installation_state, 'stop');
  denied(() => sql(file(migration)), /history_policy_objects_already_exist/);
  sql('drop function public.current_user_history_window_v1(text);');
  sql(file(migration)); assert.match(sql(file(verifier)), /PASS/); checks++;
  sql('create role uxdate_drift; grant uxdate_drift to postgres; grant create on schema public to uxdate_drift;');
  const drift=(change,verify,pattern)=>denied(()=>sql('begin; '+change+'\n'+file(verify)),pattern);
  for (const change of [
    'alter table public.networking_history_policy alter column max_history_months set default 12;',
    'alter table public.networking_history_policy alter column revision type numeric;',
    'alter table public.networking_history_policy alter column updated_at drop not null;',
    'alter table public.networking_history_policy add column unexpected text;',
    'alter table public.networking_history_policy drop constraint networking_history_policy_max_history_months_check;',
    'alter table public.networking_history_policy drop constraint networking_history_policy_singleton_check; alter table public.networking_history_policy add constraint networking_history_policy_singleton_check check (true);',
    'alter table public.networking_history_policy drop constraint networking_history_policy_revision_check; alter table public.networking_history_policy add constraint networking_history_policy_revision_check check (revision>0) not valid;',
    'alter table public.networking_history_policy drop constraint networking_history_policy_updated_by_fkey; alter table public.networking_history_policy add constraint networking_history_policy_updated_by_fkey foreign key(updated_by) references public.profiles(id) on delete cascade;',
    'alter table public.networking_history_policy alter constraint networking_history_policy_updated_by_fkey deferrable;',
    'alter table public.networking_history_policy owner to uxdate_drift;',
    'alter table public.networking_history_policy disable row level security;',
    'grant select on public.networking_history_policy to authenticated;',
    'grant select(updated_by) on public.networking_history_policy to authenticated;',
    'create policy unexpected on public.networking_history_policy for select to authenticated using(true);',
    'alter function public.enforce_cycle_start_policy_v1() security invoker;',
    'alter function public.networking_history_floor_v1(text,integer,timestamptz) volatile;',
    'alter function public.networking_history_floor_v1(text,integer,timestamptz) set search_path=public;',
    'alter function public.networking_history_floor_v1(text,integer,timestamptz) strict;',
    'grant execute on function public.enforce_cycle_start_policy_v1() to supabase_auth_admin;',
    'grant execute on function public.current_user_history_window_v1() to authenticated with grant option;'
  ]) drift(change,verifier,/history_policy_/);
  assert.match(sql(file(verifier)),/PASS/); checks++;
  equal(JSON.parse(sql(file(pre))).installation_state, 'stop');
  const user = randomUUID(), other = randomUUID(), fresh = randomUUID();
  for (const id of [user, other, fresh]) sql(`insert into public.app_access_allowlist(email_normalized) values ('${id}@example.invalid');
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('${id}','authenticated','authenticated','${id}@example.invalid',now(),'{"provider":"google","providers":["google"]}','{}',now(),now());`);
  sql(`select public.set_r2b_rollout_gate('test_only','${user}'); select public.set_r2b_rollout_gate('open',null);`);
  equal(JSON.parse(request(user, "select public.current_user_networking_history_policy_v1('America/Santiago');")).max_months, 6);
  denied(() => request(user, 'update public.networking_history_policy set max_history_months=12;'), /permission denied/);
  denied(() => request(user, 'select public.admin_set_networking_history_policy_v1(12,1);'), /admin_manage_access_required/);
  denied(() => request(user, 'select public.current_user_history_window_v1();'), /history_active_cycle_required/);
  denied(() => sql('begin; set local role anon; select public.current_user_history_window_v1(); rollback;'),/permission denied/);
  denied(() => request(fresh,`select public.start_networking_cycle_r2b('${randomUUID()}','Too old',now()-interval '7 months','UTC',null,'none:initial',false,false);`),/cycle_start_outside_policy/);
  sql(`insert into public.user_role_assignments(user_id,role_code) values ('${user}','system_admin');`);
  for (const months of [0, 13, -1]) denied(() => request(user, `select public.admin_set_networking_history_policy_v1(${months},1);`), /history_policy_invalid_months/);
  equal(JSON.parse(request(user, 'select public.admin_set_networking_history_policy_v1(1,1);')).revision, 2);
  equal(JSON.parse(request(other, "select public.current_user_networking_history_policy_v1('UTC');")).max_months, 1);
  denied(() => request(user, 'select public.admin_set_networking_history_policy_v1(6,1);'), /history_policy_stale/);
  request(user, 'select public.admin_set_networking_history_policy_v1(6,2);');
  // Civil calendar arithmetic: leap year, month end and Santiago's skipped midnight.
  equal(sql("select public.networking_history_floor_v1('UTC',1,'2024-03-31T12:00Z')='2024-02-29T00:00Z'::timestamptz;"), 't');
  equal(sql("select public.networking_history_floor_v1('UTC',12,'2024-02-29T12:00Z')='2023-02-28T00:00Z'::timestamptz;"), 't');
  equal(sql("select public.networking_history_floor_v1('America/Santiago',1,'2024-10-08T12:00Z')='2024-09-08T04:00Z'::timestamptz;"), 't');
  denied(() => request(user, "select public.current_user_networking_history_policy_v1('not/a-zone');"), /history_policy_invalid_time/);
  const requestId = randomUUID();
  const start = sql("select date_trunc('second',statement_timestamp()-interval '1 day');");
  const create = `select public.start_networking_cycle_r2b('${requestId}','Synthetic cycle','${start}','UTC',null,'none:initial',false,false);`;
  const cycle = request(user, create);
  equal(request(user, create), cycle);
  equal(JSON.parse(request(user, 'select public.current_user_history_window_v1();')).cycle_id, cycle);
  denied(() => request(other, 'select public.current_user_history_window_v1();'), /history_active_cycle_required/);
  denied(() => sql(`update public.networking_cycles set started_at=started_at-interval '1 day',started_on=started_on-1 where id='${cycle}';`), /cycle_start_immutable/);
  const token = `active:${cycle}:${requestId}`;
  request(user, `select public.close_networking_cycle_r2b('${randomUUID()}','${cycle}','${token}',statement_timestamp(),'other');`);
  denied(() => request(user, 'select public.current_user_history_window_v1();'), /history_active_cycle_required/);
  denied(() => request(user, `select public.start_networking_cycle_r2b('${randomUUID()}','Too old',now()-interval '7 months','UTC',null,'none:${cycle}',false,false);`), /cycle_start_outside_policy|cycle.*overlap/);
  // Existing undated legacy cycles may be configured once with their real old start.
  const legacy = sql(`insert into public.networking_cycles(user_id,objective_type,origin) values ('${other}','JOB_SEARCH','legacy') returning id;`);
  denied(()=>request(other,'select public.current_user_history_window_v1();'),/history_cycle_start_required/);
  const legacyRequest=randomUUID();
  for(const date of ['-infinity','infinity']) {
    denied(()=>request(other,`select public.configure_legacy_networking_cycle_r2b('${legacyRequest}','${legacy}','active:${legacy}:${legacy}','Legacy','${date}','UTC');`),/cycle_start_nonfinite|legacy_cycle_already_configured_or_invalid/);
    equal(sql(`select started_at is null and started_on is null and start_request_id is null from public.networking_cycles where id='${legacy}';`),'t');
    denied(()=>request(fresh,`select public.start_networking_cycle_r2b('${randomUUID()}','Infinite','${date}','UTC',null,'none:initial',false,false);`),/cycle_start_nonfinite|cycle_start_invalid/);
  }
  denied(()=>sql(`update public.networking_cycles set started_on='-infinity' where id='${legacy}';`),/cycle_start_nonfinite/);
  const legacyDate=sql("select date_trunc('second',now()-interval '3 years');");
  const configure=`select public.configure_legacy_networking_cycle_r2b('${legacyRequest}','${legacy}','active:${legacy}:${legacy}','Legacy','${legacyDate}','UTC');`;
  equal(request(other,configure),legacy);
  equal(request(other,configure),legacy);
  denied(()=>sql(`update public.networking_cycles set started_at='-infinity',started_on='-infinity' where id='${legacy}';`),/cycle_start_nonfinite/);
  const window = JSON.parse(request(other, 'select public.current_user_history_window_v1();'));
  equal(window.max_months, 6);
  equal(Date.parse(window.effective_start) > Date.now() - 190 * 86400000, true);
  sql(`update public.user_settings set setting_value=to_char(current_date,'YYYY-MM-DD') where user_id='${other}' and setting_key='Fecha_Inicio_Networking';`);
  equal(JSON.parse(request(other, 'select public.current_user_history_window_v1();')).effective_start, window.effective_start);
  assert.match(sql(file(verifier)), /PASS/);
  const pre2='preflight/202611040002_preflight_history_import_context_v1.sql';
  const migration2='migrations/202611040002_history_import_context_v1.sql';
  const verifier2='verifiers/202611040002_verify_history_import_context_v1.sql';
  for(const mode of ['open','test_only']) {
    if(mode==='test_only') sql(`select public.set_r2b_rollout_gate('paused',null);select public.set_r2b_rollout_gate('test_only','${user}');`);
    equal(JSON.parse(sql(file(pre2))).stop_reasons.includes('history_cutover_requires_paused_gate'),true);
    denied(()=>sql(file(migration2)),/history_cutover_requires_paused_gate/);
    equal(sql("select to_regprocedure('public.apply_ics_import_v2(jsonb,jsonb)') is null;"),'t');
    equal(sql("select has_function_privilege('authenticated','public.apply_ics_import_v1(jsonb)','EXECUTE');"),'t');
  }
  sql("select public.set_r2b_rollout_gate('paused',null);");
  equal(JSON.parse(sql(file(pre2))).installation_state,'ready');
  sql('grant execute on function public.apply_ics_import_v1(jsonb) to anon;');
  equal(JSON.parse(sql(file(pre2))).installation_state,'stop');
  denied(()=>sql(file(migration2)),/history_writer_acl_drift/);
  equal(sql("select to_regprocedure('public.apply_ics_import_v2(jsonb,jsonb)') is null;"),'t');
  sql('revoke execute on function public.apply_ics_import_v1(jsonb) from anon;');
  denied(() => sql(file(migration2).replace(/commit;\s*$/, "do $$ begin raise exception 'synthetic_abort'; end $$; commit;")),/synthetic_abort/);
  equal(sql("select has_function_privilege('authenticated','public.apply_ics_import_v1(jsonb)','EXECUTE');"),'t');
  const installer=session(file(migration2).replace(/commit;\s*$/, "select 'INSTALLED_HELD';"),'uxdate-installer');
  try {
    await until(()=>installer.output().includes('INSTALLED_HELD'));
    const opener=session(`select public.set_r2b_rollout_gate('test_only','${user}');`,'uxdate-opener');
    opener.child.stdin.end();
    await until(()=>sql("select exists(select 1 from pg_stat_activity where application_name='uxdate-opener' and wait_event_type='Lock');")==='t');
    equal(sql("select mode from public.r2b_rollout_gate where singleton;"),'paused');
    installer.child.stdin.end('commit;\n'); equal((await installer.done).code,0); equal((await opener.done).code,0);
  } finally {if(!installer.child.stdin.destroyed)installer.child.stdin.end('rollback;\n');await installer.done;}
  sql("select public.set_r2b_rollout_gate('open',null);");
  assert.match(sql(file(verifier2)),/PASS/); checks++;
  for(const change of [
    'alter function public.assert_history_context_v1(jsonb) security invoker;',
    'alter function public.assert_history_context_v1(jsonb) owner to uxdate_drift;',
    'alter function public.assert_history_context_v1(jsonb) set search_path=public;',
    'alter function public.assert_history_context_v1(jsonb) stable;',
    'alter function public.assert_history_context_v1(jsonb) strict;',
    'grant execute on function public.assert_history_context_v1(jsonb) to supabase_auth_admin;',
    'grant execute on function public.apply_google_history_v1(uuid,jsonb,jsonb) to authenticated with grant option;',
    'alter function public.apply_ics_import_v1(jsonb) security invoker;'
  ]) drift(change,verifier2,/history_import_/);
  assert.match(sql(file(verifier2)),/PASS/); checks++;
  denied(() => request(other,"select public.apply_ics_import_v1('[]');"),/permission denied/);
  denied(() => request(other,`select public.apply_google_interaction_sync_v1('${randomUUID()}','{}');`),/permission denied/);
  const context=JSON.parse(request(other,'select public.current_user_history_window_v1();'));
  const encoded=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
  denied(() => request(other,`select public.apply_ics_import_v2('[]',${encoded({...context,revision:0})});`),/history_context_stale/);
  denied(() => request(user,`select public.apply_ics_import_v2('[]',${encoded(context)});`),/history_active_cycle_required/);
  denied(() => request(other,`select public.apply_google_history_v1('${randomUUID()}', '{"occurredAt":"2000-01-01T00:00Z"}',${encoded(context)});`),/history_item_before_window/);
  request(user,'select public.admin_set_networking_history_policy_v1(1,3);');
  denied(() => request(other,`select public.apply_ics_import_v2('[]',${encoded(context)});`),/history_context_stale/);
  request(user,'select public.admin_set_networking_history_policy_v1(6,4);');
  const current=JSON.parse(request(other,'select public.current_user_history_window_v1();'));
  const contact=randomUUID();
  sql(`begin; select set_config('app.networking_context',public.current_networking_context_r2b('${other}'),true);
    insert into public.contacts(id,user_id,display_name,networking_focus) values('${contact}','${other}','Synthetic',true);
    insert into public.contact_emails(user_id,contact_id,email,normalized_email,is_primary) values('${other}','${contact}','focus@example.invalid','focus@example.invalid',true); commit;`);
  const helper=file('verifiers/202610140001_verify_ics_networking_start_behavior.sql');
  const helperDefinition=helper.slice(helper.indexOf('create function pg_temp.ics_networking_start_item'),helper.indexOf('do $verify$'));
  // The temporary helper and all requests share this single transaction/session.
  const fixture=`pg_temp.ics_networking_start_item('synthetic-ux-date@example.invalid','ics-review:ics-1',current_date,'${contact}')`;
  const result=sql(`${helperDefinition} begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.apply_ics_import_v2(jsonb_build_array(${fixture}),${encoded(current)}); commit;`);
  equal(JSON.parse(result).createdCount,1);
  const repeated=sql(`${helperDefinition} begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.apply_ics_import_v2(jsonb_build_array(${fixture}),${encoded(current)}); commit;`);
  equal(JSON.parse(repeated).unchangedCount,1);
  const before=sql(`select count(*) from public.interactions where user_id='${other}';`);
  denied(() => sql(`${helperDefinition} begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.apply_ics_import_v2(jsonb_build_array(${fixture},pg_temp.ics_networking_start_item('old@example.invalid','old','2000-01-01','${contact}')),${encoded(current)}); commit;`),/ICS_IMPORT_BEFORE_NETWORKING_START/);
  equal(sql(`select count(*) from public.interactions where user_id='${other}';`),before);
  equal(request(user,`select count(*) from public.interactions where user_id='${other}';`),'0');
  // The periodic writer preserves old dates even without an active cycle.
  const account=randomUUID();
  sql(`insert into public.user_role_assignments(user_id,role_code) values('${user}','beta_tester');
    insert into public.connected_accounts(id,user_id,provider,account_email,scopes,capabilities,status,effective_scopes_verified_at,effective_scopes_verification_method)
    values('${account}','${user}','google','${user}@example.invalid',array['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/gmail.readonly'],
    '{"calendar_read":true,"gmail_read":true}','active',now(),'synthetic');`);
  const item={sourceService:'calendar',externalObjectType:'calendar_event',externalId:'synthetic-old',interactionType:'calendar',direction:'internal',occurredAt:'2000-01-01T12:00:00Z',subject:'Synthetic',participants:[],metadata:{}};
  const periodic=`select public.apply_google_periodic_v1('${account}',${encoded(item)});`;
  const first=JSON.parse(request(user,periodic));
  equal(JSON.parse(request(user,periodic)).interaction_id,first.interaction_id);
  denied(()=>request(other,periodic),/denied|not_owned|not_found|forbidden/i);
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${user}','interactions.sync_calendar','deny');`);
  denied(()=>request(user,periodic),/denied|forbidden/i);
  sql(`delete from public.user_capability_overrides where user_id='${user}' and capability_code='interactions.sync_calendar';`);
  const historyAccount=randomUUID();
  sql(`insert into public.user_role_assignments(user_id,role_code) values('${other}','beta_tester');
    insert into public.connected_accounts(id,user_id,provider,account_email,scopes,capabilities,status,effective_scopes_verified_at,effective_scopes_verification_method)
    values('${historyAccount}','${other}','google','${other}@example.invalid',array['https://www.googleapis.com/auth/gmail.readonly'],
    '{"gmail_read":true}','active',now(),'synthetic');`);
  const email={...item,sourceService:'gmail',externalObjectType:'gmail_message',externalId:'synthetic-mail',interactionType:'email',occurredAt:new Date().toISOString()};
  const historical=`select public.apply_google_history_v1('${historyAccount}',${encoded(email)},${encoded(current)});`;
  const historyResult=JSON.parse(request(other,historical));
  equal(JSON.parse(request(other,historical)).interaction_id,historyResult.interaction_id);
  equal(request(fresh,`select count(*) from public.interactions where id='${historyResult.interaction_id}';`),'0');
  const preserved=sql(`select count(*) from public.interactions where user_id='${other}';`);
  // Policy row lock: a preview cannot pass using the old policy after waiting.
  const holder=session('begin; update public.networking_history_policy set max_history_months=1,revision=revision+1; select \'HELD\';','uxdate-holder');
  try {
    await until(()=>holder.output().includes('HELD'));
    const waiter=session(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}'; select public.apply_ics_import_v2('[]',${encoded(current)}); commit;`,'uxdate-waiter');
    waiter.child.stdin.end();
    await until(()=>sql("select exists(select 1 from pg_stat_activity where application_name='uxdate-waiter' and wait_event_type='Lock');")==='t');
    holder.child.stdin.end('commit;\n');
    equal((await holder.done).code,0);
    const waited=await waiter.done;
    equal(waited.code,3); assert.match(waited.errors,/history_context_stale/); checks++;
  } finally { if (!holder.child.stdin.destroyed) holder.child.stdin.end('rollback;\n'); await holder.done; }
  const beforeClose=JSON.parse(request(other,'select public.current_user_history_window_v1();'));
  const closer=session(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.close_networking_cycle_r2b('${randomUUID()}','${legacy}','${beforeClose.context}',statement_timestamp(),'other'); select 'HELD';`,'uxdate-closer');
  try {
    await until(()=>closer.output().includes('HELD'));
    const waiter=session(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}'; select public.apply_ics_import_v2('[]',${encoded(beforeClose)}); commit;`,'uxdate-cycle-waiter');
    waiter.child.stdin.end();
    await until(()=>sql("select exists(select 1 from pg_stat_activity where application_name='uxdate-cycle-waiter' and wait_event_type='Lock');")==='t');
    closer.child.stdin.end('commit;\n');equal((await closer.done).code,0);
    const waited=await waiter.done;equal(waited.code,3);assert.match(waited.errors,/history_active_cycle_required/);checks++;
  } finally { if (!closer.child.stdin.destroyed) closer.child.stdin.end('rollback;\n'); await closer.done; }
  const legacySetting=sql(`select setting_value from public.user_settings where user_id='${other}' and setting_key='Fecha_Inicio_Networking';`);
  request(other,"select public.save_current_user_starting_point_v1(p_full_name=>'Synthetic updated',p_professional_situation_code=>'employed',p_networking_start_date=>null);");
  equal(sql(`select setting_value from public.user_settings where user_id='${other}' and setting_key='Fecha_Inicio_Networking';`),legacySetting);
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${user}','admin.manage_access','deny');`);
  denied(()=>request(user,'select public.admin_set_networking_history_policy_v1(6,6);'),/admin_manage_access_required/);
  equal(sql(`select count(*) from public.interactions where user_id='${other}';`),preserved);
  console.log(`PASS: ${checks} SQL assertions, full baseline chain + policy + import wrappers; synthetic data only.`);
} finally {
  if (identity) {
    const info = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(info.Id, identity); assert.equal(info.Config.Labels[label], run);
    docker(['rm', '-f', name]);
  }
}
