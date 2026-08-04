-- Separates app interactions from external provider objects.
-- Run after schema_v0_1.sql on existing Supabase dev projects.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.external_interaction_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  provider text not null,
  source_service text not null,
  external_object_type text not null,
  external_id text not null,
  external_thread_id text,
  external_url text,
  source_subject text,
  source_detail text,
  content_hash text,
  sync_status text not null default 'imported'
    check (sync_status in ('imported', 'synced', 'deleted_at_source', 'error', 'ignored')),
  prevent_reimport boolean not null default false,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_external_interaction_sources_provider_external
  on public.external_interaction_sources(user_id, provider, source_service, external_id)
  where is_active = true;

create index if not exists idx_external_interaction_sources_interaction
  on public.external_interaction_sources(user_id, interaction_id);

create index if not exists idx_external_interaction_sources_thread
  on public.external_interaction_sources(user_id, provider, source_service, external_thread_id)
  where external_thread_id is not null and external_thread_id <> '';

create index if not exists idx_external_interaction_sources_prevent_reimport
  on public.external_interaction_sources(user_id, prevent_reimport)
  where prevent_reimport = true;

drop trigger if exists set_external_interaction_sources_updated_at on public.external_interaction_sources;
create trigger set_external_interaction_sources_updated_at
before update on public.external_interaction_sources
for each row execute function public.set_updated_at();

alter table public.external_interaction_sources enable row level security;

drop policy if exists "External interaction sources are owned by user" on public.external_interaction_sources;
create policy "External interaction sources are owned by user"
on public.external_interaction_sources
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
