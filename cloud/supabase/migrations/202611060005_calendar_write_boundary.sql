begin;
set local lock_timeout='5s';
-- Recheck drift in the installation transaction. Do not repair ambiguous data.
lock table public.external_interaction_sources,public.interactions in share row exclusive mode;
do $contract$
declare r record; p pg_proc%rowtype; t oid; who text;
begin
  if to_regprocedure('public.apply_google_interaction_sync_internal_v2(uuid,jsonb)') is not null then raise exception 'STOP: 005 already present'; end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole=current_user::regrole and d.defaclobjtype='f'
      and d.defaclnamespace in (0,'public'::regnamespace)
      and a.grantee not in (0,'postgres'::regrole,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole,'supabase_auth_admin'::regrole))
  then raise exception 'STOP: Calendar 005 unexpected function default ACL'; end if;
  for r in select * from (values
    ('public.apply_google_interaction_sync_v1(uuid,jsonb)','b50f8d410fa7138ab3252f126984d9f8',false,'v','jsonb','plpgsql'),
    ('public.apply_calendar_discovery_v1(uuid,jsonb)','d7eb754e2d6afee5f8f333cb548c1af7',false,'v','jsonb','plpgsql'),
    ('public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)','3de0a3fa967bb855e5a70029cfea4850',false,'v','jsonb','plpgsql'),
    ('public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean)','ecfd8c5a36cda965b0fceccab7aff02e',false,'v','jsonb','plpgsql'),
    ('public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz)','d62c4c9b64924f221f594f7175e5b4ad',false,'v','jsonb','plpgsql'),
    ('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)','be197960fddd2fc53b18e6bfcf00c1dd',false,'v','jsonb','plpgsql'),
    ('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','a803c67d432b24eb74d8c242d26631e4',true,'v','jsonb','plpgsql'),
    ('public.calendar_local_hash_v2(uuid,jsonb)','665792a8a46221111a7b9121670cbe65',false,'s','text','sql'),
    ('public.current_user_can_sync_connected_account_base_v1(uuid,text)','87b109e1eb93bbcd347255f55af637e1',false,'s','boolean','sql'),
    ('public.current_user_can_sync_connected_account_v1(uuid,text)','3080b157198b77d076185c513ce0cb74',true,'s','boolean','sql'),
    ('public.current_user_can_use_calendar_admin_v1()','27bd7b911459f42a2478456fee0015b9',true,'s','boolean','sql'),
    ('public.apply_google_periodic_v1(uuid,jsonb)','fa6bf40bd8d9f446ecbd1c7cde30bd24',true,'v','jsonb','sql'),
    ('public.apply_google_history_v1(uuid,jsonb,jsonb)','ff0702a42eea49431e4355aae352f75f',true,'v','jsonb','plpgsql'),
    ('public.assert_history_context_v1(jsonb)','8b0781f2e28899b57d11c31a16b0553f',false,'v','timestamp with time zone','plpgsql'),
    ('public.user_has_provider_rollout_for_user_v1(uuid,text)','80d831fcd4a29397287059032f1afa99',false,'s','boolean','sql')) x(signature,hash,client,volatility,result,language) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or not p.prosecdef or p.proowner<>'postgres'::regrole
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility or p.proretset or p.prorettype<>r.result::regtype
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from r.client
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,case when r.client then 'authenticated'::regrole else 'postgres'::regrole end)
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: Calendar 005 body/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') then
        raise exception 'STOP: Calendar 005 inherited EXECUTE drift: %',r.signature; end if;
    end loop;
  end loop;
  foreach t in array array[to_regclass('public.calendar_sync_state_v2'),to_regclass('public.calendar_sync_runs_v2'),to_regclass('public.calendar_sync_batches_v2'),to_regclass('public.calendar_sync_stamps_v2')] loop
    if t is null or not exists(select 1 from pg_class where oid=t and relrowsecurity and relowner='postgres'::regrole)
      or exists(select 1 from pg_policy where polrelid=t)
      or exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and a.grantee<>'postgres'::regrole)
      or exists(select 1 from pg_attribute where attrelid=t and attacl is not null)
      or exists(select 1 from pg_constraint where conrelid=t and not convalidated)
      or not exists(select 1 from pg_constraint where conrelid=t and contype='p')
      or not exists(select 1 from pg_constraint where conrelid=t and contype='f' and confdeltype='c') then
      raise exception 'STOP: Calendar v2 private table drift'; end if;
  end loop;
  for r in select * from (values
    ('public.calendar_sync_state_v2','user_id:uuid:1,account_id:uuid:1,calendar_id:text:1,flow_version:integer:1,sync_token:text:0,last_success:timestamp with time zone:0,last_result:jsonb:0,active_run:uuid:0,lease_until:timestamp with time zone:0',5),
    ('public.calendar_sync_runs_v2','user_id:uuid:1,account_id:uuid:1,run_id:uuid:1,time_min:timestamp with time zone:1,time_max:timestamp with time zone:1,created_at:timestamp with time zone:1,status:text:1,created_count:integer:1,updated_count:integer:1,skipped_count:integer:1,result:jsonb:0',7),
    ('public.calendar_sync_batches_v2','user_id:uuid:1,account_id:uuid:1,run_id:uuid:1,batch_no:integer:1,payload_hash:text:1,result:jsonb:1',3),
    ('public.calendar_sync_stamps_v2','source_id:uuid:1,event_hash:text:1,provider_updated:timestamp with time zone:0,local_hash:text:1',2)) x(name,columns,checks) loop
    t:=to_regclass(r.name);
    if (select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::integer,',' order by attnum) from pg_attribute where attrelid=t and attnum>0 and not attisdropped) is distinct from r.columns
      or (select count(*) from pg_constraint where conrelid=t)<>r.checks then raise exception 'STOP: Calendar v2 column/constraint drift'; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_state_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((flow_version = 2))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_state_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((calendar_id = ''primary''::text))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_runs_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((isfinite(time_min) AND isfinite(time_max) AND (time_min < time_max)))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_runs_v2'::regclass and contype='f' and confrelid='public.calendar_sync_state_v2'::regclass and conkey=array[1,2]::smallint[] and confkey=array[1,2]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_batches_v2'::regclass and contype='f' and confrelid='public.calendar_sync_runs_v2'::regclass and conkey=array[1,2,3]::smallint[] and confkey=array[1,2,3]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_stamps_v2'::regclass and contype='f' and confrelid='public.external_interaction_sources'::regclass)
    then raise exception 'STOP: Calendar v2 scope/temporal/FK drift'; end if;
end $contract$;

do $data$
begin
  if exists(select 1 from public.external_interaction_sources s
    left join public.interactions i on i.id=s.interaction_id
    left join public.connected_accounts a on a.id=s.connected_account_id
    where lower(btrim(s.provider))='google' and lower(btrim(s.source_service)) in ('gmail','calendar') and (
      s.provider<>'google' or s.source_service<>lower(btrim(s.source_service))
      or btrim(s.external_id)='' or s.external_id<>btrim(s.external_id)
      or i.id is null or i.user_id is distinct from s.user_id or i.provider is distinct from 'google'
      or i.provider_event_id is distinct from s.external_id
      or i.interaction_type is distinct from case s.source_service when 'gmail' then 'email' else 'calendar' end
      or coalesce(nullif(s.external_object_type,''),case s.source_service when 'gmail' then 'email_message' else 'calendar_event' end)
        <>case s.source_service when 'gmail' then 'email_message' else 'calendar_event' end
      or (i.metadata->>'external_source_service' is not null and i.metadata->>'external_source_service'<>s.source_service)
      or a.user_id is distinct from s.user_id or a.provider is distinct from 'google'
      or (s.source_service='gmail' and left(lower(s.external_id),9)='calendar_')))
    or exists(select 1 from public.external_interaction_sources s join public.external_interaction_sources x
      on x.interaction_id=s.interaction_id and x.id<>s.id
      where s.provider='google' and s.source_service in ('gmail','calendar'))
    or exists(select 1 from public.external_interaction_sources s where s.provider='google'
      group by s.user_id,lower(s.external_id) having count(*)>1)
    or exists(select 1 from public.interactions i where i.provider='google' and i.provider_event_id is not null
      group by i.user_id,lower(i.provider_event_id) having count(*)>1)
    or exists(select 1 from public.interactions i join public.external_interaction_sources s
      on s.user_id=i.user_id and s.provider='google' and lower(s.external_id)=lower(i.provider_event_id)
      where i.provider='google' and (s.interaction_id<>i.id or s.external_id<>i.provider_event_id))
  then raise exception 'STOP: Google cross-resource identity/source ambiguity; owner review required'; end if;
end $data$;

create or replace function public.apply_google_interaction_sync_internal_v2(
  p_connected_account_id uuid,
  p_item jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created boolean := false;
  v_user_id uuid := auth.uid();
  v_source public.external_interaction_sources%rowtype;
  v_interaction_id uuid;
  v_source_id uuid;
  v_source_service text := lower(btrim(coalesce(p_item->>'sourceService', '')));
  v_operation text;
  v_interaction_type text := lower(btrim(coalesce(p_item->>'interactionType', '')));
  v_direction text := lower(btrim(coalesce(p_item->>'direction', 'unknown')));
  v_external_id text := btrim(coalesce(p_item->>'externalId', ''));
  v_participant jsonb;
  v_contact_id uuid;
  v_email text;
  v_role text;
  v_participants_inserted integer := 0;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authenticated user is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_item) is distinct from 'object' or v_external_id = '' then
    raise exception 'GOOGLE_SYNC_INVALID_ITEM';
  end if;
  if v_source_service = 'gmail' then
    v_operation := 'email';
  elsif v_source_service = 'calendar' then
    v_operation := 'calendar';
  else
    raise exception 'GOOGLE_SYNC_INVALID_SOURCE_SERVICE';
  end if;
  if (v_operation = 'email' and v_interaction_type <> 'email')
     or (v_operation = 'calendar' and v_interaction_type <> 'calendar') then
    raise exception 'GOOGLE_SYNC_INVALID_INTERACTION_TYPE';
  end if;
  if v_direction not in ('inbound', 'outbound', 'internal', 'unknown') then
    raise exception 'GOOGLE_SYNC_INVALID_DIRECTION';
  end if;
  if not public.current_user_can_sync_connected_account_v1(p_connected_account_id, v_operation) then
    raise exception 'GOOGLE_CONNECTED_SYNC_DENIED' using errcode = '42501';
  end if;


  -- One cross-resource lock per user, before identity/row locks. The v2 entry
  -- acquires the same lock before its account/state locks; payloads cannot opt out.
  perform pg_advisory_xact_lock(hashtext(v_user_id::text),hashtext('google-write-boundary-v2'));
  if (v_source_service='gmail' and (left(lower(v_external_id),9)='calendar_'
      or lower(coalesce(p_item->>'source','')) like '%calendar%'
      or coalesce(nullif(p_item->>'externalObjectType',''),'email_message')<>'email_message'))
    or (v_source_service='calendar' and coalesce(p_item->>'externalObjectType','')<>'calendar_event') then
    raise exception 'GOOGLE_RESOURCE_IDENTITY_CONFLICT' using errcode='22023';
  end if;
  -- Lock all aliases and every source attached to a candidate interaction,
  -- including inactive sources. An old/ambiguous alias is never reassigned.
  perform 1 from public.external_interaction_sources s
    where (s.user_id=v_user_id and s.provider='google' and lower(s.external_id)=lower(v_external_id))
      or s.interaction_id in (select i.id from public.interactions i where i.user_id=v_user_id
        and i.provider='google' and lower(i.provider_event_id)=lower(v_external_id))
    order by s.id for update;
  perform 1 from public.interactions i where
    (i.user_id=v_user_id and i.provider='google' and lower(i.provider_event_id)=lower(v_external_id))
    or i.id in (select s.interaction_id from public.external_interaction_sources s
      where s.user_id=v_user_id and s.provider='google' and lower(s.external_id)=lower(v_external_id))
    order by i.id for update;
  if (select count(*) from public.interactions i where i.user_id=v_user_id and i.provider='google'
        and lower(i.provider_event_id)=lower(v_external_id))>1
    or (select count(*) from public.external_interaction_sources s where s.user_id=v_user_id
        and s.provider='google' and lower(s.external_id)=lower(v_external_id))>1
    or exists(select 1 from public.interactions i where
      ((i.user_id=v_user_id and i.provider='google' and lower(i.provider_event_id)=lower(v_external_id))
        or i.id in (select s.interaction_id from public.external_interaction_sources s
          where s.user_id=v_user_id and s.provider='google' and lower(s.external_id)=lower(v_external_id)))
      and (i.user_id is distinct from v_user_id or i.provider is distinct from 'google'
        or i.provider_event_id is distinct from v_external_id or i.interaction_type is distinct from v_interaction_type
        or (i.metadata->>'external_source_service' is not null and i.metadata->>'external_source_service'<>v_source_service)))
    or exists(select 1 from public.external_interaction_sources s where
      ((s.user_id=v_user_id and s.provider='google' and lower(s.external_id)=lower(v_external_id))
        or s.interaction_id in (select i.id from public.interactions i where i.user_id=v_user_id
          and i.provider='google' and lower(i.provider_event_id)=lower(v_external_id)))
      and (s.user_id is distinct from v_user_id or s.provider is distinct from 'google'
        or s.source_service is distinct from v_source_service or s.external_id is distinct from v_external_id
        or coalesce(nullif(s.external_object_type,''),case v_source_service when 'gmail' then 'email_message' else 'calendar_event' end)
          <>case v_source_service when 'gmail' then 'email_message' else 'calendar_event' end
        or s.connected_account_id is distinct from p_connected_account_id))
  then raise exception 'GOOGLE_RESOURCE_IDENTITY_CONFLICT' using errcode='22023'; end if;

  -- Serialize the provider identity before resolving or creating its local row.
  -- The active-source unique index remains the final invariant, while this lock
  -- makes concurrent retries idempotent instead of surfacing a unique violation.
  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext('google-interaction:' || v_source_service || ':' || v_external_id)
  );

  -- Recheck denies after waiting for the identity lock.
  if not public.current_user_can_sync_connected_account_v1(p_connected_account_id, v_operation) then
    raise exception 'GOOGLE_CONNECTED_SYNC_DENIED' using errcode = '42501';
  end if;

  select * into v_source
  from public.external_interaction_sources source
  where source.user_id = v_user_id
    and source.provider = 'google'
    and source.source_service = v_source_service
    and source.external_id = v_external_id
    and source.is_active = true
  limit 1
  for update;

  if found and v_source.prevent_reimport then
    return jsonb_build_object(
      'status', 'skipped_prevent_reimport',
      'interaction_id', v_source.interaction_id,
      'external_source_id', v_source.id,
      'participants_inserted', 0
    );
  end if;

  v_interaction_id := v_source.interaction_id;
  if v_interaction_id is null then
    select interaction.id into v_interaction_id
    from public.interactions interaction
    where interaction.user_id = v_user_id
      and interaction.provider = 'google'
      and interaction.provider_event_id = v_external_id
    order by interaction.created_at asc, interaction.id::text asc
    limit 1
    for update;
  end if;

  if v_interaction_id is null then
    v_created := true;
    insert into public.interactions (
      user_id, provider, provider_event_id, provider_thread_id, interaction_type,
      direction, occurred_at, subject, source_detail, user_notes_raw, metadata
    ) values (
      v_user_id,
      'google',
      v_external_id,
      nullif(btrim(p_item->>'externalThreadId'), ''),
      v_interaction_type,
      v_direction,
      nullif(p_item->>'occurredAt', '')::timestamptz,
      nullif(btrim(p_item->>'subject'), ''),
      nullif(p_item->>'sourceDetail', ''),
      coalesce(p_item->>'sourceDetail', ''),
      jsonb_build_object(
        'source', coalesce(nullif(btrim(p_item->>'source'), ''), 'external_interaction_sync'),
        'external_provider', 'google',
        'external_source_service', v_source_service
      )
    ) returning id into v_interaction_id;
  else
    update public.interactions interaction
    set provider = 'google',
        provider_event_id = v_external_id,
        provider_thread_id = nullif(btrim(p_item->>'externalThreadId'), ''),
        interaction_type = v_interaction_type,
        direction = v_direction,
        occurred_at = nullif(p_item->>'occurredAt', '')::timestamptz,
        subject = nullif(btrim(p_item->>'subject'), ''),
        source_detail = nullif(p_item->>'sourceDetail', '')
    where interaction.id = v_interaction_id
      and interaction.user_id = v_user_id;
    if not found then
      raise exception 'GOOGLE_SYNC_INTERACTION_OWNERSHIP_DENIED' using errcode = '42501';
    end if;
  end if;

  if v_source.id is null then
    insert into public.external_interaction_sources (
      user_id, interaction_id, connected_account_id, provider, source_service,
      external_object_type, external_id, external_thread_id, external_url,
      source_subject, source_detail, content_hash, sync_status, is_active,
      last_seen_at, last_synced_at, metadata
    ) values (
      v_user_id, v_interaction_id, p_connected_account_id, 'google', v_source_service,
      btrim(coalesce(p_item->>'externalObjectType', '')), v_external_id,
      nullif(btrim(p_item->>'externalThreadId'), ''), nullif(btrim(p_item->>'externalUrl'), ''),
      nullif(btrim(p_item->>'subject'), ''), nullif(p_item->>'sourceDetail', ''),
      nullif(btrim(p_item->>'contentHash'), ''), 'synced', true,
      nullif(p_item->>'occurredAt', '')::timestamptz, v_now,
      coalesce(p_item->'metadata', '{}'::jsonb)
    ) returning id into v_source_id;
  else
    update public.external_interaction_sources source
    set interaction_id = v_interaction_id,
        connected_account_id = p_connected_account_id,
        external_object_type = btrim(coalesce(p_item->>'externalObjectType', '')),
        external_thread_id = nullif(btrim(p_item->>'externalThreadId'), ''),
        external_url = nullif(btrim(p_item->>'externalUrl'), ''),
        source_subject = nullif(btrim(p_item->>'subject'), ''),
        source_detail = nullif(p_item->>'sourceDetail', ''),
        content_hash = nullif(btrim(p_item->>'contentHash'), ''),
        sync_status = 'synced',
        is_active = true,
        last_seen_at = nullif(p_item->>'occurredAt', '')::timestamptz,
        last_synced_at = v_now,
        metadata = coalesce(p_item->'metadata', '{}'::jsonb)
    where source.id = v_source.id
      and source.user_id = v_user_id
    returning id into v_source_id;
  end if;

  for v_participant in
    select value from jsonb_array_elements(coalesce(p_item->'participants', '[]'::jsonb))
  loop
    v_contact_id := nullif(v_participant->>'contactId', '')::uuid;
    v_email := nullif(lower(btrim(v_participant->>'email')), '');
    v_role := nullif(upper(btrim(v_participant->>'role')), '');
    if v_contact_id is not null and not exists (
      select 1 from public.contacts contact
      where contact.id = v_contact_id and contact.user_id = v_user_id
    ) then
      raise exception 'GOOGLE_SYNC_PARTICIPANT_OWNERSHIP_DENIED' using errcode = '42501';
    end if;
    if (v_contact_id is not null or v_email is not null) and not exists (
      select 1 from public.interaction_participants participant
      where participant.user_id = v_user_id
        and participant.interaction_id = v_interaction_id
        and participant.contact_id is not distinct from v_contact_id
        and lower(coalesce(participant.email_identity, '')) = coalesce(v_email, '')
        and upper(coalesce(participant.role, '')) = coalesce(v_role, '')
    ) then
      insert into public.interaction_participants (
        user_id, interaction_id, contact_id, email_identity, role
      ) values (v_user_id, v_interaction_id, v_contact_id, v_email, v_role);
      v_participants_inserted := v_participants_inserted + 1;
    end if;
  end loop;

  insert into public.action_invocations (
    user_id, action_name, actor_type, status, object_type, object_id,
    input_json, output_json, requires_confirmation, executed_at
  ) values (
    v_user_id, 'interaction.sync_external', 'system', 'executed', 'interaction', v_interaction_id,
    jsonb_build_object('provider', 'google', 'source_service', v_source_service, 'external_id', v_external_id),
    jsonb_build_object('interaction_id', v_interaction_id, 'external_source_id', v_source_id, 'participants_inserted', v_participants_inserted),
    false, v_now
  );

  return jsonb_build_object(
    'status', case when v_created then 'created' else 'updated' end,
    'interaction_id', v_interaction_id,
    'external_source_id', v_source_id,
    'participants_inserted', v_participants_inserted
  );
end;
$$;

create or replace function public.apply_google_interaction_sync_v1(p_connected_account_id uuid,p_item jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_item) is distinct from 'object'
    or lower(btrim(coalesce(p_item->>'sourceService',''))) <> 'gmail'
    or lower(btrim(coalesce(p_item->>'interactionType',''))) <> 'email' then
    raise exception 'GOOGLE_LEGACY_CALENDAR_DENIED' using errcode='42501';
  end if;
  return public.apply_google_interaction_sync_internal_v2(p_connected_account_id,p_item);
end $$;

create or replace function public.apply_calendar_discovery_v1(p_account uuid,p_item jsonb)
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
  v_result:=public.apply_google_interaction_sync_internal_v2(p_account,p_item);
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

create or replace function public.calendar_manual_sync_internal_v2(p_account uuid,p_run uuid,p_action text,p_payload jsonb default '{}'::jsonb)
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
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext('google-write-boundary-v2'));
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
alter function public.apply_google_interaction_sync_internal_v2(uuid,jsonb) owner to postgres;
revoke all on function public.apply_google_interaction_sync_internal_v2(uuid,jsonb) from public,anon,authenticated,service_role,supabase_auth_admin;
-- A custom default ACL must never expose the new core between COMMIT and verifier.
do $new_acl$
declare p pg_proc%rowtype;
begin
  select * into p from pg_proc where oid='public.apply_google_interaction_sync_internal_v2(uuid,jsonb)'::regprocedure;
  if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>'postgres'::regrole)
    or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE')
    or has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')
  then raise exception 'STOP: Calendar 005 unexpected new-core default ACL'; end if;
end $new_acl$;
-- Existing wrappers retain their certified owners/ACL. No shared RPC is revoked.
commit;
