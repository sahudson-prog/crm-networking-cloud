-- Consolidates legacy imported interactions duplicated by external ID casing.
-- Purpose: one-time migration repair for the imported mirror, not product logic.
--
-- Example fixed:
-- CALENDAR__abc imported from legacy and calendar__abc synced from Google
-- are the same provider object. The synced row is kept as primary, legacy
-- notes/participants are preserved, and imported duplicate rows are hidden by
-- metadata so the app no longer shows both.

begin;

create table if not exists public.migration_backup_case_variant_external_interactions_v0_1 (
  backed_up_at timestamptz not null default now(),
  interaction_id uuid not null,
  user_id uuid not null,
  provider text,
  provider_event_id text,
  legacy_entry_id text,
  occurred_at timestamptz,
  subject text,
  source_detail text,
  user_notes_raw text,
  metadata jsonb,
  primary key (interaction_id)
);

create table if not exists public.migration_backup_case_variant_external_sources_v0_1 (
  backed_up_at timestamptz not null default now(),
  source_id uuid not null,
  user_id uuid not null,
  interaction_id uuid not null,
  provider text,
  source_service text,
  external_id text,
  sync_status text,
  is_active boolean,
  metadata jsonb,
  primary key (source_id)
);

with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
source_rows as (
  select
    eis.id as source_id,
    eis.user_id,
    eis.interaction_id,
    eis.provider,
    eis.source_service,
    eis.external_id,
    lower(eis.external_id) as external_id_key,
    eis.sync_status,
    eis.is_active,
    eis.metadata as source_metadata,
    i.provider_event_id,
    i.legacy_entry_id,
    i.occurred_at,
    i.subject,
    i.source_detail,
    i.user_notes_raw,
    i.metadata as interaction_metadata
  from public.external_interaction_sources eis
  join public.interactions i
    on i.user_id = eis.user_id
   and i.id = eis.interaction_id
  join params p on p.user_id = eis.user_id
  where eis.is_active = true
),
duplicate_groups as (
  select
    user_id,
    provider,
    source_service,
    external_id_key
  from source_rows
  group by user_id, provider, source_service, external_id_key
  having count(distinct interaction_id) > 1
),
ranked as (
  select
    sr.*,
    row_number() over (
      partition by sr.user_id, sr.provider, sr.source_service, sr.external_id_key
      order by
        case when sr.sync_status = 'synced' then 0 else 1 end,
        case when sr.legacy_entry_id is null or sr.legacy_entry_id = '' then 0 else 1 end,
        sr.occurred_at desc nulls last,
        sr.interaction_id::text
    ) as source_rank
  from source_rows sr
  join duplicate_groups dg
    on dg.user_id = sr.user_id
   and dg.provider = sr.provider
   and dg.source_service = sr.source_service
   and dg.external_id_key = sr.external_id_key
),
primary_sources as (
  select *
  from ranked
  where source_rank = 1
),
secondary_sources as (
  select
    r.*,
    ps.interaction_id as primary_interaction_id,
    ps.source_id as primary_source_id
  from ranked r
  join primary_sources ps
    on ps.user_id = r.user_id
   and ps.provider = r.provider
   and ps.source_service = r.source_service
   and ps.external_id_key = r.external_id_key
  where r.source_rank > 1
),
backup_interactions as (
  insert into public.migration_backup_case_variant_external_interactions_v0_1 (
    interaction_id,
    user_id,
    provider,
    provider_event_id,
    legacy_entry_id,
    occurred_at,
    subject,
    source_detail,
    user_notes_raw,
    metadata
  )
  select distinct
    i.id,
    i.user_id,
    i.provider,
    i.provider_event_id,
    i.legacy_entry_id,
    i.occurred_at,
    i.subject,
    i.source_detail,
    i.user_notes_raw,
    i.metadata
  from public.interactions i
  join (
    select user_id, interaction_id from primary_sources
    union
    select user_id, interaction_id from secondary_sources
  ) affected
    on affected.user_id = i.user_id
   and affected.interaction_id = i.id
  on conflict (interaction_id) do nothing
  returning interaction_id
),
backup_sources as (
  insert into public.migration_backup_case_variant_external_sources_v0_1 (
    source_id,
    user_id,
    interaction_id,
    provider,
    source_service,
    external_id,
    sync_status,
    is_active,
    metadata
  )
  select distinct
    eis.id,
    eis.user_id,
    eis.interaction_id,
    eis.provider,
    eis.source_service,
    eis.external_id,
    eis.sync_status,
    eis.is_active,
    eis.metadata
  from public.external_interaction_sources eis
  join (
    select user_id, source_id from primary_sources
    union
    select user_id, source_id from secondary_sources
  ) affected
    on affected.user_id = eis.user_id
   and affected.source_id = eis.id
  on conflict (source_id) do nothing
  returning source_id
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
    ss.primary_interaction_id,
    ip.contact_id,
    ip.email_identity,
    ip.role,
    now()
  from secondary_sources ss
  join public.interaction_participants ip
    on ip.user_id = ss.user_id
   and ip.interaction_id = ss.interaction_id
  where not exists (
    select 1
    from public.interaction_participants existing
    where existing.user_id = ip.user_id
      and existing.interaction_id = ss.primary_interaction_id
      and existing.contact_id is not distinct from ip.contact_id
      and existing.email_identity is not distinct from ip.email_identity
      and existing.role is not distinct from ip.role
  )
  returning id
),
best_legacy_notes as (
  select distinct on (ss.primary_interaction_id)
    ss.user_id,
    ss.primary_interaction_id,
    ss.user_notes_raw
  from secondary_sources ss
  where coalesce(trim(ss.user_notes_raw), '') <> ''
  order by
    ss.primary_interaction_id,
    case when ss.sync_status = 'imported' then 0 else 1 end,
    ss.occurred_at desc nulls last
),
updated_primary_interactions as (
  update public.interactions i
     set user_notes_raw = case
           when coalesce(trim(bln.user_notes_raw), '') <> ''
            and (
              coalesce(trim(i.user_notes_raw), '') = ''
              or coalesce(trim(i.user_notes_raw), '') = coalesce(trim(i.source_detail), '')
              or coalesce(i.metadata->>'source', '') = 'external_interaction_sync'
            )
           then bln.user_notes_raw
           else i.user_notes_raw
         end,
         metadata = coalesce(i.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'case_variant_external_merge_primary', true,
                'case_variant_external_merge_at', now()
              ),
         updated_at = now()
  from best_legacy_notes bln
  where i.user_id = bln.user_id
    and i.id = bln.primary_interaction_id
  returning i.id
),
normalized_primary_sources as (
  update public.external_interaction_sources eis
     set external_id = lower(eis.external_id),
         metadata = coalesce(eis.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'case_variant_external_merge_primary', true,
                'case_variant_external_merge_at', now()
              ),
         updated_at = now()
  from primary_sources ps
  where eis.user_id = ps.user_id
    and eis.id = ps.source_id
    and eis.external_id <> lower(eis.external_id)
    and not exists (
      select 1
      from public.external_interaction_sources existing
      where existing.user_id = eis.user_id
        and existing.provider = eis.provider
        and existing.source_service = eis.source_service
        and existing.external_id = lower(eis.external_id)
        and existing.is_active = true
        and existing.id <> eis.id
    )
  returning eis.id
),
disabled_secondary_sources as (
  update public.external_interaction_sources eis
     set is_active = false,
         interaction_id = ss.primary_interaction_id,
         metadata = coalesce(eis.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'disabled_reason', 'case_variant_external_id_consolidated',
                'disabled_at', now(),
                'merged_into_interaction_id', ss.primary_interaction_id,
                'canonical_external_id', ss.external_id_key
              ),
         updated_at = now()
  from secondary_sources ss
  where eis.user_id = ss.user_id
    and eis.id = ss.source_id
  returning eis.id
),
hidden_secondary_interactions as (
  update public.interactions i
     set metadata = coalesce(i.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'deleted', true,
                'dismissed', true,
                'merged_at', now(),
                'merged_by', 'system:case_variant_external_interaction_repair',
                'merged_into_interaction_id', ss.primary_interaction_id,
                'merged_reason', 'same_external_object_case_variant',
                'provider', ss.provider,
                'source_service', ss.source_service,
                'external_id', ss.external_id,
                'canonical_external_id', ss.external_id_key
              ),
         updated_at = now()
  from secondary_sources ss
  where i.user_id = ss.user_id
    and i.id = ss.interaction_id
  returning i.id
),
audit as (
  insert into public.audit_log (
    user_id,
    actor,
    action,
    object_type,
    object_id,
    before_json,
    after_json
  )
  select
    user_id,
    'system:migration_repair',
    'legacy_interactions.consolidate_case_variant_external_ids',
    'migration',
    null,
    jsonb_build_object(
      'backup_interactions_table', 'migration_backup_case_variant_external_interactions_v0_1',
      'backup_sources_table', 'migration_backup_case_variant_external_sources_v0_1'
    ),
    jsonb_build_object(
      'groups', count(distinct provider || ':' || source_service || ':' || external_id_key),
      'secondary_interactions_hidden', (select count(*) from hidden_secondary_interactions),
      'participants_copied', (select count(*) from copied_participants),
      'secondary_sources_disabled', (select count(*) from disabled_secondary_sources)
    )
  from secondary_sources
  group by user_id
  returning id
)
select
  (select count(distinct provider || ':' || source_service || ':' || external_id_key) from secondary_sources) as groups_consolidated,
  (select count(*) from copied_participants) as participants_copied,
  (select count(*) from updated_primary_interactions) as primary_interactions_updated,
  (select count(*) from normalized_primary_sources) as primary_sources_normalized,
  (select count(*) from disabled_secondary_sources) as secondary_sources_disabled,
  (select count(*) from hidden_secondary_interactions) as secondary_interactions_hidden;

commit;
