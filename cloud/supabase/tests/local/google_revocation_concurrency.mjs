import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local Docker only, no ports, no network, no downloads, no remote credentials.
// This characterizes existing semantics; it does NOT approve writes after revocation.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sqlRoot = join(repo, 'cloud/supabase');
assert.equal(existsSync(join(sqlRoot, 'migrations/202610210002_google_sync_capability_enforcement_contract_v1.sql')), false,
  'Run from the isolated expand package, never the dirty contract worktree');
const run = randomUUID();
const name = `cc-revocation-${run.slice(0, 12)}`;
const label = 'coffeecito.sec-google-revocation';
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 8e6, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).trim();
const pause = () => new Promise((done) => setTimeout(done, 100));
const psqlArgs = (app) => ['exec', '-i', '-e', `PGAPPNAME=${app}`, '-e',
  `PGOPTIONS=-c coffeecito.local_fixture=${run} -c statement_timeout=45000 -c client_min_messages=warning`, name,
  'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
const sql = (text, app = `${name}-observer`) => docker(psqlArgs(app), { input: text });
const children = new Set();
function session(app, text, close = true) {
  const child = spawn('docker', psqlArgs(app), { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { error += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => { children.delete(child); resolve({ code, output, error }); });
  });
  child.stdin.write(text);
  if (close) child.stdin.end();
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
let created = false;
let id;
try {
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  id = docker(['create', '--pull=never', '--name', name, '--label', `${label}=${run}`,
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'PGDATA=/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image]);
  created = true;
  docker(['start', name]);
  await until(() => {
    try { return sql('select 1;') === '1'; } catch { return false; }
  }, 'local PostgreSQL startup');
  const version = sql('show server_version;');
  assert.match(version, /^17\./);
  // Guard before the first application DDL. No DROP SCHEMA or reset is used.
  sql(`do $$ begin
    if current_database() <> 'postgres' or current_setting('coffeecito.local_fixture', true) <> '${run}'
      or to_regclass('public.profiles') is not null or to_regclass('auth.users') is null then
      raise exception 'Not the empty disposable Supabase database';
    end if;
    if exists(select 1 from auth.users) then raise exception 'Auth store is not empty'; end if;
  end $$;`);
  const identity = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(identity.Id, id);
  assert.equal(identity.Config.Labels[label], run);
  assert.equal(identity.HostConfig.NetworkMode, 'none');
  sql(readFileSync(join(sqlRoot, 'bootstrap/preflight_empty.sql'), 'utf8'));
  for (const folder of ['migrations', 'seeds']) {
    for (const file of readdirSync(join(sqlRoot, folder)).filter((file) => file.endsWith('.sql')).sort()) {
      sql(readFileSync(join(sqlRoot, folder, file), 'utf8'));
    }
  }
  for (const file of [
    '202610210001_verify_access_expand_pre_contract.sql',
    '202610210001_verify_google_sync_capability_enforcement_v1.sql',
    '202609290002_verify_merge_reset_grants.sql',
  ]) {
    sql(readFileSync(join(sqlRoot, 'verifiers', file), 'utf8'));
    console.log(`PostgreSQL ${version}: ${file} PASS`);
  }
  // Negative verifier probes use effective grants and always roll back.
  const verifier = readFileSync(join(sqlRoot, 'verifiers/202610210001_verify_access_expand_pre_contract.sql'), 'utf8')
    .replace(/begin transaction read only;/i, '').replace(/rollback;\s*$/i, '');
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin']) {
    assert.throws(() => sql(`begin; grant execute on function public.user_has_provider_rollout_for_user_v1(uuid,text) to ${role};\n${verifier}\nrollback;`),
      /can execute|EXECUTE grant/);
  }
  sql(readFileSync(join(sqlRoot, 'verifiers/202610210001_verify_access_expand_pre_contract.sql'), 'utf8'));
  console.log('Internal helper: five forbidden EXECUTE probes rejected and rolled back');
  for (const kind of ['contacts', 'calendar']) {
    const user = randomUUID();
    const account = randomUUID();
    const external = `synthetic-${kind}-${run}`;
    const deniedExternal = `${external}-after`;
    const capability = kind === 'contacts' ? 'contacts.sync_external' : 'interactions.sync_calendar';
    const key = kind === 'contacts' ? `google-contact:${external}` : `google-interaction:calendar:${external}`;
    sql(`begin;
      insert into public.app_access_allowlist(email_normalized) values ('${user}@example.invalid');
      insert into auth.users(id,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
      values ('${user}','${user}@example.invalid',now(),now(),'{}','{}');
      update public.user_access_profiles set account_status='active', beta_access_status='approved' where user_id='${user}';
      insert into public.user_role_assignments(user_id,role_code,assignment_reason) values ('${user}','beta_tester','local concurrency fixture');
      insert into public.connected_accounts(id,user_id,provider,account_email,scopes,capabilities,status,effective_scopes_verified_at,effective_scopes_verification_method)
      values ('${account}','${user}','google','${user}@example.invalid',
        array['https://www.googleapis.com/auth/contacts.readonly','https://www.googleapis.com/auth/calendar.readonly'],
        '{"contacts_read":true,"calendar_read":true,"gmail_read":false}','active',now(),'google_tokeninfo_userinfo_v0_1');
      commit;`);
    const auth = `set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true);`;
    const call = (externalId) => {
      const payload = kind === 'contacts'
        ? { changeType: 'new', changeId: externalId, contact: { displayName: 'Synthetic revocation' },
            externalIds: [{ externalId }], snapshots: [{ externalId, displayName: 'Synthetic revocation' }] }
        : { sourceService: 'calendar', interactionType: 'calendar', direction: 'unknown', externalId,
            externalObjectType: 'event', occurredAt: '2026-10-23T12:00:00Z', subject: 'Synthetic revocation', participants: [] };
      const rpc = kind === 'contacts' ? 'apply_google_contact_sync_change_v1' : 'apply_google_interaction_sync_v1';
      return `select public.${rpc}('${account}', '${JSON.stringify(payload)}'::jsonb);`;
    };
    const holderName = `${name}-${kind}-holder`;
    const writerName = `${name}-${kind}-writer`;
    const holder = session(holderName, `begin; select pg_advisory_xact_lock(hashtext('${user}'),hashtext('${key}')); select 'LOCK_HELD';\n`, false);
    await until(() => holder.output().includes('LOCK_HELD'), 'holder acquired exact identity lock');
    const writer = session(writerName, `begin; ${auth} ${call(external)} commit;`);
    const waitingSql = `select count(*) from pg_stat_activity w join pg_stat_activity h on h.application_name='${holderName}'
      join pg_locks wl on wl.pid=w.pid and wl.locktype='advisory' and not wl.granted
      join pg_locks hl on hl.pid=h.pid and hl.granted and hl.locktype=wl.locktype
        and hl.classid=wl.classid and hl.objid=wl.objid and hl.objsubid=wl.objsubid
      where w.application_name='${writerName}' and w.wait_event_type='Lock' and w.wait_event='advisory'
        and h.pid=any(pg_blocking_pids(w.pid));`;
    await until(() => sql(waitingSql) === '1', 'Apply passed authorization and waits on the held advisory lock');
    const events = ['holder_lock_acquired', 'apply_wait_confirmed_pg_locks'];
    // Third independent connection commits while Apply is demonstrably blocked.
    sql(`begin; insert into public.user_capability_overrides(user_id,capability_code,override_mode,override_reason)
      values ('${user}','${capability}','deny','local concurrent revocation'); commit;`, `${name}-revoker`);
    events.push('deny_committed');
    assert.equal(sql(waitingSql), '1');
    const allowed = sql(`begin; ${auth} select public.current_user_can_sync_connected_account_v1('${account}','${kind}'); rollback;`);
    assert.equal(allowed.split('\n').at(-1), 'f');
    holder.child.stdin.end('commit;\n');
    assert.equal((await holder.done).code, 0);
    events.push('holder_released');
    const outcome = await writer.done;
    assert.equal(outcome.code, 0, outcome.error);
    events.push('waiting_apply_committed');
    const countsSql = kind === 'contacts'
      ? `select json_build_array((select count(*) from public.contacts where user_id='${user}'),
          (select count(*) from public.external_contact_ids where user_id='${user}'),
          (select count(*) from public.external_contact_snapshots where user_id='${user}'),
          (select count(*) from public.audit_log where user_id='${user}' and action='sync.contacts.apply_preview'),
          (select count(*) from public.external_contact_ids x left join public.contacts c on c.id=x.contact_id where x.user_id='${user}' and (c.id is null or c.user_id<>x.user_id)));`
      : `select json_build_array((select count(*) from public.interactions where user_id='${user}'),
          (select count(*) from public.external_interaction_sources where user_id='${user}'),
          (select count(*) from public.action_invocations where user_id='${user}' and action_name='interaction.sync_external'),
          (select count(*) from public.external_interaction_sources x left join public.interactions i on i.id=x.interaction_id where x.user_id='${user}' and (i.id is null or i.user_id<>x.user_id)));`;
    const before = JSON.parse(sql(countsSql));
    assert.deepEqual(before, kind === 'contacts' ? [1,1,1,1,0] : [1,1,1,0]);
    const denied = await session(`${name}-${kind}-new`, `begin; ${auth} ${call(deniedExternal)} commit;`).done;
    assert.notEqual(denied.code, 0);
    assert.match(denied.error, /GOOGLE_CONNECTED_SYNC_DENIED/);
    assert.deepEqual(JSON.parse(sql(countsSql)), before);
    events.push('new_apply_denied_no_partial_writes');
    console.log(JSON.stringify({ kind, events, counts: before, observed: 'authorized_in_flight_write_survives_deny', acceptance: 'PENDING_SECURITY_DECISION' }));
  }
} finally {
  for (const child of children) if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
  if (created) {
    const identity = JSON.parse(docker(['inspect', name]))[0];
    assert.equal(identity.Id, id);
    assert.equal(identity.Config.Labels[label], run);
    assert.equal(identity.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', '-v', name]);
    console.log(`Removed owned disposable container ${name} and its anonymous volumes`);
  }
}
