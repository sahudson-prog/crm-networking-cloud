import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Only called by the network-none PostgreSQL harness. Never connects remotely.
export function verifyProdContext({ sql, file, migration, authInsert }) {
  const context = file('operations/prod/202611200003_check_reg_open_prod_context.sql');
  const body = context.replace('begin isolation level repeatable read read only;', '');
  let checks = 0;
  const pass = expected => {
    assert.equal(JSON.parse(sql(context)).registration_state, expected);
    checks++;
  };
  const fails = (mutation, pattern) => {
    assert.throws(() => sql('begin; ' + mutation + '\n' + body), pattern);
    checks++;
  };
  const tester = randomUUID();
  sql(authInsert(tester));
  sql(`select public.set_r2b_rollout_gate('test_only','${tester}'); select public.set_r2b_rollout_gate('open',null);`);
  const snapshot = () => sql("select jsonb_build_object('gate',(select to_jsonb(g) from public.r2b_rollout_gate g),'functions',(select jsonb_agg(jsonb_build_array(oid,prosrc,proacl) order by oid) from pg_proc where oid in ('public.set_r2b_rollout_gate(text,uuid)'::regprocedure,'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure,'public.submit_contact_request_v1(text,text,text,text,text,uuid)'::regprocedure)));");
  const before = snapshot();
  pass('not_installed');
  fails("update public.r2b_rollout_gate set mode='paused';", /expected PROD standard/);
  fails(`update public.r2b_rollout_gate set mode='test_only',test_user_id='${tester}';`, /expected PROD standard/);
  fails("alter table public.r2b_rollout_gate add column additional_test_user_ids uuid[] not null default '{}';", /expected PROD standard/);
  for (const signature of ['public.finalize_google_connected_account_verified(uuid,text,text[])','public.submit_contact_request_v1(text,text,text,text,text,uuid)']) {
    fails(`revoke execute on function ${signature} from service_role;`, /EXECUTE drift/);
    fails(`grant execute on function ${signature} to authenticated;`, /function drift/);
    fails(`alter function ${signature} security invoker;`, /function drift/);
  }
  sql(migration);
  pass('OFF');
  sql(file('preflight/202611200002_preflight_public_registration_single_switch.sql'));
  sql(file('migrations/202611200002_public_registration_single_switch.sql'));
  pass('OFF');
  fails('update public.app_public_registration_settings set enabled=true;', /must remain OFF/);
  fails('delete from public.app_public_registration_settings;', /must remain OFF/);
  pass('OFF');
  assert.equal(snapshot(), before, 'context reads and rolled-back negative fixtures preserve gate and protected functions'); checks++;
  console.log(`PASS: REG-OPEN PROD context ${checks} checks; pre/post chain, OFF, standard/open, ACL, security, rollback, read-only`);
}
