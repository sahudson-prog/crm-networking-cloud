-- CRM Networking cloud schema v0.2
-- Purpose: remember sync changes the user chose not to see again.
-- Safe to rerun in dev.

create table if not exists public.sync_change_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  resource_type text not null
    check (resource_type in ('contacts', 'mail', 'calendar', 'messages')),
  object_type text not null,
  object_id text not null default '',
  external_id text not null default '',
  change_type text not null,
  field_name text not null default '',
  field_value_hash text not null default '',
  reason text,
  created_by text not null default 'user',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_sync_change_suppressions_active
  on public.sync_change_suppressions(
    user_id,
    provider,
    resource_type,
    object_type,
    object_id,
    external_id,
    change_type,
    field_name,
    field_value_hash
  );

create index if not exists idx_sync_change_suppressions_lookup
  on public.sync_change_suppressions(user_id, provider, resource_type, object_type, is_active);

drop trigger if exists set_sync_change_suppressions_updated_at on public.sync_change_suppressions;
create trigger set_sync_change_suppressions_updated_at
before update on public.sync_change_suppressions
for each row execute function public.set_updated_at();

alter table public.sync_change_suppressions enable row level security;

drop policy if exists "Sync change suppressions are owned by user" on public.sync_change_suppressions;
create policy "Sync change suppressions are owned by user"
on public.sync_change_suppressions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
