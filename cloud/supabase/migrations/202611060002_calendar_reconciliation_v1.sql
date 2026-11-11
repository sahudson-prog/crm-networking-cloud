begin;

do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
    p.proname in ('apply_calendar_discovery_v1','prepare_calendar_reconciliation_v1','reconcile_calendar_event_v1','finish_calendar_reconciliation_v1'))
    or to_regclass('public.calendar_participant_provenance_v1') is not null
    or to_regprocedure('public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean)') is not null
    or to_regprocedure('public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)') is not null
    or to_regprocedure('public.apply_calendar_discovery_v1(uuid,jsonb)') is not null then
    raise exception 'calendar_reconciliation_already_present';
  end if;
  if to_regprocedure('public.apply_google_periodic_v1(uuid,jsonb)') is null
    or to_regprocedure('public.opportunity_interaction_active_v1(jsonb)') is null
    or not exists(select 1 from pg_proc where oid='public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure
      and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""'] and md5(replace(prosrc,E'\r',''))='b50f8d410fa7138ab3252f126984d9f8') then
    raise exception 'calendar_independent_dependency_missing';
  end if;
  if to_regclass('public.opportunity_interactions') is null or exists(select 1 from pg_class where oid in
    ('public.external_interaction_sources'::regclass,'public.interactions'::regclass,'public.interaction_participants'::regclass)
    and (not relrowsecurity or relowner<>'postgres'::regrole)) then raise exception 'calendar_dependency_drift'; end if;
  if exists(select 1 from public.external_interaction_sources where metadata ? 'calendar_reconciliation_v1') then
    raise exception 'calendar_metadata_key_already_in_use'; end if;
  if exists(select 1 from public.external_interaction_sources s join public.external_interaction_sources other
    on other.interaction_id=s.interaction_id and other.id<>s.id and other.is_active
    where s.provider='google' and s.source_service='calendar' and s.is_active) then
    raise exception 'calendar_shared_interaction_requires_owner_review'; end if;
end $$;

-- Only server-created links are eligible for removal. No legacy provenance is inferred.
create table public.calendar_participant_provenance_v1 (
  participant_id uuid primary key references public.interaction_participants(id) on delete cascade,
  source_id uuid not null references public.external_interaction_sources(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{32}$')
);
alter table public.calendar_participant_provenance_v1 owner to postgres;
alter table public.calendar_participant_provenance_v1 enable row level security;
create index calendar_participant_provenance_source_idx on public.calendar_participant_provenance_v1(source_id);
revoke all on public.calendar_participant_provenance_v1 from public,anon,authenticated,service_role;

create function public.apply_calendar_discovery_v1(p_account uuid,p_item jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_source public.external_interaction_sources%rowtype; v_before uuid[];
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('calendar-reconcile:'||p_account::text));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  if p_item->>'sourceService' is distinct from 'calendar' or p_item->>'interactionType' is distinct from 'calendar'
    or coalesce(p_item->>'externalId','') not like 'CALENDAR_%' then raise exception 'CALENDAR_INVALID_ITEM'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('google-interaction:calendar:'||(p_item->>'externalId')));
  select * into v_source from public.external_interaction_sources
    where user_id=auth.uid() and provider='google' and source_service='calendar' and external_id=p_item->>'externalId' and is_active for update;
  if found then
    if v_source.connected_account_id is distinct from p_account then raise exception 'CALENDAR_ACCOUNT_MISMATCH'; end if;
    -- Existing sources must use the update-only route, never discovery/upsert.
    return jsonb_build_object('status','skipped_prevent_reimport','interaction_id',v_source.interaction_id);
  end if;
  -- Revalidate Focus at Apply; entering/leaving Focus between read and Apply is not a bypass.
  p_item:=jsonb_set(p_item,'{participants}',coalesce((select jsonb_agg(x.value) from jsonb_array_elements(coalesce(p_item->'participants','[]')) x
    join public.contacts c on c.id=(x.value->>'contactId')::uuid and c.user_id=auth.uid() and c.is_active and c.networking_focus),'[]'::jsonb));
  if jsonb_array_length(p_item->'participants')=0 then return jsonb_build_object('status','skipped_prevent_reimport'); end if;
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_before from public.interaction_participants p
    join public.interactions i on i.id=p.interaction_id where i.user_id=auth.uid() and i.provider='google' and i.provider_event_id=p_item->>'externalId';
  v_result:=public.apply_google_periodic_v1(p_account,p_item);
  if v_result->>'status' in ('created','updated') then
    insert into public.calendar_participant_provenance_v1(participant_id,source_id,fingerprint)
      select p.id,(v_result->>'external_source_id')::uuid,
        md5(jsonb_build_array(p.id,p.contact_id,p.email_identity,p.role)::text)
      from public.interaction_participants p
      where p.interaction_id=(v_result->>'interaction_id')::uuid and p.user_id=auth.uid()
        and not(p.id=any(v_before)) and p.xmin::text=pg_current_xact_id()::text
      on conflict do nothing;
  end if;
  return v_result;
end $$;

create function public.prepare_calendar_reconciliation_v1(
  p_account uuid,p_min timestamptz,p_max timestamptz,p_received jsonb,p_enqueue boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_last timestamptz; v_rows jsonb; v_known jsonb; v_pending bigint;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('calendar-reconcile:'||p_account::text));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  if p_min is null or p_max is null or not isfinite(p_min) or not isfinite(p_max) or p_min>=p_max
    or jsonb_typeof(p_received) is distinct from 'object' then raise exception 'CALENDAR_INVALID_WINDOW'; end if;
  if (select count(*) from jsonb_object_keys(p_received))>2500 then raise exception 'CALENDAR_INVALID_WINDOW'; end if;
  select (metadata->>'calendar_reconciliation_success_at')::timestamptz into v_last from public.sync_cursors where user_id=auth.uid()
    and connected_account_id=p_account and provider='google' and resource_type='calendar' and cursor_label='' and status='ok';
  if p_enqueue then
    -- A cooldown must not freeze all previously checked sources until full success.
    -- Start another bounded pass only after the runnable queue has drained.
    if not exists(select 1 from public.external_interaction_sources s join public.interactions i on i.id=s.interaction_id
      where s.user_id=auth.uid() and i.user_id=auth.uid() and s.connected_account_id=p_account
        and s.provider='google' and s.source_service='calendar' and s.is_active and not s.prevent_reimport
        and public.opportunity_interaction_active_v1(to_jsonb(i)) and s.metadata#>>'{calendar_reconciliation_v1,pending}'='true'
        and (p_received ? s.external_id
          or coalesce((s.metadata#>>'{calendar_reconciliation_v1,retry_after}')::timestamptz,'-infinity')<=clock_timestamp())) then
      v_last:=clock_timestamp();
    end if;
    update public.external_interaction_sources s set metadata=jsonb_set(s.metadata,'{calendar_reconciliation_v1}',
      coalesce(s.metadata->'calendar_reconciliation_v1','{}'::jsonb)||jsonb_build_object('pending',true,
        'queued_at',coalesce(s.metadata#>>'{calendar_reconciliation_v1,queued_at}',clock_timestamp()::text))), updated_at=clock_timestamp()
    from public.interactions i
    where s.interaction_id=i.id and s.user_id=auth.uid() and i.user_id=auth.uid() and s.connected_account_id=p_account
      and s.provider='google' and s.source_service='calendar' and s.is_active and not s.prevent_reimport
      and public.opportunity_interaction_active_v1(to_jsonb(i))
      and (p_received ? s.external_id or (s.sync_status<>'deleted_at_source' and s.last_seen_at>=p_min and s.last_seen_at<p_max))
      and (s.metadata#>>'{calendar_reconciliation_v1,checked_at}' is null
        or (s.metadata#>>'{calendar_reconciliation_v1,checked_at}')::timestamptz<=v_last
        or (p_received ? s.external_id and p_received->>s.external_id is distinct from s.metadata#>>'{calendar_reconciliation_v1,provider_marker}'));
  end if;
  select coalesce(jsonb_agg(s.external_id),'[]'::jsonb) into v_known from public.external_interaction_sources s
    where s.user_id=auth.uid() and s.provider='google' and s.source_service='calendar'
      and p_received ? s.external_id;
  -- Preserve pending work even when the rolling window advances between clicks.
  select count(*) into v_pending from public.external_interaction_sources s join public.interactions i on i.id=s.interaction_id
    where s.user_id=auth.uid() and i.user_id=auth.uid() and s.connected_account_id=p_account
      and s.provider='google' and s.source_service='calendar' and s.is_active and not s.prevent_reimport
      and public.opportunity_interaction_active_v1(to_jsonb(i)) and s.metadata#>>'{calendar_reconciliation_v1,pending}'='true';
  select coalesce(jsonb_agg(t.row),'[]'::jsonb) into v_rows from (
    select jsonb_build_object('source_id',s.id,'external_id',s.external_id,'source_version',s.updated_at,
      'interaction_version',i.updated_at,'retry_after',s.metadata#>>'{calendar_reconciliation_v1,retry_after}') as row
    from public.external_interaction_sources s join public.interactions i on i.id=s.interaction_id
    where s.user_id=auth.uid() and i.user_id=auth.uid() and s.connected_account_id=p_account
      and s.provider='google' and s.source_service='calendar' and s.is_active and not s.prevent_reimport
      and public.opportunity_interaction_active_v1(to_jsonb(i)) and s.metadata#>>'{calendar_reconciliation_v1,pending}'='true'
    order by (p_received ? s.external_id) desc,
      (coalesce((s.metadata#>>'{calendar_reconciliation_v1,retry_after}')::timestamptz,'-infinity')>clock_timestamp()),
      s.metadata#>>'{calendar_reconciliation_v1,queued_at}',s.id limit 200
  ) t;
  return jsonb_build_object('rows',v_rows,'pending',v_pending,'known_ids',v_known);
end $$;

create function public.reconcile_calendar_event_v1(p_account uuid,p_source uuid,
  p_source_version timestamptz,p_interaction_version timestamptz,p_event jsonb,p_inaccessible integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.external_interaction_sources%rowtype; i public.interactions%rowtype;
  v_when timestamptz; v_email text; v_targets jsonb; v_owned uuid[]; v_id uuid; t jsonb; v_old_updated timestamptz; v_protected integer:=0;
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('calendar-reconcile:'||p_account::text));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  select * into s from public.external_interaction_sources where id=p_source and user_id=auth.uid()
    and connected_account_id=p_account and provider='google' and source_service='calendar';
  if not found then raise exception 'CALENDAR_SOURCE_NOT_FOUND' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('google-interaction:calendar:'||s.external_id));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  select * into s from public.external_interaction_sources where id=p_source for update;
  if s.user_id is distinct from auth.uid() or s.connected_account_id is distinct from p_account then raise exception 'CALENDAR_ACCOUNT_MISMATCH'; end if;
  select * into i from public.interactions where id=s.interaction_id and user_id=auth.uid() for update;
  if not found then raise exception 'CALENDAR_INTERACTION_NOT_FOUND'; end if;
  if exists(select 1 from public.external_interaction_sources other where other.interaction_id=i.id and other.id<>s.id and other.is_active) then
    raise exception 'CALENDAR_SHARED_INTERACTION_REQUIRES_REVIEW'; end if;
  if not s.is_active or s.prevent_reimport or not public.opportunity_interaction_active_v1(to_jsonb(i)) then
    return jsonb_build_object('status','skipped'); end if;
  if s.updated_at is distinct from p_source_version or i.updated_at is distinct from p_interaction_version then
    raise exception 'CALENDAR_RECONCILIATION_STALE' using errcode='40001'; end if;
  if p_inaccessible is not null then
    if p_inaccessible not in (403,404) or p_event is not null then raise exception 'CALENDAR_INVALID_EVIDENCE'; end if;
    update public.external_interaction_sources set metadata=jsonb_set(metadata,'{calendar_reconciliation_v1}',
      coalesce(metadata->'calendar_reconciliation_v1','{}'::jsonb)||jsonb_build_object('pending',true,
        'retry_after',clock_timestamp()+interval '24 hours','access_status',p_inaccessible)),updated_at=clock_timestamp() where id=s.id;
    return jsonb_build_object('status','skipped');
  end if;
  if jsonb_typeof(p_event) is distinct from 'object' or ('CALENDAR_'||(p_event->>'id')) is distinct from s.external_id
    or coalesce(p_event->>'status','') not in ('confirmed','tentative','cancelled') then raise exception 'CALENDAR_INVALID_EVIDENCE'; end if;
  v_old_updated:=(s.metadata#>>'{calendar_reconciliation_v1,provider_updated_at}')::timestamptz;
  if p_event->>'updated' is not null and not isfinite((p_event->>'updated')::timestamptz) then raise exception 'CALENDAR_INVALID_DATE'; end if;
  if v_old_updated is not null and (p_event->>'updated')::timestamptz<v_old_updated then
    raise exception 'CALENDAR_PROVIDER_RESPONSE_STALE' using errcode='40001'; end if;
  if p_event->>'status'<>'cancelled' then
    v_when:=coalesce((p_event#>>'{start,dateTime}')::timestamptz,((p_event#>>'{start,date}')::date::timestamp at time zone 'UTC'));
    if v_when is null or not isfinite(v_when) then raise exception 'CALENDAR_INVALID_DATE'; end if;
    update public.interactions set occurred_at=v_when,subject=coalesce(nullif(p_event->>'summary',''),'Reunion sin titulo'),
      source_detail=coalesce(p_event->>'description','')||case when coalesce(p_event->>'location','')<>'' then E'\n\nUbicacion/Link: '||(p_event->>'location') else '' end,
      updated_at=clock_timestamp() where id=i.id;
    -- Only full attendee responses permit association reconciliation. Never infer provenance for legacy links.
    if coalesce((p_event->>'attendeesOmitted')::boolean,false)=false
      and (p_event->'attendees' is null or jsonb_typeof(p_event->'attendees')='array') then
      select account_email into v_email from public.connected_accounts where id=p_account;
      select coalesce(jsonb_agg(x.item),'[]'::jsonb) into v_targets from (
        select distinct on (c.id) jsonb_build_object('contactId',c.id,'email',lower(e.email),'role',a.role) item
        from (select value->>'email' email,'TO'::text role from jsonb_array_elements(coalesce(p_event->'attendees','[]'::jsonb))
          union all select p_event#>>'{organizer,email}','FROM') a
        join public.contact_emails e on lower(e.email)=lower(a.email) and e.user_id=auth.uid()
        join public.contacts c on c.id=e.contact_id and c.user_id=auth.uid()
        where lower(e.email)<>lower(v_email) order by c.id,a.role,e.id
      ) x;
      -- A changed fingerprint (manual edit/merge) forfeits ownership; preserve that link.
      delete from public.calendar_participant_provenance_v1 o using public.interaction_participants p
        where o.source_id=s.id and p.id=o.participant_id and o.fingerprint<>md5(jsonb_build_array(p.id,p.contact_id,p.email_identity,p.role)::text);
      select coalesce(array_agg(p.id),array[]::uuid[]) into v_owned
        from public.interaction_participants p join public.calendar_participant_provenance_v1 o on o.participant_id=p.id
        where o.source_id=s.id and p.interaction_id=i.id and p.user_id=auth.uid()
          and not exists(select 1 from jsonb_array_elements(v_targets) x where x->>'contactId'=p.contact_id::text and x->>'email'=p.email_identity and x->>'role'=p.role)
          and not exists(select 1 from public.external_interaction_sources other where other.interaction_id=i.id and other.id<>s.id and other.is_active);
      if exists(select 1 from public.opportunity_interactions where interaction_id=i.id and user_id=auth.uid()) then
        v_protected:=cardinality(v_owned);
      else
        delete from public.interaction_participants where id=any(v_owned) and user_id=auth.uid();
      end if;
      for t in select value from jsonb_array_elements(v_targets) loop
        if not exists(select 1 from public.interaction_participants where interaction_id=i.id and user_id=auth.uid()
          and (contact_id=(t->>'contactId')::uuid or lower(email_identity)=t->>'email')) then
          insert into public.interaction_participants(user_id,interaction_id,contact_id,email_identity,role)
            values(auth.uid(),i.id,(t->>'contactId')::uuid,t->>'email',t->>'role') returning id into v_id;
          insert into public.calendar_participant_provenance_v1 values(v_id,s.id,
            md5(jsonb_build_array(v_id,(t->>'contactId')::uuid,t->>'email',t->>'role')::text));
        end if;
      end loop;
    end if;
  end if;
  update public.external_interaction_sources set
    sync_status=case when p_event->>'status'='cancelled' then 'deleted_at_source' else 'synced' end,
    last_seen_at=case when p_event->>'status'='cancelled' then last_seen_at else v_when end,
    source_subject=case when p_event->>'status'='cancelled' then source_subject else coalesce(p_event->>'summary','Reunion sin titulo') end,
    source_detail=case when p_event->>'status'='cancelled' then source_detail else (select source_detail from public.interactions where id=i.id) end,
    external_url=case when p_event->>'status'='cancelled' then external_url else nullif(p_event->>'htmlLink','') end,
    content_hash=case when p_event->>'status'='cancelled' then content_hash else null end,
    last_synced_at=clock_timestamp(),updated_at=clock_timestamp(),
    metadata=jsonb_set(metadata,'{calendar_reconciliation_v1}',jsonb_build_object('pending',false,
      'checked_at',clock_timestamp(),'provider_updated_at',p_event->>'updated','event_status',p_event->>'status',
      'provider_marker',coalesce(p_event->>'updated','')||'|'||coalesce(p_event->>'status',''))) where id=s.id;
  insert into public.action_invocations(user_id,action_name,actor_type,status,object_type,object_id,input_json,output_json,requires_confirmation,executed_at)
    values(auth.uid(),'interaction.reconcile_calendar','system','executed','interaction',i.id,
      jsonb_build_object('source_id',s.id),jsonb_build_object('event_status',p_event->>'status','associations_preserved',v_protected),false,clock_timestamp());
  return jsonb_build_object('status',case when p_event->>'status'='cancelled' then 'cancelled' else 'updated' end,'associations_preserved',v_protected);
end $$;

create function public.finish_calendar_reconciliation_v1(p_account uuid,p_min timestamptz,p_max timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('calendar-reconcile:'||p_account::text));
  if not coalesce(public.current_user_can_sync_connected_account_v1(p_account,'calendar'),false) then
    raise exception 'CALENDAR_DENIED' using errcode='42501'; end if;
  if p_min is null or p_max is null or not isfinite(p_min) or not isfinite(p_max) or p_min>=p_max then raise exception 'CALENDAR_INVALID_WINDOW'; end if;
  if exists(select 1 from public.external_interaction_sources s join public.interactions i on i.id=s.interaction_id
    where s.user_id=auth.uid() and i.user_id=auth.uid() and s.connected_account_id=p_account and s.provider='google'
      and s.source_service='calendar' and s.is_active and not s.prevent_reimport and public.opportunity_interaction_active_v1(to_jsonb(i))
      and s.metadata#>>'{calendar_reconciliation_v1,pending}'='true') then
    raise exception 'CALENDAR_RECONCILIATION_PENDING'; end if;
  insert into public.sync_cursors(user_id,connected_account_id,provider,resource_type,cursor_label,cursor_value,status,last_synced_at,metadata)
    values(auth.uid(),p_account,'google','calendar','',null,'ok',v_now,
      jsonb_build_object('mode','rolling_window','time_min',p_min,'time_max',p_max,'calendar_reconciliation_success_at',v_now))
    on conflict(user_id,provider,resource_type,cursor_label) do update set connected_account_id=excluded.connected_account_id,
      cursor_value=null,status='ok',last_synced_at=excluded.last_synced_at,metadata=excluded.metadata,updated_at=clock_timestamp();
  return jsonb_build_object('status','complete','synced_at',v_now);
end $$;

alter function public.apply_calendar_discovery_v1(uuid,jsonb) owner to postgres;
alter function public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean) owner to postgres;
alter function public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer) owner to postgres;
alter function public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz) owner to postgres;
revoke all on function public.apply_calendar_discovery_v1(uuid,jsonb),public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean),
  public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer),public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.apply_calendar_discovery_v1(uuid,jsonb),public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean),
  public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer),public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz) to authenticated;
commit;
