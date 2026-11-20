import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs only in the existing network-none disposable PostgreSQL harness.
export function verifyDevCalendarContract({ sql, file, migration, authInsert, multiTesters }) {
  const verifier = file('verifiers/202611200001_verify_reg_open_dev_calendar.sql');
  // Negative fixtures mutate only this disposable DB inside a rollback transaction.
  // Keep the operational verifier itself strictly read-only; do not nest BEGIN.
  const fixtureBody = verifier.replace('begin transaction isolation level repeatable read read only;', '');
  const historical = file('verifiers/202610270002_verify_networking_cycle_operations_v1.sql');
  const retained = historical.slice(historical.indexOf('  foreach v_table'), historical.indexOf('select jsonb_build_object'));
  assert.ok(verifier.includes(retained), 'all remaining historical R2-B invariants retained verbatim');
  let checks = 1;
  const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
  const fails = (mutation, pattern) => {
    assert.throws(() => sql('begin isolation level repeatable read; ' + mutation + '\n' + fixtureBody), pattern); checks++;
  };
  sql(migration);
  const admin = randomUUID(), other = randomUUID(), outsider = randomUUID();
  for (const id of [admin, other, outsider]) {
    sql("insert into public.app_access_allowlist(email_normalized) values('" + id + "@example.invalid'); " + authInsert(id));
    sql("insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('" + id + "','beta_tester','Synthetic Calendar capability fixture');");
  }
  sql("insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('" + admin + "','system_admin','Synthetic verifier fixture'),('" + outsider + "','system_admin','Synthetic outsider');");
  sql("select public.set_r2b_rollout_gate('test_only','" + admin + "');");
  if (multiTesters) sql("update public.r2b_rollout_gate set additional_test_user_ids=array['" + other + "']::uuid[];");
  // Simulate the separately approved DEV operational grant only in this fixture.
  sql('grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to service_role;');
  const snapshot = () => sql("select jsonb_build_object('gate',(select to_jsonb(g) from public.r2b_rollout_gate g),'acl',(select proacl::text from pg_proc where oid='public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure),'accounts',(select count(*) from public.connected_accounts));");
  const before = snapshot();
  equal(JSON.parse(sql(verifier)).verdict, 'pass');
  equal(snapshot(), before, 'read-only verifier does not write accounts, gate or ACL');
  assert.throws(() => sql(historical), /R2-B service writer gate invalid/); checks++;
  const canAdmin = id => sql("begin read only; set local role authenticated; set local request.jwt.claim.sub='" + id + "'; select public.current_user_can_use_calendar_admin_v1(); rollback;");
  equal(canAdmin(admin), 't');
  equal(canAdmin(other), 'f', 'non-admin remains denied even when listed');
  equal(canAdmin(outsider), 'f', 'admin role does not bypass tester membership');
  equal(sql("select allowed from public.app_access_status_for_user('" + outsider + "');"), 'f');
  if (multiTesters) {
    equal(sql("select allowed from public.app_access_status_for_user('" + other + "');"), 't');
    const blocked = sql("begin isolation level repeatable read; update public.user_access_profiles set beta_access_status='blocked' where user_id='" + other + "';\n" + fixtureBody);
    equal(JSON.parse(blocked).verdict, 'pass', 'blocked member is not reactivated by grant');
    fails("update public.r2b_rollout_gate set additional_test_user_ids=array['" + randomUUID() + "']::uuid[];", /invalid DEV tester membership/);
  }
  fails('grant execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) to service_role;', /ACL drift|EXECUTE drift/);
  fails('revoke execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) from service_role;', /EXECUTE drift/);
  for (const role of ['anon','authenticated','supabase_auth_admin','PUBLIC']) {
    fails('grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to ' + role + ';', /ACL drift|EXECUTE drift/);
  }
  fails('alter function public.finalize_google_connected_account_verified(uuid,text,text[]) security invoker;', /security\/ACL drift/);
  fails("alter function public.finalize_google_connected_account_verified(uuid,text,text[]) set search_path=public;", /security\/ACL drift/);
  fails('create function public.finalize_google_connected_account_verified(text) returns boolean language sql as $$ select false $$;', /signature\/security\/ACL drift/);
  fails("create or replace function public.user_has_capability_for_user(p_user_id uuid,p_capability_code text) returns boolean language sql stable security definer set search_path='' as $$ select true $$;", /body\/signature\/security\/ACL drift/);
  fails("update public.r2b_rollout_gate set mode='paused',test_user_id=null" + (multiTesters ? ",additional_test_user_ids='{}'" : '') + ';', /requires DEV test_only/);
  fails("update public.r2b_rollout_gate set mode='open',test_user_id=null" + (multiTesters ? ",additional_test_user_ids='{}'" : '') + ';', /requires DEV test_only/);
  fails("update public.user_access_profiles set account_status='paused' where user_id='" + admin + "';", /no effective Calendar admin/);
  fails("update public.user_role_assignments set is_active=false where user_id='" + admin + "' and role_code='system_admin';", /no effective Calendar admin/);
  fails("insert into public.user_capability_overrides(user_id,capability_code,override_mode,is_active,starts_at) values('" + admin + "','interactions.sync_calendar','deny',true,now());", /no effective Calendar admin/);
  fails('grant select on public.r2b_rollout_gate to authenticated;', /gate client privileges/);
  equal(JSON.parse(sql(verifier)).verdict, 'pass', 'failed fixtures rollback completely');
  equal(snapshot(), before);
  console.log('PASS: REG-OPEN DEV Calendar verifier ' + checks + ' checks; ' + (multiTesters ? 'multi-tester' : 'standard') + '; grants, drift, blockers, membership, route admin helper, read-only, historical failure reproduced');
}
