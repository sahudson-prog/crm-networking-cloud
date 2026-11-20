import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional local baseline path supports reviewing this draft outside the worktree.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselineArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const baseline = baselineArg ? resolve(baselineArg) : root;
const multiTesters = process.argv.includes('--dev-multitester');
const image = 'sha256:06ddc7962e11ab0f4f0334fd05671e97c30ea202f6e6a7113800bd3d6e416108';
const run = randomUUID(), name = `cc-reg-open-${run.slice(0, 10)}`, label = 'coffeecito.reg-open.local';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 32e6, stdio: ['pipe', 'pipe', 'pipe'], ...options
}).trim();
const args = (app = name) => ['exec', '-i', '-e', `PGAPPNAME=${app}`,
  '-e', 'PGOPTIONS=-c statement_timeout=20000 -c client_min_messages=warning', name,
  'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'];
const sql = body => docker(args(), { input: body });
const sqlAsAuthAdmin = body => docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
  '-h','127.0.0.1','-U','supabase_auth_admin','-d','postgres'], { input: body });
const file = (path, base = root) => readFileSync(join(base, path), 'utf8');
const pre = file('preflight/202611190001_preflight_public_registration_v1.sql');
const migration = file('migrations/202611190001_public_registration_v1.sql');
const verifier = file('verifiers/202611190001_verify_public_registration_v1.sql');
const jwt = id => `set local role authenticated; set local request.jwt.claim.sub='${id}';`;
const request = (id, body) => sql(`begin; ${jwt(id)} ${body} commit;`);
const bootstrap = id => JSON.parse(request(id, 'select row_to_json(s) from public.bootstrap_current_user_invitation_v1() s;'));
const access = id => JSON.parse(request(id, 'select row_to_json(s) from public.current_user_app_access_status() s;'));
const publicStatus = () => JSON.parse(sql('begin; set local role anon; select public.public_registration_status_v1(); commit;'));
const authInsert = (id, confirmed = true, provider = 'email', forgedVerification = false) => `insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('${id}','authenticated','authenticated','${id}@example.invalid',${confirmed ? 'clock_timestamp()' : 'null'},
    '${JSON.stringify({ provider, providers: [provider], ...(forgedVerification ? { email_verified: true } : {}) })}',
    '${JSON.stringify(forgedVerification ? { email_verified: true, verified_email: true } : {})}',clock_timestamp(),clock_timestamp());`;
const newUser = (confirmed = true, provider = 'email', forgedVerification = false) => {
  const id = randomUUID(); sql(authInsert(id, confirmed, provider, forgedVerification)); return id;
};
let identity = '', checks = 0;
const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const denied = (fn, pattern) => { assert.throws(fn, pattern); checks++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(test, description) {
  for (let i = 0; i < 150; i++) { if (test()) return; await sleep(100); }
  throw Error(`Timed out: ${description}`);
}
const children = new Set();
function session(app, body, keepOpen = false) {
  const child = spawn('docker', args(app), { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child); let output = '', error = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => error += b);
  const done = new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('close', code => { children.delete(child); resolvePromise({ code, output, error }); });
  });
  child.stdin.write(body); if (!keepOpen) child.stdin.end();
  return { child, done, output: () => output };
}
try {
  equal(docker(['image', 'inspect', image, '--format', '{{.Id}}']), image);
  identity = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  docker(['start', name]);
  await until(() => { try { return sql('select 1;') === '1'; } catch { return false; } }, 'isolated PostgreSQL');
  const info = JSON.parse(docker(['inspect', name]))[0];
  equal(info.Id, identity); equal(info.HostConfig.NetworkMode, 'none');
  equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  for (const column of ['email_confirmed_at', 'banned_until']) {
    if (sql(`select count(*) from pg_attribute where attrelid='auth.users'::regclass and attname='${column}' and not attisdropped;`) === '0') {
      docker(['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'supabase_auth_admin', '-d', 'postgres'],
        { input: `alter table auth.users add column ${column} timestamptz;` });
    }
  }
  sql(file('bootstrap/preflight_empty.sql', baseline));
  for (const path of readdirSync(join(baseline, 'migrations')).filter(p => p.endsWith('.sql') && p < '202611190001').sort())
    sql(file(`migrations/${path}`, baseline));
  for (const path of readdirSync(join(baseline, 'seeds')).filter(p => p.endsWith('.sql')).sort()) sql(file(`seeds/${path}`, baseline));
  if (multiTesters) sql(file('tests/local/fixtures/reg_open_r2b_dev_multitester.sql'));
  console.log('PASS: actual baseline migrations through Calendar 005; R2-B ' + (multiTesters ? 'DEV multi-tester' : 'standard'));
  if (process.argv.includes('--prod-context-only')) {
    if (multiTesters) throw Error('PROD context requires the standard local fixture');
    const { verifyProdContext } = await import('./reg_open_prod_context.mjs');
    verifyProdContext({ sql, file, migration, authInsert });
  } else if (process.argv.includes('--single-switch-only')) {
    const { verifySingleSwitch } = await import('./public_registration_single_switch.mjs');
    await verifySingleSwitch({ sql, sqlAsAuthAdmin, file, migration, authInsert, multiTesters, session, until });
  } else if (process.argv.includes('--dev-calendar-verifier-only')) {
    const { verifyDevCalendarContract } = await import('./reg_open_dev_calendar_verifier.mjs');
    verifyDevCalendarContract({ sql, file, migration, authInsert, multiTesters });
  } else {
  const previousPrimary = randomUUID(), previousAdditional = randomUUID();
  for (const id of [previousPrimary, previousAdditional])
    sql(`insert into public.app_access_allowlist(email_normalized) values('${id}@example.invalid'); ${authInsert(id)}`);
  sql(`select public.set_r2b_rollout_gate('test_only','${previousPrimary}');`);
  if (multiTesters)
    sql(`update public.r2b_rollout_gate set additional_test_user_ids=array['${previousAdditional}']::uuid[];`);
  const gateSnapshot = () => sql(`select jsonb_build_object(
    'definition',pg_get_functiondef('public.set_r2b_rollout_gate(text,uuid)'::regprocedure),
    'oid','public.set_r2b_rollout_gate(text,uuid)'::regprocedure::oid,
    'acl',(select proacl::text from pg_proc where oid='public.set_r2b_rollout_gate(text,uuid)'::regprocedure),
    'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname)
      from pg_constraint where conrelid='public.r2b_rollout_gate'::regclass),
    'row',(select to_jsonb(g) from public.r2b_rollout_gate g))`);
  const gateBefore = gateSnapshot();
  const diagnostic = JSON.parse(sql(file('operations/dev/202611190001_diagnose_reg_open_contract.sql')));
  equal(diagnostic.findings_by_cause, {});
  equal(diagnostic.known_r2b_variant, multiTesters ? 'dev_multi_tester' : 'standard');
  const functionDefinition = (source, name) => {
    const tail = source.slice(source.indexOf('create or replace function public.' + name + '('));
    assert.ok(tail.startsWith('create or replace function'));
    return tail.slice(0, tail.indexOf('$$;') + 3);
  };
  const otherSource = multiTesters
    ? file('migrations/202610270002_networking_cycle_operations_v1.sql', baseline)
    : file('tests/local/fixtures/reg_open_r2b_dev_multitester.sql');
  const otherAccess = functionDefinition(otherSource, 'app_access_status_for_user');
  // Reject mixed known variants, not just arbitrary unknown hashes.
  for (const contract of [pre, migration]) {
    denied(() => sql('begin; ' + otherAccess + '\n' + contract), /body\/signature\/security\/ACL drift/);
    denied(() => sql("begin; create or replace function public.set_r2b_rollout_gate(p_mode text,p_test_user_id uuid default null) returns void language plpgsql security definer set search_path='' as $$ begin null; end; $$;\n" + contract), /unknown R2-B gate variant/);
    denied(() => sql('begin; alter function public.app_access_status_for_user(uuid) security invoker;\n' + contract), /body\/signature\/security\/ACL drift/);
    const columnDrift = multiTesters
      ? 'alter table public.r2b_rollout_gate alter column additional_test_user_ids drop not null;'
      : "alter table public.r2b_rollout_gate add column additional_test_user_ids uuid[] not null default '{}';";
    denied(() => sql('begin; ' + columnDrift + '\n' + contract), /gate column drift|unexpected multi-tester column/);
  }
  const preserved = () => sql(`select jsonb_agg(jsonb_build_array(oid, proname, proacl::text) order by proname)
    from pg_proc where oid in ('public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure,
      'public.bootstrap_current_user_invitation_v1()'::regprocedure,'public.app_access_status_for_user(uuid)'::regprocedure);`);
  const before = preserved();
  const legacyPending = newUser();
  assert.match(sql(pre), /PASS/);
  denied(() => sql(migration.replace(/commit;\s*$/, "do $$ begin raise exception 'synthetic_abort'; end $$; commit;")), /synthetic_abort/);
  assert.match(sql(pre), /PASS/);
  denied(() => sql("begin; grant execute on function public.current_user_app_access_status() to anon;\n" + pre), /anon schema exposure/);
  denied(() => sql("begin; grant select(email) on public.profiles to anon;\n" + migration), /anon schema exposure/);
  denied(() => sql("begin; alter function public.handle_new_auth_user_profile() security invoker;\n" + pre), /body\/signature\/security\/ACL drift/);
  sql(migration);
  equal(preserved(), before, 'existing function OIDs and ACL preserved');
  equal(gateSnapshot(), gateBefore, 'setter definition/OID/ACL and gate membership untouched');
  equal(access(previousPrimary).allowed, true, 'preexisting primary tester preserved');
  equal(access(previousAdditional).allowed, multiTesters, 'preexisting DEV membership preserved');
  const expandedOtherAccess = otherAccess.replace(
    'if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation) then',
    'if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation or public.public_registration_admission_valid_v1(p_user_id)) then');
  denied(() => sql('begin; ' + expandedOtherAccess + '\n' + verifier), /body\/signature\/security\/ACL drift/);
  denied(() => sql("begin; create or replace function public.set_r2b_rollout_gate(p_mode text,p_test_user_id uuid default null) returns void language plpgsql security definer set search_path='' as $$ begin null; end; $$;\n" + verifier), /unknown R2-B gate variant/);
  denied(() => sql('begin; alter function public.app_access_status_for_user(uuid) security invoker;\n' + verifier), /body\/signature\/security\/ACL drift/);
  assert.match(sql(verifier), /PASS/);
  equal(publicStatus(), { enabled: false });
  denied(() => sql(pre), /anon schema exposure|already present/);
  const admin = randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized) values('${admin}@example.invalid'); ${authInsert(admin)}
    insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('${admin}','system_admin','Synthetic');
    select public.set_r2b_rollout_gate('paused',null);
    select public.set_r2b_rollout_gate('test_only','${admin}'); select public.set_r2b_rollout_gate('open',null);`);
  const configure = enabled => {
    const state = JSON.parse(request(admin, 'select public.admin_public_registration_state_v1();'));
    return JSON.parse(request(admin, `select public.admin_set_public_registration_v1(${enabled},${state.revision});`));
  };
  equal(configure(true), { enabled: true, revision: 1 });
  equal(JSON.parse(request(admin, 'select public.admin_set_public_registration_v1(p_enabled=>true,p_expected_revision=>1);')),
    { enabled: true, revision: 1 }, 'named frontend parameters and idempotent no-op');
  equal(publicStatus(), { enabled: true });
  denied(() => request(admin, 'select public.admin_set_public_registration_v1(false,0);'), /revision_conflict/);
  denied(() => request(legacyPending, 'select public.admin_public_registration_state_v1();'), /admin_manage_access_required/);
  equal(bootstrap(legacyPending).allowed, false, 'no legacy pending backfill');
  // New identities below are synthetic rows in the disposable network-none DB.
  const additional = newUser(), secondAdditional = newUser(), outsider = newUser();
  sql("select public.set_r2b_rollout_gate('paused',null);");
  equal(bootstrap(additional).reason, 'maintenance', 'paused vetoes public admission');
  sql(`select public.set_r2b_rollout_gate('test_only','${admin}');`);
  if (multiTesters) sql(`update public.r2b_rollout_gate set additional_test_user_ids=array['${additional}','${secondAdditional}']::uuid[];`);
  equal(publicStatus(), { enabled: false }, 'test_only never opens anonymous signup');
  equal(JSON.parse(sqlAsAuthAdmin(`select public.hook_enforce_app_access_allowlist('{"user":{"email":"${outsider}@example.invalid"}}');`)).error.http_code, 403);
  equal(bootstrap(admin).allowed, true, 'primary tester retains legacy admission');
  equal(bootstrap(outsider).reason, 'maintenance', 'unlisted identity rejected');
  equal(bootstrap(additional).allowed, multiTesters, 'only the known DEV variant admits additional testers');
  equal(access(additional).allowed, multiTesters);
  if (multiTesters) {
    equal(sql(`select plan_code||':'||account_status||':'||beta_access_status from public.user_access_profiles where user_id='${additional}';`), 'free:active:approved');
    equal(sql(`select count(*) from public.user_role_assignments where user_id='${additional}' and role_code='user';`), '1');
    configure(false);
    equal(bootstrap(additional).allowed, true, 'OFF preserves admitted additional tester');
    equal(bootstrap(secondAdditional).allowed, false, 'OFF does not admit pending additional tester');
    configure(true);
    equal(bootstrap(secondAdditional).allowed, true);
    sql(`update public.user_access_profiles set beta_access_status='blocked' where user_id='${additional}';`);
    equal(bootstrap(additional).reason, 'administratively_blocked');
    equal(access(additional).allowed, false, 'test membership never overrides admin block');
    sql(`insert into public.app_access_allowlist(email_normalized,revoked_at) values('${secondAdditional}@example.invalid',clock_timestamp());`);
    equal(bootstrap(secondAdditional).allowed, false, 'test membership never overrides revocation');
    equal(access(secondAdditional).allowed, false);
    assert.match(sql(verifier), /PASS/);
  }
  sql("select public.set_r2b_rollout_gate('paused',null);");
  equal(access(admin).allowed, false);
  if (multiTesters) equal(sql('select cardinality(additional_test_user_ids) from public.r2b_rollout_gate;'), '0', 'paused clears membership');
  sql(`select public.set_r2b_rollout_gate('test_only','${admin}');`);
  if (multiTesters) {
    equal(sql('select cardinality(additional_test_user_ids) from public.r2b_rollout_gate;'), '0', 'reentry does not resurrect testers');
    sql(`update public.r2b_rollout_gate set additional_test_user_ids=array['${additional}']::uuid[];`);
  }
  sql("select public.set_r2b_rollout_gate('open',null);");
  if (multiTesters) equal(sql('select cardinality(additional_test_user_ids) from public.r2b_rollout_gate;'), '0', 'open clears membership');
  equal(bootstrap(outsider).allowed, true, 'open admits previously gated evidence');
  const user = newUser(false);
  equal(bootstrap(user).reason, 'email_not_verified');
  equal(access(user).allowed, false);
  sql(`update auth.users set email_confirmed_at=clock_timestamp() where id='${user}';`);
  equal(bootstrap(user), { allowed: true, reason: 'allowed', access_source: 'public_registration' });
  equal(access(user).allowed, true);
  equal(sql(`select plan_code||':'||account_status||':'||beta_access_status from public.user_access_profiles where user_id='${user}';`), 'free:active:approved');
  equal(sql(`select count(*) from public.user_role_assignments where user_id='${user}' and role_code='user';`), '1');
  equal(sql(`select count(*) from public.user_settings where user_id='${user}' and setting_key='Fecha_Inicio_Networking';`), '1');
  equal(bootstrap(user).allowed, true);
  // SQL identity simulations, not hosted Google OAuth or GoTrue verification.
  const google = newUser(true, 'google');
  equal(sql(`select raw_app_meta_data->>'provider' from auth.users where id='${google}';`), 'google');
  equal(access(google).allowed, false, 'verified Google identity still requires admission');
  equal(bootstrap(google), { allowed: true, reason: 'allowed', access_source: 'public_registration' });
  equal(access(google).allowed, true);
  equal(sql(`select plan_code from public.user_access_profiles where user_id='${google}';`), 'free');
  equal(sql(`select count(*) from public.user_role_assignments where user_id='${google}' and role_code='user' and is_active;`), '1');
  const googlePending = newUser(true, 'google');
  for (const provider of ['email', 'google']) {
    const forged = newUser(false, provider, true);
    equal(bootstrap(forged).reason, 'email_not_verified', `${provider} verification metadata is not Auth evidence`);
    equal(access(forged).allowed, false);
    equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${forged}';`), 't');
    equal(sql(`select count(*) from public.user_role_assignments where user_id='${forged}';`), '0');
    sql(`update auth.users set email_confirmed_at=clock_timestamp() where id='${forged}';`);
    equal(bootstrap(forged).allowed, true, 'only authoritative confirmation unlocks admission');
  }
  configure(false); equal(publicStatus(), { enabled: false }); equal(bootstrap(user).allowed, true);
  equal(bootstrap(google).allowed, true, 'Google admission persists with OFF');
  equal(bootstrap(googlePending).allowed, false, 'Google candidate cannot complete while OFF without another source');
  equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${googlePending}';`), 't');
  const offUser = newUser(), googleOff = newUser(true, 'google');
  for (const id of [offUser, googleOff]) {
    equal(bootstrap(id).allowed, false, 'new email/Google identities denied with OFF');
    equal(sql(`select count(*) from public.app_public_registration_admissions where user_id='${id}';`), '0');
  }
  configure(true);
  equal(bootstrap(offUser).allowed, false, 'OFF email creation cannot acquire evidence later');
  equal(bootstrap(googleOff).allowed, false, 'OFF Google creation cannot acquire evidence later');
  equal(bootstrap(googlePending).allowed, true, 'Google evidence captured ON remains usable when reopened');
  sql(`update public.user_role_assignments set is_active=false where user_id='${user}' and role_code='user';`);
  equal(bootstrap(user).allowed, true);
  equal(sql(`select count(*) from public.user_role_assignments where user_id='${user}' and is_active;`), '0', 'revoked role not repaired');
  for (const state of ['paused', 'closed']) {
    sql(`update public.user_access_profiles set account_status='${state}' where user_id='${user}';`);
    equal(bootstrap(user).allowed, false); equal(access(user).allowed, false);
  }
  sql(`update public.user_access_profiles set account_status='active',beta_access_status='blocked' where user_id='${user}';`);
  equal(bootstrap(user).allowed, false); equal(access(user).allowed, false);
  sql(`update public.user_access_profiles set beta_access_status='approved' where user_id='${user}';
    update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id='${user}';`);
  equal(bootstrap(user).reason, 'auth_user_banned'); equal(access(user).allowed, false);
  sql(`update auth.users set banned_until=null,email='changed-${user}@example.invalid' where id='${user}';`);
  equal(bootstrap(user).reason, 'public_registration_identity_changed'); equal(access(user).allowed, false);
  for (const status of ['inactive', 'expired', 'future']) {
    const candidate = newUser();
    sql(`insert into public.user_role_assignments(user_id,role_code,is_active,starts_at,expires_at)
      values('${candidate}','user',${status !== 'inactive'},${status === 'future' ? "clock_timestamp()+interval '1 day'" : 'clock_timestamp()'},
        ${status === 'expired' ? "clock_timestamp()-interval '1 day'" : 'null'});`);
    equal(bootstrap(candidate).reason, 'public_registration_role_history');
    equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${candidate}';`), 't');
  }
  // Verification is exercised as the actual client roles, not only catalog queries.
  for (const role of ['anon','authenticated','service_role','supabase_auth_admin']) {
    const asRole = body => role === 'supabase_auth_admin' ? sqlAsAuthAdmin(body)
      : sql(`begin; set local role ${role}; ${body} rollback;`);
    denied(() => asRole('select * from public.app_public_registration_admissions;'), /permission denied for table/);
    denied(() => asRole('select public.bootstrap_public_registration_v1();'), /permission denied for function/);
  }
  denied(() => sql('begin; set local role anon; select public.admin_public_registration_state_v1(); rollback;'), /permission denied/);
  const hook = id => JSON.parse(sqlAsAuthAdmin(
    `select public.hook_enforce_app_access_allowlist('{"user":{"email":"${id}@example.invalid"}}');`));
  equal(hook(randomUUID()), {});
  const gated = newUser();
  sql("select public.set_r2b_rollout_gate('paused',null);");
  equal(publicStatus(), { enabled: false }); equal(bootstrap(gated).reason, 'maintenance');
  equal(hook(randomUUID()).error.http_code, 403);
  equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${gated}';`), 't');
  sql(`select public.set_r2b_rollout_gate('test_only','${admin}');`);
  equal(publicStatus(), { enabled: false }); equal(bootstrap(gated).reason, 'maintenance');
  equal(JSON.parse(request(admin,'select public.admin_public_registration_state_v1();')).enabled, true);
  sql("select public.set_r2b_rollout_gate('open',null);");
  equal(bootstrap(gated).allowed, true);
  const inviteSettings = (enabled, registrations) => request(admin,
    `select public.admin_update_invitation_program_v1(${enabled},${registrations},10);`);
  const invite = id => JSON.parse(request(admin, `select public.authorize_current_user_invitation_v1('${id}@example.invalid');`)).invitation_id;
  inviteSettings(true, true);
  const pending = newUser(); const invitation = invite(pending);
  const invitationBefore = sql(`select row_to_json(i) from public.app_invitations i where id='${invitation}';`);
  inviteSettings(false, false);
  equal(bootstrap(pending).access_source, 'public_registration');
  equal(sql(`select row_to_json(i) from public.app_invitations i where id='${invitation}';`), invitationBefore,
    'public path leaves pending invitation, original expiry and reservation untouched');
  inviteSettings(true, true);
  const fallback = newUser(); invite(fallback); configure(false);
  equal(bootstrap(fallback).access_source, 'invitation', 'OFF pending public evidence falls back to valid invitation');
  equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${fallback}';`), 't');
  equal(bootstrap(fallback).access_source, 'invitation', 'registered invitation remains legacy');
  equal(bootstrap(admin).access_source, 'legacy_allowlist');
  configure(true);
  const blocked = newUser(); const blockedInvitation = invite(blocked);
  request(admin, `select public.admin_cancel_invitation_v1('${blockedInvitation}','Synthetic cancellation');`);
  equal(bootstrap(blocked).allowed, false); equal(hook(blocked).error.http_code, 403);
  const revoked = newUser();
  sql(`insert into public.app_access_allowlist(email_normalized,revoked_at) values('${revoked}@example.invalid',clock_timestamp());`);
  equal(bootstrap(revoked).allowed, false); equal(hook(revoked).error.http_code, 403);
  const revokedEvidence = newUser();
  sql(`update public.app_public_registration_admissions set revoked_at=clock_timestamp() where user_id='${revokedEvidence}';`);
  equal(bootstrap(revokedEvidence).allowed, false);
  // Existing RLS consumers see the same helper OID and isolate ownership.
  equal(request(pending, `select count(*) from public.profiles where id='${pending}';`), '1');
  equal(request(pending, `select count(*) from public.profiles where id='${admin}';`), '0');
  request(pending, "select * from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');");
  equal(access(pending).allowed, true, 'own-data reset preserves admission');
  for (const table of ['app_public_registration_settings','app_public_registration_admissions'])
    denied(() => request(pending, `delete from public.${table};`), /permission denied/);

  const bootSql = id => `select row_to_json(s) from public.bootstrap_current_user_invitation_v1() s;`;
  const waiting = app => sql(`select count(*) from pg_stat_activity where application_name='${app}' and wait_event_type='Lock';`) === '1';
  const notAdmitted = id => equal(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${id}';`), 't');
  // OFF commits while dispatch waits on the setting: no stale ON admission.
  const offRace = newUser();
  const offLock = session('reg-off-lock', `begin; update public.app_public_registration_settings set enabled=false,revision=revision+1;
    select 'LOCKED';\n`, true);
  await until(() => offLock.output().includes('LOCKED'), 'OFF lock');
  const offBoot = session('reg-off-bootstrap', `begin; ${jwt(offRace)} ${bootSql(offRace)} commit;`);
  await until(() => waiting('reg-off-bootstrap'), 'bootstrap waiting on OFF');
  offLock.child.stdin.end('commit;\n'); equal((await offLock.done).code, 0);
  const offResult = await offBoot.done; equal(offResult.code, 0); equal(JSON.parse(offResult.output).allowed, false); notAdmitted(offRace);
  configure(true);
  // Cancellation commits while first admission waits on the allowlist table.
  const cancelRace = newUser(); const cancelInvitation = invite(cancelRace);
  const allowlistLock = session('reg-allowlist-lock', `begin; lock table public.app_access_allowlist in row exclusive mode; select 'LOCKED';\n`, true);
  await until(() => allowlistLock.output().includes('LOCKED'), 'allowlist lock');
  const cancelBoot = session('reg-cancel-bootstrap', `begin; ${jwt(cancelRace)} ${bootSql(cancelRace)} commit;`);
  await until(() => waiting('reg-cancel-bootstrap'), 'bootstrap waiting on veto table');
  request(admin, `select public.admin_cancel_invitation_v1('${cancelInvitation}','Synthetic concurrent cancellation');`);
  allowlistLock.child.stdin.end('commit;\n'); equal((await allowlistLock.done).code, 0);
  const cancelResult = await cancelBoot.done; equal(cancelResult.code, 0); equal(JSON.parse(cancelResult.output).allowed, false); notAdmitted(cancelRace);
  // Account block commits while bootstrap waits: no profile reactivation.
  const profileRace = newUser();
  const profileLock = session('reg-profile-lock', `begin; update public.user_access_profiles set account_status='paused' where user_id='${profileRace}'; select 'LOCKED';\n`, true);
  await until(() => profileLock.output().includes('LOCKED'), 'profile lock');
  const profileBoot = session('reg-profile-bootstrap', `begin; ${jwt(profileRace)} ${bootSql(profileRace)} commit;`);
  await until(() => waiting('reg-profile-bootstrap'), 'bootstrap waiting on blocked profile');
  profileLock.child.stdin.end('commit;\n'); equal((await profileLock.done).code, 0);
  const profileResult = await profileBoot.done; equal(profileResult.code, 0); equal(JSON.parse(profileResult.output).reason, 'administratively_blocked'); notAdmitted(profileRace);
  // Unique-key/FK reverse order can deadlock. Force bootstrap to detect the cycle
  // first, then prove full rollback and conservative retry after admin wins here.
  // Production can choose either victim; this does not guarantee admin priority.
  const roleRace = newUser();
  const roleBarrier = session('reg-role-barrier', `begin; select user_id from public.user_access_profiles where user_id='${roleRace}' for update; select 'LOCKED';\n`, true);
  await until(() => roleBarrier.output().includes('LOCKED'), 'role barrier');
  const roleBoot = session('reg-role-bootstrap', `begin; set local deadlock_timeout='100ms'; ${jwt(roleRace)} ${bootSql(roleRace)} commit;`);
  await until(() => waiting('reg-role-bootstrap'), 'bootstrap has profile FK barrier');
  const roleAdmin = session('reg-role-admin', `begin; set local deadlock_timeout='10s';
    insert into public.user_role_assignments(user_id,role_code,is_active,starts_at)
    values('${roleRace}','user',true,clock_timestamp()+interval '1 day'); commit;`);
  await until(() => waiting('reg-role-admin'), 'admin role FK wait');
  roleBarrier.child.stdin.end('commit;\n'); equal((await roleBarrier.done).code, 0);
  const roleResult = await roleBoot.done; assert.notEqual(roleResult.code, 0); assert.match(roleResult.error, /deadlock detected/); checks++;
  equal((await roleAdmin.done).code, 0); notAdmitted(roleRace);
  equal(sql(`select account_status from public.user_access_profiles where user_id='${roleRace}';`), 'beta_pending');
  equal(bootstrap(roleRace).reason, 'public_registration_role_history');
  // Concurrent idempotent calls produce one admission and one user role.
  const concurrent = newUser();
  const c1 = session('reg-concurrent-1', `begin; ${jwt(concurrent)} ${bootSql(concurrent)} commit;`);
  const c2 = session('reg-concurrent-2', `begin; ${jwt(concurrent)} ${bootSql(concurrent)} commit;`);
  for (const result of await Promise.all([c1.done,c2.done])) { equal(result.code, 0); equal(JSON.parse(result.output).allowed, true); }
  equal(sql(`select count(*) from public.user_role_assignments where user_id='${concurrent}' and role_code='user';`), '1');
  // Setting writers recheck privileges after waiting, not only before acquiring the row.
  const secondAdmin = randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized) values('${secondAdmin}@example.invalid'); ${authInsert(secondAdmin)}
    insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('${secondAdmin}','system_admin','Synthetic');`);
  const stateBefore = JSON.parse(request(admin, 'select public.admin_public_registration_state_v1();'));
  const settingsLock = session('reg-admin-settings-lock', 'begin; select singleton from public.app_public_registration_settings for update; select \'LOCKED\';\n', true);
  await until(() => settingsLock.output().includes('LOCKED'), 'admin setting lock');
  const adminWrite = session('reg-admin-settings-write', `begin; ${jwt(secondAdmin)}
    select public.admin_set_public_registration_v1(false,${stateBefore.revision}); commit;`);
  await until(() => waiting('reg-admin-settings-write'), 'admin mutation waiting');
  sql(`update public.user_role_assignments set is_active=false where user_id='${secondAdmin}' and role_code='system_admin';`);
  settingsLock.child.stdin.end('commit;\n'); equal((await settingsLock.done).code, 0);
  const adminResult = await adminWrite.done; assert.notEqual(adminResult.code, 0); assert.match(adminResult.error, /admin_manage_access_required/); checks++;
  equal(JSON.parse(request(admin, 'select public.admin_public_registration_state_v1();')), stateBefore);
  const revision = stateBefore.revision;
  const s1 = session('reg-cas-1', `begin; ${jwt(admin)} select public.admin_set_public_registration_v1(false,${revision}); commit;`);
  const s2 = session('reg-cas-2', `begin; ${jwt(admin)} select public.admin_set_public_registration_v1(false,${revision}); commit;`);
  const cas = await Promise.all([s1.done,s2.done]); equal(cas.filter(r => r.code === 0).length, 1);
  assert.match(cas.find(r => r.code !== 0).error, /revision_conflict/); checks++;
  configure(true);
  denied(() => sql("begin; grant execute on function public.bootstrap_public_registration_v1() to authenticated;\n" + verifier), /function body\/signature\/security\/ACL drift/);
  denied(() => sql("begin; grant update(enabled) on public.app_public_registration_settings to anon;\n" + verifier), /table security drift/);
  denied(() => sql("begin; alter table public.app_public_registration_settings alter column enabled set default true;\n" + verifier), /default drift/);
  denied(() => sql("begin; alter table public.app_public_registration_settings drop constraint app_public_registration_settings_revision_check; alter table public.app_public_registration_settings add check(revision>=-1);\n" + verifier), /CHECK drift/);
  equal(JSON.parse(sql(file('verifiers/202610270002_verify_networking_cycle_operations_v1.sql', baseline))).verdict, 'pass');
  assert.match(sql(file('verifiers/202611060005_verify_calendar_write_boundary.sql', baseline)), /PASS/i);
  assert.match(sql(verifier), /PASS/);
  console.log(`PASS: REG-OPEN-01 ${checks} checks; OIDs/ACL, anon, RLS, R2-B, invitations, email/Google SQL identities ON/OFF, forged metadata rejection, roles, OFF/block/cancel races, role deadlock rollback, concurrent admission`);
  }
} finally {
  for (const child of children) { child.stdin.end(); child.kill(); }
  if (identity) {
    const info = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(info.Id, identity); assert.equal(info.Config.Labels[label], run); assert.equal(info.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', name]);
  }
}
