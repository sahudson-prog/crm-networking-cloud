-- Removes one-shot DEV backup tables from the legacy case-variant repair.

begin;

drop table if exists public.migration_backup_case_variant_external_sources_v0_1;
drop table if exists public.migration_backup_case_variant_external_interactions_v0_1;

commit;
