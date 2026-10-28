import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Disposable local PostgreSQL only: no network, no persistent volume, verified identity.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(root, 'cloud/supabase');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID();
const name = `cc-r2b-${run.slice(0, 10)}`;
const label = 'coffeecito.obj-02-r2b-local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
const asyncExecFile = promisify(execFile);
const asyncRequest = async (user, body) => asyncExecFile('docker', [
  'exec', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
  '-d', 'postgres', '-c', `begin; set local role authenticated;
    set local request.jwt.claim.sub='${user}'; ${body} commit;`
], { timeout: 120000 });
const sql = (body, role = 'postgres') => docker([
  'exec', '-i', '-e', 'PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', role,
  ...(role === 'postgres' ? [] : ['-h', '127.0.0.1']), '-d', 'postgres'
], { input: body });
const file = (path) => readFileSync(join(sqlRoot, path), 'utf8');
const jsonb = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const pause = (ms) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
const request = (user, body) => sql(`begin; set local role authenticated;
  set local request.jwt.claim.sub = '${user}'; ${body} commit;`);
const denied = (body, pattern) => assert.throws(() => sql(body), pattern);

let created = false;
let identity = '';
try {
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  identity = docker(['create', '--pull=never', '--name', name,
    '--label', `${label}=${run}`, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  created = true;
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = sql('select 1;') === '1'; } catch { /* startup */ }
    if (ready) break;
    await pause(100);
  }
  assert.ok(ready, 'PostgreSQL startup');
  await pause(2500);
  const inspected = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(inspected.Id, identity);
  assert.equal(inspected.Config.Labels[label], run);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');
  assert.equal(sql('select to_regclass(\'public.profiles\') is null;'), 't');
  if (sql(`select count(*) from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='email_confirmed_at';`) === '0') {
    sql('alter table auth.users add column email_confirmed_at timestamptz;', 'supabase_auth_admin');
  }
  sql(file('bootstrap/preflight_empty.sql'));
  for (const migration of readdirSync(join(sqlRoot, 'migrations')).filter((item) => item.endsWith('.sql')
    && item < '202610270001_networking_cycles_history_v1.sql').sort()) {
    sql(file(`migrations/${migration}`));
  }
  for (const seed of readdirSync(join(sqlRoot, 'seeds')).filter((item) => item.endsWith('.sql')).sort()) {
    sql(file(`seeds/${seed}`));
  }
  const user = randomUUID();
  const other = randomUUID();
  for (const [id, suffix] of [[user, 'one'], [other, 'two']]) {
    const email = `r2b-${suffix}-${run}@example.invalid`;
    sql(`insert into public.app_access_allowlist(email_normalized) values ('${email}');
      insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('${id}','authenticated','authenticated','${email}',clock_timestamp(),
      '{"provider":"google","providers":["google"]}','{}',clock_timestamp(),clock_timestamp());`);
  }
  const contact = randomUUID();
  const headhunter = randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name,networking_status,networking_focus)
      values ('${contact}','${user}','Synthetic contact','Contactado',true);
    insert into public.contacts(id,user_id,display_name,networking_status,networking_focus,is_headhunter)
      values ('${headhunter}','${user}','Synthetic headhunter','Agendado',true,true);
    insert into public.objectives(user_id,objective_name,objective_name_normalized,objective_type,priority_level)
      values ('${user}','Synthetic priority','synthetic priority','COMPANY','HIGH');`);
  sql(file('migrations/202610270001_networking_cycles_history_v1.sql'));
  assert.equal(JSON.parse(sql(file('preflight/202610270002_preflight_networking_cycle_operations_v1.sql'))).installation_state, 'clean_install');
  assert.equal(JSON.parse(sql(file('operations/dev/202610270002_check_write_pause.sql'))).authenticator_active_transactions, 0);
  sql(file('migrations/202610270002_networking_cycle_operations_v1.sql'));
  assert.equal(JSON.parse(sql(file('verifiers/202610270002_verify_networking_cycle_operations_v1.sql'))).verdict, 'pass');
  assert.equal(JSON.parse(sql(file('preflight/202610280001_preflight_google_contact_sync_r2b_context.sql'))).installation_state, 'ready');
  sql('revoke execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) from authenticated;');
  assert.equal(JSON.parse(sql(file('preflight/202610280001_preflight_google_contact_sync_r2b_context.sql'))).installation_state, 'ready');
  sql('grant execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) to authenticated;');
  sql('grant execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) to anon;');
  assert.equal(JSON.parse(sql(file('preflight/202610280001_preflight_google_contact_sync_r2b_context.sql'))).installation_state, 'stop');
  sql('revoke execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) from anon;');
  sql(`select public.set_r2b_rollout_gate('test_only','${user}');`);
  denied(file('migrations/202610280001_google_contact_sync_r2b_context.sql'), /r2b_rollout_must_be_paused/);
  assert.equal(sql("select to_regprocedure('public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)') is null;"), 't');
  assert.equal(sql("select has_function_privilege('authenticated','public.apply_google_contact_sync_change_v1(uuid,jsonb)','EXECUTE');"), 't');
  sql("select public.set_r2b_rollout_gate('paused',null);");
  sql(file('migrations/202610280001_google_contact_sync_r2b_context.sql'));
  assert.equal(JSON.parse(sql(file('verifiers/202610280001_verify_google_contact_sync_r2b_context.sql'))).verdict, 'pass');
  assert.equal(JSON.parse(sql(file('preflight/202610280001_preflight_google_contact_sync_r2b_context.sql'))).installation_state, 'stop');
  sql('grant execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) to authenticated;');
  denied(file('verifiers/202610280001_verify_google_contact_sync_r2b_context.sql'), /Legacy Google writer remains executable/);
  sql('revoke execute on function public.apply_google_contact_sync_change_v1(uuid,jsonb) from authenticated;');
  assert.equal(JSON.parse(sql(file('verifiers/202610280001_verify_google_contact_sync_r2b_context.sql'))).verdict, 'pass');
  assert.equal(request(user, 'select public.current_user_has_app_access();'), 'f');
  assert.equal(sql("select has_function_privilege('service_role', 'public.submit_contact_request_v1(text,text,text,text,text,uuid)', 'EXECUTE');"), 'f');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.set_r2b_rollout_gate('open',null); commit;`, /permission denied/);
  denied("select public.set_r2b_rollout_gate('open',null);", /r2b_rollout_transition_invalid/);
  sql(`select public.set_r2b_rollout_gate('test_only','${user}');`);
  assert.equal(request(user, 'select public.current_user_has_app_access();'), 't');
  assert.equal(request(other, 'select public.current_user_has_app_access();'), 'f');
  assert.equal(sql("select has_function_privilege('service_role', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE');"), 'f');
  sql("select public.set_r2b_rollout_gate('open',null);");
  assert.equal(sql("select has_function_privilege('service_role', 'public.submit_contact_request_v1(text,text,text,text,text,uuid)', 'EXECUTE');"), 't');
  const googleAccount = randomUUID();
  sql(`insert into public.user_role_assignments(user_id,role_code,assignment_reason)
    select '${user}','beta_tester','R2-B local fixture' where not exists
      (select 1 from public.user_role_assignments where user_id='${user}' and role_code='beta_tester');
    insert into public.connected_accounts(id,user_id,provider,account_email,scopes,capabilities,status,
      effective_scopes_verified_at,effective_scopes_verification_method)
    values ('${googleAccount}','${user}','google','r2b-local@example.invalid',
      array['https://www.googleapis.com/auth/contacts.readonly'],
      '{"contacts_read":true,"calendar_read":false,"gmail_read":false}','active',now(),'google_tokeninfo_userinfo_v0_1');`);
  assert.equal(request(user, `select public.current_user_can_sync_connected_account_v1('${googleAccount}','contacts');`), 't');
  assert.equal(sql("select has_function_privilege('authenticated','public.apply_google_contact_sync_change_v1(uuid,jsonb)','EXECUTE');"), 'f');
  assert.equal(sql("select has_function_privilege('anon','public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)','EXECUTE');"), 'f');
  assert.equal(sql("select has_function_privilege('service_role','public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)','EXECUTE');"), 'f');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_v1('${googleAccount}', '{}'::jsonb); commit;`, /permission denied/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.connected_accounts set capabilities='{}' where id='${googleAccount}'; commit;`, /permission denied/);
  const googleExternal = `people/r2b-${run}`;
  const initialLegacyCycle = sql(`select id from public.networking_cycles where user_id='${user}' and status='active';`);
  const initialGoogleToken = `active:${initialLegacyCycle}:${initialLegacyCycle}`;
  const googleNew = {
    changeType: 'new', changeId: googleExternal,
    contact: { displayName: 'Google synthetic', networkingStatus: 'Contactado', networkingFocus: true },
    externalIds: [{ externalId: googleExternal }], snapshots: [{ externalId: googleExternal, displayName: 'Google synthetic' }]
  };
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleNew)}, null, 'none:wrong'); commit;`, /networking_context_stale/);
  assert.equal(sql(`select count(*) from public.external_contact_ids where external_id='${googleExternal}';`), '0');
  const googleContact = request(user, `select public.apply_google_contact_sync_change_r2b(
    '${googleAccount}', ${jsonb(googleNew)}, '${initialLegacyCycle}', '${initialGoogleToken}');`);
  assert.match(googleContact, /^[0-9a-f-]{36}$/);
  assert.equal(sql(`select networking_status || '|' || networking_focus from public.contacts where id='${googleContact}';`), 'Contactado|true');
  const googleModified = { changeType: 'modified', changeId: googleExternal, contactId: googleContact,
    contact: { networkingStatus: 'Agendado', networkingFocus: false }, externalIds: [{ externalId: googleExternal }] };
  request(user, `select public.apply_google_contact_sync_change_r2b(
    '${googleAccount}', ${jsonb(googleModified)}, '${initialLegacyCycle}', '${initialGoogleToken}');`);
  assert.equal(sql(`select networking_status || '|' || networking_focus from public.contacts where id='${googleContact}';`), 'Agendado|false');
  const invalidAfterContactUpdate = { ...googleModified, contact: { networkingStatus: 'Cita concretada' },
    snapshots: [{ displayName: 'Invalid late snapshot' }] };
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(invalidAfterContactUpdate)},
      '${initialLegacyCycle}', '${initialGoogleToken}'); commit;`, /GOOGLE_SYNC_EXTERNAL_ID_REQUIRED/);
  assert.equal(sql(`select networking_status from public.contacts where id='${googleContact}';`), 'Agendado');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleModified)},
      null, 'none:initial'); commit;`, /GOOGLE_CONNECTED_SYNC_DENIED/);
  // Two tabs with the same empty expectation must serialize to exactly one active cycle.
  const concurrentStart = new Date(Date.now() - 3_600_000).toISOString();
  const concurrent = await Promise.allSettled([1, 2].map(() => asyncRequest(other,
    `select public.start_networking_cycle_r2b('${randomUUID()}','Concurrent',
      '${concurrentStart}','America/Santiago',null,'none:initial',false,false);`)));
  assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((entry) => entry.status === 'rejected').length, 1);
  assert.equal(sql(`select count(*) from public.networking_cycles where user_id='${other}' and status='active';`), '1');
  const legacy = initialLegacyCycle;
  const legacyInitialToken = `active:${legacy}:${legacy}`;
  assert.equal(sql(`select started_at is null and professional_situation_code_at_start is null
    from public.networking_cycles where id='${legacy}';`), 't');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.objectives set objective_name='Old tab' where user_id='${user}'; commit;`, /networking_context_stale/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.contacts set networking_focus=false where id='${contact}'; commit;`, /networking_context_stale/);
  request(user, `update public.contacts set display_name='Global identity edit' where id='${contact}';`);
  const startLegacy = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const endLegacy = new Date(Date.now() - 3_600_000).toISOString();
  const startRequest = randomUUID();
  assert.equal(request(user, `select public.configure_legacy_networking_cycle_r2b(
    '${startRequest}','${legacy}','${legacyInitialToken}','Legacy confirmed','${startLegacy}','America/Santiago');`), legacy);
  const legacyToken = `active:${legacy}:${startRequest}`;
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.save_objective_r2b('${legacy}','${legacyInitialToken}',null,
      'Stale legacy','stale legacy','COMPANY','HIGH','',true); commit;`, /networking_context_stale/);
  const legacyObjective = sql(`select id from public.objectives where user_id='${user}' and cycle_id='${legacy}';`);
  request(user, `select public.replace_contact_objectives_r2b(
    '${legacy}','${legacyToken}','${contact}',array['${legacyObjective}']::uuid[],'user');`);
  assert.equal(request(user, `select public.configure_legacy_networking_cycle_r2b(
    '${startRequest}','${legacy}','${legacyInitialToken}','Legacy confirmed','${startLegacy}','America/Santiago');`), legacy);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.close_networking_cycle_r2b('${randomUUID()}','${legacy}','${legacyToken}','${endLegacy}','stopped'); commit;`, /cycle_not_owned/);
  const closeRequest = randomUUID();
  assert.equal(request(user, `select public.close_networking_cycle_r2b(
    '${closeRequest}','${legacy}','${legacyToken}','${endLegacy}','stopped');`), legacy);
  const noneLegacy = `none:${legacy}`;
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleModified)},
      '${legacy}', '${legacyToken}'); commit;`, /networking_context_stale/);
  request(user, `select public.apply_google_contact_sync_change_r2b(
    '${googleAccount}', ${jsonb(googleModified)}, null, '${noneLegacy}');`);
  assert.equal(request(user, `select public.close_networking_cycle_r2b(
    '${closeRequest}','${legacy}','${legacyToken}','${endLegacy}','stopped');`), legacy);
  assert.equal(sql(`select count(*) from public.networking_cycle_closed_contacts where cycle_id='${legacy}';`), '3');
  assert.equal(sql(`select count(*) from public.networking_cycle_closed_assignments where cycle_id='${legacy}';`), '1');
  assert.equal(request(other, `select count(*) from public.networking_cycle_closed_contacts where cycle_id='${legacy}';`), '0');
  assert.equal(sql(`select count(*) from public.objectives where user_id='${user}' and cycle_id='${legacy}';`), '1');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    insert into public.objectives(user_id,objective_name,objective_name_normalized,objective_type)
    values ('${user}','Old tab','old tab','COMPANY'); commit;`, /networking_cycle_required/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.contacts set networking_focus=false where id='${contact}'; commit;`, /networking_context_stale/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.start_networking_cycle_r2b('${randomUUID()}','Overlap',
      '${new Date(Date.parse(startLegacy) + 3_600_000).toISOString()}',
      'America/Santiago',null,'${noneLegacy}',false,false); commit;`, /networking_cycle_date_overlap/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.start_networking_cycle_r2b('${randomUUID()}','Future',
      '${new Date(Date.now() + 86_400_000).toISOString()}',
      'America/Santiago',null,'${noneLegacy}',false,false); commit;`, /cycle_start_invalid/);
  const nextRequest = randomUUID();
  const next = request(user, `select public.start_networking_cycle_r2b('${nextRequest}', 'Next search',
    '${endLegacy}', 'America/Santiago', null, '${noneLegacy}', true, true);`);
  const nextToken = `active:${next}:${nextRequest}`;
  assert.match(next, /^[0-9a-f-]{36}$/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleModified)},
      null, '${noneLegacy}'); commit;`, /networking_context_stale/);
  assert.equal(request(user, `select public.start_networking_cycle_r2b('${nextRequest}', 'Next search',
    '${endLegacy}', 'America/Santiago', null, '${noneLegacy}', true, true);`), next);
  assert.equal(sql(`select networking_status || '|' || networking_focus || '|' || is_headhunter
    from public.contacts where id='${headhunter}';`), 'Pendiente|false|true');
  assert.equal(sql(`select networking_status || '|' || networking_focus
    from public.networking_cycle_closed_contacts where contact_id='${headhunter}';`), 'Agendado|true');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.objectives set priority_level='LOW' where cycle_id='${legacy}'; commit;`, /objective_cycle_not_active_or_owned/);
  const objective = request(user, `select public.save_objective_r2b('${next}', '${nextToken}', null, 'New priority',
    'new priority', 'COMPANY', 'HIGH', '', true);`);
  assert.match(objective, /^[0-9a-f-]{36}$/);
  assert.equal(sql(`select count(*) from public.objectives where user_id='${user}';`), '2');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    delete from public.objectives where id='${objective}'; commit;`, /objective_archive_required/);
  request(user, `select public.archive_objective_r2b('${next}','${nextToken}','${objective}');`);
  assert.equal(sql(`select is_active from public.objectives where id='${objective}';`), 'f');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${other}';
    select public.save_objective_r2b('${next}', '${nextToken}', null, 'Foreign', 'foreign', 'COMPANY','HIGH','',true); commit;`, /networking_context_stale/);
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.start_networking_cycle_r2b('${randomUUID()}','Overlap','${startLegacy}',
    'America/Santiago','${next}','${nextToken}',false,false); commit;`, /close_active_cycle_first/);
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${user}','${endLegacy}')='${next}';`), 't');
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${user}','${startLegacy}')='${legacy}';`), 't');
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${user}',null) is null;`), 't');
  // A failed local transaction must leave the previous status and closure snapshot unchanged.
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.contacts set networking_status='Contactado', networking_write_context='${nextToken}' where id='${contact}';
    select public.close_networking_cycle_r2b('${randomUUID()}','${legacy}','${legacyToken}','${endLegacy}','stopped'); commit;`, /cycle_already_closed/);
  assert.equal(sql(`select networking_status from public.contacts where id='${contact}';`), 'Pendiente');
  // Independent reset switches: status-only retains focus; focus-only retains status.
  request(user, `update public.contacts set networking_status='Contactado', networking_focus=true,
    networking_write_context='${nextToken}' where id='${contact}';`);
  const thirdStart = new Date(Date.now() - 2_400_000).toISOString();
  request(user, `select public.close_networking_cycle_r2b('${randomUUID()}','${next}','${nextToken}','${thirdStart}','other');`);
  const noneNext = `none:${next}`;
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    update public.contacts set networking_status='Agendado', networking_write_context='${noneLegacy}'
      where id='${contact}'; commit;`, /networking_context_stale/);
  const third = request(user, `select public.start_networking_cycle_r2b('${randomUUID()}',
    'Status only','${thirdStart}','America/Santiago',null,'${noneNext}',true,false);`);
  const thirdToken = sql(`select public.current_networking_context_r2b('${user}');`);
  assert.equal(sql(`select networking_status || '|' || networking_focus from public.contacts where id='${contact}';`), 'Pendiente|true');
  request(user, `update public.contacts set networking_status='Agendado',
    networking_write_context='${thirdToken}' where id='${contact}';`);
  const fourthStart = new Date(Date.now() - 1_200_000).toISOString();
  request(user, `select public.close_networking_cycle_r2b('${randomUUID()}','${third}','${thirdToken}','${fourthStart}','other');`);
  const fourth = request(user, `select public.start_networking_cycle_r2b('${randomUUID()}',
    'Focus only','${fourthStart}','America/Santiago',null,'none:${third}',false,true);`);
  assert.equal(sql(`select networking_status || '|' || networking_focus from public.contacts where id='${contact}';`), 'Agendado|false');
  const fourthToken = sql(`select public.current_networking_context_r2b('${user}');`);
  const closeFourthAt = new Date().toISOString();
  const closing = asyncRequest(user, `select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('networking-cycle'),pg_catalog.hashtext('${user}'));
    select pg_catalog.pg_sleep(0.5);
    select public.close_networking_cycle_r2b('${randomUUID()}','${fourth}',
      '${fourthToken}','${closeFourthAt}','other');`);
  let closeLockHeld = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    closeLockHeld = sql(`select not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtext('networking-cycle'),pg_catalog.hashtext('${user}'));`) === 't';
    if (closeLockHeld) break;
    await pause(50);
  }
  assert.ok(closeLockHeld, 'close session acquired context lock');
  const competingWrite = asyncRequest(user, `update public.contacts
    set networking_status='Contactado', networking_write_context='${fourthToken}'
    where id='${contact}';`);
  const googleBeforeRace = sql(`select networking_status from public.contacts where id='${googleContact}';`);
  const competingGoogleSync = asyncRequest(user, `select public.apply_google_contact_sync_change_r2b(
    '${googleAccount}', ${jsonb({ ...googleModified, contact: { networkingStatus: 'Agradecimiento enviado', networkingFocus: true } })},
    '${fourth}', '${fourthToken}');`);
  const race = await Promise.allSettled([closing, competingWrite, competingGoogleSync]);
  assert.equal(race[0].status, 'fulfilled');
  assert.equal(race[1].status, 'rejected');
  assert.equal(race[2].status, 'rejected');
  assert.match(String(race[2].reason?.stderr ?? race[2].reason), /networking_context_stale/);
  assert.equal(sql(`select networking_status from public.contacts where id='${contact}';`), 'Agendado');
  assert.equal(sql(`select networking_status from public.contacts where id='${googleContact}';`), googleBeforeRace);
  assert.equal(sql(`select networking_status from public.networking_cycle_closed_contacts
    where cycle_id='${fourth}' and contact_id='${contact}';`), 'Agendado');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.merge_contacts_deep('${headhunter}',array['${contact}']::uuid[],
      '{"name":"Merged"}'::jsonb,'test'); commit;`, /permission denied/);
  request(user, `select public.merge_contacts_deep_r2b(null,'none:${fourth}',
    '${headhunter}',array['${contact}']::uuid[],
    '{"name":"Merged","networkingStatus":"Agendado","focus":false,
      "headhunter":true,"emails":[],"phones":[]}'::jsonb,'test');`);
  assert.equal(sql(`select count(*) from public.contact_objective_assignments
    where objective_id='${legacyObjective}' and contact_id='${headhunter}';`), '1');
  assert.equal(sql(`select count(*) from public.networking_cycle_closed_assignments
    where cycle_id='${legacy}' and objective_id='${legacyObjective}' and contact_id='${contact}';`), '1');
  const googleConsolidation = { changeType: 'consolidation', changeId: `merge-${run}`,
    contactId: googleContact, mergeSourceContactIds: [headhunter],
    mergeResult: { name: 'Merged Google synthetic', company: '', role: '', networkingStatus: 'Agendado',
      focus: false, headhunter: true, emails: [], phones: [] } };
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleConsolidation)},
      null, 'none:${third}'); commit;`, /networking_context_stale/);
  assert.equal(request(user, `select public.apply_google_contact_sync_change_r2b(
    '${googleAccount}', ${jsonb(googleConsolidation)}, null, 'none:${fourth}');`), googleContact);
  assert.equal(sql(`select count(*) from public.contact_objective_assignments
    where objective_id='${legacyObjective}' and contact_id='${googleContact}';`), '1');
  assert.equal(sql(`select count(*) from public.networking_cycle_closed_assignments
    where cycle_id='${legacy}' and objective_id='${legacyObjective}' and contact_id='${contact}';`), '1');
  sql(`delete from public.app_access_allowlist where email_normalized='r2b-one-${run}@example.invalid';`);
  assert.equal(request(user, 'select public.current_user_has_app_access();'), 'f');
  assert.equal(request(user, 'select count(*) from public.networking_cycle_closed_contacts;'), '0');
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.start_networking_cycle_r2b('${randomUUID()}','Denied','${closeFourthAt}',
      'America/Santiago',null,'none:${fourth}',false,false); commit;`, /app_access_denied/);
  sql("select public.set_r2b_rollout_gate('paused',null);");
  denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}';
    select public.apply_google_contact_sync_change_r2b('${googleAccount}', ${jsonb(googleModified)},
      null, 'none:${fourth}'); commit;`, /app_access_denied/);
  assert.equal(request(other, 'select public.current_user_has_app_access();'), 'f');
  assert.equal(sql("select has_function_privilege('service_role', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE');"), 'f');
  assert.equal(JSON.parse(sql(file('verifiers/202610270002_verify_networking_cycle_operations_v1.sql'))).verdict, 'pass');
  console.log('R2-B local PostgreSQL behavior: PASS');
} finally {
  if (created) {
    const inspected = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(inspected.Id, identity);
    assert.equal(inspected.Config.Labels[label], run);
    docker(['rm', '-f', '-v', name]);
  }
}
