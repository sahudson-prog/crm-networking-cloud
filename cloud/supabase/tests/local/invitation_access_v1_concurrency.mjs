import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only certification. No ports, network, downloads or remote credentials.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
const run = randomUUID();
const name = `cc-inv01-${run.slice(0, 12)}`;
const label = 'coffeecito.inv-01-local-certification';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32e6, timeout: 120000,
  stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const psqlArgs = (app = `${name}-observer`, user = 'postgres') => [
  'exec', '-i', '-e', `PGAPPNAME=${app}`,
  '-e', 'PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',
  name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', 'postgres',
];
const sql = (text, app) => docker(psqlArgs(app), { input: text });
const sqlAs = (user, text, app) => docker(
  [...psqlArgs(app, user), '-h', '127.0.0.1'],
  { input: text },
);
const pause = (ms = 100) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const children = new Set();

function session(app, text, keepOpen = false) {
  const child = spawn('docker', psqlArgs(app), { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { error += chunk; });
  const done = new Promise((resolvePromise) => {
    child.on('close', (code) => {
      children.delete(child);
      resolvePromise({ code, output, error });
    });
  });
  child.stdin.write(text);
  if (!keepOpen) child.stdin.end();
  return { child, done, output: () => output };
}

async function until(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await pause();
  }
  throw new Error(`Timed out: ${description}`);
}

const jwt = (userId) => `set local role authenticated; set local "request.jwt.claim.sub"='${userId}';`;
const authInsert = (userId, email, confirmed = true) => `
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values ('${userId}','authenticated','authenticated','${email}',${confirmed ? 'now()' : 'null'},
    '{"provider":"email","providers":["email"]}','{}',now(),now());`;

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
  await until(() => {
    try { return sql('select 1;') === '1'; } catch { return false; }
  }, 'disposable PostgreSQL startup');
  await pause(2500);
  await until(() => {
    try { return sql('select 1;') === '1'; } catch { return false; }
  }, 'Supabase PostgreSQL postmaster handoff');
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
  // The standalone PostgreSQL image omits this GoTrue column; the repo and
  // deployed Supabase schema require it for verified-email admission.
  if (sql(`select count(*) from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name = 'email_confirmed_at';`) === '0') {
    sqlAs('supabase_auth_admin',
      'alter table auth.users add column email_confirmed_at timestamptz;');
  }

  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  const invitationMigrationFile = '202610250001_invitation_access_v1.sql';
  const invitationMigration = readFileSync(join(sqlRoot, 'migrations', invitationMigrationFile), 'utf8');
  for (const file of readdirSync(join(sqlRoot, 'migrations')).filter((entry) => entry.endsWith('.sql')).sort()) {
    if (file !== invitationMigrationFile) sql(readFileSync(join(sqlRoot, 'migrations', file), 'utf8'));
  }
  sql(readFileSync(join(sqlRoot, 'verifiers/202610210001_verify_access_expand_pre_contract.sql'), 'utf8'));
  console.log('Google expand without INV-01 composed objects: PASS');

  const hookBefore = sql(`select md5(pg_get_functiondef(
    'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure));`);
  const rollbackProbe = invitationMigration.replace(
    /\ncommit;\s*$/i,
    () => "\ndo $$ begin raise exception 'deliberate INV-01 migration rollback probe'; end $$;\ncommit;",
  );
  assert.throws(() => sql(rollbackProbe), /deliberate INV-01 migration rollback probe/);
  assert.equal(sql("select to_regclass('public.app_invitations') is null;"), 't');
  assert.equal(sql(`select md5(pg_get_functiondef(
    'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure));`), hookBefore);
  assert.equal(sql(`select count(*) from public.app_capabilities
    where capability_code='invitations.authorize';`), '0');
  console.log('Migration transaction rollback and prior runtime preservation: PASS');
  sql(invitationMigration);
  for (const file of readdirSync(join(sqlRoot, 'seeds')).filter((entry) => entry.endsWith('.sql')).sort()) {
    sql(readFileSync(join(sqlRoot, 'seeds', file), 'utf8'));
  }

  for (const file of [
    '202610250001_verify_invitation_access_v1.sql',
    '202610250001_verify_invitation_access_v1_behavior.sql',
    '202610250001_verify_access_invitation_composed.sql',
    '202609290002_verify_merge_reset_grants.sql',
  ]) {
    sql(readFileSync(join(sqlRoot, 'verifiers', file), 'utf8'));
    console.log(`${file}: PASS`);
  }

  const admin = randomUUID();
  const inviterA = randomUUID();
  const inviterB = randomUUID();
  const adminEmail = `admin-${run}@example.invalid`;
  const inviterAEmail = `a-${run}@example.invalid`;
  const inviterBEmail = `b-${run}@example.invalid`;
  sql(`begin;
    insert into public.app_access_allowlist(email_normalized) values
      ('${adminEmail}'),('${inviterAEmail}'),('${inviterBEmail}');
    ${authInsert(admin, adminEmail)}
    ${authInsert(inviterA, inviterAEmail)}
    ${authInsert(inviterB, inviterBEmail)}
    insert into public.user_role_assignments(user_id,role_code,assignment_reason)
    values ('${admin}','system_admin','INV-01 concurrency fixture') on conflict do nothing;
    commit;`);
  sql(`begin; ${jwt(admin)} select public.admin_update_invitation_program_v1(true,true,1); commit;`);

  // Last global slot: both calls really wait on the singleton lock; exactly one persists.
  const blocker = session('inv01-capacity-blocker', `begin;
    select * from public.app_invitation_program_settings where singleton for update;
    select 'LOCKED';\n`, true);
  await until(() => blocker.output().includes('LOCKED'), 'capacity blocker lock');
  const capacityCalls = [
    session('inv01-capacity-a', `begin; ${jwt(inviterA)} select public.authorize_current_user_invitation_v1('target-a-${run}@example.invalid'); commit;`),
    session('inv01-capacity-b', `begin; ${jwt(inviterB)} select public.authorize_current_user_invitation_v1('target-b-${run}@example.invalid'); commit;`),
  ];
  await until(() => Number(sql(`select count(*) from pg_stat_activity
    where application_name in ('inv01-capacity-a','inv01-capacity-b') and wait_event_type='Lock';`)) === 2,
  'both capacity calls waiting on a real lock');
  blocker.child.stdin.end('commit;\n');
  await blocker.done;
  const capacityResults = await Promise.all(capacityCalls.map((call) => call.done));
  assert.equal(capacityResults.filter((result) => result.code === 0).length, 1);
  assert.equal(capacityResults.filter((result) => /invitation_capacity_reached/.test(result.error)).length, 1);
  assert.equal(sql('select count(*) from public.app_invitations where invitation_status=\'pending\';'), '1');
  console.log('Concurrent last global slot: PASS');

  // Personal limit: six synchronized calls create five rows and reject one.
  sql(`begin; delete from public.app_invitation_events; delete from public.app_invitations;
    ${jwt(admin)} select public.admin_update_invitation_program_v1(true,true,500); commit;`);
  const personalBlocker = session('inv01-personal-blocker', `begin;
    select * from public.app_invitation_program_settings where singleton for update;
    select 'LOCKED';\n`, true);
  await until(() => personalBlocker.output().includes('LOCKED'), 'personal blocker lock');
  const personalCalls = Array.from({ length: 6 }, (_, index) => session(
    `inv01-personal-${index + 1}`,
    `begin; ${jwt(inviterA)} select public.authorize_current_user_invitation_v1('personal-${index + 1}-${run}@example.invalid'); commit;`,
  ));
  await until(() => Number(sql(`select count(*) from pg_stat_activity
    where application_name like 'inv01-personal-%' and wait_event_type='Lock';`)) === 6,
  'six personal calls waiting on a real lock');
  personalBlocker.child.stdin.end('commit;\n');
  await personalBlocker.done;
  const personalResults = await Promise.all(personalCalls.map((call) => call.done));
  assert.equal(personalResults.filter((result) => result.code === 0).length, 5);
  assert.equal(personalResults.filter((result) => /personal_invitation_limit_reached/.test(result.error)).length, 1);
  assert.equal(sql(`select count(*) from public.app_invitations where inviter_user_id='${inviterA}' and invitation_status='pending';`), '5');
  console.log('Concurrent personal limit 5/6: PASS');

  // Two real sessions materialize the same exact 120-hour boundary only once.
  sql('begin; delete from public.app_invitation_events; delete from public.app_invitations; commit;');
  const expiryEmail = `expiry-${run}@example.invalid`;
  const expiryId = sql(`insert into public.app_invitations (
      inviter_user_id, email_normalized, email_fingerprint,
      authorized_at, invitation_status
    ) values (
      '${inviterA}', '${expiryEmail}', public.invitation_email_fingerprint_v1('${expiryEmail}'),
      '2026-10-25 12:00:00+00', 'pending'
    ) returning id;`);
  const expiryBlocker = session('inv01-expiry-blocker', `begin;
    select id from public.app_invitations where id='${expiryId}' for update;
    select 'LOCKED';\n`, true);
  await until(() => expiryBlocker.output().includes('LOCKED'), 'expiry blocker lock');
  const expiryCalls = [
    session('inv01-expiry-a', `begin; select public.materialize_expired_invitations_v1('2026-10-30 12:00:00+00'); commit;`),
    session('inv01-expiry-b', `begin; select public.materialize_expired_invitations_v1('2026-10-30 12:00:00+00'); commit;`),
  ];
  await until(() => Number(sql(`select count(*) from pg_stat_activity
    where application_name in ('inv01-expiry-a','inv01-expiry-b') and wait_event_type='Lock';`)) === 2,
  'both expiration calls waiting on a real row lock');
  expiryBlocker.child.stdin.end('commit;\n');
  await expiryBlocker.done;
  const expiryResults = await Promise.all(expiryCalls.map((call) => call.done));
  assert.deepEqual(expiryResults.map((result) => result.output.trim()).sort(), ['0', '1']);
  assert.equal(sql(`select invitation_status from public.app_invitations where id='${expiryId}';`), 'expired');
  assert.equal(sql(`select count(*) from public.app_invitation_events
    where invitation_id='${expiryId}' and event_type='expired';`), '1');
  console.log('Concurrent exact 120-hour expiration: PASS');

  // Bootstrap waits on the access profile until after expiry, then must use a
  // fresh clock_timestamp and reject conversion.
  sql('begin; delete from public.app_invitation_events; delete from public.app_invitations; commit;');
  const delayedUser = randomUUID();
  const delayedEmail = `delayed-${run}@example.invalid`;
  const delayedInvitation = JSON.parse(sql(`begin; ${jwt(inviterA)}
    select public.authorize_current_user_invitation_v1('${delayedEmail}'); commit;`));
  sql(`update public.app_invitations
    set authorized_at = clock_timestamp() - interval '120 hours' + interval '3 seconds'
    where id='${delayedInvitation.invitation_id}';`);
  sql(authInsert(delayedUser, delayedEmail));
  const delayedBlocker = session('inv01-delayed-bootstrap-blocker', `begin;
    select user_id from public.user_access_profiles where user_id='${delayedUser}' for update;
    select 'LOCKED';\n`, true);
  await until(() => delayedBlocker.output().includes('LOCKED'), 'delayed bootstrap blocker lock');
  const delayedBootstrap = session('inv01-delayed-bootstrap', `begin; ${jwt(delayedUser)}
    select allowed, reason, coalesce(access_source,'')
    from public.bootstrap_current_user_invitation_v1(); commit;`);
  await until(() => Number(sql(`select count(*) from pg_stat_activity
    where application_name='inv01-delayed-bootstrap' and wait_event_type='Lock';`)) === 1,
  'bootstrap waiting on access profile lock');
  await until(() => sql(`select clock_timestamp() >= expires_at
    from public.app_invitations where id='${delayedInvitation.invitation_id}';`) === 't',
  'invitation exact expiry while bootstrap waits');
  delayedBlocker.child.stdin.end('commit;\n');
  await delayedBlocker.done;
  const delayedResult = await delayedBootstrap.done;
  assert.equal(delayedResult.code, 0);
  assert.match(delayedResult.output, /f\|invitation_expired\|/);
  assert.equal(sql(`select invitation_status || '|' || coalesce(registered_user_id::text,'')
    from public.app_invitations where id='${delayedInvitation.invitation_id}';`), 'expired|');
  assert.equal(sql(`select account_status || '|' || beta_access_status
    from public.user_access_profiles where user_id='${delayedUser}';`), 'beta_pending|pending');
  console.log('Bootstrap expiry after real lock wait: PASS');

  async function conversionRace(order) {
    sql('begin; delete from public.app_invitation_events; delete from public.app_invitations; commit;');
    const target = randomUUID();
    const targetEmail = `${order}-${run}@example.invalid`;
    const invitation = JSON.parse(sql(`begin; ${jwt(inviterA)}
      select public.authorize_current_user_invitation_v1('${targetEmail}'); commit;`));
    sql(authInsert(target, targetEmail));
    const raceBlocker = session(`inv01-${order}-blocker`, `begin;
      select * from public.app_invitation_program_settings where singleton for update;
      select 'LOCKED';\n`, true);
    await until(() => raceBlocker.output().includes('LOCKED'), `${order} blocker lock`);
    const bootstrapSql = `begin; ${jwt(target)} select * from public.bootstrap_current_user_invitation_v1(); commit;`;
    const cancelSql = `begin; ${jwt(admin)} select public.admin_cancel_invitation_v1('${invitation.invitation_id}','synthetic security cancellation'); commit;`;
    const first = session(`inv01-${order}-first`, order === 'bootstrap-first' ? bootstrapSql : cancelSql);
    await until(() => Number(sql(`select count(*) from pg_stat_activity where application_name='inv01-${order}-first' and wait_event_type='Lock';`)) === 1,
      `${order} first caller waiting`);
    const second = session(`inv01-${order}-second`, order === 'bootstrap-first' ? cancelSql : bootstrapSql);
    await until(() => Number(sql(`select count(*) from pg_stat_activity where application_name='inv01-${order}-second' and wait_event_type='Lock';`)) === 1,
      `${order} second caller waiting`);
    raceBlocker.child.stdin.end('commit;\n');
    await raceBlocker.done;
    const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
    const finalState = sql(`select invitation_status from public.app_invitations where id='${invitation.invitation_id}';`);
    if (order === 'bootstrap-first') {
      assert.equal(firstResult.code, 0);
      assert.equal(finalState, 'registered');
      assert.match(secondResult.error, /only_pending_invitations_can_be_cancelled/);
    } else {
      assert.equal(firstResult.code, 0);
      assert.equal(finalState, 'cancelled');
      assert.match(secondResult.output, /invitation_email_blocked|invitation_missing/);
    }
    assert.equal(sql(`select count(*) from public.app_invitation_events where invitation_id='${invitation.invitation_id}' and event_type in ('registered','cancelled');`), '1');
  }
  await conversionRace('bootstrap-first');
  await conversionRace('cancel-first');
  console.log('Concurrent conversion/cancellation, both orders: PASS');

  // Deliberate error after changing the switches proves transactional rollback.
  sql(`begin; ${jwt(admin)} select public.admin_update_invitation_program_v1(false,false,500); commit;`);
  assert.throws(() => sql(`begin; update public.app_invitation_program_settings
    set invitations_enabled=true, registrations_enabled=true where singleton;
    do $$ begin raise exception 'deliberate rollback probe'; end $$; commit;`), /deliberate rollback probe/);
  assert.equal(sql(`select invitations_enabled::text || '|' || registrations_enabled::text
    from public.app_invitation_program_settings where singleton;`), 'false|false');
  console.log('Transactional rollback after deliberate error: PASS');

  console.log('INV-01 PostgreSQL 17 local certification: PASS');
} finally {
  for (const child of children) {
    try { child.kill(); } catch { /* best effort for owned sessions */ }
  }
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, containerId);
    assert.equal(identity.Config.Labels[label], run);
    docker(['rm', '-f', '-v', name]);
  }
}
