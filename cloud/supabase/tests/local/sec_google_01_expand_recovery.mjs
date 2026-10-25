import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
const operationRoot = join(sqlRoot, 'operations/prod');
const run = randomUUID();
const name = `cc-google-recovery-${run.slice(0, 12)}`;
const label = 'coffeecito.sec-google-expand-recovery';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const temporaryRoot = mkdtempSync(join(tmpdir(), 'coffeecito-google-recovery-'));
const snapshotPath = join(temporaryRoot, 'capture.json');
const draftPath = join(temporaryRoot, 'recovery-draft.sql');
const approvedPath = join(temporaryRoot, 'recovery-approved.sql');
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const sql = (text) => docker([
  'exec', '-i', '-e', `PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning`,
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], { input: text });
const node = (...args) => execFileSync(process.execPath, args, {
  cwd: repo, encoding: 'utf8', maxBuffer: 8e6,
}).trim();
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let created = false;
let containerId = '';

try {
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  containerId = docker([
    'create', '--pull=never', '--name', name, '--label', `${label}=${run}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image,
  ]);
  created = true;
  docker(['start', name]);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { ready = sql('select 1;') === '1'; } catch { /* startup */ }
    if (ready) break;
    await pause(100);
  }
  assert.equal(ready, true, 'Disposable PostgreSQL did not start');
  // The Supabase image briefly exposes its initialization server before the
  // final postmaster takes over. Wait through that handoff and confirm again.
  await pause(2500);
  ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { ready = sql('select 1;') === '1'; } catch { /* postmaster handoff */ }
    if (ready) break;
    await pause(100);
  }
  assert.equal(ready, true, 'Disposable PostgreSQL did not survive initialization handoff');
  assert.match(sql('show server_version;'), /^17\./);
  sql(`do $$ begin
    if current_database() <> 'postgres' or to_regclass('public.profiles') is not null
      or to_regclass('auth.users') is null or exists(select 1 from auth.users) then
      raise exception 'Not an empty disposable Supabase database';
    end if;
  end $$;`);
  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  for (const folder of ['migrations', 'seeds']) {
    const files = readdirSync(join(sqlRoot, folder))
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => !file.startsWith('202610210001_') && !file.startsWith('202610210002_'))
      .sort();
    for (const file of files) sql(readFileSync(join(sqlRoot, folder, file), 'utf8'));
  }

  // The current branch seed already describes the post-expand catalog. PROD
  // preflight must determine its own state; this synthetic fixture exercises
  // the approved pre-expand case where the four capabilities/grants are absent.
  sql(`begin;
    delete from public.app_role_capabilities where capability_code in
      ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');
    delete from public.subscription_plan_capabilities where capability_code in
      ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');
    delete from public.user_capability_overrides where capability_code in
      ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');
    delete from public.app_capabilities where capability_code in
      ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');
    commit;`);

  const rolloutPreflight = sql(readFileSync(
    join(sqlRoot, 'preflight/202610210001_preflight_google_sync_rollout_v1.sql'),
    'utf8',
  ));
  const preflightBlocks = rolloutPreflight.split(/\r?\n/).filter(Boolean);
  assert.equal(preflightBlocks.length, 7);
  for (const block of [
    'population_summary', 'access_exceptions', 'connection_states',
    'cohort_matrix', 'active_overrides', 'beta_tester_capabilities', 'planned_delta',
  ]) assert.ok(preflightBlocks.some((row) => row.includes(`|${block}|`)), block);

  const captureSql = readFileSync(join(operationRoot, '202610240001_capture_sec_google_01_expand.sql'), 'utf8');
  const capture = sql(captureSql);
  const envelope = JSON.parse(capture);
  assert.equal(envelope.capture_version, 'sec-google-01-expand-envelope-v1');
  writeFileSync(snapshotPath, `${capture}\n`, 'utf8');

  const migration = readFileSync(join(sqlRoot, 'migrations/202610210001_google_sync_capability_enforcement_v1.sql'), 'utf8');
  sql(migration);
  const functionHashes = JSON.parse(sql(`select jsonb_object_agg(
    signature,
    jsonb_build_object(
      'body_md5', md5(state.prosrc),
      'definition_md5', md5(pg_catalog.pg_get_functiondef(state.oid)),
      'owner', pg_catalog.pg_get_userbyid(state.proowner),
      'language', state.language_name,
      'security_definer', state.prosecdef,
      'volatility', state.provolatile,
      'parallel_safety', state.proparallel,
      'strict', state.proisstrict,
      'leakproof', state.proleakproof,
      'kind', state.prokind,
      'returns_set', state.proretset,
      'proconfig', state.proconfig,
      'acl', (
        select jsonb_agg(jsonb_build_object(
          'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by 2, 3)
        from pg_catalog.aclexplode(coalesce(state.proacl, pg_catalog.acldefault('f', state.proowner))) acl
      )
    ) order by signature
  ) from (
    select signature, procedure.*, language.lanname as language_name
    from unnest(array[
      'public.user_has_provider_rollout_for_user_v1(uuid,text)',
      'public.current_user_can_start_connected_oauth_v1(text)',
      'public.current_user_can_sync_connected_account_v1(uuid,text)',
      'public.finalize_google_connected_account_verified(uuid,text,text[])',
      'public.apply_google_interaction_sync_v1(uuid,jsonb)',
      'public.apply_google_contact_sync_change_v1(uuid,jsonb)'
    ]) signature
    join pg_catalog.pg_proc procedure on procedure.oid = signature::regprocedure
    join pg_catalog.pg_language language on language.oid = procedure.prolang
  ) state;`));
  console.log(JSON.stringify({ expandedFunctionHashes: functionHashes }));

  const builder = join(operationRoot, 'build-sec-google-01-expand-recovery.mjs');
  node(builder, '--snapshot', snapshotPath, '--output', draftPath);
  assert.throws(() => sql(readFileSync(draftPath, 'utf8')), /DRAFT ONLY/);
  assert.equal(sql(`select count(*) from public.app_capabilities where capability_code in
    ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');`), '4');

  node(builder, '--snapshot', snapshotPath, '--output', approvedPath, '--approve', envelope.payload_md5);
  const assertExpandStillPresent = () => {
    assert.equal(sql(`select count(*) from public.app_capabilities where capability_code in
      ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');`), '4');
    assert.equal(sql(`select count(*) from unnest(array[
      'public.apply_google_contact_sync_change_v1(uuid,jsonb)',
      'public.apply_google_interaction_sync_v1(uuid,jsonb)',
      'public.current_user_can_sync_connected_account_v1(uuid,text)',
      'public.current_user_can_start_connected_oauth_v1(text)',
      'public.user_has_provider_rollout_for_user_v1(uuid,text)'
    ]) signature where pg_catalog.to_regprocedure(signature) is not null;`), '5');
  };

  sql(`grant execute on function public.user_has_provider_rollout_for_user_v1(uuid,text) to anon;`);
  assert.throws(
    () => sql(readFileSync(approvedPath, 'utf8')),
    /Expanded function ACL changed: public.user_has_provider_rollout_for_user_v1\(uuid,text\)/,
  );
  assertExpandStillPresent();
  sql(`revoke execute on function public.user_has_provider_rollout_for_user_v1(uuid,text) from anon;`);

  sql(`alter function public.current_user_can_start_connected_oauth_v1(text) set search_path = public;`);
  assert.throws(
    () => sql(readFileSync(approvedPath, 'utf8')),
    /Expanded function definition or security properties changed: public.current_user_can_start_connected_oauth_v1\(text\)/,
  );
  assertExpandStillPresent();
  sql(`alter function public.current_user_can_start_connected_oauth_v1(text) set search_path = '';`);

  sql(`alter table public.connected_accounts disable row level security;`);
  assert.throws(
    () => sql(readFileSync(approvedPath, 'utf8')),
    /connected_accounts owner or RLS configuration changed after capture/,
  );
  assertExpandStillPresent();
  sql(`alter table public.connected_accounts enable row level security;`);

  const user = randomUUID();
  const account = randomUUID();
  const contactExternal = `people/recovery-${run}`;
  const interactionExternal = `calendar-recovery-${run}`;
  sql(`begin;
    insert into public.app_access_allowlist(email_normalized) values ('${user}@example.invalid');
    insert into auth.users(id,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
    values ('${user}','${user}@example.invalid',now(),now(),'{}','{}');
    update public.user_access_profiles set account_status='active', beta_access_status='approved' where user_id='${user}';
    insert into public.user_role_assignments(user_id,role_code,assignment_reason) values ('${user}','beta_tester','local recovery fixture');
    insert into public.connected_accounts(id,user_id,provider,account_email,scopes,capabilities,status,effective_scopes_verified_at,effective_scopes_verification_method)
    values ('${account}','${user}','google','${user}@example.invalid',
      array['https://www.googleapis.com/auth/contacts.readonly','https://www.googleapis.com/auth/calendar.readonly'],
      '{"contacts_read":true,"calendar_read":true,"gmail_read":false}','active',now(),'google_tokeninfo_userinfo_v0_1');
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${user}',true);
    select public.apply_google_contact_sync_change_v1('${account}', '${JSON.stringify({
      changeType: 'new', changeId: contactExternal, contact: { displayName: 'Recovery fixture' },
      externalIds: [{ externalId: contactExternal }], snapshots: [{ externalId: contactExternal, displayName: 'Recovery fixture' }],
    })}'::jsonb);
    select public.apply_google_interaction_sync_v1('${account}', '${JSON.stringify({
      sourceService: 'calendar', interactionType: 'calendar', direction: 'unknown', externalId: interactionExternal,
      externalObjectType: 'event', occurredAt: '2026-10-24T12:00:00Z', subject: 'Recovery fixture', participants: [],
    })}'::jsonb);
    reset role;
    insert into public.sync_cursors(user_id,connected_account_id,provider,resource_type,cursor_label,cursor_value)
    values ('${user}','${account}','google','calendar','recovery-fixture','cursor-value');
    commit;`);

  sql(readFileSync(approvedPath, 'utf8'));
  assert.equal(sql(`select count(*) from public.app_capabilities where capability_code in
    ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');`), '0');
  assert.equal(sql(`select count(*) from public.connected_accounts where id='${account}';`), '1');
  assert.equal(sql(`select count(*) from public.external_contact_ids where external_id='${contactExternal}';`), '1');
  assert.equal(sql(`select count(*) from public.external_interaction_sources where external_id='${interactionExternal}';`), '1');
  assert.equal(sql(`select count(*) from public.sync_cursors where cursor_label='recovery-fixture';`), '1');

  // Reapply expand after recovery: prior runtime compatibility and forward recovery remain available.
  sql(migration);
  for (const verifier of [
    '202610210001_verify_google_sync_capability_enforcement_v1.sql',
    '202610210001_verify_access_expand_pre_contract.sql',
  ]) sql(readFileSync(join(sqlRoot, 'verifiers', verifier), 'utf8'));

  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode,override_reason)
    values ('${user}','contacts.sync_external','deny','local recovery STOP fixture');`);
  assert.throws(
    () => sql(readFileSync(approvedPath, 'utf8')),
    /Post-expand capability references require manual recovery review/,
  );
  assert.equal(sql(`select count(*) from public.app_capabilities where capability_code in
    ('connectors.google.use','contacts.sync_external','interactions.sync_email','interactions.sync_calendar');`), '4');
  assert.equal(sql(`select to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)') is not null;`), 't');
  console.log('SEC-GOOGLE-01 expand capture/recovery PostgreSQL PASS');
} finally {
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, containerId);
    assert.equal(identity.Config.Labels[label], run);
    assert.equal(identity.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', name]);
  }
  assert.equal(existsSync(temporaryRoot), true);
  rmSync(temporaryRoot, { recursive: true });
}
