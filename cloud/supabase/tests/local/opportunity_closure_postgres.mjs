import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exerciseLifecycleHttp } from './opportunity_lifecycle_http.mjs';

// Called only by the identity-checked, network-isolated disposable PostgreSQL harness.
export async function exerciseClosure(c) {
  const {sql,file,request,denied,user,other,cycle,token,source,contact,interaction,objective,asyncRequest}=c;
  const pre='preflight/202610300001_preflight_opportunity_closure_v1.sql';
  const migration='migrations/202610300001_opportunity_closure_v1.sql';
  const verifier='verifiers/202610300001_verify_opportunity_closure_v1.sql';
  const q=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
  const version=id=>sql(`select updated_at from public.opportunities where id=${q(id)};`);
  const call=({id=null,stage='identified',situation='active',result=null,note=null,expected=id?version(id):null,
    contacts=[],objectives=[],interactions=[],requestId=randomUUID(),ctx=token,cycleId=cycle}={})=>
    `select public.save_opportunity_v2(${q(cycleId)},${q(ctx)},${q(id)},${q(expected)},'Synthetic',null,null,
      ${q(stage)},${q(result)},${q(note)},array[${contacts.map(q)}]::uuid[],array[${objectives.map(q)}]::uuid[],
      array[${interactions.map(q)}]::uuid[],${q(situation)},${q(requestId)});`;
  const fail=(body,pattern)=>denied(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${body} commit;`,pattern);
  assert.equal(JSON.parse(sql(file(pre))).installation_state,'ready');
  const cleanup='operations/dev/202610300001_delete_single_legacy_finished_opportunity.sql';
  const legacy=request(user,`select public.save_opportunity_v1('${cycle}','${token}',null,null,'Synthetic legacy',null,null,
    'finished','not_selected',null,'{${source}}','{${objective}}','{${interaction}}','${randomUUID()}');`);
  const keep=[];
  for(let n=0;n<4;n++) keep.push(request(user,`select public.save_opportunity_v1('${cycle}','${token}',null,null,
    'Synthetic retained ${n}',null,null,'applied',null,null,
    '${n===0?`{${source}}`:'{}'}','${n===0?`{${objective}}`:'{}'}','${n===0?`{${interaction}}`:'{}'}','${randomUUID()}');`));
  const keptHash=sql(`select md5(jsonb_agg(to_jsonb(o) order by id)::text) from public.opportunities o where id <> '${legacy}';`);
  const retainedLinks=sql(`select jsonb_build_array((select count(*) from public.opportunity_contacts where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_objectives where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_interactions where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_events where opportunity_id='${keep[0]}'));`);
  assert.equal(sql('select count(*) from public.opportunities;'),'5');
  const sixth=request(user,`select public.save_opportunity_v1('${cycle}','${token}',null,null,
    'Synthetic extra',null,null,'applied',null,null,'{}','{}','{}','${randomUUID()}');`);
  denied(file(cleanup),/expected exactly five rows/);
  sql(`delete from public.opportunities where id='${sixth}';`);
  sql(`update public.opportunities set result='other' where id='${legacy}';`);
  denied(file(cleanup),/expected exactly five rows/);
  sql(`update public.opportunities set result='not_selected' where id='${legacy}';`);
  sql('alter table public.opportunity_contacts disable trigger validate_opportunity_contacts_v1;');
  denied(file(cleanup),/opportunity trigger drift/);
  sql('alter table public.opportunity_contacts enable trigger validate_opportunity_contacts_v1;');
  const legacyHash=sql(`select md5(to_jsonb(o)::text) from public.opportunities o where id='${legacy}';`);
  assert.equal(JSON.parse(sql(file(pre))).ambiguous_finished_rows,1);
  denied(file(migration),/legacy_finished_stage_requires_owner_resolution/);
  assert.equal(sql(`select md5(to_jsonb(o)::text) from public.opportunities o where id='${legacy}';`),legacyHash);
  sql(`update public.opportunities set voided_at=clock_timestamp() where id='${legacy}';`);
  denied(file(migration),/legacy_finished_stage_requires_owner_resolution/);
  const beforeCleanup=sql(`select md5(to_jsonb(o)::text) from public.opportunities o where id='${legacy}';`);
  denied(file(cleanup).replace(/commit;\s*$/,
    "do $$ begin raise exception 'synthetic_abort_after_delete'; end $$; commit;"),/synthetic_abort_after_delete/);
  assert.equal(sql('select count(*) from public.opportunities;'),'5');
  assert.equal(sql(`select md5(to_jsonb(o)::text) from public.opportunities o where id='${legacy}';`),beforeCleanup);
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${legacy}';`),'1');
  sql(file(cleanup));
  assert.equal(sql('select count(*) from public.opportunities;'),'4');
  assert.equal(sql(`select md5(jsonb_agg(to_jsonb(o) order by id)::text) from public.opportunities o where id <> '${legacy}';`),keptHash);
  assert.equal(sql(`select jsonb_build_array((select count(*) from public.opportunity_contacts where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_objectives where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_interactions where opportunity_id='${keep[0]}'),
    (select count(*) from public.opportunity_events where opportunity_id='${keep[0]}'));`),retainedLinks);
  for(const relation of ['opportunity_contacts','opportunity_objectives','opportunity_interactions','opportunity_events'])
    assert.equal(sql(`select count(*) from public.${relation} where opportunity_id='${legacy}';`),'0');
  denied(file(cleanup),/expected exactly five rows/);
  console.log('PASS DEV-only cleanup: exact cohort, drift STOP, deliberate rollback, dependent cascades and four retained rows');
  const oldId=request(user,`select public.save_opportunity_v1('${cycle}','${token}',null,null,'Preserved',null,null,
    'identified',null,null,'{}','{}','{}','${randomUUID()}');`);
  const oldEvents=sql(`select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.opportunity_events e;`);
  const oldRow=sql(`select md5(to_jsonb(o)::text) from public.opportunities o where id='${oldId}';`);
  denied(`begin; alter table public.opportunities drop constraint opportunities_check;
    alter table public.opportunities add constraint opportunities_check check(true); ${file(migration)}`,
    /opportunity_legacy_constraint_drift/);
  denied(`begin; grant execute on function public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid) to anon; ${file(migration)}`,
    /RPC ACL|Excess RPC/);
  denied(file(migration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort'; end; $$; commit;"),/synthetic_abort/);
  assert.equal(sql(`select count(*) from pg_attribute where attrelid='public.opportunities'::regclass and attname='situation' and not attisdropped;`),'0');
  assert.equal(sql(`select to_regprocedure('public.opportunity_closure_valid_v1(text,text,text)') is null;`),'t');
  assert.equal(JSON.parse(sql(file(pre))).installation_state,'ready','rollback preserved old function bodies and ACL');
  sql(file(migration));
  assert.equal(sql(`select situation||':'||stage from public.opportunities where id='${oldId}';`),'active:identified');
  assert.equal(sql(`select md5((to_jsonb(o)-'situation')::text) from public.opportunities o where id='${oldId}';`),oldRow);
  assert.equal(sql(`select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.opportunity_events e;`),oldEvents);
  assert.match(sql(file(verifier)),/PASS/);
  denied(`begin; update public.opportunities set result='offer_accepted' where id='${oldId}'; commit;`,/opportunity_closure_valid/);
  denied(`begin; grant execute on function public.opportunity_closure_valid_v1(text,text,text) to authenticated; ${file(verifier)}`,
    /function_contract_incompatible/);
  console.log('PASS 002->003->004->closure; legacy ambiguity STOP including voided; rollback and original history preservation');

  const outcomes={identified:['discarded','application_deadline_expired','vacancy_cancelled','other'],
    applied:['not_selected','application_withdrawn','vacancy_cancelled','no_response','other'],
    in_process:['not_selected','process_withdrawn','vacancy_cancelled','no_response','other'],
    offer_received:['offer_accepted','offer_declined','offer_expired','other']};
  for(const [stage,results] of Object.entries(outcomes)) {
    for(const result of results) {
      const id=request(user,call({stage}));
      request(user,call({id,stage,situation:'finalized',result,note:'Synthetic closure cause'}));
      assert.equal(sql(`select situation||':'||stage||':'||result_note from public.opportunities where id='${id}';`),`finalized:${stage}:Synthetic closure cause`);
      fail(call({id,stage:stage==='identified'?'applied':'identified',situation:'active'}),/opportunity_reopen_same_stage_required/);
      request(user,call({id,stage}));
      assert.equal(sql(`select result is null and result_note is null and situation='active' from public.opportunities where id='${id}';`),'t');
      assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${id}' and kind='reopened'
        and before_state->>'result'='${result}' and before_state->>'result_note'='Synthetic closure cause';`),'1');
      fail(call({id,stage,situation:'finalized'}),/invalid_opportunity/);
      request(user,call({id,stage,situation:'finalized',result}));
    }
    for(const result of new Set(Object.values(outcomes).flat())) if(!results.includes(result))
      fail(call({stage,situation:'finalized',result}),/invalid_opportunity/);
  }
  fail(call({stage:'finished',situation:'finalized',result:'offer_accepted'}),/invalid_opportunity/);
  fail(call({situation:'voided'}),/invalid_opportunity/);
  fail(call({note:'not allowed while active'}),/invalid_opportunity/);
  fail(`select public.save_opportunity_v1('${cycle}','${token}',null,null,'Old client',null,null,'identified',null,null,'{}','{}','{}','${randomUUID()}');`,/opportunity_runtime_upgrade_required/);
  const requestId=randomUUID(), command=call({requestId});
  assert.equal(request(user,command),request(user,command));
  fail(call({requestId,stage:'applied'}),/opportunity_request_conflict/);
  const racing=request(user,call());const expected=version(racing);
  const races=await Promise.allSettled([
    asyncRequest(user,call({id:racing,expected,situation:'finalized',result:'discarded'})),
    asyncRequest(user,call({id:racing,expected,situation:'finalized',result:'vacancy_cancelled'}))]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.match(races.find(r=>r.status==='rejected').reason.message,/opportunity_stale/);
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${racing}' and kind='finalized';`),'1');
  console.log('PASS all 18 stage/outcome pairs, invalid pairs, same-stage reopen, causes, idempotency and concurrent version conflicts');

  assert.equal(request(other,'select count(*) from public.opportunities;'),'0');
  assert.throws(()=>request(other,call({id:racing})),/networking_context|opportunity_not_found|active_job_cycle/);
  fail(`update public.opportunities set result='other' where id='${racing}';`,/permission denied/);
  const offer=request(user,call({stage:'offer_received'}));
  request(user,call({id:offer,stage:'offer_received',situation:'finalized',result:'offer_expired'}));
  const metrics=()=>sql(`select jsonb_build_array(count(*),count(*) filter(where stage='offer_received'),
    count(*) filter(where situation='finalized' and result='offer_accepted')) from public.opportunities where situation<>'voided';`);
  const before=JSON.parse(metrics());
  request(user,`select public.void_opportunity_v1('${cycle}','${token}','${offer}');`);
  request(user,`select public.void_opportunity_v1('${cycle}','${token}','${offer}');`);
  assert.deepEqual(JSON.parse(metrics()),[before[0]-1,before[1]-1,before[2]]);
  fail(call({id:offer,stage:'offer_received'}),/opportunity_not_found/);
  await exerciseLifecycleHttp(c);
  const linked=request(user,call({contacts:[source,source],objectives:[objective],interactions:[interaction]}));
  request(user,call({id:linked,situation:'finalized',result:'discarded',contacts:[source],objectives:[objective],interactions:[interaction]}));
  request(user,`select public.merge_contacts_deep_r2b('${cycle}','${token}','${contact}',array['${source}']::uuid[],
    '{"name":"Synthetic merged","company":"","role":"","emails":[],"phones":[],"networkingStatus":"Pendiente","focus":false,"headhunter":false}'::jsonb,'contact_merge');`);
  assert.equal(sql(`select count(*) from public.opportunity_contacts where opportunity_id='${linked}' and contact_id='${contact}';`),'1');
  assert.equal(sql(`select count(*) from public.opportunity_interactions where opportunity_id='${linked}';`),'1');
  assert.match(sql(file(verifier)),/PASS/);
  console.log('PASS RLS/ACL, ownership, current metrics, idempotent void, actual HTTP reads/writes, participants and merge');
  const history=sql(`select count(*) from public.opportunity_events where opportunity_id='${linked}';`);
  request(user,`select public.close_networking_cycle_r2b('${randomUUID()}','${cycle}','${token}',clock_timestamp(),'stopped');`);
  const next=request(user,`select public.start_networking_cycle_r2b('${randomUUID()}','Next synthetic',clock_timestamp(),'UTC',null,'none:${cycle}',false,false);`);
  assert.equal(sql(`select count(*) from public.opportunities where cycle_id='${next}';`),'0');
  assert.equal(sql(`select cycle_id||':'||situation from public.opportunities where id='${linked}';`),`${cycle}:finalized`);
  assert.equal(sql(`select count(*) from public.opportunity_events where opportunity_id='${linked}';`),history);
  fail(call({id:linked}),/networking_context_stale/);
  request(user,`select count(*) from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');`);
  assert.equal(sql(`select count(*) from public.opportunities where user_id='${user}';`),'0');
  assert.equal(sql(`select count(*) from public.opportunity_events where user_id='${user}';`),'0');
  assert.match(sql(file(verifier)),/PASS/);
  console.log('PASS cycle close/new cycle preserves closed opportunities and history; global reset retains its explicit destructive contract');
}
