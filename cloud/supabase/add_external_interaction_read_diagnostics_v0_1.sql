-- Stores raw provider reads for interaction diagnostics.
-- This is diagnostic data, separate from app interactions and external sources.

create table if not exists public.external_interaction_read_diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  source_service text not null,
  external_id text not null,
  occurred_at timestamptz,
  subject text not null default '',
  participant_emails text[] not null default array[]::text[],
  matched_emails text[] not null default array[]::text[],
  mapped_contact_ids uuid[] not null default array[]::uuid[],
  candidate_status text not null
    check (candidate_status in ('candidate', 'not_mapped', 'filtered_out')),
  exclusion_reason text not null default '',
  read_context jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_external_interaction_read_diag_provider_external
  on public.external_interaction_read_diagnostics(user_id, provider, source_service, external_id);

create index if not exists idx_external_interaction_read_diag_user_service_date
  on public.external_interaction_read_diagnostics(user_id, provider, source_service, occurred_at);

create index if not exists idx_external_interaction_read_diag_status
  on public.external_interaction_read_diagnostics(user_id, provider, source_service, candidate_status);

drop trigger if exists set_external_interaction_read_diagnostics_updated_at on public.external_interaction_read_diagnostics;
create trigger set_external_interaction_read_diagnostics_updated_at
before update on public.external_interaction_read_diagnostics
for each row execute function public.set_updated_at();

alter table public.external_interaction_read_diagnostics enable row level security;

drop policy if exists "External interaction read diagnostics are owned by user" on public.external_interaction_read_diagnostics;
create policy "External interaction read diagnostics are owned by user"
on public.external_interaction_read_diagnostics
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
