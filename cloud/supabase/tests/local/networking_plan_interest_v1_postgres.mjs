import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(root, 'cloud/supabase');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const run = randomUUID();
const name = `cc-notice-${run.slice(0, 10)}`;
const label = 'coffeecito.obj-02-notice-local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
const sql = (body, role = 'postgres') => docker([
  'exec', '-i', '-e', 'PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', role,
  ...(role === 'postgres' ? [] : ['-h', '127.0.0.1']), '-d', 'postgres'
], { input: body });
const file = (path) => readFileSync(join(sqlRoot, path), 'utf8');
const request = (user, body) => sql(`begin; set local role authenticated;
  set local request.jwt.claim.sub = '${user}'; ${body} commit;`);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

let identity;
try {
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  identity = docker(['create', '--pull=never', '--name', name,
    '--label', `${label}=${run}`, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { ready = sql('select 1;') === '1'; } catch { /* startup */ }
    if (ready) break;
    await pause(100);
  }
  assert.ok(ready, 'local PostgreSQL startup');
  await pause(2500);
  const inspected = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(inspected.Id, identity);
  assert.equal(inspected.Config.Labels[label], run);
  assert.equal(inspected.HostConfig.NetworkMode, 'none');

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
  for (const [id, prefix] of [[user, 'one'], [other, 'two']]) {
    const email = `notice-${prefix}-${run}@example.invalid`;
    sql(`insert into public.app_access_allowlist(email_normalized) values ('${email}');
      insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('${id}','authenticated','authenticated','${email}',clock_timestamp(),
      '{"provider":"google","providers":["google"]}','{}',clock_timestamp(),clock_timestamp());`);
  }
  sql(file('migrations/202610270001_networking_cycles_history_v1.sql'));
  sql(file('migrations/202610270002_networking_cycle_operations_v1.sql'));
  sql(file('migrations/202610280001_google_contact_sync_r2b_context.sql'));
  const resetBodyBefore = sql(`select md5(prosrc) from pg_proc
    where oid='public.reset_current_user_app_data_v0_1(text)'::regprocedure;`);
  const preflight = JSON.parse(sql(file('preflight/202610290001_preflight_networking_plan_interest_v1.sql')));
  assert.equal(preflight.installation_state, 'clean_install', preflight.stop_reasons.join(', '));
  sql(file('migrations/202610290001_networking_plan_interest_v1.sql'));
  assert.equal(sql(`select md5(prosrc) from pg_proc
    where oid='public.reset_current_user_app_data_v0_1(text)'::regprocedure;`), resetBodyBefore);
  assert.match(sql(file('verifiers/202610290001_verify_networking_plan_interest_v1.sql')), /^PASS\|/);
  sql('alter table public.networking_plan_notice_modes force row level security;');
  assert.throws(() => sql(file('verifiers/202610290001_verify_networking_plan_interest_v1.sql')),
    /interest_modes_contract_mismatch/);
  sql('alter table public.networking_plan_notice_modes no force row level security;');
  sql(`select public.set_r2b_rollout_gate('test_only','${user}');`);
  assert.equal(request(user, 'select public.current_user_has_app_access();'), 't');
  assert.equal(request(user, "select public.request_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');"), 't');
  const firstRequestedAt = sql(`select requested_at from public.networking_plan_interest
    where user_id='${user}' and objective_type='BUSINESS_DEVELOPMENT';`);
  assert.equal(request(user, "select public.request_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');"), 't');
  assert.equal(sql(`select requested_at from public.networking_plan_interest
    where user_id='${user}' and objective_type='BUSINESS_DEVELOPMENT';`), firstRequestedAt);
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${user}';`), '1');
  assert.equal(request(user, 'select count(*) from public.networking_plan_interest;'), '1');
  assert.equal(request(other, 'select count(*) from public.networking_plan_interest;'), '0');
  assert.throws(() => request(other, "select public.request_networking_plan_notice_v1('PERSONAL_BRAND');"), /networking_plan_notice_access_required/);
  assert.throws(() => request(user, "select public.request_networking_plan_notice_v1('UNKNOWN');"), /networking_plan_notice_modality_invalid/);
  assert.throws(() => request(user, `insert into public.networking_plan_interest(user_id,objective_type,email_at_request)
    values ('${other}','PERSONAL_BRAND','forged@example.invalid');`), /permission denied/);
  assert.throws(() => request(user, 'delete from public.networking_plan_interest;'), /permission denied/);
  assert.equal(sql(`select email_at_request = 'notice-one-${run}@example.invalid'
    from public.networking_plan_interest where user_id='${user}';`), 't');
  assert.equal(request(user, "select public.withdraw_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');"), 't');
  assert.equal(request(user, "select public.withdraw_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');"), 't');
  assert.equal(sql('select count(*) from public.networking_plan_interest;'), '0');
  request(user, "select public.request_networking_plan_notice_v1('PERSONAL_BRAND');");
  const closeDraft = file('operations/manual/202610290001_close_networking_plan_notice_mode.sql');
  assert.throws(() => sql(closeDraft), /manual_mode_close_not_approved/);
  const approvedClose = (count) => closeDraft
    .replace('v_approved boolean := false', 'v_approved boolean := true')
    .replace('v_modality text := null', "v_modality text := 'PERSONAL_BRAND'")
    .replace('v_expected_count integer := null', `v_expected_count integer := ${count}`)
    .replace(/rollback;\s*$/i, 'commit;');
  assert.throws(() => sql(approvedClose(0)), /mode_close_count_changed/);
  assert.equal(sql("select is_open from public.networking_plan_notice_modes where objective_type='PERSONAL_BRAND';"), 't');
  assert.equal(sql("select count(*) from public.networking_plan_interest where objective_type='PERSONAL_BRAND';"), '1');
  sql(approvedClose(1));
  assert.throws(() => request(user, "select public.request_networking_plan_notice_v1('PERSONAL_BRAND');"), /networking_plan_notice_closed/);
  assert.equal(sql('select count(*) from public.networking_plan_interest;'), '0');
  sql(`select public.set_r2b_rollout_gate('open',null);`);
  assert.equal(request(other, 'select public.current_user_has_app_access();'), 't');
  request(user, "select public.request_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');");
  request(other, "select public.request_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');");
  assert.equal(request(user, 'select count(*) from public.networking_plan_interest;'), '1');
  assert.equal(request(other, 'select count(*) from public.networking_plan_interest;'), '1');
  sql(`update public.user_access_profiles set account_status='paused' where user_id='${other}';`);
  assert.equal(request(other, 'select count(*) from public.networking_plan_interest;'), '0');
  assert.throws(() => request(other, "select public.withdraw_networking_plan_notice_v1('BUSINESS_DEVELOPMENT');"),
    /networking_plan_notice_access_required/);
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${other}';`), '1');
  sql(`delete from auth.users where id='${other}';`);
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${other}';`), '0');
  const start = new Date(Date.now() - 7_200_000).toISOString();
  const end = new Date(Date.now() - 3_600_000).toISOString();
  const firstRequest = randomUUID();
  const firstCycle = request(user, `select public.start_networking_cycle_r2b('${firstRequest}', 'First search',
    '${start}', 'America/Santiago', null, 'none:initial', false, false);`);
  assert.equal(request(user, `select public.close_networking_cycle_r2b('${randomUUID()}', '${firstCycle}',
    'active:${firstCycle}:${firstRequest}', '${end}', 'stopped');`), firstCycle);
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${user}';`), '1');
  request(user, `select public.start_networking_cycle_r2b('${randomUUID()}', 'Next search',
    '${end}', 'America/Santiago', null, 'none:${firstCycle}', true, true);`);
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${user}';`), '1');
  request(user, "select public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');");
  assert.equal(sql(`select count(*) from public.networking_plan_interest where user_id='${user}';`), '1');
  console.log('PASS: local PostgreSQL 17, RLS/RPC, retries, isolation, manual closure, cycle/reset survival and Auth cascade');
} finally {
  if (identity) {
    const actual = JSON.parse(docker(['inspect', name]))[0];
    if (actual.Id === identity && actual.Config.Labels[label] === run && actual.HostConfig.NetworkMode === 'none') {
      docker(['rm', '-f', name]);
    } else {
      throw new Error('Disposable container identity changed; refusing cleanup');
    }
  }
}
