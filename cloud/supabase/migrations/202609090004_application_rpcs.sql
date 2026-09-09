-- Coffeecito PROD bootstrap: application RPCs and structural validators.

begin;

create or replace function public.validate_contact_sync_storage_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.external_contact_snapshots') is null then
    missing_or_stale := array_append(missing_or_stale, 'external_contact_snapshots table');
  end if;

  if to_regclass('public.uq_external_contact_snapshots_provider_external') is null then
    missing_or_stale := array_append(missing_or_stale, 'external contact snapshot unique index');
  end if;

  if to_regclass('public.uq_contact_emails_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact email per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_phones_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact phone per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_emails_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global email unique index still exists');
  end if;

  if to_regclass('public.uq_contact_phones_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global phone unique index still exists');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'CONTACT_SYNC_STORAGE_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;



create or replace function public.validate_headhunter_company_master_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
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

  select *
  into v_account
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
    set
      account_email = v_normalized_email,
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
      user_id,
      provider,
      account_email,
      scopes,
      capabilities,
      status,
      effective_scopes_verified_at,
      effective_scopes_verification_method
    )
    values (
      p_user_id,
      'google',
      v_normalized_email,
      v_effective_scopes,
      v_capabilities,
      'active',
      now(),
      'google_tokeninfo_userinfo_v0_1'
    )
    returning * into v_account;
  end if;

  return query
  select
    v_account.id,
    v_account.provider,
    v_account.account_email,
    v_account.scopes,
    v_account.capabilities,
    v_account.status,
    v_account.connected_at,
    v_account.revoked_at,
    v_account.updated_at;
end;
$$;

create or replace function public.disconnect_current_user_google_connected_account(p_account_id uuid)
returns table (
  id uuid,
  status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_revoked_at timestamptz;
  v_status text;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authenticated user is required';
  end if;

  if not public.current_user_has_app_access() then
    raise exception 'app access denied';
  end if;

  update public.connected_accounts account
  set
    status = 'revoked',
    revoked_at = now()
  where account.id = p_account_id
    and account.user_id = v_user_id
    and account.provider = 'google'
    and account.status <> 'revoked'
  returning account.id, account.status, account.revoked_at
  into v_account_id, v_status, v_revoked_at;

  if v_account_id is null then
    raise exception 'google connected account not found';
  end if;

  return query select v_account_id, v_status, v_revoked_at;
end;
$$;

create or replace function public.merge_contacts_deep(
  p_target_contact_id uuid,
  p_source_contact_ids uuid[],
  p_result jsonb,
  p_source text default 'contact_merge'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_source_ids uuid[] := coalesce(p_source_contact_ids, array[]::uuid[]);
  v_all_ids uuid[];
  v_emails text[];
  v_phones text[];
  v_rows integer := 0;
  v_external_ids_moved integer := 0;
  v_participants_moved integer := 0;
  v_participants_deduped integer := 0;
  v_referrals_referred_by_moved integer := 0;
  v_referrals_linked_moved integer := 0;
  v_todos_moved integer := 0;
  v_review_states_deleted integer := 0;
  v_review_states_moved integer := 0;
begin
  if v_user_id is null then
    raise exception 'No hay usuario autenticado.';
  end if;

  if not public.current_user_has_capability('contacts.manage') then
    raise exception 'El usuario actual no tiene permiso para fusionar contactos.';
  end if;

  if p_target_contact_id is null then
    raise exception 'Debe existir un contacto resultante.';
  end if;

  select coalesce(array_agg(distinct source_id), array[]::uuid[])
    into v_source_ids
  from unnest(v_source_ids) as source_items(source_id)
  where source_id is not null;

  if array_length(v_source_ids, 1) is null or array_length(v_source_ids, 1) < 1 then
    raise exception 'Debes elegir al menos un contacto origen para fusionar.';
  end if;

  if array_length(v_source_ids, 1) > 2 then
    raise exception 'Fusionar contactos acepta maximo 3 contactos en total.';
  end if;

  if p_target_contact_id = any(v_source_ids) then
    raise exception 'El contacto resultante no puede repetirse como origen.';
  end if;

  v_all_ids := array_append(v_source_ids, p_target_contact_id);

  if (
    select count(*)
    from public.contacts
    where user_id = v_user_id
      and id = any(v_all_ids)
  ) <> array_length(v_all_ids, 1) then
    raise exception 'Uno o mas contactos no existen o no pertenecen al usuario.';
  end if;

  if nullif(trim(coalesce(p_result->>'name', '')), '') is null then
    raise exception 'El nombre del contacto resultante es obligatorio.';
  end if;

  if coalesce(p_result->>'networkingStatus', 'Pendiente') not in (
    'Pendiente',
    'Contactado',
    'Agendado',
    'Cita concretada',
    'Agradecimiento enviado'
  ) then
    raise exception 'Estado networking no valido.';
  end if;

  select coalesce(array_agg(distinct lower(trim(value))), array[]::text[])
    into v_emails
  from jsonb_array_elements_text(coalesce(p_result->'emails', '[]'::jsonb)) as email_values(value)
  where trim(value) <> '';

  select coalesce(array_agg(distinct regexp_replace(trim(value), '[^0-9+]', '', 'g')), array[]::text[])
    into v_phones
  from jsonb_array_elements_text(coalesce(p_result->'phones', '[]'::jsonb)) as phone_values(value)
  where regexp_replace(trim(value), '[^0-9+]', '', 'g') <> '';

  if exists (
    select 1
    from public.contact_emails
    where user_id = v_user_id
      and normalized_email = any(v_emails)
      and not (contact_id = any(v_all_ids))
  ) then
    raise exception 'Uno de los correos seleccionados ya pertenece a otro contacto.';
  end if;

  if exists (
    select 1
    from public.contact_phones
    where user_id = v_user_id
      and normalized_phone = any(v_phones)
      and not (contact_id = any(v_all_ids))
  ) then
    raise exception 'Uno de los telefonos seleccionados ya pertenece a otro contacto.';
  end if;

  update public.contacts
     set display_name = trim(p_result->>'name'),
         company = trim(coalesce(p_result->>'company', '')),
         role = trim(coalesce(p_result->>'role', '')),
         networking_status = coalesce(p_result->>'networkingStatus', 'Pendiente'),
         networking_focus = coalesce((p_result->>'focus')::boolean, true),
         is_headhunter = coalesce((p_result->>'headhunter')::boolean, false),
         sync_status = 'merged_result',
         updated_at = v_now
   where user_id = v_user_id
     and id = p_target_contact_id;

  delete from public.contact_emails
   where user_id = v_user_id
     and contact_id = any(v_all_ids)
     and not (normalized_email = any(v_emails));

  insert into public.contact_emails (
    user_id,
    contact_id,
    email,
    normalized_email,
    domain,
    is_primary,
    source
  )
  select
    v_user_id,
    p_target_contact_id,
    email_value,
    email_value,
    substring(email_value from '@.*$'),
    ordinality = 1,
    'app'
  from unnest(v_emails) with ordinality as email_item(email_value, ordinality)
  on conflict (user_id, contact_id, normalized_email)
  do update set
    email = excluded.email,
    domain = excluded.domain,
    is_primary = excluded.is_primary,
    source = excluded.source,
    updated_at = v_now;

  delete from public.contact_phones
   where user_id = v_user_id
     and contact_id = any(v_all_ids)
     and not (normalized_phone = any(v_phones));

  insert into public.contact_phones (
    user_id,
    contact_id,
    phone,
    normalized_phone,
    normalized_phone_last8,
    is_primary,
    source
  )
  select
    v_user_id,
    p_target_contact_id,
    phone_value,
    phone_value,
    right(phone_value, 8),
    ordinality = 1,
    'app'
  from unnest(v_phones) with ordinality as phone_item(phone_value, ordinality)
  on conflict (user_id, contact_id, normalized_phone)
  do update set
    phone = excluded.phone,
    normalized_phone_last8 = excluded.normalized_phone_last8,
    is_primary = excluded.is_primary,
    source = excluded.source,
    updated_at = v_now;

  update public.external_contact_ids
     set contact_id = p_target_contact_id,
         is_active = true,
         updated_at = v_now
   where user_id = v_user_id
     and contact_id = any(v_source_ids);
  get diagnostics v_external_ids_moved = row_count;

  update public.interaction_participants
     set contact_id = p_target_contact_id
   where user_id = v_user_id
     and contact_id = any(v_source_ids);
  get diagnostics v_participants_moved = row_count;

  with ranked as (
    select
      id,
      row_number() over (
        partition by user_id, interaction_id, contact_id, coalesce(email_identity, ''), coalesce(role, '')
        order by created_at, id
      ) as rn
    from public.interaction_participants
    where user_id = v_user_id
      and contact_id = p_target_contact_id
  )
  delete from public.interaction_participants ip
  using ranked r
  where ip.id = r.id
    and ip.user_id = v_user_id
    and r.rn > 1;
  get diagnostics v_participants_deduped = row_count;

  update public.referrals
     set referred_by_contact_id = p_target_contact_id,
         updated_at = v_now
   where user_id = v_user_id
     and referred_by_contact_id = any(v_source_ids);
  get diagnostics v_referrals_referred_by_moved = row_count;

  update public.referrals
     set linked_contact_id = p_target_contact_id,
         updated_at = v_now
   where user_id = v_user_id
     and linked_contact_id = any(v_source_ids);
  get diagnostics v_referrals_linked_moved = row_count;

  update public.todos
     set object_id = p_target_contact_id,
         updated_at = v_now
   where user_id = v_user_id
     and object_type = 'contact'
     and object_id = any(v_source_ids);
  get diagnostics v_todos_moved = row_count;

  with ranked_assignments as (
    select
      assignment.id,
      row_number() over (
        partition by assignment.objective_id
        order by
          case when assignment.contact_id = p_target_contact_id then 0 else 1 end,
          assignment.assigned_at,
          assignment.id
      ) as rn
    from public.contact_objective_assignments assignment
    where assignment.user_id = v_user_id
      and assignment.contact_id = any(v_all_ids)
  )
  delete from public.contact_objective_assignments assignment
  using ranked_assignments ranked
  where assignment.id = ranked.id
    and assignment.user_id = v_user_id
    and ranked.rn > 1;

  update public.contact_objective_assignments
     set contact_id = p_target_contact_id,
         updated_at = v_now
   where user_id = v_user_id
     and contact_id = any(v_source_ids);

  with ranked_review_states as (
    select
      review_state.id,
      row_number() over (
        partition by review_state.processor_id, review_state.object_type
        order by
          case when review_state.object_id = p_target_contact_id then 0 else 1 end,
          review_state.last_reviewed_at desc nulls last,
          review_state.created_at,
          review_state.id
      ) as rn
    from public.object_review_state review_state
    where review_state.user_id = v_user_id
      and review_state.object_type = 'contact'
      and review_state.object_id = any(v_all_ids)
  )
  delete from public.object_review_state review_state
  using ranked_review_states ranked
  where review_state.id = ranked.id
    and review_state.user_id = v_user_id
    and ranked.rn > 1;
  get diagnostics v_review_states_deleted = row_count;

  update public.object_review_state
     set object_id = p_target_contact_id,
         updated_at = v_now
   where user_id = v_user_id
     and object_type = 'contact'
     and object_id = any(v_source_ids);
  get diagnostics v_review_states_moved = row_count;

  update public.contacts
     set is_active = false,
         sync_status = 'merged_into_contact',
         updated_at = v_now
   where user_id = v_user_id
     and id = any(v_source_ids);

  insert into public.action_invocations (
    user_id,
    action_name,
    actor_type,
    status,
    object_type,
    object_id,
    input_json,
    output_json,
    requires_confirmation,
    confirmed_at,
    executed_at
  )
  values (
    v_user_id,
    'contact.merge_deep',
    'user',
    'executed',
    'contact',
    p_target_contact_id,
    jsonb_build_object(
      'target_contact_id', p_target_contact_id,
      'source_contact_ids', v_source_ids,
      'result', p_result,
      'source', p_source
    ),
    jsonb_build_object(
      'target_contact_id', p_target_contact_id,
      'source_contact_ids', v_source_ids,
      'external_ids_moved', v_external_ids_moved,
      'participants_moved', v_participants_moved,
      'participants_deduped', v_participants_deduped,
      'referrals_referred_by_moved', v_referrals_referred_by_moved,
      'referrals_linked_moved', v_referrals_linked_moved,
      'todos_moved', v_todos_moved,
      'review_states_deleted', v_review_states_deleted,
      'review_states_moved', v_review_states_moved
    ),
    true,
    v_now,
    v_now
  );

  insert into public.audit_log (
    user_id,
    actor,
    action,
    object_type,
    object_id,
    before_json,
    after_json
  )
  values (
    v_user_id,
    'user',
    'contact.merge_deep',
    'contact',
    p_target_contact_id,
    jsonb_build_object('source_contact_ids', v_source_ids),
    jsonb_build_object(
      'target_contact_id', p_target_contact_id,
      'result', p_result,
      'external_ids_moved', v_external_ids_moved,
      'participants_moved', v_participants_moved,
      'participants_deduped', v_participants_deduped,
      'referrals_referred_by_moved', v_referrals_referred_by_moved,
      'referrals_linked_moved', v_referrals_linked_moved,
      'todos_moved', v_todos_moved,
      'review_states_deleted', v_review_states_deleted,
      'review_states_moved', v_review_states_moved
    )
  );

  return jsonb_build_object(
    'targetContactId', p_target_contact_id,
    'sourceContactIds', v_source_ids,
    'externalIdsMoved', v_external_ids_moved,
    'participantsMoved', v_participants_moved,
    'participantsDeduped', v_participants_deduped,
    'referralsReferredByMoved', v_referrals_referred_by_moved,
    'referralsLinkedMoved', v_referrals_linked_moved,
    'todosMoved', v_todos_moved,
    'reviewStatesDeleted', v_review_states_deleted,
    'reviewStatesMoved', v_review_states_moved
  );
end;
$$;

create or replace function public.reset_current_user_app_data_v0_1(p_confirmation text)
returns table (
  deleted_table_name text,
  deleted_row_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  table_to_delete text;
  deleted_count integer;
  tables_in_delete_order text[] := array[
    'metric_snapshots',
    'usage_events',
    'usage_limits',
    'data_exports',
    'import_batches',
    'sync_change_suppressions',
    'sync_run_logs',
    'sync_cursors',
    'external_interaction_read_diagnostics',
    'object_review_state',
    'action_invocations',
    'todos',
    'todo_configs',
    'referrals',
    'contact_objective_assignments',
    'objectives',
    'external_interaction_sources',
    'interaction_participants',
    'interactions',
    'contact_emails',
    'contact_phones',
    'external_contact_snapshots',
    'external_contact_ids',
    'contacts',
    'connected_accounts',
    'user_settings',
    'audit_log'
  ];
begin
  if target_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  if p_confirmation <> 'BORRAR MIS DATOS' then
    raise exception 'Invalid confirmation phrase.';
  end if;

  if not public.current_user_has_capability('data.delete_account') then
    raise exception 'Current user does not have permission to reset app data.';
  end if;

  foreach table_to_delete in array tables_in_delete_order loop
    if to_regclass(format('public.%I', table_to_delete)) is null then
      deleted_table_name := table_to_delete;
      deleted_row_count := 0;
      return next;
    else
      if not exists (
        select 1
        from information_schema.columns column_definition
        where column_definition.table_schema = 'public'
          and column_definition.table_name = table_to_delete
          and column_definition.column_name = 'user_id'
      ) then
        raise exception 'Reset table % exists but does not have user_id column.', table_to_delete;
      end if;

      execute format('delete from public.%I where user_id = $1', table_to_delete)
      using target_user_id;
      get diagnostics deleted_count = row_count;
      deleted_table_name := table_to_delete;
      deleted_row_count := deleted_count;
      return next;
    end if;
  end loop;
end;
$$;

alter function public.validate_contact_sync_storage_v0_1() owner to postgres;
alter function public.validate_headhunter_company_master_v0_1() owner to postgres;
alter function public.finalize_google_connected_account_verified(uuid, text, text[]) owner to postgres;
alter function public.disconnect_current_user_google_connected_account(uuid) owner to postgres;
alter function public.merge_contacts_deep(uuid, uuid[], jsonb, text) owner to postgres;
alter function public.reset_current_user_app_data_v0_1(text) owner to postgres;

commit;
