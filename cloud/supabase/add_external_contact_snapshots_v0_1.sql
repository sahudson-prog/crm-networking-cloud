-- CRM Networking cloud migration: external contact provider snapshots v0.1
-- Adds the provider-side contact mirror used by contact sync previews.

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
