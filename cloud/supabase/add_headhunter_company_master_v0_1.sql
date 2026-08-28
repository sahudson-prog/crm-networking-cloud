-- CRM Networking cloud migration: headhunter company master v0.1
-- Purpose: global app master of headhunter companies and domains.
-- Safe to rerun. It does not modify existing contacts.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.headhunter_companies (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint headhunter_companies_display_name_not_blank check (btrim(display_name) <> ''),
  constraint headhunter_companies_normalized_name_not_blank check (btrim(normalized_name) <> '')
);

create table if not exists public.headhunter_company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.headhunter_companies(id) on delete cascade,
  domain text not null,
  normalized_domain text not null,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint headhunter_company_domains_domain_not_blank check (btrim(domain) <> ''),
  constraint headhunter_company_domains_normalized_domain_not_blank check (btrim(normalized_domain) <> ''),
  constraint headhunter_company_domains_domain_shape check (position('@' in normalized_domain) = 1)
);

create unique index if not exists uq_headhunter_companies_name_active
  on public.headhunter_companies(normalized_name)
  where is_active = true;

create unique index if not exists uq_headhunter_company_domains_domain_active
  on public.headhunter_company_domains(normalized_domain)
  where is_active = true;

create index if not exists idx_headhunter_company_domains_company
  on public.headhunter_company_domains(company_id)
  where is_active = true;

drop trigger if exists set_headhunter_companies_updated_at on public.headhunter_companies;
create trigger set_headhunter_companies_updated_at
before update on public.headhunter_companies
for each row execute function public.set_updated_at();

drop trigger if exists set_headhunter_company_domains_updated_at on public.headhunter_company_domains;
create trigger set_headhunter_company_domains_updated_at
before update on public.headhunter_company_domains
for each row execute function public.set_updated_at();

alter table public.headhunter_companies enable row level security;
alter table public.headhunter_company_domains enable row level security;

drop policy if exists "Headhunter companies are owned by user" on public.headhunter_companies;
drop policy if exists "Headhunter companies are globally readable" on public.headhunter_companies;
create policy "Headhunter companies are globally readable"
on public.headhunter_companies
for select
using (is_active = true);

drop policy if exists "Headhunter companies are manageable in beta" on public.headhunter_companies;
create policy "Headhunter companies are manageable in beta"
on public.headhunter_companies
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

drop policy if exists "Headhunter company domains are owned by user" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are globally readable" on public.headhunter_company_domains;
create policy "Headhunter company domains are globally readable"
on public.headhunter_company_domains
for select
using (is_active = true);

drop policy if exists "Headhunter company domains are manageable in beta" on public.headhunter_company_domains;
create policy "Headhunter company domains are manageable in beta"
on public.headhunter_company_domains
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create or replace function public.validate_headhunter_company_master_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.validate_headhunter_company_master_v0_1() to authenticated;
