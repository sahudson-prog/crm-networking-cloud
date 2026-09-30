-- Forward-only repair for environments where the per-contact identity indexes
-- were installed but merge_contacts_deep still used the former global conflict targets.

begin;

do $contract$
declare
  incompatible_targets text[] := array[]::text[];
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'contact_emails'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 3
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_definition.indnkeyatts
      ) = array['user_id', 'contact_id', 'normalized_email']::text[]
  ) then
    incompatible_targets := array_append(
      incompatible_targets,
      'contact_emails(user_id, contact_id, normalized_email)'
    );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'contact_phones'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 3
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_definition.indnkeyatts
      ) = array['user_id', 'contact_id', 'normalized_phone']::text[]
  ) then
    incompatible_targets := array_append(
      incompatible_targets,
      'contact_phones(user_id, contact_id, normalized_phone)'
    );
  end if;

  if cardinality(incompatible_targets) > 0 then
    raise exception
      'Cannot repair merge_contacts_deep: incompatible conflict targets: %',
      array_to_string(incompatible_targets, ', ');
  end if;
end;
$contract$;

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

alter function public.merge_contacts_deep(uuid, uuid[], jsonb, text) owner to postgres;

revoke all on function public.merge_contacts_deep(uuid, uuid[], jsonb, text)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.merge_contacts_deep(uuid, uuid[], jsonb, text)
  to authenticated;

commit;
