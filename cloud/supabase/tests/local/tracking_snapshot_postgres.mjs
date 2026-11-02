import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTracking, validateTrackingSnapshot } from '../../../web/lib/trackingModel.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const run=randomUUID(),name='cc-tracking-'+run.slice(0,10),label='coffeecito.tracking.local';
const image='public.ecr.aws/supabase/postgres:17.11.0.004';
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:32e6,stdio:['pipe','pipe','pipe'],...options}).trim();
const sql=body=>docker(['exec','-i','-e','PGOPTIONS=-c statement_timeout=60000 -c client_min_messages=warning',name,
  'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:body});
const file=path=>readFileSync(join(root,path),'utf8');
const request=(user,body)=>sql(`begin; set local role authenticated; set local request.jwt.claim.sub='${user}'; ${body} commit;`);
const snapshot=user=>JSON.parse(request(user,'select public.current_user_tracking_snapshot_v1();'));
const pre='preflight/202610300002_preflight_tracking_snapshot_v1.sql';
const migration='migrations/202610300002_tracking_snapshot_v1.sql';
const verifier='verifiers/202610300002_verify_tracking_snapshot_v1.sql';
const nextPre='preflight/202610300003_preflight_tracking_coffees_v1.sql';
const nextMigration='migrations/202610300003_tracking_coffees_v1.sql';
const nextVerifier='verifiers/202610300003_verify_tracking_coffees_v1.sql';
let identity='';
try {
  docker(['image','inspect',image]);
  identity=docker(['create','--pull=never','--name',name,'--label',label+'='+run,'--network','none',
    '--tmpfs','/var/lib/postgresql/data','-e','PGDATA=/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
  docker(['start',name]);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=sql('select 1;')==='1';}catch{} if(ready)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready);
  await new Promise(r=>setTimeout(r,2500));
  const inspect=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(inspect.Id,identity);assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.Config.Labels[label],run);
  if(sql("select count(*) from information_schema.columns where table_schema='auth' and table_name='users' and column_name='email_confirmed_at';")==='0')
    docker(['exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','supabase_auth_admin','-d','postgres'],{input:'alter table auth.users add column email_confirmed_at timestamptz;'});
  sql(file('bootstrap/preflight_empty.sql'));
  for(const f of readdirSync(join(root,'migrations')).filter(f=>f.endsWith('.sql')&&f<'202610300002').sort()) sql(file('migrations/'+f));
  for(const f of readdirSync(join(root,'seeds')).filter(f=>f.endsWith('.sql')).sort())sql(file('seeds/'+f));
  assert.equal(JSON.parse(sql(file(pre))).installation_state,'clean_install');
  sql('alter table public.interactions rename column metadata to synthetic_metadata;');
  assert.ok(JSON.parse(sql(file(pre))).stop_reasons.includes('tracking_columns_missing'));
  assert.throws(()=>sql(file(migration)),/tracking_columns_missing/);
  assert.equal(sql("select to_regprocedure('public.current_user_tracking_snapshot_v1()') is null;"),'t');
  sql('alter table public.interactions rename column synthetic_metadata to metadata;');
  sql('alter table public.interactions alter column metadata type json using metadata::json;');
  assert.ok(JSON.parse(sql(file(pre))).stop_reasons.includes('tracking_column_type_incompatible'));
  assert.throws(()=>sql(file(migration)),/tracking_column_type_incompatible/);
  sql('alter table public.interactions alter column metadata type jsonb using metadata::jsonb;');
  assert.throws(()=>sql(file(migration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort'; end $$; commit;")),/synthetic_abort/);
  assert.equal(sql("select to_regprocedure('public.current_user_tracking_snapshot_v1()') is null;"),'t');
  sql('create function public.current_user_tracking_snapshot_v1(text) returns jsonb language sql as $$ select null::jsonb; $$;');
  assert.equal(JSON.parse(sql(file(pre))).installation_state,'stop');
  assert.throws(()=>sql(file(migration)),/already_present/);
  sql('drop function public.current_user_tracking_snapshot_v1(text);');
  sql(file(migration));assert.match(sql(file(verifier)),/PASS/);
  assert.equal(JSON.parse(sql(file(pre))).installation_state,'stop');
  assert.equal(JSON.parse(sql(file(nextPre))).installation_state,'upgrade_ready');
  sql('grant execute on function public.current_user_tracking_snapshot_v1() to anon;');
  assert.ok(JSON.parse(sql(file(nextPre))).stop_reasons.includes('tracking_snapshot_acl_drift'));
  assert.throws(()=>sql(file(nextMigration)),/tracking_snapshot_acl_drift/);
  sql('revoke execute on function public.current_user_tracking_snapshot_v1() from anon;');
  sql('alter table public.contacts rename column networking_status to synthetic_status;');
  assert.ok(JSON.parse(sql(file(nextPre))).stop_reasons.includes('contact_status_contract_missing'));
  assert.throws(()=>sql(file(nextMigration)),/tracking_status_columns_missing/);
  sql('alter table public.contacts rename column synthetic_status to networking_status;');
  assert.equal(JSON.parse(sql(file(nextPre))).installation_state,'upgrade_ready');
  assert.throws(()=>sql(file(nextMigration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort_003'; end $$; commit;")),/synthetic_abort_003/);
  assert.equal(JSON.parse(sql(file(nextPre))).installation_state,'upgrade_ready','rollback preserves the installed v1 body');
  sql(file(nextMigration));assert.match(sql(file(nextVerifier)),/PASS/);
  assert.ok(JSON.parse(sql(file(nextPre))).stop_reasons.includes('tracking_snapshot_body_drift'));
  for(const role of ['anon','service_role','supabase_auth_admin'])
    assert.throws(()=>sql(`begin; set local role ${role}; select public.current_user_tracking_snapshot_v1(); rollback;`),/permission denied/);
  assert.throws(()=>sql('begin; set local role authenticated; select public.current_user_tracking_snapshot_v1(); rollback;'),/tracking_access_denied/);
  const user=randomUUID(),other=randomUUID();
  for(const [id,tag] of [[user,'one'],[other,'two']]){
    sql(`insert into public.app_access_allowlist(email_normalized) values ('tracking-${tag}-${run}@example.invalid');
      insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('${id}','authenticated','authenticated','tracking-${tag}-${run}@example.invalid',clock_timestamp(),
        '{"provider":"google","providers":["google"]}','{}',clock_timestamp(),clock_timestamp());`);
  }
  assert.throws(()=>snapshot(user),/tracking_access_denied/);
  sql(`select public.set_r2b_rollout_gate('test_only','${user}'); select public.set_r2b_rollout_gate('open',null);`);
  assert.equal(snapshot(user).cycle,null);
  const cycle=request(user,`select public.start_networking_cycle_r2b('${randomUUID()}','Synthetic',
    clock_timestamp()-interval '10 days','America/Santiago',null,'none:initial',false,false);`);
  const contact=randomUUID(),foreign=randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context) values
    ('${contact}','${user}','Synthetic',true,public.current_networking_context_r2b('${user}')),
    ('${foreign}','${other}','Foreign synthetic',true,public.current_networking_context_r2b('${other}'));
    update public.contacts set networking_status='Cita concretada',
      networking_write_context=public.current_networking_context_r2b('${user}') where id='${contact}';
    insert into public.interactions(user_id,interaction_type,occurred_at,metadata)
      select '${user}','call',clock_timestamp()-interval '1 day','{}' from generate_series(1,2601);
    insert into public.interaction_participants(user_id,interaction_id,contact_id)
      select '${user}',id,'${contact}' from public.interactions where user_id='${user}';
    insert into public.interactions(user_id,interaction_type,occurred_at,subject)
      values('${other}','call',clock_timestamp(),'PRIVATE_SYNTHETIC');`);
  const data=snapshot(user);assert.equal(data.cycle.id,cycle);assert.equal(data.interactions.length,2601);
  assert.equal(data.contacts.length,1);assert.equal(data.participants.length,2601);
  assert.equal(data.contacts[0].networking_status,'Cita concretada');
  assert.ok(data.transitions.some(t=>t.next_status==='Cita concretada'&&t.previous_status==='Pendiente'&&t.id));
  assert.ok(!JSON.stringify(data).includes('PRIVATE_SYNTHETIC'));assert.ok(!JSON.stringify(data).includes('subject'));
  assert.equal(snapshot(other).interactions.length,0);
  const plan=JSON.parse(request(user,'explain (analyze, buffers, format json) select public.current_user_tracking_snapshot_v1();'))[0];
  console.log(`Synthetic 2601-event authenticated snapshot: ${plan['Execution Time']} ms (PostgreSQL execution, not network/browser latency)`);
  const localContact=randomUUID(),past=randomUUID(),future=randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context)
    values('${localContact}','${user}','Local calendar synthetic',true,public.current_networking_context_r2b('${user}'));
    insert into public.interactions(id,user_id,interaction_type,occurred_at,metadata) values
      ('${past}','${user}','calendar',clock_timestamp()-interval '2 days','{}'),
      ('${future}','${user}','calendar',clock_timestamp()+interval '2 days','{}');
    insert into public.interaction_participants(user_id,interaction_id,contact_id) values
      ('${user}','${past}','${localContact}'),('${user}','${future}','${localContact}');`);
  const localModel=()=>{const m=buildTracking(validateTrackingSnapshot(snapshot(user)));assert.equal(m.state,'ready');return m;};
  assert.equal(localModel().counts[1],1,'pending calendar contact does not become an accredited coffee');
  assert.equal(localModel().blue.size,1,'calls never determine blue attribution');
  assert.equal(localModel().green.size,1,'future local Calendar without source counts');
  request(user,`update public.interactions set metadata='{"ics_import":{"status":"CANCELLED"}}' where id='${past}';`);
  assert.equal(localModel().blue.size,1,'pending past cancellation does not alter blue');
  request(user,`update public.interactions set metadata='{"dismissed":true}' where id='${future}';`);
  assert.equal(localModel().green.size,0,'effective role local dismissal recalculates');
  request(user,`update public.interactions set metadata='{}',is_deleted=true where id='${past}';`);
  assert.equal(localModel().blue.size,1,'optional soft delete preserved by snapshot');
  sql('alter table public.interactions drop column is_deleted;');
  assert.equal(snapshot(user).interactions.length,2603,'optional schema without is_deleted');
  assert.equal(localModel().blue.size,1,'no optional column is a valid local schema');
  sql(`update public.contacts set networking_status='Cita concretada',
    networking_write_context=public.current_networking_context_r2b('${user}') where id='${localContact}';`);
  assert.equal(localModel().counts[1],2,'current eligible state accredits the contact');
  assert.equal(localModel().blue.size,2,'transition supplies the blue date without a valid past calendar');
  sql(`update public.interactions set metadata='{"dismissed":true}' where user_id='${user}';`);
  assert.ok(snapshot(user).interactions.every(i=>i.metadata.dismissed===true));
  sql(`update public.app_access_allowlist set revoked_at=clock_timestamp() where email_normalized='tracking-one-${run}@example.invalid';`);
  assert.throws(()=>snapshot(user),/tracking_access_denied/);
  sql('grant execute on function public.current_user_tracking_snapshot_v1() to anon;');
  assert.throws(()=>sql(file(nextVerifier)),/tracking_coffees_acl_drift/);
  sql('revoke execute on function public.current_user_tracking_snapshot_v1() from anon;');
  assert.match(sql(file(nextVerifier)),/PASS/);
  console.log('PASS PostgreSQL17: 002->003, preflight/rollback/drift, invoker RLS/ACL, effective access/paused/revoked, two-user isolation, 2603 records, current status and transition, both soft-delete schemas');
} finally {
  if(identity){const i=JSON.parse(docker(['inspect',name]))[0];
    if(i.Id!==identity||i.Config.Labels[label]!==run||i.HostConfig.NetworkMode!=='none')throw Error('cleanup_identity_mismatch');
    docker(['rm','-f',name]);}
}
