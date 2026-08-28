-- CRM Networking cloud migration: headhunter company master global v0.2
-- Purpose:
-- - Convert the headhunter company/domain master from user-owned data into a global app catalog.
-- - Preserve already loaded rows by consolidating active duplicate companies/domains.
--
-- This query writes schema and data in:
-- - public.headhunter_companies
-- - public.headhunter_company_domains
--
-- Safe to rerun.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.migration_backup_headhunter_company_master_user_owned_v0_2 as
select
  'headhunter_companies'::text as source_table,
  to_jsonb(hc.*) as row_json,
  now() as backed_up_at
from public.headhunter_companies hc
union all
select
  'headhunter_company_domains'::text as source_table,
  to_jsonb(hcd.*) as row_json,
  now() as backed_up_at
from public.headhunter_company_domains hcd;

alter table public.migration_backup_headhunter_company_master_user_owned_v0_2 enable row level security;

drop policy if exists "Headhunter companies are owned by user" on public.headhunter_companies;
drop policy if exists "Headhunter company domains are owned by user" on public.headhunter_company_domains;
drop policy if exists "Headhunter companies are globally readable" on public.headhunter_companies;
drop policy if exists "Headhunter company domains are globally readable" on public.headhunter_company_domains;
drop policy if exists "Headhunter companies are manageable in beta" on public.headhunter_companies;
drop policy if exists "Headhunter company domains are manageable in beta" on public.headhunter_company_domains;

drop index if exists public.uq_headhunter_companies_user_name_active;
drop index if exists public.uq_headhunter_company_domains_user_domain_active;
drop index if exists public.uq_headhunter_companies_name_active;
drop index if exists public.uq_headhunter_company_domains_domain_active;
drop index if exists public.idx_headhunter_company_domains_company;

with ranked_companies as (
  select
    id,
    normalized_name,
    row_number() over (
      partition by normalized_name
      order by is_active desc, updated_at desc, created_at desc, id
    ) as company_rank
  from public.headhunter_companies
  where is_active = true
),
canonical_companies as (
  select id, normalized_name
  from ranked_companies
  where company_rank = 1
),
duplicate_companies as (
  select id, normalized_name
  from ranked_companies
  where company_rank > 1
)
update public.headhunter_company_domains hcd
   set company_id = cc.id,
       updated_at = now()
from duplicate_companies dc
join canonical_companies cc on cc.normalized_name = dc.normalized_name
where hcd.company_id = dc.id;

with ranked_companies as (
  select
    id,
    normalized_name,
    row_number() over (
      partition by normalized_name
      order by is_active desc, updated_at desc, created_at desc, id
    ) as company_rank
  from public.headhunter_companies
  where is_active = true
)
update public.headhunter_companies hc
   set is_active = false,
       notes = btrim(concat_ws(E'\n', nullif(hc.notes, ''), 'Desactivada al convertir el maestro en catalogo global.')),
       updated_at = now()
from ranked_companies rc
where hc.id = rc.id
  and rc.company_rank > 1;

with ranked_domains as (
  select
    id,
    row_number() over (
      partition by normalized_domain
      order by is_active desc, is_primary desc, updated_at desc, created_at desc, id
    ) as domain_rank
  from public.headhunter_company_domains
  where is_active = true
)
update public.headhunter_company_domains hcd
   set is_active = false,
       updated_at = now()
from ranked_domains rd
where hcd.id = rd.id
  and rd.domain_rank > 1;

alter table public.headhunter_company_domains drop column if exists user_id;
alter table public.headhunter_companies drop column if exists user_id;

create unique index if not exists uq_headhunter_companies_name_active
  on public.headhunter_companies(normalized_name)
  where is_active = true;

create unique index if not exists uq_headhunter_company_domains_domain_active
  on public.headhunter_company_domains(normalized_domain)
  where is_active = true;

create index if not exists idx_headhunter_company_domains_company
  on public.headhunter_company_domains(company_id)
  where is_active = true;

alter table public.headhunter_companies enable row level security;
alter table public.headhunter_company_domains enable row level security;

create policy "Headhunter companies are globally readable"
on public.headhunter_companies
for select
to authenticated
using (is_active = true);

create policy "Headhunter companies are manageable in beta"
on public.headhunter_companies
for all
to authenticated
using (true)
with check (true);

create policy "Headhunter company domains are globally readable"
on public.headhunter_company_domains
for select
to authenticated
using (is_active = true);

create policy "Headhunter company domains are manageable in beta"
on public.headhunter_company_domains
for all
to authenticated
using (true)
with check (true);

commit;

select
  'headhunter_companies_activas' as resultado,
  count(*)::text as valor
from public.headhunter_companies
where is_active = true
union all
select
  'headhunter_domains_activos',
  count(*)::text
from public.headhunter_company_domains
where is_active = true
union all
select
  'user_id_columns_restantes',
  count(*)::text
from information_schema.columns
where table_schema = 'public'
  and table_name in ('headhunter_companies', 'headhunter_company_domains')
  and column_name = 'user_id'
order by resultado;
