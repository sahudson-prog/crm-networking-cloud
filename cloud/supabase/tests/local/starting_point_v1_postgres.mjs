import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only certification. No ports, network, downloads or remote credentials.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
const run = randomUUID();
const name = `cc-obj02-r1-${run.slice(0, 12)}`;
const label = 'coffeecito.obj-02-r1-local-certification';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const psqlArgs = (user = 'postgres') => [
  'exec', '-i', '-e', `PGAPPNAME=${name}-certifier`,
  '-e', 'PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user,
  ...(user === 'postgres' ? [] : ['-h', '127.0.0.1']), '-d', 'postgres',
];
const sql = (text, user = 'postgres') => docker(psqlArgs(user), { input: text });
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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
  ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { ready = sql('select 1;') === '1'; } catch { /* postmaster handoff */ }
    if (ready) break;
    await pause(100);
  }
  assert.equal(ready, true, 'Disposable PostgreSQL did not survive initialization handoff');
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
    where table_schema = 'auth' and table_name = 'users'
      and column_name = 'email_confirmed_at';`) === '0') {
    sql('alter table auth.users add column email_confirmed_at timestamptz;', 'supabase_auth_admin');
  }

  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  const migrationFile = '202610260001_starting_point_v1.sql';
  const migration = readFileSync(join(sqlRoot, 'migrations', migrationFile), 'utf8');
  for (const file of readdirSync(join(sqlRoot, 'migrations'))
    .filter((entry) => entry.endsWith('.sql') && entry !== migrationFile)
    .sort()) {
    sql(readFileSync(join(sqlRoot, 'migrations', file), 'utf8'));
  }
  for (const file of readdirSync(join(sqlRoot, 'seeds')).filter((entry) => entry.endsWith('.sql')).sort()) {
    sql(readFileSync(join(sqlRoot, 'seeds', file), 'utf8'));
  }

  sql(readFileSync(join(sqlRoot, 'verifiers/202610250001_verify_access_invitation_composed.sql'), 'utf8'));
  console.log('Pre-R1 composed access verifier: PASS');

  const legacyUser = randomUUID();
  const legacyEmail = `obj02-r1-${run}@example.invalid`;
  sql(`begin;
    insert into public.app_access_allowlist(email_normalized) values ('${legacyEmail}');
    insert into auth.users(
      id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values (
      '${legacyUser}','authenticated','authenticated','${legacyEmail}',clock_timestamp(),
      '{"provider":"google","providers":["google"]}','{"full_name":"Legacy R1"}',clock_timestamp(),clock_timestamp()
    );
    insert into public.user_settings(user_id,setting_key,setting_value)
    values ('${legacyUser}','product_onboarding_v1','{"version":1,"status":"completed","introSeen":true,"lastStep":"final"}')
    on conflict (user_id,setting_key) do update set setting_value=excluded.setting_value;
    commit;`);

  const rollbackProbe = migration.replace(
    /\ncommit;\s*$/i,
    () => "\ndo $$ begin raise exception 'deliberate OBJ-02 R1 rollback probe'; end $$;\ncommit;",
  );
  assert.throws(() => sql(rollbackProbe), /deliberate OBJ-02 R1 rollback probe/);
  assert.equal(sql(`select count(*) from information_schema.columns
    where table_schema='public' and table_name='profiles'
      and column_name='professional_situation_code';`), '0');
  assert.equal(sql("select to_regprocedure('public.current_user_starting_point_v1()') is null;"), 't');
  assert.equal(sql(`select full_name from public.profiles where id='${legacyUser}';`), 'Legacy R1');
  assert.match(sql(`select setting_value from public.user_settings
    where user_id='${legacyUser}' and setting_key='product_onboarding_v1';`), /"status":"completed"/);
  console.log('Migration rollback and legacy onboarding preservation: PASS');

  sql(migration);
  for (const verifier of [
    '202610260001_verify_starting_point_v1.sql',
    '202610260001_verify_starting_point_v1_behavior.sql',
    '202610260001_verify_access_starting_point_composed.sql',
    '202609290002_verify_merge_reset_grants.sql',
  ]) {
    sql(readFileSync(join(sqlRoot, 'verifiers', verifier), 'utf8'));
    console.log(`${verifier}: PASS`);
  }

  assert.equal(sql(`select professional_situation_code is null
    from public.profiles where id='${legacyUser}';`), 't');
  assert.match(sql(`select setting_value from public.user_settings
    where user_id='${legacyUser}' and setting_key='product_onboarding_v1';`), /"status":"completed"/);
  assert.equal(sql(`select count(*) from public.import_batches
    where user_id='${legacyUser}';`), '0');
  console.log('Legacy values and no import side effects: PASS');
  console.log('OBJ-02 R1 PostgreSQL 17 local certification: PASS');
} finally {
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, containerId);
    assert.equal(identity.Config.Labels[label], run);
    assert.equal(identity.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', '-v', name]);
  }
}
