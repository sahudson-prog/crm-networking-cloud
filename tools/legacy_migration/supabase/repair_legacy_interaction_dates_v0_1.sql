-- Repairs legacy imported interaction dates that were date-only in the local app.
-- Purpose: one-time migration repair for the imported mirror, not product logic.
--
-- Problem:
-- Legacy exported dates such as 16/03/2026 had no time. The importer stored them
-- as 2026-03-16 00:00 UTC, which can render as 15/03 in Chile.
--
-- Repair:
-- Move only legacy imported rows at midnight UTC to noon UTC of the same day.
-- This preserves the calendar day without inventing a real meeting time.
--
-- Replace the user_id below if this is run for another imported account.

begin;

create table if not exists public.migration_backup_legacy_interaction_dates_v0_1 (
  backed_up_at timestamptz not null default now(),
  interaction_id uuid not null,
  user_id uuid not null,
  legacy_entry_id text,
  provider_event_id text,
  interaction_type text,
  occurred_at_before timestamptz,
  source_last_seen_at_before timestamptz,
  subject text,
  user_notes_raw text,
  metadata jsonb,
  primary key (interaction_id)
);

with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
affected as (
  select
    i.id,
    i.user_id,
    i.legacy_entry_id,
    i.provider_event_id,
    i.interaction_type,
    i.occurred_at,
    eis.last_seen_at,
    i.subject,
    i.user_notes_raw,
    i.metadata
  from public.interactions i
  join params p on p.user_id = i.user_id
  left join public.external_interaction_sources eis
    on eis.user_id = i.user_id
   and eis.interaction_id = i.id
   and eis.is_active = true
  where i.legacy_entry_id is not null
    and i.legacy_entry_id <> ''
    and i.occurred_at is not null
    and coalesce(i.metadata->>'deleted', 'false') <> 'true'
    and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
    and (i.occurred_at at time zone 'UTC')::time = time '00:00:00'
)
insert into public.migration_backup_legacy_interaction_dates_v0_1 (
  interaction_id,
  user_id,
  legacy_entry_id,
  provider_event_id,
  interaction_type,
  occurred_at_before,
  source_last_seen_at_before,
  subject,
  user_notes_raw,
  metadata
)
select
  id,
  user_id,
  legacy_entry_id,
  provider_event_id,
  interaction_type,
  occurred_at,
  last_seen_at,
  subject,
  user_notes_raw,
  metadata
from affected
on conflict (interaction_id) do nothing;

with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
updated_interactions as (
  update public.interactions i
     set occurred_at = i.occurred_at + interval '12 hours',
         metadata = coalesce(i.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'legacy_date_repair', 'date_only_noon_utc',
                'legacy_date_repaired_at', now()
              )
  from params p
  where i.user_id = p.user_id
    and i.legacy_entry_id is not null
    and i.legacy_entry_id <> ''
    and i.occurred_at is not null
    and coalesce(i.metadata->>'deleted', 'false') <> 'true'
    and coalesce(i.metadata->>'dismissed', 'false') <> 'true'
    and (i.occurred_at at time zone 'UTC')::time = time '00:00:00'
  returning i.id, i.user_id
)
update public.external_interaction_sources eis
   set last_seen_at = eis.last_seen_at + interval '12 hours',
       metadata = coalesce(eis.metadata, '{}'::jsonb)
         || jsonb_build_object(
              'legacy_date_repair', 'date_only_noon_utc',
              'legacy_date_repaired_at', now()
            )
from updated_interactions ui
where eis.user_id = ui.user_id
  and eis.interaction_id = ui.id
  and eis.last_seen_at is not null
  and (eis.last_seen_at at time zone 'UTC')::time = time '00:00:00';

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
  'legacy_interaction_dates.noon_utc_repair',
  'migration',
  null,
  jsonb_build_object('backup_table', 'migration_backup_legacy_interaction_dates_v0_1'),
  jsonb_build_object('repair', 'date_only_noon_utc', 'affected_rows', count(*))
from public.migration_backup_legacy_interaction_dates_v0_1
where user_id = '674317f4-44d6-4311-8460-ecade3ec3620'::uuid
group by user_id;

commit;

-- Verification after commit.
with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
select
  i.interaction_type,
  count(*) as total_repaired,
  min(i.occurred_at) as primera_fecha_reparada,
  max(i.occurred_at) as ultima_fecha_reparada
from public.interactions i
join params p on p.user_id = i.user_id
where i.metadata->>'legacy_date_repair' = 'date_only_noon_utc'
group by i.interaction_type
order by i.interaction_type;
