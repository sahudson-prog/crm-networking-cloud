begin;

-- Forward-only: v1 bodies remain intact. A separate namespace fences the cursor.
do $$ declare r record; p pg_proc%rowtype; begin
  if to_regclass('public.calendar_sync_state_v2') is not null then raise exception 'STOP: Calendar v2 already installed'; end if;
  for r in select * from (values
    ('public.apply_calendar_discovery_v1(uuid,jsonb)','d7eb754e2d6afee5f8f333cb548c1af7'),
    ('public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)','3de0a3fa967bb855e5a70029cfea4850')) x(signature,hash) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or not p.prosecdef or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""'] or md5(replace(p.prosrc,E'\r',''))<>r.hash then
      raise exception 'STOP: Calendar 002 dependency drift'; end if;
  end loop;
end $$;

create table public.calendar_sync_state_v2(
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.connected_accounts(id) on delete cascade,
  calendar_id text not null default 'primary' check(calendar_id='primary'),
  flow_version integer not null default 2 check(flow_version=2),
  sync_token text, last_success timestamptz, last_result jsonb,
  active_run uuid, lease_until timestamptz,
  primary key(user_id,account_id)
);
create table public.calendar_sync_runs_v2(
  user_id uuid not null, account_id uuid not null, run_id uuid not null,
  time_min timestamptz not null, time_max timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'running' check(status in ('running','complete','aborted')),
  created_count integer not null default 0 check(created_count>=0),
  updated_count integer not null default 0 check(updated_count>=0),
  skipped_count integer not null default 0 check(skipped_count>=0),
  result jsonb, primary key(user_id,account_id,run_id),
  foreign key(user_id,account_id) references public.calendar_sync_state_v2 on delete cascade,
  check(isfinite(time_min) and isfinite(time_max) and time_min<time_max)
);
create table public.calendar_sync_batches_v2(
  user_id uuid not null, account_id uuid not null, run_id uuid not null, batch_no integer not null check(batch_no>=0),
  payload_hash text not null, result jsonb not null,
  primary key(user_id,account_id,run_id,batch_no),
  foreign key(user_id,account_id,run_id) references public.calendar_sync_runs_v2 on delete cascade
);
create table public.calendar_sync_stamps_v2(
  source_id uuid primary key references public.external_interaction_sources(id) on delete cascade,
  event_hash text not null, provider_updated timestamptz, local_hash text not null
);
alter table public.calendar_sync_state_v2 enable row level security;
alter table public.calendar_sync_runs_v2 enable row level security;
alter table public.calendar_sync_batches_v2 enable row level security;
alter table public.calendar_sync_stamps_v2 enable row level security;
revoke all on public.calendar_sync_state_v2,public.calendar_sync_runs_v2,public.calendar_sync_batches_v2,public.calendar_sync_stamps_v2 from public,anon,authenticated,service_role;

-- Carry forward only an explicitly confirmed v1 success, never its cursor or inferred counts.
do $$ begin
  if exists(select 1 from public.sync_cursors where provider='google' and resource_type='calendar' and cursor_label='' and status='ok'
    and metadata ? 'calendar_reconciliation_success_at' and
    (last_synced_at is null or not isfinite(last_synced_at) or (metadata->>'calendar_reconciliation_success_at')::timestamptz is distinct from last_synced_at)) then
    raise exception 'STOP: incompatible Calendar success evidence'; end if;
end $$;
insert into public.calendar_sync_state_v2(user_id,account_id,last_success)
  select c.user_id,c.connected_account_id,c.last_synced_at from public.sync_cursors c
  join public.connected_accounts a on a.id=c.connected_account_id and a.user_id=c.user_id
  where c.provider='google' and c.resource_type='calendar' and c.cursor_label='' and c.status='ok'
    and c.metadata ? 'calendar_reconciliation_success_at';

create function public.calendar_local_hash_v2(p_source uuid,p_event jsonb) returns text
language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_array(
    (select jsonb_agg(jsonb_build_array(c.id,c.is_active,c.networking_focus,e.email) order by c.id,e.email)
      from public.contacts c join public.contact_emails e on e.contact_id=c.id and e.user_id=c.user_id
      where c.user_id=auth.uid() and lower(e.email) in
        (select lower(value->>'email') from jsonb_array_elements(coalesce(p_event->'attendees','[]'::jsonb))
         union select lower(p_event#>>'{organizer,email}'))),
    (select jsonb_agg(jsonb_build_array(p.id,p.contact_id,p.email_identity,p.role,o.fingerprint) order by p.id)
      from public.external_interaction_sources s join public.interaction_participants p on p.interaction_id=s.interaction_id
      left join public.calendar_participant_provenance_v1 o on o.participant_id=p.id
      where s.id=p_source and s.user_id=auth.uid()),
    (select jsonb_agg(op.opportunity_id order by op.opportunity_id) from public.external_interaction_sources s
      join public.opportunity_interactions op on op.interaction_id=s.interaction_id where s.id=p_source and s.user_id=auth.uid())
  )::text);
$$;

create function public.calendar_manual_sync_v2(p_account uuid,p_run uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<operation>>
declare st public.calendar_sync_state_v2%rowtype; ru public.calendar_sync_runs_v2%rowtype;
  so public.external_interaction_sources%rowtype; it public.interactions%rowtype; stamp public.calendar_sync_stamps_v2%rowtype;
  ev jsonb; item jsonb; targets jsonb; answer jsonb; prior jsonb; result jsonb;
  lo timestamptz; hi timestamptz; event_time timestamptz; upd timestamptz; account_email text;
  batch integer; n_created integer:=0; n_updated integer:=0; n_skipped integer:=0; n_protected integer:=0; event_hash text; local_hash text;
begin
  if auth.uid() is null or not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('calendar-reconcile:'||p_account::text));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  if p_run is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'CALENDAR_INVALID_REQUEST'; end if;
  select * into st from public.calendar_sync_state_v2 where user_id=auth.uid() and account_id=p_account for update;
  if p_action='status' then return jsonb_build_object('synced_at',st.last_success,'result',st.last_result); end if;
  select * into ru from public.calendar_sync_runs_v2 where user_id=auth.uid() and account_id=p_account and run_id=p_run;
  if p_action in ('begin','finish') and ru.status='complete' then return ru.result; end if;
  if p_action='begin' then
    lo:=(p_payload->>'timeMin')::timestamptz; hi:=(p_payload->>'timeMax')::timestamptz;
    if lo is null or hi is null or not isfinite(lo) or not isfinite(hi) or lo>=hi
      or lo<clock_timestamp()-interval '7 days 5 minutes' or hi>clock_timestamp()+interval '30 days 5 minutes' then
      raise exception 'CALENDAR_INVALID_WINDOW'; end if;
    if st.active_run is not null and st.active_run<>p_run and st.lease_until>clock_timestamp() then
      raise exception 'CALENDAR_BUSY' using errcode='55P03'; end if;
    if ru.run_id is not null and (ru.status<>'running' or st.active_run is distinct from p_run or st.lease_until<=clock_timestamp()) then
      raise exception 'CALENDAR_RUN_STALE' using errcode='40001'; end if;
    insert into public.calendar_sync_state_v2(user_id,account_id,active_run,lease_until) values(auth.uid(),p_account,p_run,clock_timestamp()+interval '5 minutes')
      on conflict(user_id,account_id) do update set active_run=p_run,lease_until=excluded.lease_until;
    insert into public.calendar_sync_runs_v2(user_id,account_id,run_id,time_min,time_max) values(auth.uid(),p_account,p_run,lo,hi) on conflict do nothing;
    return jsonb_build_object('status','running','token',st.sync_token,'timeMin',coalesce(ru.time_min,lo),'timeMax',coalesce(ru.time_max,hi));
  end if;
  if ru.status is distinct from 'running' or st.active_run is distinct from p_run or st.lease_until is null or st.lease_until<=clock_timestamp() then
    raise exception 'CALENDAR_RUN_STALE' using errcode='40001'; end if;
  update public.calendar_sync_state_v2 set lease_until=clock_timestamp()+interval '5 minutes' where user_id=auth.uid() and account_id=p_account;
  if p_action='renew' then return jsonb_build_object('status','running'); end if;
  if p_action='abort' then
    update public.calendar_sync_runs_v2 set status='aborted' where user_id=auth.uid() and account_id=p_account and run_id=p_run;
    update public.calendar_sync_state_v2 set active_run=null,lease_until=null where user_id=auth.uid() and account_id=p_account;
    return jsonb_build_object('status','aborted','created',ru.created_count);
  end if;
  if p_action='known' then
    select coalesce(jsonb_agg(x.item),'[]'::jsonb) into result from (
      select jsonb_build_object('source',s.id,'id',substring(s.external_id from 10),'retryAfter',s.metadata#>>'{calendar_reconciliation_v1,retry_after}') item from public.external_interaction_sources s
      join public.interactions i on i.id=s.interaction_id and i.user_id=s.user_id
      where s.user_id=auth.uid() and s.connected_account_id=p_account and s.provider='google' and s.source_service='calendar'
        and s.is_active and not s.prevent_reimport and s.external_id like 'CALENDAR_%'
        and public.opportunity_interaction_active_v1(to_jsonb(i))
        and (nullif(p_payload->>'after','') is null or s.id>(p_payload->>'after')::uuid)
      order by s.id limit 250) x;
    return jsonb_build_object('rows',result);
  end if;
  if p_action='defer' then
    if (p_payload->>'status')::integer not in (403,404) then raise exception 'CALENDAR_INVALID_EVIDENCE'; end if;
    select * into so from public.external_interaction_sources s where s.user_id=auth.uid() and s.connected_account_id=p_account
      and s.provider='google' and s.source_service='calendar' and s.external_id='CALENDAR_'||(p_payload->>'id') for update;
    if not found then raise exception 'CALENDAR_SOURCE_NOT_FOUND'; end if;
    select * into it from public.interactions where id=so.interaction_id and user_id=auth.uid() for update;
    return public.reconcile_calendar_event_v1(p_account,so.id,so.updated_at,it.updated_at,null,(p_payload->>'status')::integer);
  end if;
  if p_action='apply' then
    batch:=(p_payload->>'batch')::integer;
    if batch is null or batch<0 or jsonb_typeof(p_payload->'events') is distinct from 'array'
      or jsonb_array_length(p_payload->'events')>50 then raise exception 'CALENDAR_INVALID_BATCH'; end if;
    select b.result into prior from public.calendar_sync_batches_v2 b where b.user_id=auth.uid() and b.account_id=p_account and b.run_id=p_run and b.batch_no=batch;
    if found then
      if not exists(select 1 from public.calendar_sync_batches_v2 b where b.user_id=auth.uid() and b.account_id=p_account and b.run_id=p_run and b.batch_no=batch and b.payload_hash=md5(p_payload::text)) then
        raise exception 'CALENDAR_BATCH_MISMATCH'; end if;
      return prior;
    end if;
    if batch<>(select count(*) from public.calendar_sync_batches_v2 where user_id=auth.uid() and account_id=p_account and run_id=p_run) then raise exception 'CALENDAR_BATCH_ORDER'; end if;
    select ca.account_email into account_email from public.connected_accounts ca where ca.id=p_account;
    for ev in select value from jsonb_array_elements(p_payload->'events') loop
      if jsonb_typeof(ev) is distinct from 'object' or coalesce(ev->>'id','')='' or coalesce(ev->>'status','') not in ('confirmed','tentative','cancelled') then raise exception 'CALENDAR_INVALID_EVENT'; end if;
      if exists(select 1 from public.external_interaction_sources s where s.user_id=auth.uid() and s.provider='google' and s.source_service='calendar'
        and lower(s.external_id)=lower('CALENDAR_'||(ev->>'id')) and s.external_id<>('CALENDAR_'||(ev->>'id'))) then raise exception 'CALENDAR_LEGACY_ID_REVIEW_REQUIRED'; end if;
      select * into so from public.external_interaction_sources s where s.user_id=auth.uid() and s.provider='google' and s.source_service='calendar' and s.external_id='CALENDAR_'||(ev->>'id') for update;
      if so.id is not null and so.connected_account_id is distinct from p_account then raise exception 'CALENDAR_ACCOUNT_MISMATCH'; end if;
      upd:=nullif(ev->>'updated','')::timestamptz;
      if upd is not null and not isfinite(upd) then raise exception 'CALENDAR_INVALID_DATE'; end if;
      event_hash:=md5(ev::text); local_hash:=public.calendar_local_hash_v2(so.id,ev);
      select * into stamp from public.calendar_sync_stamps_v2 where source_id=so.id;
      if stamp.provider_updated is not null and upd is not null and upd<stamp.provider_updated then
        n_skipped:=n_skipped+1; continue; end if;
      if stamp.event_hash=event_hash and stamp.local_hash=local_hash then
        if so.metadata#>>'{calendar_reconciliation_v1,retry_after}' is not null then
          update public.external_interaction_sources set metadata=jsonb_set(metadata #- '{calendar_reconciliation_v1,retry_after}' #- '{calendar_reconciliation_v1,access_status}',
            '{calendar_reconciliation_v1,pending}','false'::jsonb) where id=so.id;
        end if;
        n_skipped:=n_skipped+1; continue; end if;
      if so.id is not null then
        select * into it from public.interactions where id=so.interaction_id and user_id=auth.uid() for update;
        answer:=public.reconcile_calendar_event_v1(p_account,so.id,so.updated_at,it.updated_at,ev,null);
      elsif ev->>'status'='cancelled' then n_skipped:=n_skipped+1; continue;
      else
        event_time:=coalesce((ev#>>'{start,dateTime}')::timestamptz,((ev#>>'{start,date}')::date::timestamp at time zone 'UTC'));
        if event_time is null or not isfinite(event_time) then raise exception 'CALENDAR_INVALID_DATE'; end if;
        if event_time<ru.time_min or event_time>=ru.time_max then n_skipped:=n_skipped+1; continue; end if;
        select coalesce(jsonb_agg(x.item),'[]'::jsonb) into targets from (
          select distinct on (c.id) jsonb_build_object('contactId',c.id,'email',lower(e.email),'role',a.role) item
          from (select value->>'email' email,'TO'::text role from jsonb_array_elements(coalesce(ev->'attendees','[]'::jsonb)) union all select ev#>>'{organizer,email}','FROM') a
          join public.contact_emails e on lower(e.email)=lower(a.email) and e.user_id=auth.uid()
          join public.contacts c on c.id=e.contact_id and c.user_id=auth.uid() and c.is_active and c.networking_focus
          where lower(e.email)<>lower(account_email) order by c.id,a.role,e.id) x;
        item:=jsonb_build_object('sourceService','calendar','interactionType','calendar','direction','unknown','externalObjectType','calendar_event',
          'externalId','CALENDAR_'||(ev->>'id'),'occurredAt',event_time,'subject',coalesce(ev->>'summary','Reunion sin titulo'),
          'sourceDetail',coalesce(ev->>'description','')||case when coalesce(ev->>'location','')<>'' then E'\n\nUbicacion/Link: '||(ev->>'location') else '' end,
          'externalUrl',ev->>'htmlLink','participants',targets,'metadata',jsonb_build_object('google_calendar_event_id',ev->>'id'));
        answer:=public.apply_calendar_discovery_v1(p_account,item);
        select * into so from public.external_interaction_sources s where s.user_id=auth.uid() and s.provider='google' and s.source_service='calendar' and s.external_id='CALENDAR_'||(ev->>'id');
      end if;
      if answer->>'status'='created' then n_created:=n_created+1;
      elsif answer->>'status' in ('updated','cancelled') then n_updated:=n_updated+1;
      else n_skipped:=n_skipped+1; end if;
      n_protected:=n_protected+coalesce((answer->>'associations_preserved')::integer,0);
      if so.id is not null then
        insert into public.calendar_sync_stamps_v2 values(so.id,event_hash,upd,public.calendar_local_hash_v2(so.id,ev))
          on conflict(source_id) do update set event_hash=excluded.event_hash,provider_updated=excluded.provider_updated,local_hash=excluded.local_hash;
      end if;
    end loop;
    result:=jsonb_build_object('created',n_created,'updated',n_updated,'skipped',n_skipped,'associations_preserved',n_protected);
    insert into public.calendar_sync_batches_v2 values(auth.uid(),p_account,p_run,batch,md5(p_payload::text),result);
    update public.calendar_sync_runs_v2 set created_count=created_count+n_created,updated_count=updated_count+n_updated,skipped_count=skipped_count+n_skipped
      where user_id=auth.uid() and account_id=p_account and run_id=p_run;
    return result;
  end if;
  if p_action='finish' then
    if coalesce(p_payload->>'token','')='' or (p_payload->>'batches')::integer is distinct from
      (select count(*)::integer from public.calendar_sync_batches_v2 where user_id=auth.uid() and account_id=p_account and run_id=p_run) then raise exception 'CALENDAR_INCOMPLETE'; end if;
    select coalesce(sum((b.result->>'associations_preserved')::integer),0) into n_protected from public.calendar_sync_batches_v2 b where b.user_id=auth.uid() and b.account_id=p_account and b.run_id=p_run;
    result:=jsonb_build_object('status','complete','created',ru.created_count,'updated',ru.updated_count,'skipped',ru.skipped_count,'associations_preserved',n_protected,'synced_at',clock_timestamp());
    update public.calendar_sync_runs_v2 set status='complete',result=operation.result where user_id=auth.uid() and account_id=p_account and run_id=p_run;
    update public.calendar_sync_state_v2 set sync_token=p_payload->>'token',last_success=(result->>'synced_at')::timestamptz,last_result=result,active_run=null,lease_until=null
      where user_id=auth.uid() and account_id=p_account;
    return result;
  end if;
  raise exception 'CALENDAR_INVALID_ACTION';
end $$;

alter function public.calendar_local_hash_v2(uuid,jsonb) owner to postgres;
alter function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.calendar_local_hash_v2(uuid,jsonb),public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) to authenticated;
-- Old reconciler cannot write during v2 or overwrite its isolated cursor. Runtime rollback stays fail-closed.
revoke execute on function public.apply_calendar_discovery_v1(uuid,jsonb),public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean),
 public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer),public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz) from authenticated;
commit;
