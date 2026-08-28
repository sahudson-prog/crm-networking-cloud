-- CRM Networking cloud migration: prepare contact sync storage v0.1
-- Run before importing Google Contacts in a clean dev database.
-- It is rerunnable and does not delete user data.

alter table public.external_contact_ids
add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.external_contact_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  provider text not null,
  external_id text not null,
  display_name text not null default '',
  company text not null default '',
  role text not null default '',
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  birthdays jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text,
  is_deleted boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_external_contact_snapshots_provider_external
  on public.external_contact_snapshots(user_id, provider, external_id);

create index if not exists idx_external_contact_snapshots_user_provider
  on public.external_contact_snapshots(user_id, provider);

drop trigger if exists set_external_contact_snapshots_updated_at on public.external_contact_snapshots;
create trigger set_external_contact_snapshots_updated_at
before update on public.external_contact_snapshots
for each row execute function public.set_updated_at();

alter table public.external_contact_snapshots enable row level security;

drop policy if exists "External contact snapshots are owned by user" on public.external_contact_snapshots;
create policy "External contact snapshots are owned by user"
on public.external_contact_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop index if exists public.uq_contact_emails_user_normalized;
drop index if exists public.uq_contact_phones_user_normalized;

create unique index if not exists uq_contact_emails_contact_normalized
  on public.contact_emails(user_id, contact_id, normalized_email);

create unique index if not exists uq_contact_phones_contact_normalized
  on public.contact_phones(user_id, contact_id, normalized_phone);

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

grant execute on function public.validate_contact_sync_storage_v0_1() to authenticated;
