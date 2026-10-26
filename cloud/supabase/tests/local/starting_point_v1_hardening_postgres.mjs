import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only hardening certification. Uses one identified disposable PostgreSQL 17 container.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
const run = randomUUID();
const name = `cc-obj02-r1-hard-${run.slice(0, 10)}`;
const label = 'coffeecito.obj-02-r1-hardening-certification';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const migrationFile = '202610260001_starting_point_v1.sql';
const migration = readFileSync(join(sqlRoot, 'migrations', migrationFile), 'utf8');
const preflight = readFileSync(join(sqlRoot, 'preflight/202610260001_preflight_starting_point_v1.sql'), 'utf8');
const verifier = readFileSync(join(sqlRoot, 'verifiers/202610260001_verify_starting_point_v1.sql'), 'utf8');
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const psqlArgs = (database = 'postgres', appName = `${name}-certifier`, user = 'postgres') => [
  'exec', '-i', '-e', `PGAPPNAME=${appName}`,
  '-e', 'PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=30000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user,
  ...(user === 'postgres' ? [] : ['-h', '127.0.0.1']), '-d', database,
];
const sql = (text, database = 'postgres', user = 'postgres') => docker(psqlArgs(database, `${name}-certifier`, user), { input: text });
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function runPsqlAsync(input, appName, database = 'postgres') {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', psqlArgs(database, appName), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function waitForOutput(child, expected, timeoutMs = 10000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`Timed out waiting for ${expected}; output=${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(expected)) {
        cleanup();
        resolvePromise(output);
      }
    };
    const onExit = (code) => {
      cleanup();
      rejectPromise(new Error(`psql exited before ${expected}; code=${code}; output=${output}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

async function waitForLock(appName) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = sql(`select coalesce(wait_event_type, '') || '|' || coalesce(wait_event, '')
      from pg_catalog.pg_stat_activity where application_name = '${appName}';`);
    if (state.startsWith('Lock|')) return state;
    await pause(50);
  }
  throw new Error(`Pending RPC ${appName} never reached a database lock wait`);
}

function assertCleanPreflight(database = 'postgres') {
  const result = JSON.parse(sql(preflight, database));
  assert.equal(result.incompatible_networking_start_rows, 0);
  assert.deepEqual(result.stop_reasons, {});
  return result;
}

let containerId = '';
let created = false;
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
    where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at';`) === '0') {
    sql('alter table auth.users add column email_confirmed_at timestamptz;', 'postgres', 'supabase_auth_admin');
  }
  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  for (const file of readdirSync(join(sqlRoot, 'migrations'))
    .filter((entry) => entry.endsWith('.sql') && entry !== migrationFile)
    .sort()) {
    sql(readFileSync(join(sqlRoot, 'migrations', file), 'utf8'));
  }
  for (const file of readdirSync(join(sqlRoot, 'seeds')).filter((entry) => entry.endsWith('.sql')).sort()) {
    sql(readFileSync(join(sqlRoot, 'seeds', file), 'utf8'));
  }

  const userId = randomUUID();
  const userEmail = `obj02-r1-hard-${run}@example.invalid`;
  sql(`insert into public.app_access_allowlist(email_normalized) values ('${userEmail}');
    insert into auth.users(
      id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values (
      '${userId}','authenticated','authenticated','${userEmail}',clock_timestamp(),
      '{"provider":"google","providers":["google"]}','{"full_name":"Hardening fixture"}',clock_timestamp(),clock_timestamp()
    );`);

  assertCleanPreflight();
  sql(`update public.user_settings set setting_value='not-a-date'
    where user_id='${userId}' and setting_key='Fecha_Inicio_Networking';`);
  const stoppedPreflight = JSON.parse(sql(preflight));
  assert.equal(stoppedPreflight.incompatible_networking_start_rows, 1);
  assert.equal(stoppedPreflight.stop_reasons.incompatible_networking_start_rows, 1);
  assert.throws(() => sql(migration), /Fecha_Inicio_Networking has 1 incompatible existing row/);
  assert.equal(sql(`select count(*) from information_schema.columns where table_schema='public'
    and table_name='profiles' and column_name='professional_situation_code';`), '0');
  assert.equal(sql("select to_regprocedure('public.current_user_starting_point_v1()') is null;"), 't');
  sql(`update public.user_settings set setting_value='5/4/2021'
    where user_id='${userId}' and setting_key='Fecha_Inicio_Networking';`);
  assertCleanPreflight();
  console.log('Legacy-date preflight and fail-closed migration: PASS');

  sql(`alter database postgres with allow_connections false;
    select pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
    where datname = 'postgres' and pid <> pg_backend_pid();`, 'template1', 'supabase_admin');
  sql(`create database obj02_r1_compatible template postgres;
    create database obj02_r1_incompatible template postgres;
    alter database postgres with allow_connections true;`, 'template1', 'supabase_admin');
  sql('grant all on schema public to postgres;', 'obj02_r1_compatible', 'supabase_admin');
  sql('grant all on schema public to postgres;', 'obj02_r1_incompatible', 'supabase_admin');

  sql(`alter table public.profiles add column professional_situation_code text;
    alter table public.profiles add constraint profiles_professional_situation_code_valid check (
      professional_situation_code is null or professional_situation_code in (
        'employed','unemployed','independent','studying','other','prefer_not_to_say'
      )
    );`, 'obj02_r1_compatible');
  assertCleanPreflight('obj02_r1_compatible');
  sql(migration, 'obj02_r1_compatible');
  sql(verifier, 'obj02_r1_compatible');
  console.log('Pre-existing compatible professional-situation contract: PASS');

  sql(`alter table public.profiles add column professional_situation_code text;
    alter table public.profiles add constraint profiles_professional_situation_code_valid check (
      professional_situation_code is null or professional_situation_code <> 'forbidden'
    );`, 'obj02_r1_incompatible');
  const incompatibleDefinition = sql(`select pg_get_constraintdef(oid, true) from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_professional_situation_code_valid';`, 'obj02_r1_incompatible');
  const incompatiblePreflight = JSON.parse(sql(preflight, 'obj02_r1_incompatible'));
  assert.equal(incompatiblePreflight.stop_reasons.incompatible_professional_situation_contract, true);
  assert.throws(() => sql(migration, 'obj02_r1_incompatible'), /has an incompatible definition/);
  assert.equal(sql(`select pg_get_constraintdef(oid, true) from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_professional_situation_code_valid';`, 'obj02_r1_incompatible'), incompatibleDefinition);
  assert.equal(sql("select to_regprocedure('public.current_user_starting_point_v1()') is null;", 'obj02_r1_incompatible'), 't');
  assert.equal(sql(`select count(*) from pg_trigger where tgrelid='public.user_settings'::regclass
    and tgname='validate_networking_start_setting_v1';`, 'obj02_r1_incompatible'), '0');
  console.log('Incompatible homonymous constraint aborts before candidate DDL: PASS');

  sql(migration);
  for (const verifierFile of [
    '202610260001_verify_starting_point_v1.sql',
    '202610260001_verify_starting_point_v1_behavior.sql',
    '202610260001_verify_access_starting_point_composed.sql',
    '202609290002_verify_merge_reset_grants.sql',
  ]) {
    sql(readFileSync(join(sqlRoot, 'verifiers', verifierFile), 'utf8'));
    console.log(`${verifierFile}: PASS`);
  }
  assertCleanPreflight();

  const beforeName = sql(`select full_name from public.profiles where id='${userId}';`);
  sql(`update public.user_access_profiles set account_status='paused' where user_id='${userId}';`);
  const deniedBefore = await runPsqlAsync(`set role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',false);
    select public.save_current_user_starting_point_v1('Denied before request','employed',date '2020-01-02');`, `${name}-denied-before`);
  assert.notEqual(deniedBefore.code, 0);
  assert.match(deniedBefore.stderr, /app_access_denied/);
  assert.equal(sql(`select full_name from public.profiles where id='${userId}';`), beforeName);
  console.log('Revocation committed before request denies the write: PASS');

  sql(`update public.user_access_profiles set account_status='active' where user_id='${userId}';`);
  const locker = spawn('docker', psqlArgs('postgres', `${name}-locker`), { stdio: ['pipe', 'pipe', 'pipe'] });
  let lockerError = '';
  locker.stderr.on('data', (chunk) => { lockerError += chunk.toString(); });
  const lockReady = waitForOutput(locker, 'LOCK_READY');
  locker.stdin.write(`begin;\nselect id from public.profiles where id='${userId}' for update;\n\\echo LOCK_READY\n`);
  await lockReady;

  const pendingApp = `${name}-pending-write`;
  const pendingWrite = runPsqlAsync(`set role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',false);
    select public.save_current_user_starting_point_v1('Admitted before revocation','employed',date '2020-01-02');`, pendingApp);
  const waitState = await waitForLock(pendingApp);
  assert.match(waitState, /^Lock\|/);
  sql(`update public.user_access_profiles set account_status='paused' where user_id='${userId}';`);
  locker.stdin.end('commit;\n\\q\n');
  const lockerExit = await new Promise((resolvePromise) => locker.on('close', resolvePromise));
  assert.equal(lockerExit, 0, lockerError);

  const admittedResult = await pendingWrite;
  assert.notEqual(admittedResult.code, 0);
  assert.match(admittedResult.stderr, /app_access_denied/);
  assert.equal(sql(`select full_name from public.profiles where id='${userId}';`), beforeName);
  assert.equal(sql(`select setting_value from public.user_settings
    where user_id='${userId}' and setting_key='Fecha_Inicio_Networking';`), '5/4/2021');

  const deniedAfter = await runPsqlAsync(`set role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',false);
    select public.save_current_user_starting_point_v1('Denied after revocation','other',date '2020-01-03');`, `${name}-denied-after`);
  assert.notEqual(deniedAfter.code, 0);
  assert.match(deniedAfter.stderr, /app_access_denied/);
  assert.equal(sql(`select full_name from public.profiles where id='${userId}';`), beforeName);
  console.log(`Concurrent revocation observed after initial authorization while RPC waited on ${waitState}: final access check rejected and rolled back the statement; later write denied`);
  console.log('OBJ-02 R1 hardening PostgreSQL 17 certification: PASS');
} finally {
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, containerId);
    assert.equal(identity.Config.Labels[label], run);
    assert.equal(identity.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', '-v', name]);
  }
}
