-- Expand-only; preserve identities, ACL, legacy scope and existing rows.
-- Approved local preparation only. Run preflight/backup gate before PROD.
begin;
do $guard$
declare p record;
begin
  select * into p from pg_catalog.pg_proc where oid=to_regprocedure('public.user_has_provider_rollout_for_user_v1(uuid,text)');
  if p.oid is null or not p.prosecdef or p.proowner <> (select oid from pg_roles where rolname='postgres')
    or not coalesce(p.proconfig && array['search_path=', 'search_path=""'],false)
    or btrim(replace(p.prosrc,E'\r','')) <> btrim(replace($expected$
  with requested_capability as (
    select case lower(btrim(coalesce(p_provider, '')))
      when 'google' then 'connectors.google.use'
      else null
    end as capability_code
  ),
  active_user as (
    select p_user_id as user_id, requested_capability.capability_code
    from requested_capability
    join public.app_capabilities capability
      on capability.capability_code = requested_capability.capability_code
     and capability.is_active = true
    where p_user_id is not null
      and requested_capability.capability_code is not null
      and exists (
        select 1
        from public.app_access_status_for_user(p_user_id) access_status
        where access_status.allowed = true
      )
  ),
  denied as (
    select 1
    from public.user_capability_overrides override
    join active_user
      on active_user.user_id = override.user_id
     and active_user.capability_code = override.capability_code
    where override.override_mode = 'deny'
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  role_grant as (
    select 1
    from public.user_role_assignments assignment
    join public.app_roles role
      on role.role_code = assignment.role_code
     and role.is_active = true
    join public.app_role_capabilities role_capability
      on role_capability.role_code = assignment.role_code
    join active_user
      on active_user.user_id = assignment.user_id
     and active_user.capability_code = role_capability.capability_code
    where assignment.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    limit 1
  ),
  plan_grant as (
    select 1
    from public.user_access_profiles access_profile
    join public.subscription_plans plan
      on plan.plan_code = access_profile.plan_code
     and plan.is_active = true
    join public.subscription_plan_capabilities plan_capability
      on plan_capability.plan_code = access_profile.plan_code
    join active_user
      on active_user.user_id = access_profile.user_id
     and active_user.capability_code = plan_capability.capability_code
    where access_profile.account_status = 'active'
      and access_profile.beta_access_status = 'approved'
    limit 1
  )
  select exists(select 1 from active_user)
    and not exists(select 1 from denied)
    and (
      exists(select 1 from role_grant)
      or exists(select 1 from plan_grant)
    );
$expected$,E'\r','')) then
    raise exception 'STOP: incompatible user_has_provider_rollout_for_user_v1';
  end if;
  if has_function_privilege('anon',p.oid,'EXECUTE') or exists (
    select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE'
  ) then raise exception 'STOP: unexpected public execute user_has_provider_rollout_for_user_v1'; end if;
  select * into p from pg_catalog.pg_proc where oid=to_regprocedure('public.finalize_google_connected_account_verified(uuid,text,text[])');
  if p.oid is null or not p.prosecdef or p.proowner <> (select oid from pg_roles where rolname='postgres')
    or not coalesce(p.proconfig && array['search_path=', 'search_path=""'],false)
    or btrim(replace(p.prosrc,E'\r','')) <> btrim(replace($expected$
declare
  v_account public.connected_accounts%rowtype;
  v_capabilities jsonb;
  v_effective_scopes text[];
  v_normalized_email text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if not public.user_has_provider_rollout_for_user_v1(p_user_id, 'google') then
    raise exception 'GOOGLE_CONNECTED_ACCOUNT_ROLLOUT_DENIED' using errcode = '42501';
  end if;

  v_normalized_email := lower(btrim(coalesce(p_account_email, '')));
  if v_normalized_email = '' then
    raise exception 'account_email is required';
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    raise exception 'profile not found';
  end if;

  select coalesce(array_agg(distinct scope_value order by scope_value), array[]::text[])
  into v_effective_scopes
  from unnest(coalesce(p_effective_scopes, array[]::text[])) as scope_value
  where scope_value in (
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly'
  )
    and public.user_has_capability_for_user(
      p_user_id,
      case scope_value
        when 'https://www.googleapis.com/auth/contacts.readonly' then 'contacts.sync_external'
        when 'https://www.googleapis.com/auth/gmail.readonly' then 'interactions.sync_email'
        when 'https://www.googleapis.com/auth/calendar.readonly' then 'interactions.sync_calendar'
      end
    );

  if cardinality(v_effective_scopes) = 0 then
    raise exception 'at least one verified Google data scope is required';
  end if;

  v_capabilities := jsonb_build_object(
    'contacts_read', 'https://www.googleapis.com/auth/contacts.readonly' = any(v_effective_scopes),
    'gmail_read', 'https://www.googleapis.com/auth/gmail.readonly' = any(v_effective_scopes),
    'calendar_read', 'https://www.googleapis.com/auth/calendar.readonly' = any(v_effective_scopes)
  );

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext('google:' || v_normalized_email));

  select * into v_account
  from public.connected_accounts account
  where account.user_id = p_user_id
    and account.provider = 'google'
    and lower(btrim(account.account_email)) = v_normalized_email
    and account.revoked_at is null
    and account.status <> 'revoked'
  order by account.connected_at asc, account.id::text asc
  limit 1
  for update;

  if found then
    update public.connected_accounts account
    set account_email = v_normalized_email,
        scopes = v_effective_scopes,
        capabilities = v_capabilities,
        status = 'active',
        revoked_at = null,
        effective_scopes_verified_at = now(),
        effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    where account.id = v_account.id
    returning * into v_account;
  else
    insert into public.connected_accounts (
      user_id, provider, account_email, scopes, capabilities, status,
      effective_scopes_verified_at, effective_scopes_verification_method
    ) values (
      p_user_id, 'google', v_normalized_email, v_effective_scopes, v_capabilities, 'active',
      now(), 'google_tokeninfo_userinfo_v0_1'
    ) returning * into v_account;
  end if;

  return query select
    v_account.id, v_account.provider, v_account.account_email, v_account.scopes,
    v_account.capabilities, v_account.status, v_account.connected_at,
    v_account.revoked_at, v_account.updated_at;
end;
$expected$,E'\r','')) then
    raise exception 'STOP: incompatible finalize_google_connected_account_verified';
  end if;
  if has_function_privilege('anon',p.oid,'EXECUTE') or exists (
    select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE'
  ) then raise exception 'STOP: unexpected public execute finalize_google_connected_account_verified'; end if;
  select * into p from pg_catalog.pg_proc where oid=to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)');
  if p.oid is null or not p.prosecdef or p.proowner <> (select oid from pg_roles where rolname='postgres')
    or not coalesce(p.proconfig && array['search_path=', 'search_path=""'],false)
    or btrim(replace(p.prosrc,E'\r','')) <> btrim(replace($expected$
declare
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
  if jsonb_typeof(p_item) <> 'object' or v_external_id = '' then
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

  -- Serialize the provider identity before resolving or creating its local row.
  -- The active-source unique index remains the final invariant, while this lock
  -- makes concurrent retries idempotent instead of surfacing a unique violation.
  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext('google-interaction:' || v_source_service || ':' || v_external_id)
  );

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
    'status', case when v_source.id is null then 'created' else 'updated' end,
    'interaction_id', v_interaction_id,
    'external_source_id', v_source_id,
    'participants_inserted', v_participants_inserted
  );
end;
$expected$,E'\r','')) then
    raise exception 'STOP: incompatible apply_google_interaction_sync_v1';
  end if;
  if has_function_privilege('anon',p.oid,'EXECUTE') or exists (
    select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE'
  ) then raise exception 'STOP: unexpected public execute apply_google_interaction_sync_v1'; end if;
  if to_regprocedure('public.apply_google_periodic_v1(uuid,jsonb)') is null
    or to_regprocedure('public.apply_google_history_v1(uuid,jsonb,jsonb)') is null then
    raise exception 'STOP: UX-DATE-01 dependencies missing';
  end if;
end;
$guard$;
do $acl$
begin
  if exists (
    select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in ('public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure,
      'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure,
      'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure)
    and (a.grantee <> 'postgres'::regrole and not (
      p.oid='public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure
      and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable))
  ) or ((select mode='open' from public.r2b_rollout_gate)
    and not has_function_privilege('service_role','public.finalize_google_connected_account_verified(uuid,text,text[])','EXECUTE'))
    or not exists(select 1 from pg_class where oid='public.connected_accounts'::regclass and relrowsecurity)
    or has_table_privilege('authenticated','public.connected_accounts','INSERT,UPDATE,DELETE') then
    raise exception 'STOP: Calendar ACL/RLS drift';
  end if;
end;
$acl$;
create or replace function public.user_has_provider_rollout_for_user_v1(
  p_user_id uuid,
  p_provider text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with requested_capability as (
    select case lower(btrim(coalesce(p_provider, '')))
      when 'google' then 'connectors.google.use'
      else null
    end as capability_code
  ),
  active_user as (
    select p_user_id as user_id, requested_capability.capability_code
    from requested_capability
    join public.app_capabilities capability
      on capability.capability_code = requested_capability.capability_code
     and capability.is_active = true
    where p_user_id is not null
      and requested_capability.capability_code is not null
      and exists (
        select 1
        from public.app_access_status_for_user(p_user_id) access_status
        where access_status.allowed = true
      )
  ),
  denied as (
    select 1
    from public.user_capability_overrides override
    join active_user
      on active_user.user_id = override.user_id
     and active_user.capability_code = override.capability_code
    where override.override_mode = 'deny'
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  role_grant as (
    select 1
    from public.user_role_assignments assignment
    join public.app_roles role
      on role.role_code = assignment.role_code
     and role.is_active = true
    join public.app_role_capabilities role_capability
      on role_capability.role_code = assignment.role_code
    join active_user
      on active_user.user_id = assignment.user_id
     and active_user.capability_code = role_capability.capability_code
    where assignment.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    limit 1
  ),
  plan_grant as (
    select 1
    from public.user_access_profiles access_profile
    join public.subscription_plans plan
      on plan.plan_code = access_profile.plan_code
     and plan.is_active = true
    join public.subscription_plan_capabilities plan_capability
      on plan_capability.plan_code = access_profile.plan_code
    join active_user
      on active_user.user_id = access_profile.user_id
     and active_user.capability_code = plan_capability.capability_code
    where access_profile.account_status = 'active'
      and access_profile.beta_access_status = 'approved'
    limit 1
  )
  select exists(select 1 from active_user)
    and not exists(select 1 from denied)
    and (
      exists(select 1 from role_grant)
      or exists(select 1 from plan_grant)
      or (lower(btrim(p_provider)) = 'google'
        and public.user_has_capability_for_user(p_user_id, 'interactions.sync_calendar'))
    );
$$;

create or replace function public.finalize_google_connected_account_verified(
  p_user_id uuid,
  p_account_email text,
  p_effective_scopes text[]
)
returns table (
  id uuid,
  provider text,
  account_email text,
  scopes text[],
  capabilities jsonb,
  status text,
  connected_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.connected_accounts%rowtype;
  v_capabilities jsonb;
  v_effective_scopes text[];
  v_normalized_email text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if not public.user_has_provider_rollout_for_user_v1(p_user_id, 'google') then
    raise exception 'GOOGLE_CONNECTED_ACCOUNT_ROLLOUT_DENIED' using errcode = '42501';
  end if;

  v_normalized_email := lower(btrim(coalesce(p_account_email, '')));
  if v_normalized_email = '' then
    raise exception 'account_email is required';
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    raise exception 'profile not found';
  end if;

  select coalesce(array_agg(distinct scope_value order by scope_value), array[]::text[])
  into v_effective_scopes
  from unnest(coalesce(p_effective_scopes, array[]::text[])) as scope_value
  where scope_value in (
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events.owned.readonly'
  )
    and public.user_has_capability_for_user(
      p_user_id,
      case scope_value
        when 'https://www.googleapis.com/auth/contacts.readonly' then 'contacts.sync_external'
        when 'https://www.googleapis.com/auth/gmail.readonly' then 'interactions.sync_email'
        when 'https://www.googleapis.com/auth/calendar.events.owned.readonly' then 'interactions.sync_calendar'
        when 'https://www.googleapis.com/auth/calendar.readonly' then 'interactions.sync_calendar'
      end
    );

  if cardinality(v_effective_scopes) = 0 then
    raise exception 'at least one verified Google data scope is required';
  end if;

  v_capabilities := jsonb_build_object(
    'contacts_read', 'https://www.googleapis.com/auth/contacts.readonly' = any(v_effective_scopes),
    'gmail_read', 'https://www.googleapis.com/auth/gmail.readonly' = any(v_effective_scopes),
    'calendar_read', ('https://www.googleapis.com/auth/calendar.readonly' = any(v_effective_scopes)
      or 'https://www.googleapis.com/auth/calendar.events.owned.readonly' = any(v_effective_scopes))
  );

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext('google:' || v_normalized_email));

  select * into v_account
  from public.connected_accounts account
  where account.user_id = p_user_id
    and account.provider = 'google'
    and lower(btrim(account.account_email)) = v_normalized_email
    and account.revoked_at is null
    and account.status <> 'revoked'
  order by account.connected_at asc, account.id::text asc
  limit 1
  for update;

  if found then
    update public.connected_accounts account
    set account_email = v_normalized_email,
        scopes = v_effective_scopes,
        capabilities = v_capabilities,
        status = 'active',
        revoked_at = null,
        effective_scopes_verified_at = now(),
        effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    where account.id = v_account.id
    returning * into v_account;
  else
    insert into public.connected_accounts (
      user_id, provider, account_email, scopes, capabilities, status,
      effective_scopes_verified_at, effective_scopes_verification_method
    ) values (
      p_user_id, 'google', v_normalized_email, v_effective_scopes, v_capabilities, 'active',
      now(), 'google_tokeninfo_userinfo_v0_1'
    ) returning * into v_account;
  end if;

  return query select
    v_account.id, v_account.provider, v_account.account_email, v_account.scopes,
    v_account.capabilities, v_account.status, v_account.connected_at,
    v_account.revoked_at, v_account.updated_at;
end;
$$;

create or replace function public.apply_google_interaction_sync_v1(
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
  if jsonb_typeof(p_item) <> 'object' or v_external_id = '' then
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
commit;
