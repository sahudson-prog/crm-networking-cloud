-- Verifies the external interaction source backfill.
-- Replace the UUID if you are checking another user.

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
counts as (
  select
    count(*) filter (where i.provider_event_id is not null and i.provider_event_id <> '') as interactions_with_external_id,
    count(*) filter (
      where upper(coalesce(i.provider_event_id, '')) like 'GMAIL%'
         or upper(coalesce(i.provider_event_id, '')) like 'CALENDAR%'
    ) as interactions_backfillable,
    count(eis.*) as external_sources_created,
    count(*) filter (where eis.source_service = 'gmail') as gmail_sources,
    count(*) filter (where eis.source_service = 'calendar') as calendar_sources,
    count(*) filter (where eis.prevent_reimport = true) as prevent_reimport_sources
  from public.interactions i
  join target_user u on u.user_id = i.user_id
  left join public.external_interaction_sources eis
    on eis.user_id = i.user_id
   and eis.interaction_id = i.id
   and eis.is_active = true
)
select * from counts;
