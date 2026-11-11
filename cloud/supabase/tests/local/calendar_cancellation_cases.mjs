import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export async function testCalendarCancellation({ sql, file, request, equal, docker, name, label, run }) {
  for (const name of ['202611060001_calendar_independent.sql','202611060002_calendar_reconciliation_v1.sql','202611060003_calendar_manual_sync_v2.sql']) sql(file(`migrations/${name}`));
  sql(file('preflight/202611060004_preflight_calendar_admin_only.sql'));
  sql(file('migrations/202611060004_calendar_admin_only.sql'));
  try { sql(file('verifiers/202611060004_verify_calendar_admin_only.sql')); }
  catch(error) {
    console.log('Synthetic verifier diagnostics:',sql(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',proname,'owner',proowner::regrole::text,'security_definer',prosecdef,'config',proconfig)) from pg_proc where oid in ('public.current_user_can_use_calendar_admin_v1()'::regprocedure,'public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)'::regprocedure,'public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure)),'authenticated_internal',has_function_privilege('authenticated','public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)','EXECUTE'),'authenticated_base',has_function_privilege('authenticated','public.current_user_can_sync_connected_account_base_v1(uuid,text)','EXECUTE'));`));
    throw error;
  }
  const user=randomUUID(), contact=randomUUID(), manual=randomUUID();
  sql(`insert into public.app_access_allowlist(email_normalized) values('${user}@example.invalid');
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('${user}','authenticated','authenticated','${user}@example.invalid',now(),'{"provider":"google","providers":["google"]}','{}',now(),now());
    update public.user_access_profiles set account_status='active',beta_access_status='approved' where user_id='${user}';
    select public.set_r2b_rollout_gate('test_only','${user}');
    insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${user}','interactions.sync_calendar','grant');`);
  const account=sql(`select id from public.finalize_google_connected_account_verified('${user}','${user}@example.invalid',array['https://www.googleapis.com/auth/calendar.events.owned.readonly']);`);
  equal(request(user,`select public.current_user_can_use_calendar_admin_v1();`),'f');
  assert.throws(()=>request(user,`select public.calendar_manual_sync_v2('${account}','${randomUUID()}','status','{}');`),/CALENDAR_ADMIN_REQUIRED/);
  sql(`insert into public.user_role_assignments(user_id,role_code,assignment_reason) values('${user}','system_admin','Synthetic Calendar gate test');`);
  equal(request(user,`select public.current_user_can_use_calendar_admin_v1();`),'t');
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','calendar');`),'t');
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','email');`),'f');
  for(const id of [contact,manual]) sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context)
    values('${id}','${user}','Synthetic',true,public.current_networking_context_r2b('${user}'));
    insert into public.contact_emails(user_id,contact_id,email,normalized_email) values('${user}','${id}','${id}@example.invalid','${id}@example.invalid');`);
  const web=resolve(dirname(fileURLToPath(import.meta.url)),'../../../web');
  const req=createRequire(join(web,'package.json')),ts=req('typescript');
  const out=mkdtempSync(join(tmpdir(),'calendar-cancellation-'));
  writeFileSync(join(out,'engine.mjs'),ts.transpileModule(readFileSync(join(web,'lib/calendarManualSync.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  const {runCalendarManualSync}=await import(pathToFileURL(join(out,'engine.mjs')).href);
  const now=Date.now(), iso=ms=>new Date(ms).toISOString();
  const window={timeMin:iso(now-7*864e5),timeMax:iso(now+30*864e5)};
  const event=id=>({id,status:'confirmed',updated:iso(now),start:{dateTime:iso(now+864e5)},summary:'Synthetic appointment',attendees:[{email:`${contact}@example.invalid`}]});
  let discovery=[event('moved'),event('series_occurrence'),event('series_sibling')], delta=[], round=0;
  const reports=[];
  async function execute() {
    const run=randomUUID(), calls={list:0,get:0,apply:0}; round++;
    const result=await runCalendarManualSync({accessToken:'synthetic',...window},{sleep:async()=>{},
      rpc:async(action,payload)=>{
        if(action==='apply') calls.apply++;
        const body=JSON.stringify(payload).replaceAll("'","''");
        return JSON.parse(request(user,`select public.calendar_manual_sync_v2('${account}','${run}','${action}','${body}'::jsonb);`));
      },
      fetch:async url=>{
        const u=new URL(url); assert.equal(u.origin,'https://www.googleapis.com');
        if(u.pathname.includes('/events/')) { calls.get++; throw Error('Unexpected point read'); }
        calls.list++; assert.equal(u.searchParams.get('showDeleted'),'true'); assert.equal(u.searchParams.get('singleEvents'),'true');
        assert.ok(u.searchParams.get('fields').includes('originalStartTime'));
        const token=u.searchParams.get('syncToken');
        if(token) for(const forbidden of ['timeMin','timeMax','orderBy','q','updatedMin']) assert.equal(u.searchParams.has(forbidden),false);
        const body=u.searchParams.has('pageToken') ? {items:token?delta:discovery,nextSyncToken:`${token?'delta':'window'}-${round}`} : {items:[],nextPageToken:'second'};
        return new Response(JSON.stringify(body));
      }});
    equal(calls.get,0);
    equal(sql(`select sync_token from public.calendar_sync_state_v2 where user_id='${user}';`),`${round===1?'window':'delta'}-${round}`);
    reports.push({round,...calls,...result,synced_at:undefined});
    return result;
  }
  equal((await execute()).created,3);
  const id=sql(`select interaction_id from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_moved';`);
  sql(`update public.interactions set user_notes_raw='Synthetic retained note' where id='${id}';
    insert into public.interaction_participants(user_id,interaction_id,contact_id,email_identity,role) values('${user}','${id}','${manual}','${manual}@example.invalid','CC');`);
  const context=sql(`select public.current_networking_context_r2b('${user}');`);
  const cycle=request(user,`select public.start_networking_cycle_r2b('${randomUUID()}','Synthetic cycle',clock_timestamp()-interval '1 day','UTC',null,'${context}',false,false);`);
  const token=sql(`select public.current_networking_context_r2b('${user}');`);
  request(user,`select public.save_opportunity_v2('${cycle}','${token}',null,null,'Synthetic opportunity',null,null,'identified',null,null,
    array['${contact}']::uuid[],array[]::uuid[],array['${id}']::uuid[],'active','${randomUUID()}');`);
  delta=[{...event('moved'),updated:iso(now+1000),start:{dateTime:iso(now+120*864e5)}}];
  discovery=discovery.filter(e=>e.id!=='moved');
  const moved=await execute(); equal(moved.created,0); equal(moved.updated,1);
  const participants=sql(`select jsonb_agg(to_jsonb(p) order by p.id) from public.interaction_participants p where interaction_id='${id}';`);
  const preserved=sql(`select occurred_at from public.interactions where id='${id}';`);
  delta=[{id:'moved',status:'cancelled'},{id:'series_occurrence',status:'cancelled',recurringEventId:'series',originalStartTime:{dateTime:iso(now+864e5)}}];
  discovery=discovery.filter(e=>e.id!=='series_occurrence');
  const cancelled=await execute();equal(cancelled.created,0);equal(cancelled.updated,2);
  equal(sql(`select count(*) from public.external_interaction_sources where user_id='${user}' and sync_status='deleted_at_source';`),'2');
  equal(sql(`select sync_status from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_series_sibling';`),'synced');
  equal(sql(`select interaction_id from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_moved';`),id);
  equal(sql(`select occurred_at from public.interactions where id='${id}';`),preserved);
  equal(sql(`select user_notes_raw from public.interactions where id='${id}';`),'Synthetic retained note');
  equal(sql(`select jsonb_agg(to_jsonb(p) order by p.id) from public.interaction_participants p where interaction_id='${id}';`),participants);
  equal(sql(`select count(*) from public.opportunity_interactions where interaction_id='${id}';`),'1');
  delta=[]; const unchanged=await execute(); equal(unchanged.created,0);equal(unchanged.updated,0);
  equal(sql(`select count(*) from public.interactions where user_id='${user}';`),'3');
  const data=JSON.parse(sql(`select jsonb_build_object('interactions',(select jsonb_agg(to_jsonb(i)) from public.interactions i where user_id='${user}'),
    'sources',(select jsonb_agg(to_jsonb(s)) from public.external_interaction_sources s where user_id='${user}'),
    'participants',(select jsonb_agg(to_jsonb(p)) from public.interaction_participants p where user_id='${user}'));`));
  writeFileSync(join(out,'result.json'),JSON.stringify(data));
  const { withCalendarVisibilityHttp } = await import('./calendar_visibility_http.mjs');
  await withCalendarVisibilityHttp({web,docker,sql,name,label,run,user,contact,cycle,token},async(readers,actions)=>{
    const sibling=data.sources.find(s=>s.external_id==='CALENDAR_series_sibling').interaction_id;
    for(const rows of [await readers.readAllInteractions(),await readers.readRecentInteractions(1),await readers.readContactInteractions(contact,1)]) {
      equal(rows.length,1);equal(rows[0].id,sibling);
    }
    equal((await readers.readAppSummary()).interactions,1);
    const [opportunity]=await actions.readOpportunities();
    equal(opportunity.visible_interaction_count,0);assert.ok(opportunity.interaction_ids.includes(id),'technical association preserved');
    delta=[{...event('moved'),updated:iso(now+2000)}];discovery=[...discovery,...delta];
    const restored=await execute();equal(restored.created,0);equal(restored.updated,1);
    equal(sql(`select interaction_id from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_moved';`),id);
    equal(sql(`select user_notes_raw from public.interactions where id='${id}';`),'Synthetic retained note');
    equal(sql(`select count(*) from public.interaction_participants where interaction_id='${id}' and contact_id='${manual}';`),'1');
    equal(sql(`select count(*) from public.interactions where user_id='${user}';`),'3');
    equal((await readers.readAllInteractions()).length,2);equal((await readers.readAppSummary()).interactions,2);
    equal((await actions.readOpportunities())[0].visible_interaction_count,1);
    delta=[];const again=await execute();equal(again.created,0);equal(again.updated,0);
    equal((await readers.readAllInteractions()).length,2);
    equal(sql(`select sync_status from public.external_interaction_sources where user_id='${user}' and external_id='CALENDAR_series_occurrence';`),'deleted_at_source');
  });
  sql(`update public.user_role_assignments set is_active=false where user_id='${user}' and role_code='system_admin';`);
  equal(request(user,`select public.current_user_can_use_calendar_admin_v1();`),'f');
  equal(request(user,`select public.current_user_can_sync_connected_account_v1('${account}','calendar');`),'f');
  assert.throws(()=>request(user,`select public.calendar_manual_sync_v2('${account}','${randomUUID()}','begin','{}');`),/CALENDAR_ADMIN_REQUIRED/);
  console.log('PASS cancellation sequence: real engine/RPC/writers; minimal tombstones, recurrence, notes, associations, cursor, second click.');
  console.log(JSON.stringify(reports));console.log('Synthetic UI artifact:',join(out,'result.json'));
}
