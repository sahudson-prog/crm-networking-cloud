-- Rolls back repair_legacy_interaction_dates_v0_1.sql using its backup table.
-- Use only if the one-time migration repair needs to be reverted.

begin;

with backup as (
  select *
  from public.migration_backup_legacy_interaction_dates_v0_1
  where user_id = '674317f4-44d6-4311-8460-ecade3ec3620'::uuid
)
update public.interactions i
   set occurred_at = b.occurred_at_before,
       metadata = coalesce(i.metadata, '{}'::jsonb)
         || jsonb_build_object(
              'legacy_date_repair_rollback', 'v0_1',
              'legacy_date_repair_rolled_back_at', now()
            )
from backup b
where i.id = b.interaction_id
  and i.user_id = b.user_id;

with backup as (
  select *
  from public.migration_backup_legacy_interaction_dates_v0_1
  where user_id = '674317f4-44d6-4311-8460-ecade3ec3620'::uuid
)
update public.external_interaction_sources eis
   set last_seen_at = b.source_last_seen_at_before,
       metadata = coalesce(eis.metadata, '{}'::jsonb)
         || jsonb_build_object(
              'legacy_date_repair_rollback', 'v0_1',
              'legacy_date_repair_rolled_back_at', now()
            )
from backup b
where eis.user_id = b.user_id
  and eis.interaction_id = b.interaction_id
  and b.source_last_seen_at_before is not null;

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
  'legacy_interaction_dates.rollback_noon_utc_repair',
  'migration',
  null,
  jsonb_build_object('backup_table', 'migration_backup_legacy_interaction_dates_v0_1'),
  jsonb_build_object('rollback', 'v0_1', 'affected_rows', count(*))
from public.migration_backup_legacy_interaction_dates_v0_1
where user_id = '674317f4-44d6-4311-8460-ecade3ec3620'::uuid
group by user_id;

commit;
