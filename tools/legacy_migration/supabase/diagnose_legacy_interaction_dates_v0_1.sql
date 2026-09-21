-- Diagnose legacy imported interactions whose original date had no time.
-- Purpose: migration-only inspection, not product logic.
--
-- Replace the user_id below if this is run for another imported account.

with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
legacy_interactions as (
  select
    i.id,
    i.legacy_entry_id,
    i.provider,
    i.provider_event_id,
    i.interaction_type,
    i.occurred_at,
    i.subject,
    i.user_notes_raw,
    i.metadata,
    eis.source_service,
    eis.sync_status,
    eis.external_id,
    eis.last_seen_at
  from public.interactions i
  join params p on p.user_id = i.user_id
  left join public.external_interaction_sources eis
    on eis.user_id = i.user_id
   and eis.interaction_id = i.id
   and eis.is_active = true
  where i.legacy_entry_id is not null
    and i.legacy_entry_id <> ''
    and coalesce(i.metadata->>'deleted', 'false') <> 'true'
    and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
)
select
  interaction_type,
  coalesce(source_service, 'app') as source_service,
  coalesce(sync_status, 'sin_origen_externo') as sync_status,
  count(*) as total,
  count(*) filter (where (occurred_at at time zone 'UTC')::time = time '00:00:00') as medianoche_utc,
  min(occurred_at) as primera_fecha,
  max(occurred_at) as ultima_fecha
from legacy_interactions
group by interaction_type, coalesce(source_service, 'app'), coalesce(sync_status, 'sin_origen_externo')
order by interaction_type, source_service, sync_status;

-- Samples to inspect affected rows.
with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
select
  i.id,
  i.legacy_entry_id,
  i.provider_event_id,
  i.interaction_type,
  i.occurred_at,
  (i.occurred_at + interval '12 hours') as proposed_occurred_at,
  i.subject,
  i.user_notes_raw
from public.interactions i
join params p on p.user_id = i.user_id
where i.legacy_entry_id is not null
  and i.legacy_entry_id <> ''
  and coalesce(i.metadata->>'deleted', 'false') <> 'true'
  and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
  and (i.occurred_at at time zone 'UTC')::time = time '00:00:00'
order by i.occurred_at desc, i.subject
limit 50;

-- Calendar imported/synced candidates that may be the same real meeting.
with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
calendar_rows as (
  select
    i.id,
    i.subject,
    i.occurred_at,
    i.provider_event_id,
    eis.sync_status,
    ip.contact_id
  from public.interactions i
  join params p on p.user_id = i.user_id
  join public.interaction_participants ip
    on ip.user_id = i.user_id
   and ip.interaction_id = i.id
  left join public.external_interaction_sources eis
    on eis.user_id = i.user_id
   and eis.interaction_id = i.id
   and eis.is_active = true
  where i.interaction_type = 'calendar'
    and coalesce(i.metadata->>'deleted', 'false') <> 'true'
    and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
)
select
  c.display_name as contacto,
  a.subject,
  a.occurred_at as fecha_a,
  a.provider_event_id as id_a,
  coalesce(a.sync_status, 'sin_origen') as estado_a,
  b.occurred_at as fecha_b,
  b.provider_event_id as id_b,
  coalesce(b.sync_status, 'sin_origen') as estado_b,
  abs(extract(epoch from (a.occurred_at - b.occurred_at)) / 3600) as horas_diferencia
from calendar_rows a
join calendar_rows b
  on b.contact_id = a.contact_id
 and b.id > a.id
 and lower(coalesce(b.subject, '')) = lower(coalesce(a.subject, ''))
 and abs(extract(epoch from (a.occurred_at - b.occurred_at))) <= 36 * 3600
left join public.contacts c on c.id = a.contact_id
order by horas_diferencia, contacto, a.subject;
