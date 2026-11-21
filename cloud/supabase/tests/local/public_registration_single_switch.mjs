import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Executes only inside the network-none disposable PostgreSQL harness.
export async function verifySingleSwitch({ sql, sqlAsAuthAdmin, file, migration, authInsert, multiTesters, session, until }) {
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const request = (id, query) => sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${id}'; ${query} commit;`);
  const bootstrap = id => JSON.parse(request(id, 'select row_to_json(s) from public.bootstrap_current_user_invitation_v1() s;'));
  const access = id => JSON.parse(request(id, 'select row_to_json(s) from public.current_user_app_access_status() s;'));
  const status = () => JSON.parse(sql('begin; set local role anon; select public.public_registration_status_v1(); commit;'));
  const hook = id => JSON.parse(sqlAsAuthAdmin(`select public.hook_enforce_app_access_allowlist('{"user":{"email":"${id}@example.invalid"}}');`));
  const admin = randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized) values('${admin}@example.invalid'); ${authInsert(admin)}
    insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('${admin}','system_admin','Synthetic');
    select public.set_r2b_rollout_gate('test_only','${admin}');`);
  sql(migration);
  let additional;
  if (multiTesters) {
    additional = randomUUID();
    sql(`insert into public.app_access_allowlist(email_normalized) values('${additional}@example.invalid'); ${authInsert(additional)}
      update public.r2b_rollout_gate set additional_test_user_ids=array['${additional}']::uuid[] where singleton;`);
    eq(access(additional).allowed, true, 'existing additional DEV tester admitted before patch');
  }
  const configure = enabled => {
    const state = JSON.parse(request(admin, 'select public.admin_public_registration_state_v1();'));
    return JSON.parse(request(admin, `select public.admin_set_public_registration_v1(${enabled},${state.revision});`));
  };
  configure(true);
  const candidate = randomUUID();
  sql(authInsert(candidate));
  eq(status().enabled, false, 'REPRO: admin ON is hidden by test_only');
  eq(hook(randomUUID()).error.http_code, 403, 'REPRO: hook denies new email');
  eq(bootstrap(candidate).reason, 'maintenance', 'REPRO: bootstrap denies captured candidate');
  eq(access(candidate).reason, 'maintenance', 'REPRO: effective access denies non-tester');
  configure(false);
  console.log(`PASS: ${checks} root-cause reproductions (${multiTesters ? 'DEV' : 'standard'}); no remote effects`);

  // Reproduce the known DEV representation: one stored CR, identical normalized body.
  sql(`do $$ declare p pg_proc%rowtype; body text; begin
    select * into p from pg_proc where oid='public.bootstrap_public_registration_v1()'::regprocedure;
    body := replace(p.prosrc,chr(13),'');
    body := overlay(body placing chr(13)||chr(10) from strpos(body,chr(10)) for 1);
    execute replace(pg_get_functiondef(p.oid),p.prosrc,body);
  end $$;`);
  eq(sql(`select length(prosrc)-length(replace(prosrc,chr(13),'')) from pg_proc
    where oid='public.bootstrap_public_registration_v1()'::regprocedure;`), '1', 'one stored CR fixture');

  const fingerprint = () => sql(`select jsonb_build_object(
    'gate',(select to_jsonb(g) from public.r2b_rollout_gate g),
    'setter',pg_get_functiondef('public.set_r2b_rollout_gate(text,uuid)'::regprocedure),
    'functions',(select jsonb_agg(jsonb_build_array(oid,proacl::text) order by oid) from pg_proc where pronamespace='public'::regnamespace),
    'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p))`);
  const before = fingerprint();
  const preflight = file('preflight/202611200002_preflight_public_registration_single_switch.sql');
  const patch = file('migrations/202611200002_public_registration_single_switch.sql');
  const verifier = file('verifiers/202611200002_verify_public_registration_single_switch.sql');
  {
    const snapshot = () => sql(`select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_array(oid,md5(prosrc),proacl::text) order by oid) from pg_proc where pronamespace='public'::regnamespace),
      'settings',(select to_jsonb(s) from public.app_public_registration_settings s),
      'admissions',(select jsonb_agg(to_jsonb(a) order by user_id) from public.app_public_registration_admissions a),
      'gate',(select to_jsonb(g) from public.r2b_rollout_gate g))`);
    const beforeTransport = snapshot();
    const anchorBlock = source => source.slice(source.indexOf('do $anchors$'),source.indexOf('end $anchors$;') + 'end $anchors$;'.length).replace(/\r/g,'');
    eq(anchorBlock(preflight), anchorBlock(patch), 'preflight and migration use identical anchor checks');
    for (const eol of ['\n','\r\n']) {
      const transport = source => source.replace(/\r?\n/g,eol);
      assert.match(sql(transport(preflight)), /PASS/); checks++;
      const abort = patch.replace(/commit;\s*$/, () => "do $$ begin raise exception 'synthetic_abort_after_replacement'; end $$; commit;");
      assert.throws(() => sql(transport(abort)), /synthetic_abort_after_replacement/); checks++;
      eq(snapshot(), beforeTransport, 'rollback preserves all bodies, ACL, switch, admissions and gate');
      for (const drift of [
        "alter function public.bootstrap_public_registration_v1() security invoker;",
        "grant execute on function public.bootstrap_public_registration_v1() to authenticated;",
        "do $$ declare d text; begin d:=pg_get_functiondef('public.bootstrap_public_registration_v1()'::regprocedure); execute replace(d,'email_not_verified','unexpected_changed_contract'); end $$;"
      ]) {
        for (const contract of [preflight,patch]) {
          const inside = contract.replace(/begin(?: isolation level repeatable read read only)?;/i,'');
          assert.throws(() => sql('begin; '+drift+'\n'+transport(inside)), /body\/signature\/security\/ACL drift/); checks++;
        }
        eq(snapshot(),beforeTransport,'real drift rejected transactionally');
      }
    }
    assert.match(sql(file('verifiers/202611190001_verify_public_registration_v1.sql')), /PASS/);
    const diagnostic = JSON.parse(sql(file('operations/dev/202611200002_diagnose_failed_single_switch.sql')));
    eq(diagnostic.installation_state, 'previous_contract_present');
    eq(diagnostic.known_variant, multiTesters ? 'dev_multi_tester' : 'standard');
    eq(diagnostic.bootstrap_anchor_checks.normalized_definition_matches_LF_anchor, true);
    eq(diagnostic.bootstrap_anchor_checks.normalized_definition_matches_CRLF_anchor, false);
    console.log('PASS: one stored CR; LF/CRLF guards, rollback and real body/security/ACL drift rejection');
  }
  assert.match(sql(preflight), /PASS/); checks++;
  configure(true);
  assert.throws(() => sql(preflight), /close public registration/); checks++;
  configure(false);
  sql(patch.replace(/\r?\n/g,'\r\n'));
  assert.match(sql(verifier.replace(/\r?\n/g,'\r\n')), /PASS/); checks++;
  const verifierBody = verifier.slice(verifier.indexOf('do $verify$'), verifier.indexOf('end $verify$;') + 'end $verify$;'.length);
  assert.throws(() => sql(`begin; alter function public.public_registration_status_v1() security invoker; ${verifierBody} rollback;`), /security\/ACL drift/); checks++;
  assert.throws(() => sql(patch), /body\/signature\/security\/ACL drift/); checks++;
  eq(fingerprint(), before, 'gate, setter, all function OIDs/ACL and RLS unchanged');
  if (additional) eq(access(additional).allowed, true, 'additional DEV tester preserved after patch');
  console.log(sql(`select proname||'='||md5(replace(prosrc,E'\\r','')) from pg_proc where oid in (
    'public.public_registration_status_v1()'::regprocedure,'public.bootstrap_public_registration_v1()'::regprocedure,
    'public.app_access_status_for_user(uuid)'::regprocedure) order by proname;`));
  eq(status().enabled, false, 'installation stays OFF');
  eq(access(admin).allowed, true, 'existing admin unaffected');
  eq(hook(randomUUID()).error.http_code, 403, 'OFF denies unknown new identity');
  eq(bootstrap(candidate).allowed, false, 'OFF does not admit a pending candidate');
  const legacyPending = randomUUID(); sql(authInsert(legacyPending));
  configure(true);
  eq(status().enabled, true, 'ON is effective while gate remains test_only');
  eq(hook(randomUUID()), {}, 'ON admits Auth creation without allowlist');
  eq(bootstrap(legacyPending).allowed, false, 'no backfill for old pending identities');
  const admitted = [];
  for (const provider of ['email', 'google']) {
    const id = randomUUID();
    sql(authInsert(id, false, provider, true));
    eq(bootstrap(id).reason, 'email_not_verified', 'metadata cannot forge verification');
    eq(access(id).allowed, false, 'unverified evidence does not exempt test_only');
    sql(`update auth.users set email_confirmed_at=clock_timestamp() where id='${id}';`);
    eq(bootstrap(id), { allowed:true, reason:'allowed', access_source:'public_registration' }, 'verified public bootstrap');
    eq(access(id).allowed, true, 'effective access agrees');
    eq(bootstrap(id).allowed, true, 'idempotent repeat');
    eq(sql(`select plan_code||':'||account_status||':'||beta_access_status from public.user_access_profiles where user_id='${id}';`), 'free:active:approved');
    eq(sql(`select string_agg(role_code,',') from public.user_role_assignments where user_id='${id}';`), 'user', 'one base role only');
    eq(request(id, "select public.current_user_has_capability('admin.manage_access');"), 'f', 'no admin escalation');
    eq(request(id, 'select public.current_user_can_use_calendar_admin_v1();'), 'f', 'Calendar remains denied');
    eq(request(id, "select public.current_user_can_start_connected_oauth_v1('google');"), 'f', 'no provider privileges');
    eq(request(id, `select count(*) from public.profiles where id='${admin}';`), '0', 'RLS prevents reading another profile');
    assert.throws(() => request(id, 'select public.admin_set_public_registration_v1(false,0);'), /admin_manage_access_required/); checks++;
    admitted.push(id);
  }
  const concurrent = randomUUID(); sql(authInsert(concurrent));
  const bootCommand = id => `begin; set local role authenticated; set local request.jwt.claim.sub='${id}'; select row_to_json(s) from public.bootstrap_current_user_invitation_v1() s; commit;`;
  const first = session('single-switch-first', bootCommand(concurrent));
  const second = session('single-switch-second', bootCommand(concurrent));
  for (const result of await Promise.all([first.done, second.done])) {
    eq(result.code, 0); eq(JSON.parse(result.output).allowed, true);
  }
  eq(sql(`select count(*) from public.user_role_assignments where user_id='${concurrent}' and role_code='user';`), '1', 'concurrent admission creates one role');
  const offRace = randomUUID(); sql(authInsert(offRace));
  const lock = session('single-switch-off-lock', "begin; update public.app_public_registration_settings set enabled=false,revision=revision+1; select 'LOCKED';\n", true);
  await until(() => lock.output().includes('LOCKED'), 'OFF transaction lock');
  const racing = session('single-switch-off-bootstrap', bootCommand(offRace));
  await until(() => sql("select count(*) from pg_stat_activity where application_name='single-switch-off-bootstrap' and wait_event_type='Lock';") === '1', 'bootstrap waiting for OFF');
  lock.child.stdin.end('commit;\n'); eq((await lock.done).code, 0);
  const raced = await racing.done;
  eq(raced.code, 0); eq(JSON.parse(raced.output).allowed, false, 'OFF wins before admission');
  eq(sql(`select admitted_at is null from public.app_public_registration_admissions where user_id='${offRace}';`), 't');
  configure(false);
  for (const id of admitted) {
    eq(bootstrap(id).allowed, true, 'OFF preserves public admitted bootstrap');
    eq(access(id).allowed, true, 'OFF preserves effective public access');
  }
  // Match the approved DEV Calendar exception only in this disposable database.
  sql(`insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('${admin}','beta_tester','Synthetic');
    grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to service_role;`);
  const calendar = file('verifiers/202611200002_verify_reg_open_dev_calendar.sql');
  assert.match(sql(calendar), /"verdict": "pass"/); checks++;
  const contextBlock = calendar.slice(calendar.indexOf('do $dev_contract$'), calendar.indexOf('end $dev_contract$;') + 'end $dev_contract$;'.length);
  assert.throws(() => sql(`begin; grant execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) to service_role; ${contextBlock} rollback;`), /EXECUTE|ACL drift/); checks++;
  eq(hook(randomUUID()).error.http_code, 403, 'OFF closes new Auth registrations again');
  const victim = admitted[0];
  for (const change of [
    `update public.user_access_profiles set account_status='paused' where user_id='${victim}';`,
    `update public.user_access_profiles set account_status='closed' where user_id='${victim}';`,
    `update public.user_access_profiles set beta_access_status='blocked' where user_id='${victim}';`,
    `update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${victim}';`,
    `update auth.users set email_confirmed_at=null where id='${victim}';`,
    `update auth.users set email='changed@example.invalid' where id='${victim}';`,
    `update public.app_public_registration_admissions set revoked_at=clock_timestamp() where user_id='${victim}';`,
    `insert into public.app_access_allowlist(email_normalized,revoked_at) values('${victim}@example.invalid',clock_timestamp());`
  ]) {
    const result = JSON.parse(sql(`begin; ${change} set local role authenticated; set local request.jwt.claim.sub='${victim}';
      select jsonb_build_object('bootstrap',(select allowed from public.bootstrap_current_user_invitation_v1()),
        'access',(select allowed from public.current_user_app_access_status())); rollback;`));
    eq(result, { bootstrap:false, access:false }, 'administrative/identity veto survives exemption');
  }
  // Preserve emergency maintenance, without changing DEV's actual gate remotely.
  sql("select public.set_r2b_rollout_gate('paused',null);");
  eq(status().enabled, false);
  eq(access(victim).reason, 'maintenance');
  eq(bootstrap(victim).reason, 'maintenance');
  sql(`select public.set_r2b_rollout_gate('test_only','${admin}');`);
  eq(access(victim).allowed, true, 'resume requires no tester enrollment');
  eq(sql("select mode from public.r2b_rollout_gate where singleton;"), 'test_only');
  // Also exercise the production-standard open mode, with OFF then ON.
  sql("select public.set_r2b_rollout_gate('open',null);");
  eq(status().enabled, false);
  configure(true);
  const openUser = randomUUID(); sql(authInsert(openUser));
  eq(hook(randomUUID()), {});
  eq(bootstrap(openUser).allowed, true);
  eq(access(openUser).allowed, true);
  configure(false);
  eq(access(openUser).allowed, true);
  // Invitation and allowlist contracts still work when public registration is OFF.
  request(admin, 'select public.admin_update_invitation_program_v1(true,true,10);');
  const invited = randomUUID();
  request(admin, `select public.authorize_current_user_invitation_v1('${invited}@example.invalid');`);
  eq(hook(invited), {}, 'valid invitation admits Auth with public OFF');
  sql(authInsert(invited));
  eq(bootstrap(invited).access_source, 'invitation');
  eq(access(invited).allowed, true);
  const legacy = randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized) values('${legacy}@example.invalid'); ${authInsert(legacy)}`);
  eq(hook(legacy), {});
  eq(bootstrap(legacy).access_source, 'legacy_allowlist');
  eq(access(legacy).allowed, true);
  configure(true);
  eq(access(invited).allowed, true); eq(access(legacy).allowed, true);
  const blocked = randomUUID(); sql(authInsert(blocked));
  const invitation = JSON.parse(request(admin, `select public.authorize_current_user_invitation_v1('${blocked}@example.invalid');`)).invitation_id;
  request(admin, `select public.admin_cancel_invitation_v1('${invitation}','Synthetic cancellation');`);
  eq(hook(blocked).error.http_code, 403, 'cancelled blocked invitation cannot use public ON');
  eq(bootstrap(blocked).allowed, false);
  const revoked = randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized,revoked_at) values('${revoked}@example.invalid',clock_timestamp());`);
  eq(hook(revoked).error.http_code, 403, 'revoked email cannot use public ON');
  configure(false);
  eq(access(invited).allowed, true); eq(access(legacy).allowed, true);
  assert.match(sql(verifier), /PASS/); checks++;
  console.log(`PASS: ${checks} single-switch checks (${multiTesters ? 'DEV' : 'standard'})`);
}
