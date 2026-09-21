-- CRM Networking cloud migration: restrict headhunter master admin writes v0.1
-- Purpose:
-- - Keep the headhunter company/domain master readable by authenticated users.
-- - Restrict writes to users with capability admin.manage_global_masters.
--
-- This query updates RLS policies in:
-- - public.headhunter_companies
-- - public.headhunter_company_domains
--
-- Requires the access model v0.1 to be installed first.
-- Safe to rerun.

begin;

alter table public.headhunter_companies enable row level security;
alter table public.headhunter_company_domains enable row level security;

drop policy if exists "Headhunter companies are owned by user" on public.headhunter_companies;
drop policy if exists "Headhunter companies are globally readable" on public.headhunter_companies;
drop policy if exists "Headhunter companies are manageable in beta" on public.headhunter_companies;
drop policy if exists "Headhunter companies are admin writable" on public.headhunter_companies;

drop policy if exists "Headhunter company domains are owned by user" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are globally readable" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are manageable in beta" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are admin writable" on public.headhunter_company_domains;

create policy "Headhunter companies are globally readable"
on public.headhunter_companies
for select
to authenticated
using (is_active = true);

create policy "Headhunter companies are admin writable"
on public.headhunter_companies
for all
to authenticated
using (public.current_user_has_capability('admin.manage_global_masters'))
with check (public.current_user_has_capability('admin.manage_global_masters'));

create policy "Headhunter company domains are globally readable"
on public.headhunter_company_domains
for select
to authenticated
using (is_active = true);

create policy "Headhunter company domains are admin writable"
on public.headhunter_company_domains
for all
to authenticated
using (public.current_user_has_capability('admin.manage_global_masters'))
with check (public.current_user_has_capability('admin.manage_global_masters'));

commit;

select
  'headhunter_companies_admin_write_policy' as check_name,
  case when count(*) = 1 then 'ok' else 'revisar' end as status,
  count(*) as observed_count
from pg_policies
where schemaname = 'public'
  and tablename = 'headhunter_companies'
  and policyname = 'Headhunter companies are admin writable'
union all
select
  'headhunter_company_domains_admin_write_policy' as check_name,
  case when count(*) = 1 then 'ok' else 'revisar' end as status,
  count(*) as observed_count
from pg_policies
where schemaname = 'public'
  and tablename = 'headhunter_company_domains'
  and policyname = 'Headhunter company domains are admin writable'
union all
select
  'old_beta_write_policies_removed' as check_name,
  case when count(*) = 0 then 'ok' else 'revisar' end as status,
  count(*) as observed_count
from pg_policies
where schemaname = 'public'
  and tablename in ('headhunter_companies', 'headhunter_company_domains')
  and policyname in ('Headhunter companies are manageable in beta', 'Headhunter company domains are manageable in beta')
order by check_name;
