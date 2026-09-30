-- Verifies that the retired case-variant repair backups are absent.

do $verify$
begin
  if to_regclass('public.migration_backup_case_variant_external_sources_v0_1') is not null then
    raise exception 'Legacy case-variant external sources backup still exists';
  end if;

  if to_regclass('public.migration_backup_case_variant_external_interactions_v0_1') is not null then
    raise exception 'Legacy case-variant external interactions backup still exists';
  end if;
end;
$verify$;
