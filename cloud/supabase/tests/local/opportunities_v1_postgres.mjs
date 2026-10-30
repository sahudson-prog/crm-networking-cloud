import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exerciseLifecycleHttp } from './opportunity_lifecycle_http.mjs';
import { exerciseClosure } from './opportunity_closure_postgres.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(root, 'cloud/supabase');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID();
const name = `cc-opp-${run.slice(0, 10)}`;
const label = 'coffeecito.obj-02-opportunities-local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
const sql = (body, role = 'postgres') => docker(['exec', '-i', '-e', 'PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', role,
  ...(role === 'postgres' ? [] : ['-h','127.0.0.1']), '-d', 'postgres'], { input: body });
const file = (path) => readFileSync(join(sqlRoot, path), 'utf8');
const request = (id, body) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${id}'; ${body} commit;`);
const denied = (body, pattern) => assert.throws(() => sql(body), pattern);
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const asyncExecFile = promisify(execFile);
const asyncRequest = (id, body) => asyncExecFile('docker', ['exec', name, 'psql', '-X', '-qAt',
  '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c',
  `begin; set local role authenticated; set local request.jwt.claim.sub='${id}'; ${body} commit;`],
{ timeout: 60000 });

let identity = '';
try {
  const canonicalWrapperBody = file('migrations/202610270002_networking_cycle_operations_v1.sql')
    .split('create or replace function public.merge_contacts_deep_r2b(')[1].split('as $$')[1].split('$$;')[0];
  assert.equal(createHash('md5').update(canonicalWrapperBody.replace(/\r\n?/g, '\n')).digest('hex'),
    'cd5399672fddc8c91dc7da18ff75347c', 'expected body derives from the published R2-B migration');
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  identity = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { ready = sql('select 1;') === '1'; } catch { /* startup */ }
    if (ready) break; await pause(100); }
  assert.ok(ready, 'PostgreSQL ready');
  await pause(2500);
  const inspected = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(inspected.Id, identity); assert.equal(inspected.Config.Labels[label], run);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  if (sql(`select count(*) from information_schema.columns where table_schema='auth'
    and table_name='users' and column_name='email_confirmed_at';`) === '0') {
    sql('alter table auth.users add column email_confirmed_at timestamptz;', 'supabase_auth_admin');
  }
  sql(file('bootstrap/preflight_empty.sql'));
  for (const migration of readdirSync(join(sqlRoot, 'migrations')).filter((item) => item.endsWith('.sql')
    && item < '202610290002_opportunities_v1.sql').sort()) sql(file(`migrations/${migration}`));
  for (const seed of readdirSync(join(sqlRoot, 'seeds')).filter((item) => item.endsWith('.sql')).sort()) sql(file(`seeds/${seed}`));
  const user = randomUUID(); const other = randomUUID();
  for (const [id, suffix] of [[user, 'one'], [other, 'two']]) {
    const email = `opportunity-${suffix}-${run}@example.invalid`;
    sql(`insert into public.app_access_allowlist(email_normalized) values ('${email}');
      insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('${id}','authenticated','authenticated','${email}',clock_timestamp(),
        '{"provider":"google","providers":["google"]}','{}',clock_timestamp(),clock_timestamp());`);
  }
  assert.equal(sql('select mode from public.r2b_rollout_gate where singleton;'), 'paused');
  const withoutSoftDelete = process.argv.includes('--without-soft-delete');
  if (withoutSoftDelete) sql('alter table public.interactions drop column is_deleted;');
  const preflight = JSON.parse(sql(file('preflight/202610290002_preflight_opportunities_v1.sql')));
  assert.equal(preflight.installation_state, 'clean_install', JSON.stringify({ preflight,
    wrapper: sql(`select jsonb_build_object('hash',md5(replace(replace(prosrc,chr(13)||chr(10),chr(10)),chr(13),chr(10))),
      'config',proconfig,'acl',proacl,'owner',pg_get_userbyid(proowner),'definer',prosecdef)
      from pg_proc where oid='public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)'::regprocedure;`) }));
  const wrapperSignature = 'public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)';
  const wrapperDefinition = sql(`select pg_get_functiondef('${wrapperSignature}'::regprocedure);`);
  for (const drift of [
    `grant execute on function ${wrapperSignature} to anon;`,
    `alter function ${wrapperSignature} security invoker;`,
    wrapperDefinition.replace('declare v_user', '-- incompatible body\ndeclare v_user')
  ]) {
    sql(drift);
    const before = sql(`select md5(pg_get_functiondef('${wrapperSignature}'::regprocedure)||proacl::text)
      from pg_proc where oid='${wrapperSignature}'::regprocedure;`);
    assert.ok(JSON.parse(sql(file('preflight/202610290002_preflight_opportunities_v1.sql'))).stop_reasons
      .includes('r2b_merge_contract_incompatible'));
    denied(file('migrations/202610290002_opportunities_v1.sql'), /r2b_merge_contract_incompatible/);
    assert.equal(sql(`select to_regclass('public.opportunities') is null;`), 't');
    assert.equal(sql(`select md5(pg_get_functiondef('${wrapperSignature}'::regprocedure)||proacl::text)
      from pg_proc where oid='${wrapperSignature}'::regprocedure;`), before, 'failed install preserves drift exactly');
    sql(wrapperDefinition);
    sql(`revoke execute on function ${wrapperSignature} from anon;`);
  }
  sql('create function public.save_opportunity_v1(text) returns void language sql as $$ select; $$;');
  assert.ok(JSON.parse(sql(file('preflight/202610290002_preflight_opportunities_v1.sql'))).stop_reasons
    .includes('opportunity_object_already_present'));
  denied(file('migrations/202610290002_opportunities_v1.sql'), /opportunity_object_already_present/);
  sql('drop function public.save_opportunity_v1(text);');
  sql(file('migrations/202610290002_opportunities_v1.sql'));
  const saveSignature = 'public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)';
  sql(`alter function ${saveSignature} security invoker;`);
  assert.equal(JSON.parse(sql(file('preflight/202610290003_preflight_opportunity_participants_v1.sql'))).installation_state, 'stop');
  denied(file('migrations/202610290003_opportunity_participants_v1.sql'), /opportunity_participation_contract_incompatible/);
  assert.equal(sql(`select to_regprocedure('public.assert_opportunity_participation_v1(uuid,uuid,uuid)') is null;`), 't');
  sql(`alter function ${saveSignature} security definer;`);
  assert.equal(JSON.parse(sql(file('preflight/202610290003_preflight_opportunity_participants_v1.sql'))).installation_state, 'ready');
  sql(file('migrations/202610290003_opportunity_participants_v1.sql'));
  const fixPreflight = 'preflight/202610290004_preflight_opportunity_interaction_lifecycle_v1.sql';
  const fixMigration = 'migrations/202610290004_opportunity_interaction_lifecycle_v1.sql';
  const fixVerifier = 'verifiers/202610290004_verify_opportunity_interaction_lifecycle_v1.sql';
  assert.equal(JSON.parse(sql(file(fixPreflight))).installation_state, 'ready');
  const saveDefinition = sql(`select pg_get_functiondef('${saveSignature}'::regprocedure);`);
  for (const drift of [
    `grant execute on function ${saveSignature} to anon;`,
    `alter function ${saveSignature} security invoker;`,
    `alter function ${saveSignature} reset search_path;`,
    saveDefinition.replace('declare', '-- drift\ndeclare')
  ]) {
    sql(drift);
    const fingerprint = sql(`select md5(pg_get_functiondef('${saveSignature}'::regprocedure)||proacl::text)
      from pg_proc where oid='${saveSignature}'::regprocedure;`);
    assert.equal(JSON.parse(sql(file(fixPreflight))).installation_state, 'stop');
    denied(file(fixMigration), /opportunity_lifecycle_precondition/);
    assert.equal(sql(`select to_regprocedure('public.opportunity_interaction_active_v1(jsonb)') is null;`), 't');
    assert.equal(sql(`select md5(pg_get_functiondef('${saveSignature}'::regprocedure)||proacl::text)
      from pg_proc where oid='${saveSignature}'::regprocedure;`), fingerprint);
    sql(saveDefinition); sql(`revoke execute on function ${saveSignature} from anon;`);
  }
  sql(file(fixMigration));
  assert.match(sql(file(fixVerifier)), /PASS/);
  assert.equal(JSON.parse(sql(file(fixPreflight))).installation_state, 'stop', 'never silently reinstall');
  assert.match(sql(file('verifiers/202610290003_verify_opportunity_participants_v1.sql')), /PASS/);
  assert.equal(sql('select mode from public.r2b_rollout_gate where singleton;'), 'paused', 'install does not activate R2-B');
  assert.equal(JSON.parse(sql(file('verifiers/202610290002_verify_opportunities_v1.sql'))).verdict, 'pass');
  sql(file('verifiers/202610270002_verify_networking_cycle_operations_v1.sql'));
  assert.match(sql(file('verifiers/202610290001_verify_networking_plan_interest_v1.sql')), /PASS/);
  for (const drift of [
    'alter policy opportunities_own_read on public.opportunities using (user_id=auth.uid() OR public.current_user_has_app_access());',
    'grant execute on function public.validate_opportunity_link_v1() to PUBLIC;',
    'grant usage on sequence public.opportunity_events_id_seq to authenticated;',
    'alter table public.opportunity_contacts disable trigger validate_opportunity_contacts_v1;'
  ]) {
    denied(`begin; ${drift}\n${file('verifiers/202610290002_verify_opportunities_v1.sql')}`, /Read policy invalid|Internal guard|Link ownership guard/);
    assert.equal(JSON.parse(sql(file('verifiers/202610290002_verify_opportunities_v1.sql'))).verdict, 'pass', 'drift probe rolls back');
  }
  assert.equal(JSON.parse(sql(file('preflight/202610290002_preflight_opportunities_v1.sql'))).installation_state, 'stop');
  sql(`select public.set_r2b_rollout_gate('test_only','${user}'); select public.set_r2b_rollout_gate('open',null);`);
  const cycle = request(user, `select public.start_networking_cycle_r2b('${randomUUID()}',
    'Synthetic cycle',clock_timestamp()-interval '1 day','UTC',null,'none:initial',false,false);`);
  const token = `active:${cycle}:${sql(`select start_request_id from public.networking_cycles where id='${cycle}';`)}`;
  const contact = randomUUID(); const source = randomUUID(); const foreignContact = randomUUID(); const interaction = randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name) values
    ('${contact}','${user}','Synthetic target'),('${source}','${user}','Synthetic source'),
    ('${foreignContact}','${other}','Synthetic foreign');
    insert into public.interactions(id,user_id,interaction_type) values ('${interaction}','${user}','manual');
    insert into public.interaction_participants(user_id,interaction_id,contact_id)
      values('${user}','${interaction}','${source}');`);
  const objective = request(user, `select public.save_objective_r2b('${cycle}','${token}',null,
    'Synthetic priority','synthetic priority','COMPANY','HIGH','',true);`);
  if (process.argv.includes('--closure')) {
    await exerciseClosure({root,docker,sql,file,request,denied,name,label,run,user,other,cycle,token,contact,source,foreignContact,interaction,objective,pause,asyncRequest});
  } else {
  console.log('Legacy 002/003/004 SQL phase only; current runtime HTTP is certified by --closure.');
  // Coordinate a real row-lock wait, then commit dismissal before admission resumes.
  const holder = spawn('docker',['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']});
  const holderDone = new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('exit',code=>code===0?resolve():reject(new Error('lifecycle lock holder failed')));});
  holder.stdout.resume();holder.stderr.resume();
  let pending;
  try {
    holder.stdin.write(`begin; set local application_name='opp-lifecycle-holder';
      select id from public.interactions where id='${interaction}' for update;\n`);
    let locked=false;
    for(let i=0;i<100;i++) { locked=sql(`select exists(select 1 from pg_stat_activity where application_name='opp-lifecycle-holder' and state='idle in transaction');`)==='t';if(locked)break;await pause(50); }
    assert.ok(locked,'holder has acquired the row lock');
    pending=asyncRequest(user,`set local application_name='opp-lifecycle-waiter';
      select public.save_opportunity_v1('${cycle}','${token}',null,null,'Dismiss race','','','identified',null,null,
        array['${source}']::uuid[],array[]::uuid[],array['${interaction}']::uuid[],gen_random_uuid());`)
      .then(()=>null,error=>error);
    let waiting=false;
    for(let i=0;i<100;i++) {waiting=sql(`select exists(select 1 from pg_stat_activity where application_name='opp-lifecycle-waiter' and wait_event_type='Lock');`)==='t';if(waiting)break;await pause(50);}
    assert.ok(waiting,'save is demonstrably waiting, not inferred from a sleep');
    holder.stdin.end(`update public.interactions set metadata='{"dismissed":true}' where id='${interaction}'; commit;\n`);
    await holderDone;
    const rejected=await pending;assert.ok(rejected);assert.match(rejected.stderr,/invalid_opportunity_relation/);
    assert.equal(sql(`select count(*) from public.opportunities where title='Dismiss race';`),'0');
    sql(`update public.interactions set metadata='{}' where id='${interaction}';`);
    console.log('PASS deterministic lifecycle concurrency: lock wait -> dismissal COMMIT -> rejected save, no partial writes');
  } finally {
    if(!holder.stdin.destroyed)holder.stdin.end('rollback;\n');
    await holderDone; if(pending)await pending;
  }
  const titleOnly = request(user, `select public.save_opportunity_v1('${cycle}','${token}',null,null,
    'Title only','','','identified',null,null,array[]::uuid[],array[]::uuid[],array[]::uuid[],gen_random_uuid());`);
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${titleOnly}';`), '0');
  request(user, `select public.void_opportunity_v1('${cycle}','${token}','${titleOnly}');`);
  const unrelatedInteraction = randomUUID();
  sql(`insert into public.interactions(id,user_id,interaction_type) values('${unrelatedInteraction}','${user}','manual');`);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_opportunity_v1('${cycle}','${token}',null,null,'Manipulated','','','identified',null,null,
      array['${source}']::uuid[],array[]::uuid[],array['${unrelatedInteraction}']::uuid[],gen_random_uuid());
    commit;`, /opportunity_interaction_requires_contact/);
  request(user, `select public.replace_contact_objectives_r2b('${cycle}','${token}','${source}',
    array['${objective}']::uuid[],'user');`);
  const save = (who, id, stage, result, contactIds = [source], creationRequestId = randomUUID()) => request(who,
    `select public.save_opportunity_v1('${cycle}','${token}',${id ? `'${id}'` : 'null'},
      ${id ? `'${sql(`select updated_at from public.opportunities where id='${id}';`)}'` : 'null'},
      'Synthetic opportunity','Synthetic company','', '${stage}',${result ? `'${result}'` : 'null'},null,
      array[${contactIds.map((value) => `'${value}'`).join(',')}]::uuid[],array['${objective}']::uuid[],array['${interaction}']::uuid[],'${creationRequestId}');`);
  const creationRequestId = randomUUID();
  const createSql = `select public.save_opportunity_v1('${cycle}','${token}',null,null,
    'Synthetic opportunity','Synthetic company','','identified',null,null,
    array['${source}']::uuid[],array['${objective}']::uuid[],array['${interaction}']::uuid[],'${creationRequestId}');`;
  const simultaneousCreates = await Promise.all([asyncRequest(user, createSql), asyncRequest(user, createSql)]);
  const opportunity = simultaneousCreates[0].stdout.trim();
  assert.equal(simultaneousCreates[1].stdout.trim(), opportunity, 'same concurrent creation request has one identity');
  assert.equal(save(user, null, 'identified', null, [source,source], creationRequestId), opportunity,
    'lost response retry and duplicate input links do not create another row');
  assert.throws(() => save(user, null, 'applied', null, [source], creationRequestId), /opportunity_request_conflict/);
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${opportunity}';`), '1');
  denied(`insert into public.opportunity_contacts(user_id,opportunity_id,contact_id)
    values('${other}','${opportunity}','${foreignContact}');`, /opportunity_link_owner_mismatch/);
  denied(`update public.opportunities set result_note='Not a result' where id='${opportunity}';`, /check constraint/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    insert into public.opportunity_contacts(user_id,opportunity_id,contact_id)
      values('${user}','${opportunity}','${contact}'); commit;`, /permission denied/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_opportunity_v1('${cycle}','${token}',null,null,'Foreign relation','','','identified',null,null,
      array['${foreignContact}']::uuid[],array[]::uuid[],array[]::uuid[],gen_random_uuid()); commit;`, /invalid_opportunity_relation/);
  assert.equal(sql(`select count(*) from public.opportunities where user_id='${user}' and voided_at is null;`), '1');
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${opportunity}';`), '1');
  denied(`delete from public.interaction_participants where interaction_id='${interaction}';`,
    /opportunity_interaction_requires_contact/);
  assert.equal(sql(`select count(*) from public.interaction_participants where interaction_id='${interaction}';`), '1');
  const participantHolder = asyncExecFile('docker', ['exec', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-c',
    `begin; select 1 from public.opportunities where id='${opportunity}' for update; select pg_sleep(6); commit;`],
  { timeout: 30000 });
  let holding = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    holding = sql(`select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid()
      and query like '%pg_sleep(6)%' and query like '%${opportunity}%' and state='active');`) === 't';
    if (holding) break;
    await pause(100);
  }
  assert.ok(holding, 'one real session holds the opportunity row lock');
  const deletion = asyncExecFile('docker', ['exec', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-c',
    `delete from public.interaction_participants where interaction_id='${interaction}';`],
  { timeout: 30000 }).then(() => null, (error) => error);
  let waiting = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    waiting = sql(`select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid()
      and query like 'delete from public.interaction_participants%' and wait_event_type='Lock');`) === 't';
    if (waiting) break;
    await pause(100);
  }
  assert.ok(waiting, 'deletion waits for the opportunity lock before checking participation');
  await participantHolder;
  assert.match(String((await deletion)?.stderr), /opportunity_interaction_requires_contact/);
  assert.equal(sql(`select count(*) from public.interaction_participants where interaction_id='${interaction}';`), '1');
  assert.equal(sql(`select count(*) from public.opportunity_interactions where opportunity_id='${opportunity}';`), '1');
  assert.equal(request(other, `select count(*) from public.opportunities where id='${opportunity}';`), '0');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.save_opportunity_v1('${cycle}','${token}','${opportunity}',null,'Cross user','','','applied',null,null,
      array[]::uuid[],array[]::uuid[],array[]::uuid[]); commit;`, /networking_context_stale|opportunity_not_found/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.opportunities set stage='finished' where id='${opportunity}'; commit;`, /permission denied/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_opportunity_v1('${cycle}','${token}','${opportunity}',null,
      'Synthetic opportunity','','','finished',null,null,array[]::uuid[],array[]::uuid[],array[]::uuid[]); commit;`, /invalid_opportunity/);
  save(user, opportunity, 'offer_received', null);
  for (const result of ['offer_accepted','offer_declined','not_selected','withdrawn','no_progress','other']) {
    save(user, opportunity, 'finished', result);
    assert.equal(sql(`select result from public.opportunities where id='${opportunity}';`), result);
    save(user, opportunity, 'identified', null);
  }
  save(user, opportunity, 'applied', null);
  assert.equal(sql(`select stage from public.opportunities where id='${opportunity}';`), 'applied');
  save(user, opportunity, 'finished', 'offer_accepted');
  assert.equal(sql(`select result from public.opportunities where id='${opportunity}';`), 'offer_accepted');
  save(user, opportunity, 'in_process', null);
  assert.equal(sql(`select result is null from public.opportunities where id='${opportunity}';`), 't');
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${opportunity}' and kind='reopened';`), '7');
  const otherVersion = sql(`select updated_at from public.opportunities where id='${opportunity}';`);
  request(user, `select public.save_opportunity_v1('${cycle}','${token}','${opportunity}','${otherVersion}',
    'Synthetic opportunity','Synthetic company','','finished','other','Synthetic explanation',
    array['${source}']::uuid[],array['${objective}']::uuid[],array['${interaction}']::uuid[]);`);
  assert.equal(sql(`select result_note from public.opportunities where id='${opportunity}';`), 'Synthetic explanation');
  save(user, opportunity, 'in_process', null);
  assert.equal(sql(`select result_note is null from public.opportunities where id='${opportunity}';`), 't');
  const expectedVersion = sql(`select updated_at from public.opportunities where id='${opportunity}';`);
  const competing = ["Competing A", "Competing B"].map((title) => asyncRequest(user,
    `select public.save_opportunity_v1('${cycle}','${token}','${opportunity}','${expectedVersion}',
      '${title}','','','in_process',null,null,array['${source}']::uuid[],
      array['${objective}']::uuid[],array['${interaction}']::uuid[]);`));
  const outcomes = await Promise.allSettled(competing);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1, 'only one stale concurrent edit commits');
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1, 'second edit rejected');
  // A deep merge moves all valid links from source to target without duplicating existing target links.
  const second = save(user, null, 'applied', null, [contact, source]);
  const beforeMergeVersion = sql(`select updated_at from public.opportunities where id='${second}';`);
  const mergeResult = JSON.stringify({ name: 'Synthetic merged', company: '', role: '', emails: [], phones: [],
    networkingStatus: 'Pendiente', focus: false, headhunter: false }).replaceAll("'", "''");
  const legacyProbe = sql(`begin; set local request.jwt.claim.sub='${user}';
    select pg_catalog.set_config('app.networking_context','merge:${token}',true);
    select public.merge_contacts_deep('${contact}',array['${source}']::uuid[],
      '${mergeResult}'::jsonb,'contact_merge');
    select count(*) from public.opportunity_contacts where opportunity_id='${opportunity}' and contact_id='${contact}';
    rollback;`);
  assert.equal(legacyProbe.split(/\r?\n/).at(-1), '0', 'canonical merge alone does not transfer new opportunity links');
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${opportunity}' and contact_id='${source}';`), '1',
    'probe rolled back without changing the fixture');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.merge_contacts_deep_r2b('${cycle}','${token}','${contact}',
      array['${source}']::uuid[],'{}'::jsonb,'contact_merge'); commit;`, /nombre del contacto resultante/i);
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${opportunity}' and contact_id='${source}';`), '1',
    'failed merge rolls back link transfer');
  request(user, `select public.merge_contacts_deep_r2b('${cycle}','${token}','${contact}',
    array['${source}']::uuid[],'${mergeResult}'::jsonb,'contact_merge');`);
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${opportunity}' and contact_id='${contact}';`), '1');
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${second}';`), '1');
  assert.equal(sql(`select count(*) from public.opportunity_contacts where contact_id='${source}';`), '0');
  assert.equal(sql(`select count(*) from public.opportunity_events where kind='merge_contacts';`), '2');
  assert.equal(sql(`select count(*) from public.contact_objective_assignments
    where objective_id='${objective}' and contact_id='${contact}';`), '1');
  assert.notEqual(sql(`select updated_at from public.opportunities where id='${second}';`), beforeMergeVersion);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_opportunity_v1('${cycle}','${token}','${second}','${beforeMergeVersion}',
      'Stale editor','','','applied',null,null,array[]::uuid[],array[]::uuid[],array[]::uuid[]); commit;`, /opportunity_stale/);
  // Archiving a linked priority must not freeze title/stage edits or discard history.
  request(user, `select public.archive_objective_r2b('${cycle}','${token}','${objective}');`);
  save(user, second, 'in_process', null, [contact]);
  assert.equal(sql(`select count(*) from public.opportunity_objectives where opportunity_id='${second}';`), '1');
  assert.throws(() => save(user, null, 'identified', null, [contact]), /invalid_opportunity_relation/);
  request(user, `select public.void_opportunity_v1('${cycle}','${token}','${opportunity}');`);
  request(user, `select public.void_opportunity_v1('${cycle}','${token}','${opportunity}');`);
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${opportunity}' and kind='voided';`), '1');
  assert.equal(sql(`select count(*) from public.opportunities where cycle_id='${cycle}' and voided_at is null;`), '1');
  assert.equal(request(other, `select count(*) from public.opportunity_events;`), '0');
  const closed = request(user, `select public.close_networking_cycle_r2b('${randomUUID()}',
    '${cycle}','${token}',clock_timestamp(),'stopped');`);
  assert.equal(closed, cycle);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.void_opportunity_v1('${cycle}','${token}','${second}'); commit;`, /networking_context_stale/);
  const nextCycle = request(user, `select public.start_networking_cycle_r2b('${randomUUID()}',
    'Next search',clock_timestamp(),'UTC',null,'none:${cycle}',false,false);`);
  assert.notEqual(nextCycle, cycle);
  assert.equal(sql(`select count(*) from public.opportunities where cycle_id='${cycle}' and title<>'Title only';`), '2');
  assert.equal(sql(`select count(*) from public.opportunities where cycle_id='${nextCycle}';`), '0');
  const nextToken = `active:${nextCycle}:${sql(`select start_request_id from public.networking_cycles where id='${nextCycle}';`)}`;
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_opportunity_v1('${nextCycle}','${nextToken}',null,null,'Wrong priority','','','identified',null,null,
      array[]::uuid[],array['${objective}']::uuid[],array[]::uuid[],gen_random_uuid()); commit;`, /invalid_opportunity_relation/);
  const finalContact = randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name) values('${finalContact}','${user}','Synthetic final target');`);
  request(user, `select public.merge_contacts_deep_r2b('${nextCycle}','${nextToken}','${finalContact}',
    array['${contact}']::uuid[],'${mergeResult}'::jsonb,'contact_merge');`);
  assert.equal(sql(`select count(*) from public.contact_objective_assignments
    where objective_id='${objective}' and contact_id='${finalContact}';`), '1', 'historical priority inherited');
  assert.equal(sql(`select count(*) from public.opportunity_contacts
    where opportunity_id='${second}' and contact_id='${finalContact}';`), '1', 'historical opportunity inherited');
  assert.equal(sql(`select count(*) from public.opportunities where cycle_id='${nextCycle}';`), '0', 'merge never relocates cycles');
  sql(`update public.app_access_allowlist set revoked_at=clock_timestamp()
    where email_normalized like 'opportunity-one-${run}@example.invalid';`);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.void_opportunity_v1('${nextCycle}','${nextToken}','${second}'); commit;`, /app_access_denied/);
  sql(`update public.app_access_allowlist set revoked_at=null
    where email_normalized like 'opportunity-one-${run}@example.invalid';`);
  request(user, `select public.request_networking_plan_notice_v1('PERSONAL_BRAND');`);
  request(user, `select count(*) from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');`);
  assert.equal(sql(`select count(*) from public.opportunities where user_id='${user}';`), '0');
  assert.equal(sql(`select count(*) from public.opportunity_events where user_id='${user}';`), '0');
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${user}';`), '1');
  assert.equal(JSON.parse(sql(file('verifiers/202610290002_verify_opportunities_v1.sql'))).verdict, 'pass');
  assert.match(sql(file('verifiers/202610290003_verify_opportunity_participants_v1.sql')), /PASS/);
  assert.match(sql(file(fixVerifier)), /PASS/);
  console.log(`PASS opportunities_v1 PostgreSQL (${withoutSoftDelete ? 'without' : 'with'} is_deleted): 002->003->004, fail-closed install/rollback, ACL/RLS, idempotency, transitions, concurrency, reopen, void, historical merge, archived links, cycles, reset`);
  }
} finally {
  if (identity) {
    const inspected = JSON.parse(docker(['inspect', name]))[0];
    if (inspected.Id === identity && inspected.Config.Labels[label] === run
      && inspected.HostConfig.NetworkMode === 'none') docker(['rm', '-f', name]);
  }
}
