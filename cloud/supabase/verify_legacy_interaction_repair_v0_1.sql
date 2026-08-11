-- Verifies the one-time legacy interaction date/case repair.
-- This query does not modify data.

with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
visible_interactions as (
  select i.*
  from public.interactions i
  join params p on p.user_id = i.user_id
  where coalesce(i.metadata->>'deleted', 'false') <> 'true'
    and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
),
legacy_midnight_remaining as (
  select
    interaction_type,
    count(*) as remaining
  from visible_interactions
  where legacy_entry_id is not null
    and legacy_entry_id <> ''
    and occurred_at is not null
    and (occurred_at at time zone 'UTC')::time = time '00:00:00'
  group by interaction_type
),
visible_calendar_duplicate_candidates as (
  select
    c.display_name as contacto,
    a.subject,
    a.occurred_at as fecha_a,
    b.occurred_at as fecha_b,
    a.provider_event_id as id_a,
    b.provider_event_id as id_b,
    abs(extract(epoch from (a.occurred_at - b.occurred_at)) / 3600) as horas_diferencia
  from visible_interactions a
  join public.interaction_participants ipa
    on ipa.user_id = a.user_id
   and ipa.interaction_id = a.id
  join visible_interactions b
    on b.user_id = a.user_id
   and b.id > a.id
   and b.interaction_type = a.interaction_type
   and lower(coalesce(b.subject, '')) = lower(coalesce(a.subject, ''))
   and abs(extract(epoch from (a.occurred_at - b.occurred_at))) <= 36 * 3600
  join public.interaction_participants ipb
    on ipb.user_id = b.user_id
   and ipb.interaction_id = b.id
   and ipb.contact_id is not distinct from ipa.contact_id
  left join public.contacts c
    on c.user_id = ipa.user_id
   and c.id = ipa.contact_id
  where a.interaction_type = 'calendar'
)
select
  'legacy_midnight_remaining' as check_name,
  coalesce(jsonb_agg(jsonb_build_object('interaction_type', interaction_type, 'remaining', remaining)), '[]'::jsonb) as result
from legacy_midnight_remaining
union all
select
  'visible_calendar_duplicate_candidates' as check_name,
  coalesce(jsonb_agg(jsonb_build_object(
    'contacto', contacto,
    'subject', subject,
    'fecha_a', fecha_a,
    'fecha_b', fecha_b,
    'id_a', id_a,
    'id_b', id_b,
    'horas_diferencia', horas_diferencia
  )), '[]'::jsonb) as result
from visible_calendar_duplicate_candidates;

