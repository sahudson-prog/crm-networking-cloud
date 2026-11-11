import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function testCalendarWriteBoundary({ sql, file, request, requestAsync, user, other, account, equal, denied }) {
  sql(file('migrations/202611060004_calendar_admin_only.sql'));
  const pre=file('preflight/202611060005_preflight_calendar_write_boundary.sql');
  const migration=file('migrations/202611060005_calendar_write_boundary.sql');
  const verifier=file('verifiers/202611060005_verify_calendar_write_boundary.sql');
  // The preceding synthetic suite deliberately left an inactive shared source.
  // 005 must not guess its meaning. Remove only this fixture after proving STOP.
  denied(()=>sql(pre),/identity\/source ambiguity/);
  sql("delete from public.external_interaction_sources where provider='synthetic' and external_id='synthetic-shared' and not is_active;");
  const rw=x=>x.replace('begin read only;','');
  for(const ending of ['\n','\r\n']) {
    const text=x=>x.replace(/\r?\n/g,ending);
    assert.match(sql(text(pre)),/PASS/);
    denied(()=>sql(text(migration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort'; end $$; commit;")),/synthetic_abort/);
    equal(sql("select to_regprocedure('public.apply_google_interaction_sync_internal_v2(uuid,jsonb)') is null;"),'t');
  }
  for(const change of [
    'grant execute on function public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb) to service_role;',
    'grant execute on function public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer) to authenticated;',
    'create or replace function public.current_user_can_use_calendar_admin_v1() returns boolean language sql stable security definer set search_path=\'\' as $$select true;$$;',
    'alter function public.current_user_can_sync_connected_account_base_v1(uuid,text) security invoker;',
    'create function public.apply_google_periodic_v1(text,jsonb) returns jsonb language sql as $$select $2;$$;'
  ]) denied(()=>sql('begin;'+change+rw(pre)),/body\/security\/ACL drift/);
  const finalizeBefore=sql("select proacl::text from pg_proc where oid='public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure;");
  denied(()=>sql("begin;create role synthetic_default_acl;alter default privileges for role postgres in schema public grant execute on functions to synthetic_default_acl;"+migration.replace(/^begin;/,'')),/unexpected .*default ACL/);
  sql(migration.replace(/\r?\n/g,'\r\n'));
  equal(sql("select proacl::text from pg_proc where oid='public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure;"),finalizeBefore);
  for(const ending of ['\n','\r\n']) assert.match(sql(verifier.replace(/\r?\n/g,ending)),/PASS/);
  for(const change of [
    'grant execute on function public.apply_google_interaction_sync_internal_v2(uuid,jsonb) to authenticated;',
    'grant execute on function public.apply_calendar_discovery_v1(uuid,jsonb) to service_role;',
    'create or replace function public.current_user_can_use_calendar_admin_v1() returns boolean language sql stable security definer set search_path=\'\' as $$select true;$$;',
    'alter function public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb) set search_path=public;',
    'grant execute on function public.apply_google_periodic_v1(uuid,jsonb) to authenticated with grant option;'
  ]) denied(()=>sql('begin;'+change+rw(verifier)),/body\/security\/ACL drift/);
  sql(`insert into public.user_role_assignments(user_id,role_code) values('${user}','system_admin'),('${user}','beta_tester'),('${other}','beta_tester');`);
  const scopes="array['https://www.googleapis.com/auth/calendar.events.owned.readonly','https://www.googleapis.com/auth/gmail.readonly']";
  equal(sql(`select id from public.finalize_google_connected_account_verified('${user}','${user}@example.invalid',${scopes});`),account);
  const otherAccount=sql(`select id from public.finalize_google_connected_account_verified('${other}','${other}@example.invalid',${scopes});`);
  request(other,`select public.start_networking_cycle_r2b('${randomUUID()}','Synthetic',now()-interval '1 day','UTC',null,'none:initial',false,false);`);
  const lit=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
  const calendar={sourceService:'calendar',interactionType:'calendar',externalObjectType:'calendar_event',externalId:'CALENDAR_boundary',occurredAt:new Date().toISOString(),direction:'unknown',participants:[]};
  const email={...calendar,sourceService:'gmail',interactionType:'email',externalObjectType:'email_message',externalId:'GMAIL_boundary'};
  const legacy=(id,p,historical=false)=>`select public.${historical?'apply_google_history_v1':'apply_google_periodic_v1'}('${id}',${lit(p)}${historical?',public.current_user_history_window_v1()':''});`;
  const snapshot=()=>sql(`select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(t) order by id) from public.interactions t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.external_interaction_sources t),
    (select jsonb_agg(to_jsonb(t) order by id) from public.interaction_participants t),
    (select jsonb_agg(to_jsonb(t) order by source_id) from public.calendar_sync_stamps_v2 t),
    (select jsonb_agg(to_jsonb(t) order by user_id,account_id) from public.calendar_sync_state_v2 t),
    (select count(*) from public.action_invocations))::text);`);
  const attacks=[calendar,{...calendar,sourceService:' Calendar '},{...calendar,sourceService:'gmail'},
    {...calendar,interactionType:'email'}, {...calendar,sourceService:null},
    {...email,externalId:'calendar_boundary'}, {...email,source:'google_calendar_discovery_v1'},
    {...email,externalObjectType:'calendar_event'}, {...email,sourceService:'GMAIL',externalId:'CALENDAR_boundary'}];
  for(const [who,id] of [[user,account],[other,otherAccount]]) {
    for(const history of [false,true]) for(const p of attacks) {
      const before=snapshot(); denied(()=>request(who,legacy(id,p,history)),/GOOGLE_LEGACY_CALENDAR_DENIED|GOOGLE_RESOURCE_IDENTITY_CONFLICT/); equal(snapshot(),before);
    }
    const p={...email,externalId:`GMAIL_${who}`};
    equal(JSON.parse(request(who,legacy(id,p))).status,'created');
    equal(JSON.parse(request(who,legacy(id,p,true))).status,'updated');
    equal(request(who,`select public.current_user_can_use_calendar_admin_v1();`),who===user?'t':'f');
  }
  denied(()=>request(other,`select public.calendar_manual_sync_v2('${otherAccount}','${randomUUID()}','status','{}');`),/CALENDAR_ADMIN_REQUIRED/);
  const contact=randomUUID();
  sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context) values('${contact}','${user}','Synthetic boundary',true,public.current_networking_context_r2b('${user}'));
    insert into public.contact_emails(user_id,contact_id,email,normalized_email) values('${user}','${contact}','boundary@example.invalid','boundary@example.invalid');`);
  const now=Date.now(),iso=n=>new Date(n).toISOString();
  const ev={id:'boundary',status:'confirmed',updated:iso(now),start:{dateTime:iso(now+864e5)},attendees:[{email:'boundary@example.invalid'}]};
  const v2=(events)=>{const run=randomUUID();const rpc=(a,p)=>JSON.parse(request(user,`select public.calendar_manual_sync_v2('${account}','${run}','${a}',${lit(p)});`));
    rpc('begin',{timeMin:iso(now-7*864e5),timeMax:iso(now+30*864e5)});
    const result=rpc('apply',{batch:0,events});rpc('finish',{batches:1,token:'synthetic-boundary'});return result;};
  equal(v2([ev]).created,1);
  const interaction=sql(`select interaction_id from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_boundary';`);
  sql(`update public.interactions set user_notes_raw='Synthetic protected note' where id='${interaction}';`);
  const moved={...ev,updated:iso(now+1000),start:{dateTime:iso(now+100*864e5)}};
  equal(v2([moved]).created,0);
  for(const event of [moved,{id:'boundary',status:'cancelled',updated:iso(now+2000)}]) {
    v2([event]);const before=snapshot();
    for(const history of [false,true]) {
      denied(()=>request(user,legacy(account,calendar,history)),/GOOGLE_LEGACY_CALENDAR_DENIED/);
      denied(()=>request(user,legacy(account,{...email,externalId:'CALENDAR_boundary'},history)),/GOOGLE_RESOURCE_IDENTITY_CONFLICT/);
    }
    equal(snapshot(),before);
  }
  equal(sql(`select user_notes_raw from public.interactions where id='${interaction}';`),'Synthetic protected note');
  equal(sql(`select sync_status from public.external_interaction_sources where interaction_id='${interaction}';`),'deleted_at_source');
  equal(v2([{id:'boundary',status:'cancelled',updated:iso(now+2000)}]).updated,0);
  // Non-prefixed legacy aliases cannot be used to evade the persisted-type guard.
  sql(`insert into public.interactions(user_id,provider,provider_event_id,interaction_type,direction) values('${user}','google','legacy_mixed','calendar','unknown');`);
  for(const id of ['legacy_mixed','LEGACY_MIXED']) denied(()=>request(user,legacy(account,{...email,externalId:id})),/GOOGLE_RESOURCE_IDENTITY_CONFLICT/);
  // Persisted descriptors must agree too, not only the request's service/type.
  for(const change of [
    "external_object_type='calendar_event'", "source_service='Calendar'", "source_service=' Calendar '", "provider='Google'"
  ]) denied(()=>sql(`begin;update public.external_interaction_sources set ${change} where user_id='${user}' and external_id='GMAIL_${user}';${rw(verifier)}`),/identity\/source ambiguity/);
  denied(()=>sql(`begin;update public.external_interaction_sources set external_object_type='calendar_event' where user_id='${user}' and external_id='GMAIL_${user}';
    set local role authenticated;set local request.jwt.claim.sub='${user}';${legacy(account,{...email,externalId:`GMAIL_${user}`})}commit;`),/GOOGLE_RESOURCE_IDENTITY_CONFLICT/);
  const gmail={...email,externalId:'GMAIL_concurrency'};
  const results=await Promise.all([requestAsync(user,legacy(account,gmail)),requestAsync(user,legacy(account,gmail))]);
  equal(results.map(x=>JSON.parse(x).status).sort(),['created','updated']);
  for(const role of ['authenticated','anon','service_role','supabase_auth_admin']) for(const fn of [
    `apply_google_interaction_sync_internal_v2('${account}','{}')`, `apply_google_interaction_sync_v1('${account}','{}')`,
    `apply_calendar_discovery_v1('${account}','{}')`, `calendar_manual_sync_internal_v2('${account}','${randomUUID()}','status','{}')`
  ]) denied(()=>sql(`begin;set local role ${role};select public.${fn};commit;`),/permission denied/);
  // Drift fixture is rolled back with the read-only contract failure, never repaired by SQL 005.
  denied(()=>sql(`begin;update public.external_interaction_sources set source_service='gmail' where interaction_id='${interaction}';${rw(verifier)}`),/identity\/source ambiguity/);
  assert.match(sql(verifier),/PASS/);
  sql(`insert into public.user_role_assignments(user_id,role_code) values('${other}','system_admin');`);
  console.log('PASS 005: admin/no-admin legacy rejects, Gmail history/periodic, unchanged notes/lifecycle/stamps, helpers private, LF/CRLF, drift, rollback and concurrent identity.');
}
