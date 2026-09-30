-- Removes the retired DEV snapshot from the headhunter master globalization.

begin;

drop table if exists public.migration_backup_headhunter_company_master_user_owned_v0_2;

commit;
