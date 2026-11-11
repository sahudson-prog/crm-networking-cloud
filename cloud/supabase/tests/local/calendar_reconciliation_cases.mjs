import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function testCalendarReconciliation({ sql, file, request, user, other, account, equal, denied }) {
  const pre = 'preflight/202611060002_preflight_calendar_reconciliation_v1.sql';
  const migration = 'migrations/202611060002_calendar_reconciliation_v1.sql';
  const verifier = 'verifiers/202611060002_verify_calendar_reconciliation_v1.sql';
  assert.match(sql(file(pre)), /PASS/);
  denied(() => sql(file(migration).replace(/commit;\s*$/, "do $$ begin raise exception 'synthetic_abort'; end $$; commit;")), /synthetic_abort/);
  equal(sql("select to_regclass('public.calendar_participant_provenance_v1') is null;"), 't');
  sql(file(migration)); assert.match(sql(file(verifier)), /PASS/);
  denied(() => sql('begin; grant select on public.calendar_participant_provenance_v1 to authenticated;\n' + file(verifier)), /drift/);
  denied(() => sql('begin; alter function public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer) security invoker;\n' + file(verifier)), /drift/);
  denied(() => request(user, 'select * from public.calendar_participant_provenance_v1;'), /permission denied/);
  const contacts = [randomUUID(), randomUUID(), randomUUID()];
  for (let n = 0; n < contacts.length; n++) sql(`insert into public.contacts(id,user_id,display_name,networking_focus,networking_write_context)
    values('${contacts[n]}','${user}','Synthetic ${n}',true,public.current_networking_context_r2b('${user}'));
    insert into public.contact_emails(user_id,contact_id,email,normalized_email) values('${user}','${contacts[n]}','synthetic-${n}@example.invalid','synthetic-${n}@example.invalid');`);
  const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const payload = id => ({ sourceService:'calendar',interactionType:'calendar',direction:'unknown',externalId:`CALENDAR_${id}`,
    externalObjectType:'calendar_event',occurredAt:'2026-11-05T12:00:00Z',subject:'Synthetic',sourceDetail:'Source',
    participants:[{contactId:contacts[0],email:'synthetic-0@example.invalid',role:'TO'}] });
  const discover = id => JSON.parse(request(user,`select public.apply_calendar_discovery_v1('${account}',${literal(payload(id))});`));
  const original = discover('occurrence_A');
  equal(original.status,'created'); equal(discover('occurrence_A').status,'skipped_prevent_reimport');
  equal(sql(`select count(*) from public.calendar_participant_provenance_v1 where source_id='${original.external_source_id}';`),'1');
  sql(`update public.interactions set user_notes_raw='Synthetic private note' where id='${original.interaction_id}';
    insert into public.interaction_participants(user_id,interaction_id,contact_id,role) values('${user}','${original.interaction_id}','${contacts[2]}','MANUAL');`);
  const prepare = (received=[], enqueue=true) => JSON.parse(request(user, `select public.prepare_calendar_reconciliation_v1('${account}',
    '2026-10-29T12:00:00Z','2026-12-05T12:00:00Z',${literal(Object.fromEntries(received.map(x=>[`CALENDAR_${x}`,'synthetic-new-version'])) )},${enqueue});`));
  const getRow = id => prepare([id]).rows.find(r => r.external_id===`CALENDAR_${id}`);
  const call = (r,event,status=null,who=user) => JSON.parse(request(who,`select public.reconcile_calendar_event_v1('${account}',
    '${r.source_id}','${r.source_version}','${r.interaction_version}',${event===null?'null':literal(event)},${status??'null'});`));
  const event = id => ({id,status:'confirmed',updated:'2026-11-05T12:00:00Z',start:{dateTime:'2027-02-01T12:00:00Z'},
    attendees:[{email:'synthetic-1@example.invalid'}]});
  sql(`update public.contacts set networking_focus=false,networking_write_context=public.current_networking_context_r2b('${user}') where id='${contacts[0]}';`);
  const old = getRow('occurrence_A');
  denied(()=>call(old,event('occurrence_A'),null,other),/DENIED/);
  equal(call(old,event('occurrence_A')).status,'updated');
  denied(()=>call(old,event('occurrence_A')),/STALE/);
  equal(sql(`select user_notes_raw from public.interactions where id='${original.interaction_id}';`),'Synthetic private note');
  equal(sql(`select occurred_at='2027-02-01T12:00:00Z'::timestamptz from public.interactions where id='${original.interaction_id}';`),'t');
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${original.interaction_id}' and contact_id='${contacts[0]}';`),'0');
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${original.interaction_id}';`),'2');
  equal(prepare([],false).rows.some(r=>r.source_id===original.external_source_id),false);
  const truncated = {...event('occurrence_A'),attendees:[],attendeesOmitted:true};
  equal(call(getRow('occurrence_A'),truncated).status,'updated');
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${original.interaction_id}';`),'2');
  // Legacy links never become owned merely because they match an attendee.
  const legacyPayload=payload('legacy_unproven');
  const legacy=JSON.parse(request(user,`select public.apply_google_periodic_v1('${account}',${literal(legacyPayload)});`));
  call(getRow('legacy_unproven'),event('legacy_unproven'));
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${legacy.interaction_id}' and contact_id='${contacts[0]}';`),'1');
  equal(discover('not_in_focus').status,'skipped_prevent_reimport');
  sql(`update public.contacts set networking_focus=true,networking_write_context=public.current_networking_context_r2b('${user}') where id='${contacts[0]}';`);
  const b=discover('occurrence_B');
  equal(call(getRow('occurrence_A'),{id:'occurrence_A',recurringEventId:'series',status:'cancelled'}).status,'cancelled');
  equal(sql(`select sync_status from public.external_interaction_sources where id='${original.external_source_id}';`),'deleted_at_source');
  equal(sql(`select sync_status from public.external_interaction_sources where id='${b.external_source_id}';`),'synced');
  equal(sql(`select user_notes_raw from public.interactions where id='${original.interaction_id}';`),'Synthetic private note');
  const inaccessible = getRow('occurrence_B');
  call(inaccessible,null,404);
  equal(sql(`select sync_status from public.external_interaction_sources where id='${b.external_source_id}';`),'synced');
  const waiting = prepare([],false).rows.find(r=>r.source_id===b.external_source_id);
  assert.ok(Date.parse(waiting.retry_after)>Date.now());
  // A manual edit or merge invalidates the fingerprint, preserving the changed link.
  const protectedLink=discover('manual_change');
  sql(`update public.interaction_participants set role='MANUAL' where interaction_id='${protectedLink.interaction_id}';`);
  call(getRow('manual_change'),event('manual_change'));
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${protectedLink.interaction_id}' and role='MANUAL';`),'1');
  const noWrite=getRow('occurrence_B');
  denied(()=>call(noWrite,{...event('occurrence_B'),start:{dateTime:'infinity'}}),/INVALID_DATE/);
  equal(sql(`select sync_status from public.external_interaction_sources where id='${b.external_source_id}';`),'synced');
  for(let n=0;n<25;n++) discover(`queue_${n}`);
  const queue = prepare().rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_'));
  equal(queue.length,25);
  // Pending admission survives the event moving out of the candidate selection interval.
  sql(`update public.external_interaction_sources set last_seen_at='2020-01-01' where user_id='${user}' and external_id='CALENDAR_queue_0';`);
  equal(prepare([],false).rows.some(r=>r.external_id==='CALENDAR_queue_0'),true);
  // Actual durable progress, not an in-memory queue: completed IDs do not re-enter a partial round.
  const eligible=prepare([],false).rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_'));
  for(const r of eligible.slice(0,20)) call(r,event(r.external_id.slice(9)));
  equal(prepare().rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_')).length,5);
  for(const r of prepare([],false).rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_'))) call(r,event(r.external_id.slice(9)));
  equal(prepare().rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_')).length,0);
  const sameMarkers=Object.fromEntries(eligible.map(r=>[r.external_id,'2026-11-05T12:00:00Z|confirmed']));
  const noRepeat=JSON.parse(request(user,`select public.prepare_calendar_reconciliation_v1('${account}','2026-10-29','2026-12-05',${literal(sameMarkers)},true);`));
  equal(noRepeat.rows.filter(r=>r.external_id.startsWith('CALENDAR_queue_')).length,0);
  const held=discover('opportunity_held');
  const context=sql(`select public.current_networking_context_r2b('${user}');`);
  const cycle=request(user,`select public.start_networking_cycle_r2b('${randomUUID()}','Synthetic cycle',clock_timestamp()-interval '1 day','UTC',null,'${context}',false,false);`);
  const token=sql(`select public.current_networking_context_r2b('${user}');`);
  request(user,`select public.save_opportunity_v2('${cycle}','${token}',null,null,'Synthetic opportunity',null,null,
    'identified',null,null,array['${contacts[0]}']::uuid[],array[]::uuid[],array['${held.interaction_id}']::uuid[],'active','${randomUUID()}');`);
  equal(call(getRow('opportunity_held'),event('opportunity_held')).associations_preserved,1);
  equal(sql(`select count(*) from public.interaction_participants where interaction_id='${held.interaction_id}' and contact_id='${contacts[0]}';`),'1');
  const shared=randomUUID();
  sql(`insert into public.external_interaction_sources(id,user_id,interaction_id,provider,source_service,external_object_type,external_id)
    values('${shared}','${user}','${held.interaction_id}','synthetic','calendar','calendar_event','synthetic-shared');`);
  denied(()=>call(getRow('opportunity_held'),{id:'opportunity_held',status:'cancelled'}),/SHARED_INTERACTION/);
  equal(sql(`select sync_status from public.external_interaction_sources where id='${held.external_source_id}';`),'synced');
  sql(`update public.external_interaction_sources set is_active=false where id='${shared}';`);
  const finish=`select public.finish_calendar_reconciliation_v1('${account}','2026-10-29','2026-12-05');`;
  const before=sql(`select last_synced_at from public.sync_cursors where user_id='${user}' and resource_type='calendar' and cursor_label='';`);
  denied(()=>request(user,finish),/RECONCILIATION_PENDING/);
  equal(sql(`select last_synced_at from public.sync_cursors where user_id='${user}' and resource_type='calendar' and cursor_label='';`),before);
  for(const r of prepare([],false).rows) call(r,event(r.external_id.slice(9)));
  equal(JSON.parse(request(user,finish)).status,'complete');
  equal(prepare().pending,0,'moved events outside the window do not cause unbounded GETs');
  const future=JSON.parse(request(user,`select public.prepare_calendar_reconciliation_v1('${account}','2027-01-26','2027-03-05','{}',true);`));
  equal(future.rows.some(r=>r.external_id==='CALENDAR_legacy_unproven'),true);
  // A persistent 404 keeps full success old, but must not freeze later ID checks of other sources.
  sql(`update public.external_interaction_sources set metadata=jsonb_set(metadata,'{calendar_reconciliation_v1,pending}','false')
    where user_id='${user}' and metadata ? 'calendar_reconciliation_v1';`);
  const recheck=discover('review_recheck'), deferred=discover('review_cooldown');
  call(getRow('review_cooldown'),null,404);
  call(getRow('review_recheck'),{...event('review_recheck'),start:{dateTime:'2026-11-05T12:00:00Z'}});
  const successBeforeRecheck=sql(`select last_synced_at from public.sync_cursors where user_id='${user}' and resource_type='calendar' and cursor_label='';`);
  const nextRound=prepare();
  equal(nextRound.rows.some(r=>r.source_id===recheck.external_source_id),true);
  equal(nextRound.rows.some(r=>r.source_id===deferred.external_source_id && Date.parse(r.retry_after)>Date.now()),true);
  equal(sql(`select last_synced_at from public.sync_cursors where user_id='${user}' and resource_type='calendar' and cursor_label='';`),successBeforeRecheck);
  assert.match(sql(file(verifier)), /PASS/);
}
