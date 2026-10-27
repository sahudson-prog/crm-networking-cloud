import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only certification against an identified, network-isolated PostgreSQL 17 container.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
const run = randomUUID();
const name = `cc-obj02-r2a-${run.slice(0, 10)}`;
const label = 'coffeecito.obj-02-r2a-certification';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const migrationFile = '202610270001_networking_cycles_history_v1.sql';
const migration = readFileSync(join(sqlRoot, 'migrations', migrationFile), 'utf8');
const preflight = readFileSync(join(sqlRoot, 'preflight/202610270001_preflight_networking_cycles_history_v1.sql'), 'utf8');
const standaloneReset = readFileSync(join(sqlRoot, 'reset_current_user_app_data_v0_1.sql'), 'utf8');
const observedDevVariant = process.env.R2A_RESET_VARIANT === 'hardened-standalone-crlf';
assert.ok(!process.env.R2A_RESET_VARIANT || observedDevVariant,
  'R2A_RESET_VARIANT must be hardened-standalone-crlf when set');
const hardenedStandaloneReset = standaloneReset
  .replace('security invoker', 'security definer')
  .replace('set search_path = public, pg_temp', "set search_path = ''")
  .concat(`
    alter function public.reset_current_user_app_data_v0_1(text) owner to postgres;
    revoke all on function public.reset_current_user_app_data_v0_1(text)
      from public, anon, authenticated, service_role, supabase_auth_admin;
    grant execute on function public.reset_current_user_app_data_v0_1(text) to authenticated;
  `);
assert.notEqual(hardenedStandaloneReset, standaloneReset);
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const psqlArgs = (database = 'postgres', app = `${name}-certifier`, user = 'postgres') => [
  'exec', '-i', '-e', `PGAPPNAME=${app}`,
  '-e', 'PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=30000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user,
  ...(user === 'postgres' ? [] : ['-h', '127.0.0.1']), '-d', database,
];
const sql = (text, database = 'postgres', app = `${name}-certifier`) => docker(psqlArgs(database, app), { input: text });
const sqlAs = (text, user, database = 'postgres') => docker(
  psqlArgs(database, `${name}-${user}`, user), { input: text },
);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const children = new Set();

function session(database, app, text, close = true) {
  const child = spawn('docker', psqlArgs(database, app), { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { error += chunk; });
  const done = new Promise((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      children.delete(child);
      resolvePromise({ code, output, error });
    });
  });
  child.stdin.write(text);
  if (close) child.stdin.end();
  return { child, done, output: () => output };
}

async function until(check, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (check()) return; } catch { /* retry while PostgreSQL changes state */ }
    await pause(75);
  }
  throw new Error(`Timed out: ${description}`);
}

function createAuthUser(userId, email) {
  sql(`insert into public.app_access_allowlist(email_normalized) values ('${email}');
    insert into auth.users(
      id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values (
      '${userId}','authenticated','authenticated','${email}',clock_timestamp(),
      '{"provider":"google","providers":["google"]}','{}',clock_timestamp(),clock_timestamp()
    );`);
}

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
  await until(() => sql('select 1;') === '1', 'local PostgreSQL startup');
  await pause(2500);
  assert.match(sql('show server_version;'), /^17\./);
  const identity = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(identity.Id, containerId);
  assert.equal(identity.Config.Labels[label], run);
  assert.equal(identity.HostConfig.NetworkMode, 'none');
  sql(`do $$ begin
    if current_database() <> 'postgres' or to_regclass('public.profiles') is not null
      or to_regclass('auth.users') is null or exists(select 1 from auth.users) then
      raise exception 'Not an empty disposable Supabase database';
    end if;
  end $$;`);

  if (sql(`select count(*) from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='email_confirmed_at';`) === '0') {
    sqlAs('alter table auth.users add column email_confirmed_at timestamptz;', 'supabase_auth_admin');
  }
  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  for (const file of readdirSync(join(sqlRoot, 'migrations'))
    .filter((entry) => entry.endsWith('.sql') && entry !== migrationFile).sort()) {
    sql(readFileSync(join(sqlRoot, 'migrations', file), 'utf8'));
  }
  for (const file of readdirSync(join(sqlRoot, 'seeds')).filter((entry) => entry.endsWith('.sql')).sort()) {
    sql(readFileSync(join(sqlRoot, 'seeds', file), 'utf8'));
  }

  const legacyUser = randomUUID();
  const legacyEmail = `r2a-legacy-${run}@example.invalid`;
  createAuthUser(legacyUser, legacyEmail);
  sql(`update public.profiles set professional_situation_code='employed' where id='${legacyUser}';
    insert into public.objectives(
      user_id,objective_name,objective_name_normalized,objective_type,priority_level
    ) values ('${legacyUser}','Legacy priority','legacy priority','COMPANY','HIGH');
    insert into public.contacts(user_id,display_name,networking_status,networking_focus)
    values ('${legacyUser}','Synthetic legacy','Contactado',true);
    insert into public.interactions(user_id,interaction_type,direction,occurred_at,subject)
    values ('${legacyUser}','calendar','unknown','2026-01-15T12:00:00Z','Synthetic legacy');`);

  const clean = JSON.parse(sql(preflight));
  assert.equal(clean.installation_state, 'clean_install');
  assert.equal(clean.reset_body_variant, 'canonical_migration');
  assert.deepEqual(clean.stop_reasons, {});
  assert.equal(clean.legacy_population.objectives, 1);

  const unexpectedInteractionColumn = JSON.parse(sql(`begin;
    alter table public.interactions add column cycle_id uuid;
    ${preflight}`));
  assert.equal(unexpectedInteractionColumn.installation_state, 'incompatible');
  assert.equal(unexpectedInteractionColumn.stop_reasons.unexpected_interactions_cycle_id, true);
  assert.throws(() => sql(`begin;
    alter table public.interactions add column cycle_id uuid;
    ${migration}`), /interactions\.cycle_id already exists/);
  const incompatibleReset = JSON.parse(sql(`begin;
    alter function public.reset_current_user_app_data_v0_1(text) security invoker;
    ${preflight}`));
  assert.equal(incompatibleReset.installation_state, 'incompatible');
  assert.equal(incompatibleReset.stop_reasons.unexpected_reset_contract, true);
  assert.equal(JSON.parse(sql(preflight)).installation_state, 'clean_install');

  if (observedDevVariant) {
    sql(hardenedStandaloneReset.replace(/\r?\n/g, '\r\n'));
    const observed = JSON.parse(sql(`select json_build_object(
      'crlf', position(chr(13) || chr(10) in procedure.prosrc) > 0,
      'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
      'definer', procedure.prosecdef,
      'search_path', procedure.proconfig,
      'authenticated_execute', has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
      'anon_execute', has_function_privilege('anon', procedure.oid, 'EXECUTE')
    ) from pg_catalog.pg_proc procedure
    where procedure.oid = 'public.reset_current_user_app_data_v0_1(text)'::regprocedure;`));
    assert.deepEqual(observed, {
      crlf: true, owner: 'postgres', definer: true, search_path: ['search_path=""'],
      authenticated_execute: true, anon_execute: false,
    });
    const observedPreflight = JSON.parse(sql(preflight));
    assert.equal(observedPreflight.reset_body_sha256,
      '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d');
    assert.equal(observedPreflight.reset_body_variant,
      'standalone_without_sync_change_suppressions');
    assert.equal(observedPreflight.installation_state, 'clean_install');
    assert.deepEqual(observedPreflight.stop_reasons, {});

    const unknownBody = hardenedStandaloneReset.replace(
      "if p_confirmation <> 'BORRAR MIS DATOS' then",
      "if p_confirmation <> 'BORRAR MIS DATOS' or false then",
    ).replace(/\r?\n/g, '\r\n');
    assert.notEqual(unknownBody, hardenedStandaloneReset.replace(/\r?\n/g, '\r\n'));
    const unknownPreflight = JSON.parse(sql(`begin; ${unknownBody} ${preflight}`));
    assert.equal(unknownPreflight.installation_state, 'incompatible');
    assert.equal(unknownPreflight.stop_reasons.unexpected_reset_contract, true);
    assert.throws(() => sql(`begin; ${unknownBody} ${migration}`),
      /reset_current_user_app_data_v0_1 differs from the R2-A baseline/);

    const unsafeGrant = 'grant execute on function public.reset_current_user_app_data_v0_1(text) to anon;';
    const grantPreflight = JSON.parse(sql(`begin; ${unsafeGrant} ${preflight}`));
    assert.equal(grantPreflight.installation_state, 'incompatible');
    assert.equal(grantPreflight.stop_reasons.unexpected_reset_contract, true);
    assert.throws(() => sql(`begin; ${unsafeGrant} ${migration}`),
      /reset_current_user_app_data_v0_1 differs from the R2-A baseline/);
    const grantOptionPreflight = JSON.parse(sql(`begin;
      grant execute on function public.reset_current_user_app_data_v0_1(text)
        to authenticated with grant option;
      ${preflight}`));
    assert.equal(grantOptionPreflight.installation_state, 'incompatible');
    assert.equal(grantOptionPreflight.stop_reasons.unexpected_reset_contract, true);
    const unsafeVolatility = JSON.parse(sql(`begin;
      alter function public.reset_current_user_app_data_v0_1(text) stable;
      ${preflight}`));
    assert.equal(unsafeVolatility.installation_state, 'incompatible');
    assert.equal(unsafeVolatility.stop_reasons.unexpected_reset_contract, true);
    assert.equal(JSON.parse(sql(preflight)).installation_state, 'clean_install');
    console.log('Observed hardened standalone reset with CRLF accepted; unknown body and unsafe ACL blocked: PASS');
  }
  sql(migration);
  const installedReset = JSON.parse(sql(`select json_build_object(
    'has_sync_suppressions', position('sync_change_suppressions' in procedure.prosrc) > 0,
    'has_cycles', position('networking_cycles' in procedure.prosrc) > 0,
    'has_professional_history', position('professional_situation_transitions' in procedure.prosrc) > 0,
    'has_contact_history', position('contact_networking_transitions' in procedure.prosrc) > 0,
    'authenticated_execute', has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
    'anon_execute', has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ) from pg_catalog.pg_proc procedure
  where procedure.oid = 'public.reset_current_user_app_data_v0_1(text)'::regprocedure;`));
  assert.deepEqual(installedReset, {
    has_sync_suppressions: true, has_cycles: true,
    has_professional_history: true, has_contact_history: true,
    authenticated_execute: true, anon_execute: false,
  });

  for (const file of [
    '202610270001_verify_networking_cycles_history_v1.sql',
    '202610270001_verify_networking_cycles_history_v1_behavior.sql',
    '202610270001_verify_access_networking_cycles_composed.sql',
    '202610260001_verify_starting_point_v1.sql',
    '202610260001_verify_starting_point_v1_behavior.sql',
    '202610210001_verify_google_sync_capability_enforcement_v1.sql',
    '202610210001_verify_google_sync_capability_enforcement_behavior.sql',
    '202610140001_verify_ics_networking_start_contract.sql',
    '202609290002_verify_merge_reset_grants.sql',
  ]) {
    sql(readFileSync(join(sqlRoot, 'verifiers', file), 'utf8'));
    console.log(`${file}: PASS`);
  }

  const legacyState = JSON.parse(sql(`select json_build_object(
    'cycles',(select count(*) from public.networking_cycles where user_id='${legacyUser}'),
    'unknown_dates',(select count(*) from public.networking_cycles where user_id='${legacyUser}' and started_on is null),
    'assigned',(select count(*) from public.objectives where user_id='${legacyUser}' and cycle_id is not null),
    'situation_history',(select count(*) from public.professional_situation_transitions where user_id='${legacyUser}'),
    'contact_history',(select count(*) from public.contact_networking_transitions where user_id='${legacyUser}')
  );`));
  assert.deepEqual(legacyState, {
    cycles: 1, unknown_dates: 1, assigned: 1, situation_history: 0, contact_history: 0,
  });
  console.log('Conservative legacy backfill without fabricated dates or history: PASS');

  const knownUser = randomUUID();
  createAuthUser(knownUser, `r2a-known-${run}@example.invalid`);
  sql(`update public.profiles set professional_situation_code='independent' where id='${knownUser}';
    insert into public.networking_cycles(user_id,objective_type,status,started_on,origin)
    values ('${knownUser}','JOB_SEARCH','active','2026-02-01','user');`);
  assert.equal(sql(`select professional_situation_code_at_start from public.networking_cycles
    where user_id='${knownUser}';`), 'independent');
  sql(`update public.profiles set professional_situation_code='unemployed' where id='${knownUser}';
    update public.networking_cycles set started_on='2026-02-02' where user_id='${knownUser}';`);
  assert.equal(sql(`select professional_situation_code_at_start from public.networking_cycles
    where user_id='${knownUser}';`), 'independent');
  assert.throws(() => sql(`update public.networking_cycles
    set professional_situation_code_at_start='unemployed' where user_id='${knownUser}';`),
    /networking_cycle_identity_or_snapshot_immutable/);
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${knownUser}','2026-01-31T23:59:59Z') is null;`), 't');
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${knownUser}','2026-02-01T12:00:00Z') is null;`), 't');
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${knownUser}','2026-02-02T00:00:00Z') is not null;`), 't');
  assert.equal(sql(`select public.networking_cycle_for_event_v1('${knownUser}',null) is null;`), 't');
  assert.throws(() => sql(`insert into public.networking_cycles(user_id,objective_type,status,started_on,origin)
    values ('${knownUser}','JOB_SEARCH','closed','2026-02-10','user');`), /networking_cycle_invalid_state/);
  assert.throws(() => sql(`insert into public.networking_cycles(user_id,objective_type,status,started_on,closed_at,origin)
    values ('${knownUser}','JOB_SEARCH','closed','2026-02-10','2026-03-01T00:00:00Z','user');`), /networking_cycle_date_overlap/);
  console.log('Snapshot, temporal attribution and overlap rejection: PASS');

  const rollbackContact = randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name) values ('${rollbackContact}','${knownUser}','Rollback synthetic');`);
  const beforeRollback = sql(`select count(*) || '|' || networking_status
    from public.contact_networking_transitions ledger
    join public.contacts contact on contact.id='${rollbackContact}'
    where ledger.contact_id='${rollbackContact}' group by contact.networking_status;`);
  const failed = await session('postgres', `${name}-rollback`, `begin;
    update public.contacts set networking_status='Contactado' where id='${rollbackContact}';
    select 1/0;`).done;
  assert.notEqual(failed.code, 0);
  assert.equal(sql(`select count(*) || '|' || networking_status
    from public.contact_networking_transitions ledger
    join public.contacts contact on contact.id='${rollbackContact}'
    where ledger.contact_id='${rollbackContact}' group by contact.networking_status;`), beforeRollback);
  console.log('Trigger write and source row roll back atomically after a deliberate error: PASS');

  const concurrentUser = randomUUID();
  createAuthUser(concurrentUser, `r2a-concurrent-${run}@example.invalid`);
  const firstApp = `${name}-cycle-first`;
  const secondApp = `${name}-cycle-second`;
  const first = session('postgres', firstApp, `begin;
    insert into public.networking_cycles(user_id,objective_type,status,started_on,origin)
    values ('${concurrentUser}','JOB_SEARCH','active','2026-04-01','user');
    select 'FIRST_READY';\n`, false);
  await until(() => first.output().includes('FIRST_READY'), 'first active cycle remains uncommitted');
  const second = session('postgres', secondApp, `begin;
    insert into public.networking_cycles(user_id,objective_type,status,started_on,origin)
    values ('${concurrentUser}','JOB_SEARCH','active','2026-04-02','user');
    commit;`);
  await until(() => sql(`select count(*) from pg_catalog.pg_stat_activity waiting
    where waiting.application_name='${secondApp}' and waiting.wait_event_type='Lock'
      and ${`array_length(pg_catalog.pg_blocking_pids(waiting.pid),1)`} > 0;`) === '1',
    'second cycle insert waits on the first transaction');
  first.child.stdin.end('commit;\n');
  assert.equal((await first.done).code, 0);
  const secondResult = await second.done;
  assert.notEqual(secondResult.code, 0);
  assert.match(secondResult.error, /duplicate key|networking_cycle_date_overlap/);
  assert.equal(sql(`select count(*) from public.networking_cycles where user_id='${concurrentUser}' and status='active';`), '1');
  console.log('Concurrent active-cycle creation serialized; exactly one committed: PASS');

  const incompatibleDb = 'r2a_incompatible';
  sqlAs(`alter database postgres with allow_connections false;
    select pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
    where datname='postgres' and pid <> pg_backend_pid();`, 'supabase_admin', 'template1');
  sqlAs(`create database ${incompatibleDb} template postgres;
    alter database postgres with allow_connections true;`, 'supabase_admin', 'template1');
  sqlAs(`grant all on schema public to postgres;`, 'supabase_admin', incompatibleDb);
  const objectiveColumnsBefore = sql(`select count(*) from information_schema.columns
    where table_schema='public' and table_name='objectives';`, incompatibleDb);
  const cycleRowsBefore = sql('select count(*) from public.networking_cycles;', incompatibleDb);
  assert.throws(() => sql(migration, incompatibleDb), /objectives\.cycle_id already exists/);
  assert.equal(sql(`select count(*) from information_schema.columns
    where table_schema='public' and table_name='objectives';`, incompatibleDb), objectiveColumnsBefore);
  assert.equal(sql('select count(*) from public.networking_cycles;', incompatibleDb), cycleRowsBefore);
  console.log('Pre-existing R2-A contract fails before replacement or partial DDL: PASS');

  const revokedUser = randomUUID();
  createAuthUser(revokedUser, `r2a-revoked-${run}@example.invalid`);
  const revokedContact = randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name) values ('${revokedContact}','${revokedUser}','Revoked synthetic');
    update public.user_access_profiles set account_status='paused' where user_id='${revokedUser}';`);
  const denied = await session('postgres', `${name}-revoked`, `begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${revokedUser}',true);
    update public.contacts set networking_focus=true where id='${revokedContact}'; commit;`).done;
  assert.equal(denied.code, 0, denied.error);
  assert.equal(sql(`select networking_focus from public.contacts where id='${revokedContact}';`), 'f');
  assert.equal(sql(`select count(*) from public.contact_networking_transitions
    where contact_id='${revokedContact}' and next_focus=true;`), '0');
  const revokedRead = await session('postgres', `${name}-revoked-read`, `begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${revokedUser}',true);
    select count(*) from public.contact_networking_transitions where user_id='${revokedUser}'; commit;`).done;
  assert.equal(revokedRead.code, 0, revokedRead.error);
  assert.match(revokedRead.output, /\n0\n/);
  console.log('Revoked effective access cannot update contacts or append ledger rows: PASS');

  sql(`insert into public.sync_change_suppressions(
    user_id, provider, resource_type, object_type, change_type
  ) values ('${knownUser}', 'google', 'contacts', 'contact', 'test');`);
  const resetResult = await session('postgres', `${name}-reset`, `begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${knownUser}',true);
    select * from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS'); commit;`).done;
  assert.equal(resetResult.code, 0, resetResult.error);
  assert.deepEqual(JSON.parse(sql(`select json_build_array(
    (select count(*) from public.networking_cycles where user_id='${knownUser}'),
    (select count(*) from public.professional_situation_transitions where user_id='${knownUser}'),
    (select count(*) from public.contact_networking_transitions where user_id='${knownUser}'),
    (select count(*) from public.sync_change_suppressions where user_id='${knownUser}'),
    (select count(*) from public.objectives where user_id='${knownUser}'),
    (select count(*) from public.contacts where user_id='${knownUser}')
  );`)), [0, 0, 0, 0, 0, 0]);
  assert.equal(sql(`select count(*) from public.networking_cycles where user_id='${legacyUser}';`), '1');
  console.log('Existing account reset removes R2-A user-owned data in dependency order: PASS');

  console.log('OBJ-02 R2-A PostgreSQL 17 certification: PASS');
} finally {
  for (const child of children) {
    if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
  }
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, containerId);
    assert.equal(identity.Config.Labels[label], run);
    assert.equal(identity.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', '-v', name]);
    console.log(`Removed owned disposable container ${name} and its anonymous volumes`);
  }
}
