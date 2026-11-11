import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID(), name = `cc-calendar-${run.slice(0, 10)}`, label = 'coffeecito.calendar.local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 32e6, stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
// The image's temporary bootstrap server accepts Unix sockets before restarting.
// Container loopback becomes ready only for the final server; no host ports exist.
const args = ['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'];
const sql = body => docker(args, { input: body });
const file = path => readFileSync(join(root, path), 'utf8');
const pre = 'preflight/202611060001_preflight_calendar_independent.sql';
const migration = 'migrations/202611060001_calendar_independent.sql';
const verifier = 'verifiers/202611060001_verify_calendar_independent.sql';
const request = (user, body) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${body} commit;`);
let identity = '', checks = 0;
function equal(a, b) { assert.deepEqual(a, b); checks++; }
function denied(fn, expression) { assert.throws(fn, expression); checks++; }
try {
  docker(['image', 'inspect', image]);
  identity = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  let ready = false;
  for (let i=0;i<120;i++) {
    try { ready=sql('select 1;')==='1'; } catch {}
    if (ready) break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready);
  const info=JSON.parse(docker(['inspect',name]))[0];
  equal(info.HostConfig.NetworkMode,'none'); equal(Object.keys(info.HostConfig.PortBindings??{}).length,0);
  assert.match(sql('show server_version;'),/^17\./);
  await new Promise(r=>setTimeout(r,2500));
  if(sql("select count(*) from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at';")==='0') {
    docker(['exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','supabase_auth_admin','-d','postgres'],{input:'alter table auth.users add column email_confirmed_at timestamptz;'});
  }
  sql(file('bootstrap/preflight_empty.sql'));
  for(const path of readdirSync(join(root,'migrations')).filter(p=>p.endsWith('.sql')&&p<'202611040001').sort()) sql(file(`migrations/${path}`));
  for(const path of readdirSync(join(root,'seeds')).filter(p=>p.endsWith('.sql')).sort()) sql(file(`seeds/${path}`));
  sql(file('migrations/202611040001_networking_history_policy_v1.sql'));
  sql(file('migrations/202611040002_history_import_context_v1.sql'));
  if (process.argv.includes('--cancellation')) {
    const { testCalendarCancellation } = await import('./calendar_cancellation_cases.mjs');
    await testCalendarCancellation({ sql, file, request, equal, docker, name, label, run });
  } else {
  console.log('Synthetic security baseline:',sql(`select json_build_object('mode',(select mode from public.r2b_rollout_gate),'finalize_execute',has_function_privilege('service_role','public.finalize_google_connected_account_verified(uuid,text,text[])','EXECUTE'),'client_write',has_table_privilege('authenticated','public.connected_accounts','INSERT,UPDATE,DELETE'));`));
  assert.match(sql(file(pre)),/PASS/);
  denied(()=>sql(file(migration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort'; end $$; commit;")),/synthetic_abort/);
  assert.match(sql(file(pre)),/PASS/);
  sql(file(migration)); assert.match(sql(file(verifier)),/PASS/);
  denied(()=>sql('begin; alter function public.apply_google_interaction_sync_v1(uuid,jsonb) security invoker;\n'+file(verifier)),/incompatible/);
  denied(()=>sql('begin; grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to anon;\n'+file(verifier)),/public execute/);
  const user=randomUUID(), other=randomUUID();
  for(const id of [user,other]) sql(`insert into public.app_access_allowlist(email_normalized) values('${id}@example.invalid');
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('${id}','authenticated','authenticated','${id}@example.invalid',now(),'{"provider":"google","providers":["google"]}','{}',now(),now());
    update public.user_access_profiles set account_status='active',beta_access_status='approved' where user_id='${id}';`);
  sql(`select public.set_r2b_rollout_gate('test_only','${user}'); select public.set_r2b_rollout_gate('open',null);`);
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${user}','interactions.sync_calendar','grant');`);
  equal(request(user,"select public.current_user_can_start_connected_oauth_v1('google');"),'t');
  const account=sql(`select id from public.finalize_google_connected_account_verified('${user}','${user}@example.invalid',array['https://www.googleapis.com/auth/calendar.events.owned.readonly']);`);
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','calendar');`),'t');
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','email');`),'f');
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','contacts');`),'f');
  equal(request(other,`select public.current_user_can_sync_connected_account_v1('${account}','calendar');`),'f');
  const payload={sourceService:'calendar',interactionType:'calendar',direction:'unknown',externalId:'CALENDAR_synthetic',externalObjectType:'calendar_event',occurredAt:'2026-11-06T12:00:00Z',subject:'Synthetic',sourceDetail:'Source',participants:[]};
  const call=(p=payload)=>`select public.apply_google_periodic_v1('${account}','${JSON.stringify(p)}'::jsonb);`;
  equal(JSON.parse(request(user,call())).status,'created');
  const interaction=JSON.parse(request(user,call())).interaction_id;
  sql(`update public.interactions set user_notes_raw='Synthetic private note' where id='${interaction}';`);
  equal(JSON.parse(request(user,call({...payload,occurredAt:'2026-12-20T12:00:00Z'}))).status,'updated');
  equal(sql(`select user_notes_raw from public.interactions where id='${interaction}';`),'Synthetic private note');
  denied(()=>request(other,call()),/DENIED/);
  // Link a source to a pre-existing interaction: never count it as newly created.
  sql(`insert into public.interactions(user_id,provider,provider_event_id,interaction_type,direction,occurred_at,subject) values('${user}','google','CALENDAR_legacy','calendar','unknown',now(),'Synthetic legacy');`);
  equal(JSON.parse(request(user,call({...payload,externalId:'CALENDAR_legacy'}))).status,'updated');
  const concurrent=()=>new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
    child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);child.on('error',reject);
    child.on('close',code=>code===0?resolve(JSON.parse(out.trim()).status):reject(new Error(err)));
    child.stdin.end(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${call({...payload,externalId:'CALENDAR_concurrent'})} commit;`);
  });
  equal((await Promise.all([concurrent(),concurrent()])).sort(),['created','updated']);
  if (process.argv.includes('--reconciliation') || process.argv.includes('--manual-v2') || process.argv.includes('--write-boundary')) {
    const { testCalendarReconciliation } = await import('./calendar_reconciliation_cases.mjs');
    await testCalendarReconciliation({ sql, file, request, user, other, account, equal, denied });
  }
  if (process.argv.includes('--manual-v2') || process.argv.includes('--write-boundary')) {
    const { testCalendarManualV2 } = await import('./calendar_manual_v2_cases.mjs');
    const requestAsync=(who,body)=>new Promise((resolve,reject)=>{
      const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
      child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
      child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));
      child.stdin.end(`begin; set local role authenticated; set local request.jwt.claim.sub='${who}'; ${body} commit;`);
    });
    const boundary = process.argv.includes('--write-boundary');
    const beforeEngine = boundary ? async () => {
      const { testCalendarWriteBoundary } = await import('./calendar_write_boundary_cases.mjs');
      await testCalendarWriteBoundary({ sql, file, request, requestAsync, user, other, account, equal, denied });
    } : undefined;
    await testCalendarManualV2({ sql, file, request, requestAsync, user, other, equal, denied, beforeEngine });
  }
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${user}','connectors.google.use','deny');`);
  equal(request(user,"select public.current_user_can_start_connected_oauth_v1('google');"),'f');
  denied(()=>request(user,call()),/DENIED/);
  assert.match(sql(file(process.argv.includes('--write-boundary') ? 'verifiers/202611060005_verify_calendar_write_boundary.sql' : verifier)),/PASS/);
  console.log(`PASS: ${checks} Calendar SQL assertions; effective roles, rollback, legacy linking and concurrency; synthetic isolated PostgreSQL 17.`);
  }
} finally {
  if(identity){const info=JSON.parse(docker(['inspect',name]))[0];assert.equal(info.Id,identity);assert.equal(info.Config.Labels[label],run);docker(['rm','-f',name]);}
}
