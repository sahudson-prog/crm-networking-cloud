import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

export async function testCalendarManualV2({ sql, file, request, requestAsync, user, other, equal, denied, beforeEngine }) {
  const pre=file('preflight/202611060003_preflight_calendar_manual_sync_v2.sql');
  const migration=file('migrations/202611060003_calendar_manual_sync_v2.sql');
  const verifier=file('verifiers/202611060003_verify_calendar_manual_sync_v2.sql');
  for(const ending of ['\n','\r\n']) {
    const text=x=>x.replace(/\r?\n/g,ending);
    assert.match(sql(text(pre)),/PASS/);
    denied(()=>sql(text(migration).replace(/commit;\s*$/,"do $$ begin raise exception 'synthetic_abort'; end $$; commit;")),/synthetic_abort/);
    equal(sql("select to_regclass('public.calendar_sync_state_v2') is null;"),'t');
  }
  const oldSuccess=sql(`select last_synced_at from public.sync_cursors where user_id='${user}' and resource_type='calendar' and cursor_label='';`);
  sql(migration.replace(/\r?\n/g,'\r\n'));
  equal(sql(`select last_success from public.calendar_sync_state_v2 where user_id='${user}';`),oldSuccess);
  equal(sql(`select sync_token is null from public.calendar_sync_state_v2 where user_id='${user}';`),'t');
  assert.match(sql(verifier),/PASS/); assert.match(sql(verifier.replace(/\r?\n/g,'\r\n')),/PASS/);
  denied(()=>sql('begin; grant select on public.calendar_sync_state_v2 to authenticated;\n'+verifier),/drift/);
  denied(()=>sql('begin; alter function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) security invoker;\n'+verifier),/drift/);
  denied(()=>sql('begin; grant execute on function public.calendar_local_hash_v2(uuid,jsonb) to authenticated;\n'+verifier),/drift/);
  denied(()=>request(user,'select * from public.calendar_sync_state_v2;'),/permission denied/);
  denied(()=>sql('begin; alter table public.calendar_sync_runs_v2 drop constraint calendar_sync_runs_v2_check;\n'+verifier),/drift/);
  denied(()=>sql('begin; alter table public.calendar_sync_batches_v2 add column drift text;\n'+verifier),/drift/);
  await beforeEngine?.();
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${other}','interactions.sync_calendar','grant');`);
  const account=sql(`select id from public.finalize_google_connected_account_verified('${other}','${other}@example.invalid',array['https://www.googleapis.com/auth/calendar.events.owned.readonly']);`);
  const contact=randomUUID(), contact2=randomUUID();
  for(const [id,email] of [[contact,'focus@example.invalid'],[contact2,'second@example.invalid']]) sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context)
    values('${id}','${other}','Synthetic',true,public.current_networking_context_r2b('${other}'));
    insert into public.contact_emails(user_id,contact_id,email,normalized_email) values('${other}','${id}','${email}','${email}');`);
  const lit=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
  const raw=(run,action,payload={},who=other)=>JSON.parse(request(who,`select public.calendar_manual_sync_v2('${account}','${run}','${action}',${lit(payload)});`));
  const web=resolve(dirname(fileURLToPath(import.meta.url)),'../../../web');
  const req=createRequire(join(web,'package.json')),ts=req('typescript');
  const out=mkdtempSync(join(tmpdir(),'calendar-v2-synthetic-'));
  writeFileSync(join(out,'engine.mjs'),ts.transpileModule(readFileSync(join(web,'lib/calendarManualSync.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
  const {runCalendarManualSync,CalendarV2Error}=await import(pathToFileURL(join(out,'engine.mjs')).href);
  const now=Date.now(),iso=ms=>new Date(ms).toISOString();
  const window={timeMin:iso(now-7*864e5),timeMax:iso(now+30*864e5)};
  const event=(id,extra={})=>({id,status:'confirmed',updated:iso(now),start:{dateTime:iso(now+864e5)},summary:'Synthetic',description:'Synthetic source',attendees:[{email:'focus@example.invalid'},{email:'second@example.invalid'}],...extra});
  let windowEvents=Array.from({length:81},(_,i)=>event(`v2_${i}`)),delta=[],expired=false,inaccessible=false,failPage=false,failBatch=false,lostFinish=false,lostBatch=false;
  const calls={list:0,get:0,apply:0,finish:0}, reports=[];
  let lastRun;
  const execute=async({signal}={})=>{
    lastRun=randomUUID(); Object.keys(calls).forEach(k=>calls[k]=0);
    return runCalendarManualSync({accessToken:'synthetic-never-transmitted',...window},{sleep:async()=>{},signal,
      rpc:async(action,payload)=>{
        if(action==='apply') {calls.apply++;if(failBatch && payload.batch===1) throw new CalendarV2Error('P0001','apply');}
        if(action==='finish') calls.finish++;
        let value;
        try{value=raw(lastRun,action,payload);}catch(error){console.error('Synthetic SQL phase:',action,String(error.stderr??error.message).slice(-1800));throw new CalendarV2Error('P0001',action);}
        if(action==='apply'&&lostBatch){lostBatch=false;throw new Error('synthetic lost batch response');}
        if(action==='finish'&&lostFinish){lostFinish=false;throw new Error('synthetic lost final response');}
        return value;
      },
      fetch:async url=>{
        const u=new URL(url); assert.equal(u.origin,'https://www.googleapis.com');
        if(/\/events\//.test(u.pathname)){calls.get++;const id=decodeURIComponent(u.pathname.split('/').at(-1));return new Response(JSON.stringify(inaccessible?{}:event(id)),{status:inaccessible?404:200});}
        calls.list++;const token=u.searchParams.get('syncToken');
        assert.equal(u.searchParams.get('singleEvents'),'true');assert.equal(u.searchParams.get('showDeleted'),'true');
        if(token){assert.equal(u.searchParams.has('timeMin'),false);assert.equal(u.searchParams.has('timeMax'),false);assert.equal(u.searchParams.has('orderBy'),false);if(expired){expired=false;return new Response('{}',{status:410});}}
        else {assert.ok(u.searchParams.get('timeMin'));assert.ok(u.searchParams.get('timeMax'));}
        const items=token?delta:windowEvents, page=Number(u.searchParams.get('pageToken')??0);
        if(failPage&&page===1)return new Response('{}',{status:503});
        // A deliberately empty first page still has continuation.
        const start=(page-1)*30;
        const body=page===0?{items:[],nextPageToken:'1'}:
          {items:items.slice(start,start+30),...(start+30<items.length?{nextPageToken:String(page+1)}:{nextSyncToken:'token-'+(token?'delta':'window')})};
        return new Response(JSON.stringify(body),{status:200});
      }});
  };
  lostBatch=true;lostFinish=true;
  const first=await execute();equal(first.created,81);equal(calls.get,0);equal(calls.apply,3);equal(calls.finish,2);
  reports.push({scenario:'81 events / empty page / lost batch and final responses',...calls,created:first.created});
  const source=sql(`select id from public.external_interaction_sources where user_id='${other}' and external_id='CALENDAR_v2_0';`);
  const interaction=sql(`select interaction_id from public.external_interaction_sources where id='${source}';`);
  sql(`update public.interactions set user_notes_raw='Synthetic retained note' where id='${interaction}';`);
  const auditBefore=sql(`select count(*) from public.action_invocations where user_id='${other}' and action_name='interaction.reconcile_calendar';`);
  const second=await execute();equal(second.created,0);equal(second.updated,0);equal(calls.get,0);
  equal(sql(`select count(*) from public.action_invocations where user_id='${other}' and action_name='interaction.reconcile_calendar';`),auditBefore);
  reports.push({scenario:'unchanged second click / no event writes',...calls,created:second.created});
  delta=windowEvents.map(e=>({...e,updated:iso(now+500),summary:'Synthetic changed'}));
  const changed=await execute();equal(changed.updated,81);equal(calls.apply,2);equal(calls.get,0);
  reports.push({scenario:'81 incremental changes in one click',...calls});
  delta=[event('v2_0',{updated:iso(now+1000),start:{dateTime:iso(now+60*864e5)}}),{id:'v2_1',status:'cancelled',recurringEventId:'synthetic-series',originalStartTime:{dateTime:iso(now+864e5)}}];
  windowEvents=windowEvents.filter(e=>!['v2_0','v2_1'].includes(e.id));
  const moved=await execute();equal(moved.created,0);equal(moved.updated,2);equal(calls.get,0);
  equal(sql(`select user_notes_raw from public.interactions where id='${interaction}';`),'Synthetic retained note');
  equal(sql(`select sync_status from public.external_interaction_sources where user_id='${other}' and external_id='CALENDAR_v2_1';`),'deleted_at_source');
  reports.push({scenario:'moved outside window + cancelled occurrence',...calls});
  delta=[];
  sql(`update public.contacts set networking_focus=false,networking_write_context=public.current_networking_context_r2b('${other}') where id in ('${contact}','${contact2}');`);
  windowEvents=[event('new_focus')]; equal((await execute()).created,0);
  sql(`update public.contacts set networking_focus=true,networking_write_context=public.current_networking_context_r2b('${other}') where id='${contact}';`);
  equal((await execute()).created,1);equal(calls.get,0);
  windowEvents.push(event('new_horizon',{start:{dateTime:iso(now+29*864e5)}}));equal((await execute()).created,1);
  windowEvents=Array.from({length:75},(_,i)=>event(`retry_${i}`));failBatch=true;
  const beforeToken=sql(`select sync_token from public.calendar_sync_state_v2 where user_id='${other}';`);
  await assert.rejects(execute(),/completar/);
  equal(sql(`select sync_token from public.calendar_sync_state_v2 where user_id='${other}';`),beforeToken);
  failBatch=false;equal((await execute()).created,25);equal(calls.get,0);
  reports.push({scenario:'intermediate batch failure / idempotent recovery',...calls});
  failPage=true;await assert.rejects(execute(),/completar/);equal(calls.apply,0);failPage=false;
  expired=true;const recovered=await execute();equal(recovered.created,0);assert.ok(calls.get>0);
  reports.push({scenario:'410 recovery / exceptional GET only',...calls});
  equal((await execute()).created,0);equal(calls.get,0);
  // An inaccessible source is not cancelled and is not retried every click.
  expired=true;inaccessible=true;
  const lastSuccess=sql(`select last_success from public.calendar_sync_state_v2 where user_id='${other}';`);
  await assert.rejects(execute(),/completar/);assert.ok(calls.get>0);
  equal(sql(`select last_success from public.calendar_sync_state_v2 where user_id='${other}';`),lastSuccess);
  expired=true;await assert.rejects(execute(),/completar/);equal(calls.get,0);
  inaccessible=false;
  // A lease fences stale writers and finalizers; no client table access or other owner access.
  const a=randomUUID(),b=randomUUID();raw(a,'begin',window);
  denied(()=>raw(b,'begin',window),/CALENDAR_BUSY/);
  denied(()=>raw(a,'apply',{batch:0,events:[]},user),/CALENDAR_DENIED/);
  sql(`update public.calendar_sync_state_v2 set lease_until=clock_timestamp()-interval '1 second' where user_id='${other}';`);
  raw(b,'begin',window);
  denied(()=>raw(a,'apply',{batch:0,events:[]}),/CALENDAR_RUN_STALE/);
  denied(()=>raw(a,'finish',{batches:0,token:'stale'}),/CALENDAR_RUN_STALE/);
  raw(b,'abort');
  const concurrentRuns=[randomUUID(),randomUUID()];
  const concurrent=await Promise.allSettled(concurrentRuns.map(id=>requestAsync(other,`select public.calendar_manual_sync_v2('${account}','${id}','begin',${lit(window)});`)));
  equal(concurrent.filter(x=>x.status==='fulfilled').length,1);equal(concurrent.filter(x=>x.status==='rejected').length,1);
  raw(concurrentRuns[concurrent.findIndex(x=>x.status==='fulfilled')],'abort');
  sql(`insert into public.user_capability_overrides(user_id,capability_code,override_mode) values('${other}','connectors.google.use','deny');`);
  denied(()=>raw(randomUUID(),'begin',window),/CALENDAR_DENIED/);
  sql(`delete from public.user_capability_overrides where user_id='${other}' and capability_code='connectors.google.use';`);
  denied(()=>request(other,`select public.apply_calendar_discovery_v1('${account}','{}');`),/permission denied/);
  const controller=new AbortController();controller.abort();await assert.rejects(execute({signal:controller.signal}),/cancelada/);
  assert.match(sql(beforeEngine ? file('verifiers/202611060005_verify_calendar_write_boundary.sql') : verifier),/PASS/);
  console.log('Calendar v2 integrated calls (synthetic Google; real engine/RPC/writers/PostgreSQL):',JSON.stringify(reports));
  console.log('PASS Calendar v2: LF/CRLF, rollback, ACL/RLS, empty pages, batching, freshness, notes, recurrence, Focus, recovery, fencing and cancellation.');
}
