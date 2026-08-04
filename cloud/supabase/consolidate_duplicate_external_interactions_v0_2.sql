-- Consolidates app interactions that point to the same external provider object.
-- IMPORTANT: this query modifies data. Review the diagnostic output first.
--
-- What it does:
-- 1. Chooses one primary app interaction per duplicated external object.
-- 2. Copies participants from duplicate interactions into the primary interaction.
-- 3. Repoints external_interaction_sources to the primary interaction.
-- 4. Archives duplicate interactions without deleting their history.
--

-- Scope:
-- - Current user only.
-- - Only duplicate external objects whose user_notes_raw and source_detail are identical.

begin;

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
duplicate_groups as (
  select
    eis.user_id,
    eis.provider,
    eis.source_service,
    eis.external_id
  from public.external_interaction_sources eis
  join public.interactions i
    on i.user_id = eis.user_id
   and i.provider_event_id = eis.external_id
  join target_user u on u.user_id = eis.user_id
  where eis.is_active = true
  group by eis.user_id, eis.provider, eis.source_service, eis.external_id
  having count(distinct i.id) > 1
     and count(distinct encode(extensions.digest(coalesce(i.user_notes_raw, ''), 'sha256'), 'hex')) = 1
     and count(distinct encode(extensions.digest(coalesce(i.source_detail, ''), 'sha256'), 'hex')) = 1
),
ranked_interactions as (
  select
    dg.user_id,
    dg.provider,
    dg.source_service,
    dg.external_id,
    i.id as interaction_id,
    row_number() over (
      partition by dg.user_id, dg.provider, dg.source_service, dg.external_id
      order by
        (
          select count(*)
          from public.interaction_participants ip_count
          where ip_count.user_id = i.user_id
            and ip_count.interaction_id = i.id
        ) desc,
        i.occurred_at desc nulls last,
        i.id::text
    ) as suggested_rank
  from duplicate_groups dg
  join public.interactions i
    on i.user_id = dg.user_id
   and i.provider_event_id = dg.external_id
),
primary_map as (
  select
    user_id,
    provider,
    source_service,
    external_id,
    max(interaction_id::text) filter (where suggested_rank = 1)::uuid as primary_interaction_id
  from ranked_interactions
  group by user_id, provider, source_service, external_id
),
secondary_map as (
  select
    ri.user_id,
    ri.provider,
    ri.source_service,
    ri.external_id,
    ri.interaction_id as secondary_interaction_id,
    pm.primary_interaction_id
  from ranked_interactions ri
  join primary_map pm
    on pm.user_id = ri.user_id
   and pm.provider = ri.provider
   and pm.source_service = ri.source_service
   and pm.external_id = ri.external_id
  where ri.interaction_id <> pm.primary_interaction_id
),
copied_participants as (
  insert into public.interaction_participants (
    user_id,
    interaction_id,
    contact_id,
    email_identity,
    role,
    created_at
  )
  select
    ip.user_id,
    sm.primary_interaction_id,
    ip.contact_id,
    ip.email_identity,
    ip.role,
    now()
  from secondary_map sm
  join public.interaction_participants ip
    on ip.user_id = sm.user_id
   and ip.interaction_id = sm.secondary_interaction_id
  where not exists (
    select 1
    from public.interaction_participants existing
    where existing.user_id = ip.user_id
      and existing.interaction_id = sm.primary_interaction_id
      and existing.contact_id is not distinct from ip.contact_id
      and existing.email_identity is not distinct from ip.email_identity
      and existing.role is not distinct from ip.role
  )
  returning id
),
updated_external_sources as (
  update public.external_interaction_sources eis
  set
    interaction_id = pm.primary_interaction_id,
    updated_at = now(),
    metadata = coalesce(eis.metadata, '{}'::jsonb) || jsonb_build_object(
      'consolidated_at', now(),
      'consolidated_reason', 'same_external_object_multiple_app_interactions'
    )
  from primary_map pm
  where eis.user_id = pm.user_id
    and eis.provider = pm.provider
    and eis.source_service = pm.source_service
    and eis.external_id = pm.external_id
    and eis.interaction_id <> pm.primary_interaction_id
  returning eis.id
),
archived_duplicates as (
  update public.interactions i
  set
    is_deleted = true,
    deleted_at = now(),
    deleted_by = 'system:duplicate_external_interaction_consolidation',
    delete_reason = 'Consolidada en una interaccion principal del mismo objeto externo.',
    metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'deleted', true,
      'dismissed', true,
      'merged_at', now(),
      'merged_by', 'system:duplicate_external_interaction_consolidation',
      'merged_into_interaction_id', sm.primary_interaction_id,
      'merged_reason', 'same_external_object_multiple_app_interactions',
      'provider', sm.provider,
      'source_service', sm.source_service,
      'external_id', sm.external_id
    ),
    updated_at = now()
  from secondary_map sm
  where i.user_id = sm.user_id
    and i.id = sm.secondary_interaction_id
  returning i.id
)
select
  (select count(*) from primary_map) as duplicate_groups_consolidated,
  (select count(*) from copied_participants) as participants_copied_to_primary,
  (select count(*) from updated_external_sources) as external_sources_repointed,
  (select count(*) from archived_duplicates) as duplicate_interactions_archived;

commit;
