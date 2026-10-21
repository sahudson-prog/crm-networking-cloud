-- SEC-GOOGLE-01 expand phase: provider rollout, operation capabilities and
-- transactional Google writes. Direct legacy writes are removed only by the
-- later contract migration after the compatible runtime is deployed.

begin;

insert into public.app_capabilities (capability_code, display_name, capability_area, description)
values
  ('connectors.google.use', 'Usar conector Google', 'connectors', 'Elegibilidad temporal de rollout para autorizar y usar Google Connected Account.'),
  ('contacts.sync_external', 'Sincronizar contactos externos', 'contacts', 'Leer y aplicar cambios de contactos desde un proveedor conectado autorizado.'),
  ('interactions.sync_email', 'Sincronizar email externo', 'interactions', 'Leer y aplicar actividad de email desde un proveedor conectado autorizado.'),
  ('interactions.sync_calendar', 'Sincronizar calendario externo', 'interactions', 'Leer y aplicar actividad de calendario desde un proveedor conectado autorizado.')
on conflict (capability_code) do update
set display_name = excluded.display_name,
    capability_area = excluded.capability_area,
    description = excluded.description,
    is_active = true;

-- Initial rollout is intentionally role-bound. Existing role assignments, plans
-- and user access profiles remain untouched; no user backfill is performed.
insert into public.app_role_capabilities (role_code, capability_code)
select 'beta_tester', capability_code
from (values
  ('connectors.google.use'),
  ('contacts.sync_external'),
  ('interactions.sync_email'),
  ('interactions.sync_calendar')
) rollout(capability_code)
where exists (select 1 from public.app_roles role where role.role_code = 'beta_tester')
on conflict (role_code, capability_code) do nothing;

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
    );
$$;

create or replace function public.current_user_can_start_connected_oauth_v1(p_provider text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_provider_rollout_for_user_v1(auth.uid(), p_provider);
$$;

create or replace function public.current_user_can_sync_connected_account_v1(
  p_connected_account_id uuid,
  p_operation text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with requested_operation as (
    select case lower(btrim(coalesce(p_operation, '')))
      when 'contacts' then 'contacts.sync_external'
      when 'email' then 'interactions.sync_email'
      when 'calendar' then 'interactions.sync_calendar'
      else null
    end as capability_code,
    case lower(btrim(coalesce(p_operation, '')))
      when 'contacts' then 'contacts_read'
      when 'email' then 'gmail_read'
      when 'calendar' then 'calendar_read'
      else null
    end as provider_capability
  )
  select exists (
    select 1
    from public.connected_accounts account
    cross join requested_operation operation
    where account.id = p_connected_account_id
      and account.user_id = auth.uid()
      and account.provider = 'google'
      and account.status = 'active'
      and account.revoked_at is null
      and operation.capability_code is not null
      and exists (
        select 1
        from public.app_capabilities capability
        where capability.capability_code = operation.capability_code
          and capability.is_active = true
      )
      and coalesce((account.capabilities ->> operation.provider_capability)::boolean, false)
      and public.user_has_provider_rollout_for_user_v1(auth.uid(), account.provider)
      and public.user_has_capability_for_user(auth.uid(), operation.capability_code)
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
    'https://www.googleapis.com/auth/calendar.readonly'
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
$$;

create or replace function public.apply_google_contact_sync_change_v1(
  p_connected_account_id uuid,
  p_change jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_change_type text := lower(btrim(coalesce(p_change->>'changeType', '')));
  v_contact_id uuid := nullif(p_change->>'contactId', '')::uuid;
  v_contact jsonb := coalesce(p_change->'contact', '{}'::jsonb);
  v_item jsonb;
  v_external_id text;
  v_external_ids_count integer := 0;
  v_existing_contact_id uuid;
  v_existing_contact_count integer := 0;
  v_email text;
  v_phone text;
  v_source_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'authenticated user is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_change) <> 'object'
     or v_change_type not in ('new', 'duplicate_complex', 'modified', 'consolidation', 'deleted', 'deactivated') then
    raise exception 'GOOGLE_SYNC_INVALID_CONTACT_CHANGE';
  end if;
  if not public.current_user_can_sync_connected_account_v1(p_connected_account_id, 'contacts') then
    raise exception 'GOOGLE_CONNECTED_SYNC_DENIED' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_change->'externalIds', '[]'::jsonb)) <> 'array' then
    raise exception 'GOOGLE_SYNC_INVALID_EXTERNAL_IDS';
  end if;

  for v_external_id in
    select btrim(coalesce(item.value->>'externalId', ''))
    from jsonb_array_elements(coalesce(p_change->'externalIds', '[]'::jsonb)) item(value)
    order by btrim(coalesce(item.value->>'externalId', ''))
  loop
    if v_external_id = '' then
      raise exception 'GOOGLE_SYNC_EXTERNAL_ID_REQUIRED';
    end if;
    v_external_ids_count := v_external_ids_count + 1;
    perform pg_advisory_xact_lock(
      hashtext(v_user_id::text),
      hashtext('google-contact:' || v_external_id)
    );
  end loop;

  if v_change_type in ('new', 'duplicate_complex') and v_external_ids_count = 0 then
    raise exception 'GOOGLE_SYNC_EXTERNAL_ID_REQUIRED';
  end if;

  select count(distinct external_id.contact_id), min(external_id.contact_id::text)::uuid
  into v_existing_contact_count, v_existing_contact_id
  from public.external_contact_ids external_id
  where external_id.user_id = v_user_id
    and external_id.provider = 'google'
    and external_id.external_id in (
      select btrim(item.value->>'externalId')
      from jsonb_array_elements(coalesce(p_change->'externalIds', '[]'::jsonb)) item(value)
    );

  if v_existing_contact_count > 1 then
    raise exception 'GOOGLE_SYNC_EXTERNAL_IDS_CONFLICT';
  end if;

  if v_change_type in ('new', 'duplicate_complex') then
    if v_existing_contact_id is null then
      insert into public.contacts (
        user_id, display_name, company, role, networking_status,
        networking_focus, is_headhunter, is_active, sync_status
      ) values (
        v_user_id,
        coalesce(nullif(btrim(v_contact->>'displayName'), ''), 'Contacto Google'),
        coalesce(btrim(v_contact->>'company'), ''),
        coalesce(btrim(v_contact->>'role'), ''),
        coalesce(nullif(btrim(v_contact->>'networkingStatus'), ''), 'Pendiente'),
        coalesce((v_contact->>'networkingFocus')::boolean, false),
        coalesce((v_contact->>'isHeadhunter')::boolean, false),
        true,
        'synced'
      ) returning id into v_contact_id;
    else
      v_contact_id := v_existing_contact_id;
      update public.contacts contact
      set display_name = coalesce(nullif(btrim(v_contact->>'displayName'), ''), contact.display_name),
          company = coalesce(v_contact->>'company', contact.company),
          role = coalesce(v_contact->>'role', contact.role),
          networking_status = coalesce(nullif(btrim(v_contact->>'networkingStatus'), ''), contact.networking_status),
          networking_focus = coalesce((v_contact->>'networkingFocus')::boolean, contact.networking_focus),
          is_headhunter = coalesce((v_contact->>'isHeadhunter')::boolean, contact.is_headhunter),
          is_active = true,
          sync_status = 'synced'
      where contact.id = v_contact_id
        and contact.user_id = v_user_id;
      if not found then
        raise exception 'GOOGLE_SYNC_CONTACT_OWNERSHIP_DENIED' using errcode = '42501';
      end if;
    end if;
  else
    if v_contact_id is null or not exists (
      select 1 from public.contacts contact
      where contact.id = v_contact_id and contact.user_id = v_user_id
    ) then
      raise exception 'GOOGLE_SYNC_CONTACT_OWNERSHIP_DENIED' using errcode = '42501';
    end if;

    if v_change_type in ('deleted', 'deactivated') then
      update public.contacts contact
      set is_active = false, sync_status = 'missing_from_source'
      where contact.id = v_contact_id and contact.user_id = v_user_id;
    elsif jsonb_array_length(coalesce(p_change->'mergeSourceContactIds', '[]'::jsonb)) > 0 then
      select array_agg(value::uuid) into v_source_ids
      from jsonb_array_elements_text(p_change->'mergeSourceContactIds') source(value);
      perform public.merge_contacts_deep(
        v_contact_id,
        v_source_ids,
        coalesce(p_change->'mergeResult', '{}'::jsonb),
        'sync.contacts.apply_preview'
      );
    else
      update public.contacts contact
      set display_name = case when v_contact ? 'displayName' then btrim(v_contact->>'displayName') else contact.display_name end,
          company = case when v_contact ? 'company' then btrim(v_contact->>'company') else contact.company end,
          role = case when v_contact ? 'role' then btrim(v_contact->>'role') else contact.role end,
          networking_status = case when v_contact ? 'networkingStatus' then btrim(v_contact->>'networkingStatus') else contact.networking_status end,
          networking_focus = case when v_contact ? 'networkingFocus' then (v_contact->>'networkingFocus')::boolean else contact.networking_focus end,
          is_headhunter = case when v_contact ? 'isHeadhunter' then (v_contact->>'isHeadhunter')::boolean else contact.is_headhunter end,
          sync_status = 'synced'
      where contact.id = v_contact_id and contact.user_id = v_user_id;
    end if;
  end if;

  if v_change_type not in ('deleted', 'deactivated')
     and coalesce(array_length(v_source_ids, 1), 0) = 0 then
    for v_item in select value from jsonb_array_elements(coalesce(p_change->'emails', '[]'::jsonb)) loop
      v_email := lower(btrim(coalesce(v_item->>'value', '')));
      if v_email = '' then continue; end if;
      if v_item->>'operation' = 'remove' then
        delete from public.contact_emails
        where user_id = v_user_id and contact_id = v_contact_id
          and normalized_email = v_email and source = 'google';
      else
        insert into public.contact_emails (
          user_id, contact_id, email, normalized_email, domain, is_primary, source
        ) values (
          v_user_id, v_contact_id, v_email, v_email,
          nullif(substring(v_email from '@.*$'), '@'), false, 'google'
        ) on conflict (user_id, contact_id, normalized_email) do update
        set email = excluded.email, domain = excluded.domain, source = 'google';
      end if;
    end loop;

    for v_item in select value from jsonb_array_elements(coalesce(p_change->'phones', '[]'::jsonb)) loop
      v_phone := regexp_replace(btrim(coalesce(v_item->>'value', '')), '[^0-9+]', '', 'g');
      if v_phone = '' then continue; end if;
      if v_item->>'operation' = 'remove' then
        delete from public.contact_phones
        where user_id = v_user_id and contact_id = v_contact_id
          and normalized_phone = v_phone and source = 'google';
      else
        insert into public.contact_phones (
          user_id, contact_id, phone, normalized_phone, normalized_phone_last8, is_primary, source
        ) values (
          v_user_id, v_contact_id, btrim(v_item->>'value'), v_phone, right(v_phone, 8), false, 'google'
        ) on conflict (user_id, contact_id, normalized_phone) do update
        set phone = excluded.phone, normalized_phone_last8 = excluded.normalized_phone_last8, source = 'google';
      end if;
    end loop;
  end if;

  if v_change_type not in ('deleted', 'deactivated') then
    for v_item in select value from jsonb_array_elements(coalesce(p_change->'externalIds', '[]'::jsonb)) loop
      v_external_id := btrim(coalesce(v_item->>'externalId', ''));
      if v_external_id = '' then raise exception 'GOOGLE_SYNC_EXTERNAL_ID_REQUIRED'; end if;
      insert into public.external_contact_ids (
        user_id, contact_id, connected_account_id, provider, external_id,
        is_active, last_seen_at, metadata
      ) values (
        v_user_id, v_contact_id, p_connected_account_id, 'google', v_external_id,
        true, now(), coalesce(v_item->'metadata', '{}'::jsonb)
      ) on conflict (user_id, provider, external_id) do update
      set contact_id = excluded.contact_id,
          connected_account_id = excluded.connected_account_id,
          is_active = true,
          last_seen_at = excluded.last_seen_at,
          metadata = excluded.metadata;
    end loop;

    for v_item in select value from jsonb_array_elements(coalesce(p_change->'snapshots', '[]'::jsonb)) loop
      v_external_id := btrim(coalesce(v_item->>'externalId', ''));
      if v_external_id = '' then raise exception 'GOOGLE_SYNC_EXTERNAL_ID_REQUIRED'; end if;
      insert into public.external_contact_snapshots (
        user_id, connected_account_id, provider, external_id, display_name,
        company, role, emails, phones, birthdays, metadata, content_hash,
        is_deleted, last_seen_at
      ) values (
        v_user_id, p_connected_account_id, 'google', v_external_id,
        coalesce(v_item->>'displayName', ''), coalesce(v_item->>'company', ''),
        coalesce(v_item->>'role', ''), coalesce(v_item->'emails', '[]'::jsonb),
        coalesce(v_item->'phones', '[]'::jsonb), coalesce(v_item->'birthdays', '[]'::jsonb),
        coalesce(v_item->'metadata', '{}'::jsonb), nullif(v_item->>'contentHash', ''),
        false, coalesce(nullif(v_item->>'lastSeenAt', '')::timestamptz, now())
      ) on conflict (user_id, provider, external_id) do update
      set connected_account_id = excluded.connected_account_id,
          display_name = excluded.display_name,
          company = excluded.company,
          role = excluded.role,
          emails = excluded.emails,
          phones = excluded.phones,
          birthdays = excluded.birthdays,
          metadata = excluded.metadata,
          content_hash = excluded.content_hash,
          is_deleted = false,
          last_seen_at = excluded.last_seen_at;
    end loop;
  end if;

  insert into public.audit_log (
    user_id, actor, action, object_type, object_id, before_json, after_json
  ) values (
    v_user_id, 'user', 'sync.contacts.apply_preview', 'contact', v_contact_id,
    jsonb_build_object('preview_change_id', p_change->>'changeId', 'preview_change_type', v_change_type),
    jsonb_build_object('provider', 'google')
  );

  return v_contact_id;
end;
$$;

alter function public.user_has_provider_rollout_for_user_v1(uuid, text) owner to postgres;
alter function public.current_user_can_start_connected_oauth_v1(text) owner to postgres;
alter function public.current_user_can_sync_connected_account_v1(uuid, text) owner to postgres;
alter function public.finalize_google_connected_account_verified(uuid, text, text[]) owner to postgres;
alter function public.apply_google_interaction_sync_v1(uuid, jsonb) owner to postgres;
alter function public.apply_google_contact_sync_change_v1(uuid, jsonb) owner to postgres;

-- connected_accounts was already an RPC-only write surface before this rollout.
-- Reassert it here so drifted environments cannot forge scopes or capabilities.
revoke insert, update, delete on table public.connected_accounts
from PUBLIC, anon, authenticated, service_role;

revoke all on function public.user_has_provider_rollout_for_user_v1(uuid, text) from PUBLIC, anon, authenticated, service_role;
revoke all on function public.current_user_can_start_connected_oauth_v1(text) from PUBLIC, anon, service_role;
grant execute on function public.current_user_can_start_connected_oauth_v1(text) to authenticated;
revoke all on function public.current_user_can_sync_connected_account_v1(uuid, text) from PUBLIC, anon, service_role;
grant execute on function public.current_user_can_sync_connected_account_v1(uuid, text) to authenticated;

revoke all on function public.finalize_google_connected_account_verified(uuid, text, text[]) from PUBLIC, anon, authenticated;
grant execute on function public.finalize_google_connected_account_verified(uuid, text, text[]) to service_role;
revoke all on function public.apply_google_interaction_sync_v1(uuid, jsonb) from PUBLIC, anon, service_role;
grant execute on function public.apply_google_interaction_sync_v1(uuid, jsonb) to authenticated;
revoke all on function public.apply_google_contact_sync_change_v1(uuid, jsonb) from PUBLIC, anon, service_role;
grant execute on function public.apply_google_contact_sync_change_v1(uuid, jsonb) to authenticated;

commit;
