-- Adds immutable, versioned legal acceptance behind authenticated RPCs.

begin;

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  terms_sha256 text not null,
  privacy_sha256 text not null,
  acceptance_method text not null,
  accepted_at timestamptz not null default now(),
  constraint legal_acceptances_terms_version check (char_length(btrim(terms_version)) between 1 and 40),
  constraint legal_acceptances_privacy_version check (char_length(btrim(privacy_version)) between 1 and 40),
  constraint legal_acceptances_terms_sha256 check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legal_acceptances_privacy_sha256 check (privacy_sha256 ~ '^[0-9a-f]{64}$'),
  constraint legal_acceptances_method check (acceptance_method = 'explicit_web'),
  constraint uq_legal_acceptances_user_contract unique (
    user_id,
    terms_version,
    privacy_version,
    terms_sha256,
    privacy_sha256,
    acceptance_method
  )
);

create index if not exists idx_legal_acceptances_user_accepted
  on public.legal_acceptances(user_id, accepted_at desc);

create or replace function public.current_user_legal_acceptance_status_v1()
returns table (
  accepted boolean,
  terms_version text,
  privacy_version text,
  terms_sha256 text,
  privacy_sha256 text,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_accepted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'LEGAL_ACCEPTANCE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'LEGAL_ACCEPTANCE_APP_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select acceptance.accepted_at
  into v_accepted_at
  from public.legal_acceptances acceptance
  where acceptance.user_id = v_user_id
    and acceptance.terms_version = '1.0'
    and acceptance.privacy_version = '1.0'
    and acceptance.terms_sha256 = '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12'
    and acceptance.privacy_sha256 = 'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30'
    and acceptance.acceptance_method = 'explicit_web'
  order by acceptance.accepted_at desc
  limit 1;

  return query select
    v_accepted_at is not null,
    '1.0'::text,
    '1.0'::text,
    '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12'::text,
    'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30'::text,
    v_accepted_at;
end;
$$;

create or replace function public.record_current_user_legal_acceptance_v1()
returns table (
  accepted boolean,
  terms_version text,
  privacy_version text,
  terms_sha256 text,
  privacy_sha256 text,
  accepted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_accepted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'LEGAL_ACCEPTANCE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'LEGAL_ACCEPTANCE_APP_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  insert into public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    terms_sha256,
    privacy_sha256,
    acceptance_method
  ) values (
    v_user_id,
    '1.0',
    '1.0',
    '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12',
    'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30',
    'explicit_web'
  )
  on conflict on constraint uq_legal_acceptances_user_contract do nothing;

  select acceptance.accepted_at
  into strict v_accepted_at
  from public.legal_acceptances acceptance
  where acceptance.user_id = v_user_id
    and acceptance.terms_version = '1.0'
    and acceptance.privacy_version = '1.0'
    and acceptance.terms_sha256 = '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12'
    and acceptance.privacy_sha256 = 'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30'
    and acceptance.acceptance_method = 'explicit_web';

  return query select
    true,
    '1.0'::text,
    '1.0'::text,
    '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12'::text,
    'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30'::text,
    v_accepted_at;
end;
$$;

alter table public.legal_acceptances owner to postgres;
alter function public.current_user_legal_acceptance_status_v1() owner to postgres;
alter function public.record_current_user_legal_acceptance_v1() owner to postgres;

alter table public.legal_acceptances enable row level security;
alter table public.legal_acceptances no force row level security;

drop policy if exists "Legal acceptances deny direct client access" on public.legal_acceptances;
create policy "Legal acceptances deny direct client access"
on public.legal_acceptances
for all
to authenticated
using (false)
with check (false);

revoke all on table public.legal_acceptances
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.current_user_legal_acceptance_status_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.record_current_user_legal_acceptance_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function public.current_user_legal_acceptance_status_v1() to authenticated;
grant execute on function public.record_current_user_legal_acceptance_v1() to authenticated;

comment on table public.legal_acceptances is 'Immutable application history of explicit acceptance of versioned Coffeecito legal documents.';
comment on column public.legal_acceptances.privacy_version is 'Acknowledgement that the published Privacy Policy was received/read; not a general consent record.';
comment on function public.current_user_legal_acceptance_status_v1() is 'Returns whether auth.uid() accepted the exact current legal contract.';
comment on function public.record_current_user_legal_acceptance_v1() is 'Idempotently records explicit_web acceptance for auth.uid() and the exact current versions/hashes.';

commit;
