-- Diagnoses app interactions that point to the same external provider object.
-- This query does not modify data.

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
duplicate_sources as (
  select
    eis.user_id,
    eis.provider,
    eis.source_service,
    eis.external_id,
    count(distinct i.id) as interaction_count
  from public.external_interaction_sources eis
  join public.interactions i
    on i.user_id = eis.user_id
   and i.provider_event_id = eis.external_id
  join target_user u on u.user_id = eis.user_id
  where eis.is_active = true
  group by eis.user_id, eis.provider, eis.source_service, eis.external_id
  having count(distinct i.id) > 1
),
interaction_details as (
  select
    ds.provider,
    ds.source_service,
    ds.external_id,
    ds.interaction_count,
    i.id as interaction_id,
    i.occurred_at,
    i.subject,
    i.direction,
    i.legacy_entry_id,
    i.user_notes_raw,
    i.source_detail,
    encode(extensions.digest(coalesce(i.user_notes_raw, ''), 'sha256'), 'hex') as notes_hash,
    encode(extensions.digest(coalesce(i.source_detail, ''), 'sha256'), 'hex') as source_hash,
    coalesce(
      jsonb_agg(
        distinct jsonb_build_object(
          'contact_id', ip.contact_id,
          'contact_name', c.display_name,
          'email', ip.email_identity,
          'role', ip.role
        )
      ) filter (where ip.id is not null),
      '[]'::jsonb
    ) as participants
  from duplicate_sources ds
  join public.interactions i
    on i.user_id = ds.user_id
   and i.provider_event_id = ds.external_id
  left join public.interaction_participants ip
    on ip.user_id = i.user_id
   and ip.interaction_id = i.id
  left join public.contacts c
    on c.user_id = ip.user_id
   and c.id = ip.contact_id
  group by
    ds.provider,
    ds.source_service,
    ds.external_id,
    ds.interaction_count,
    i.id,
    i.occurred_at,
    i.subject,
    i.direction,
    i.legacy_entry_id,
    i.user_notes_raw,
    i.source_detail
),
ranked as (
  select
    *,
    row_number() over (
      partition by provider, source_service, external_id
      order by
        jsonb_array_length(participants) desc,
        occurred_at desc nulls last,
        interaction_id
    ) as suggested_rank
  from interaction_details
)
select
  provider,
  source_service,
  external_id,
  interaction_count,
  (jsonb_agg(interaction_id order by suggested_rank)->>0)::uuid as suggested_primary_interaction_id,
  count(distinct notes_hash) as distinct_notes_versions,
  count(distinct source_hash) as distinct_source_versions,
  jsonb_agg(
    jsonb_build_object(
      'suggested_rank', suggested_rank,
      'interaction_id', interaction_id,
      'legacy_entry_id', legacy_entry_id,
      'occurred_at', occurred_at,
      'subject', subject,
      'direction', direction,
      'participants', participants,
      'notes_empty', coalesce(user_notes_raw, '') = '',
      'source_empty', coalesce(source_detail, '') = ''
    )
    order by suggested_rank
  ) as interactions
from ranked
group by provider, source_service, external_id, interaction_count
order by interaction_count desc, source_service, external_id;
