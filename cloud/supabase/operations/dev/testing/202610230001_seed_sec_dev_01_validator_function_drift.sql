-- LOCAL DISPOSABLE DATABASE ONLY.
-- Reproduces the two confirmed validator-function drifts for PostgreSQL tests.
-- Requires both the exact disposable database name and an explicit session opt-in.

\set ON_ERROR_STOP on

begin;

do $guard$
begin
  if current_user <> 'postgres' then
    raise exception 'SEC_DEV_01_VALIDATOR_FIXTURE_WRONG_ROLE';
  end if;

  if current_database() is distinct from 'coffeecito_sec_dev_01_validator_fixture' then
    raise exception 'SEC_DEV_01_VALIDATOR_FIXTURE_WRONG_DATABASE';
  end if;

  if current_setting('coffeecito.sec_dev_01_local_fixture', true) is distinct from 'on' then
    raise exception 'SEC_DEV_01_VALIDATOR_FIXTURE_LOCAL_OPT_IN_REQUIRED';
  end if;
end
$guard$;

drop schema if exists public cascade;
create schema public authorization postgres;

grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;

create schema if not exists extensions authorization postgres;
create extension if not exists pgcrypto with schema extensions;

create table public.external_contact_snapshots (
  user_id uuid not null,
  provider text not null,
  external_id text not null
);

create table public.contact_emails (
  user_id uuid not null,
  contact_id uuid not null,
  normalized_email text not null
);

create table public.contact_phones (
  user_id uuid not null,
  contact_id uuid not null,
  normalized_phone text not null
);

create table public.headhunter_companies (
  normalized_name text not null,
  is_active boolean not null default true
);

create table public.headhunter_company_domains (
  normalized_domain text not null,
  is_active boolean not null default true
);

create unique index uq_external_contact_snapshots_provider_external
  on public.external_contact_snapshots(user_id, provider, external_id);
create unique index uq_contact_emails_contact_normalized
  on public.contact_emails(user_id, contact_id, normalized_email);
create unique index uq_contact_phones_contact_normalized
  on public.contact_phones(user_id, contact_id, normalized_phone);
create unique index uq_headhunter_companies_name_active
  on public.headhunter_companies(normalized_name)
  where is_active = true;
create unique index uq_headhunter_company_domains_domain_active
  on public.headhunter_company_domains(normalized_domain)
  where is_active = true;

create or replace function public.validate_contact_sync_storage_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.external_contact_snapshots') is null then
    missing_or_stale := array_append(missing_or_stale, 'external_contact_snapshots table');
  end if;

  if to_regclass('public.uq_external_contact_snapshots_provider_external') is null then
    missing_or_stale := array_append(missing_or_stale, 'external contact snapshot unique index');
  end if;

  if to_regclass('public.uq_contact_emails_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact email per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_phones_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact phone per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_emails_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global email unique index still exists');
  end if;

  if to_regclass('public.uq_contact_phones_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global phone unique index still exists');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'CONTACT_SYNC_STORAGE_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

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

  if to_regclass('public.uq_headhunter_companies_user_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_user_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.validate_contact_sync_storage_v0_1()
  from public, anon, service_role, supabase_auth_admin;
grant execute on function public.validate_contact_sync_storage_v0_1()
  to authenticated;

revoke execute on function public.validate_headhunter_company_master_v0_1()
  from public, anon, authenticated, service_role, supabase_auth_admin;

commit;
