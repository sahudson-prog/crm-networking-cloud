-- Verifies that the retired headhunter master migration backup is absent.

do $verify$
begin
  if to_regclass('public.migration_backup_headhunter_company_master_user_owned_v0_2') is not null then
    raise exception 'Legacy headhunter master migration backup still exists';
  end if;
end;
$verify$;
