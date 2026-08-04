-- CRM Networking cloud schema v0.1
-- Target: Supabase/Postgres development project.
-- Purpose: empty schema for the first cloud mirror import.
-- This script is designed to be safe to rerun in a dev database.
-- Do not run on production without a migration review and backups.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  setting_key text not null,
  setting_value text,
  value_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_connectors (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service_type text not null,
  capabilities jsonb not null default '{}'::jsonb,
  auth_type text not null default 'oauth',
  enabled boolean not null default true,
  config_schema_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  account_email text,
  oauth_refresh_token_encrypted text,
  scopes text[] not null default array[]::text[],
  capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'error', 'paused')),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legacy_app_contact_id text,
  legacy_google_id text,
  display_name text not null default '',
  company text not null default '',
  role text not null default '',
  networking_status text not null default 'Pendiente'
    check (networking_status in (
      'Pendiente',
      'Contactado',
      'Agendado',
      'Cita concretada',
      'Agradecimiento enviado'
    )),
  networking_focus boolean not null default true,
  closeness_level text,
  is_headhunter boolean not null default false,
  headhunter_domains text[] not null default array[]::text[],
  is_active boolean not null default true,
  sync_status text,
  legacy_milestones jsonb not null default '{}'::jsonb,
  legacy_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.external_contact_ids (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  provider text not null,
  external_id text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email text not null,
  normalized_email text not null,
  domain text,
  is_primary boolean not null default false,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_phones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  phone text not null,
  normalized_phone text not null,
  normalized_phone_last8 text,
  is_primary boolean not null default false,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legacy_entry_id text,
  provider text,
  provider_event_id text,
  provider_thread_id text,
  interaction_type text not null
    check (interaction_type in ('email', 'calendar', 'call', 'message', 'manual')),
  direction text check (direction in ('inbound', 'outbound', 'internal', 'unknown')),
  occurred_at timestamptz,
  subject text,
  source_detail text,
  user_notes_raw text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by text,
  delete_reason text,
  prevent_reimport boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interaction_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email_identity text,
  role text,
  created_at timestamptz not null default now()
);

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

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legacy_referral_id text,
  referred_by_contact_id uuid not null references public.contacts(id) on delete cascade,
  linked_contact_id uuid references public.contacts(id) on delete set null,
  referred_name text not null default '',
  referred_company text not null default '',
  referred_role text not null default '',
  referred_email text not null default '',
  referred_phone text not null default '',
  notes text not null default '',
  status text not null default 'active'
    check (status in ('active', 'dismissed', 'converted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todo_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  todo_type text not null,
  engine_type text not null
    check (engine_type in ('RULE', 'HYBRID', 'AI')),
  action_scope text not null default 'in_app'
    check (action_scope in ('in_app', 'external_action')),
  user_mode text not null default 'confirm_always'
    check (user_mode in ('do_not_suggest', 'confirm_always', 'execute_without_asking')),
  enabled boolean not null default true,
  display_name text not null default '',
  description text not null default '',
  rule_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legacy_todo_id text,
  todo_type text not null,
  engine_type text not null
    check (engine_type in ('RULE', 'HYBRID', 'AI')),
  status text not null default 'active'
    check (status in ('active', 'done', 'dismissed', 'expired', 'auto_resolved')),
  priority smallint not null default 2,
  object_type text,
  object_id uuid,
  current_state text,
  suggested_state text,
  summary text not null default '',
  reason text not null default '',
  evidence text not null default '',
  actions_json jsonb not null default '[]'::jsonb,
  dedup_key text,
  source_fingerprint text,
  supersedes_todo_id uuid references public.todos(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.action_invocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action_name text not null,
  actor_type text not null default 'user'
    check (actor_type in ('user', 'rule', 'ai', 'system')),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'executed', 'failed', 'cancelled')),
  source_todo_id uuid references public.todos(id) on delete set null,
  object_type text,
  object_id uuid,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  error_message text,
  requires_confirmation boolean not null default true,
  confirmed_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.object_review_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  processor_id text not null,
  processor_type text not null
    check (processor_type in ('RULE', 'HYBRID', 'AI')),
  object_type text not null,
  object_id uuid not null,
  object_updated_at timestamptz,
  last_reviewed_at timestamptz,
  last_fingerprint text,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connected_account_id uuid references public.connected_accounts(id) on delete set null,
  provider text not null,
  resource_type text not null,
  cursor_label text not null default '',
  cursor_value text,
  last_synced_at timestamptz,
  status text not null default 'ok'
    check (status in ('ok', 'expired', 'error', 'paused')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null,
  source_filename text,
  manifest_json jsonb not null default '{}'::jsonb,
  validation_report_json jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validated', 'imported', 'failed', 'discarded')),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  export_type text not null,
  manifest_json jsonb not null default '{}'::jsonb,
  file_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  limit_type text not null,
  period text not null,
  max_units integer not null,
  used_units integer not null default 0,
  hard_stop boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  limit_type text not null,
  units integer not null default 1,
  event_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor text not null default 'user',
  action text not null,
  object_type text,
  object_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  metric_key text not null,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  value_numeric numeric not null default 0,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_user_settings_user_key
  on public.user_settings(user_id, setting_key);
create unique index if not exists uq_service_connectors_provider_service
  on public.service_connectors(provider, service_type);
create unique index if not exists uq_contacts_legacy_app_contact_id
  on public.contacts(user_id, legacy_app_contact_id)
  where legacy_app_contact_id is not null and legacy_app_contact_id <> '';
create unique index if not exists uq_contacts_legacy_google_id
  on public.contacts(user_id, legacy_google_id)
  where legacy_google_id is not null and legacy_google_id <> '';
create unique index if not exists uq_external_contact_ids_provider_external
  on public.external_contact_ids(user_id, provider, external_id);
create unique index if not exists uq_contact_emails_user_normalized
  on public.contact_emails(user_id, normalized_email);
create unique index if not exists uq_contact_phones_user_normalized
  on public.contact_phones(user_id, normalized_phone);
create unique index if not exists uq_interactions_legacy_entry_id
  on public.interactions(user_id, legacy_entry_id)
  where legacy_entry_id is not null and legacy_entry_id <> '';
create unique index if not exists uq_external_interaction_sources_provider_external
  on public.external_interaction_sources(user_id, provider, source_service, external_id)
  where is_active = true;
create unique index if not exists uq_referrals_legacy_referral_id
  on public.referrals(user_id, legacy_referral_id)
  where legacy_referral_id is not null and legacy_referral_id <> '';
create unique index if not exists uq_todo_configs_user_type
  on public.todo_configs(user_id, todo_type);
create unique index if not exists uq_todos_legacy_todo_id
  on public.todos(user_id, legacy_todo_id)
  where legacy_todo_id is not null and legacy_todo_id <> '';
create unique index if not exists uq_todos_dedup_key
  on public.todos(user_id, dedup_key)
  where dedup_key is not null and dedup_key <> '';
create index if not exists idx_action_invocations_user_status
  on public.action_invocations(user_id, status);
create index if not exists idx_action_invocations_source_todo
  on public.action_invocations(user_id, source_todo_id);
create unique index if not exists uq_object_review_state_processor_object
  on public.object_review_state(user_id, processor_id, object_type, object_id);
create unique index if not exists uq_sync_cursors_user_resource
  on public.sync_cursors(user_id, provider, resource_type, cursor_label);
create unique index if not exists uq_usage_limits_user_period
  on public.usage_limits(user_id, limit_type, period);
create unique index if not exists uq_metric_snapshots_user_period
  on public.metric_snapshots(user_id, metric_key, period_type, period_start);

create index if not exists idx_contacts_user_status
  on public.contacts(user_id, networking_status);
create index if not exists idx_contacts_user_focus
  on public.contacts(user_id, networking_focus);
create index if not exists idx_contacts_user_hh
  on public.contacts(user_id, is_headhunter);
create index if not exists idx_contact_emails_user_contact
  on public.contact_emails(user_id, contact_id);
create index if not exists idx_contact_phones_user_contact
  on public.contact_phones(user_id, contact_id);
create index if not exists idx_contact_phones_user_last8
  on public.contact_phones(user_id, normalized_phone_last8)
  where normalized_phone_last8 is not null and normalized_phone_last8 <> '';
create index if not exists idx_interactions_user_occurred
  on public.interactions(user_id, occurred_at desc);
create index if not exists idx_interactions_user_active_occurred
  on public.interactions(user_id, is_deleted, occurred_at desc);
create index if not exists idx_interactions_user_thread
  on public.interactions(user_id, provider, provider_thread_id);
create index if not exists idx_interactions_user_prevent_reimport
  on public.interactions(user_id, prevent_reimport)
  where prevent_reimport = true;
create index if not exists idx_interaction_participants_contact
  on public.interaction_participants(user_id, contact_id);
create index if not exists idx_external_interaction_sources_interaction
  on public.external_interaction_sources(user_id, interaction_id);
create index if not exists idx_external_interaction_sources_thread
  on public.external_interaction_sources(user_id, provider, source_service, external_thread_id)
  where external_thread_id is not null and external_thread_id <> '';
create index if not exists idx_external_interaction_sources_prevent_reimport
  on public.external_interaction_sources(user_id, prevent_reimport)
  where prevent_reimport = true;
create index if not exists idx_referrals_user_referred_by
  on public.referrals(user_id, referred_by_contact_id);
create index if not exists idx_referrals_user_linked
  on public.referrals(user_id, linked_contact_id);
create index if not exists idx_todos_user_status
  on public.todos(user_id, status);
create index if not exists idx_usage_events_user_created
  on public.usage_events(user_id, created_at desc);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_service_connectors_updated_at on public.service_connectors;
create trigger set_service_connectors_updated_at
before update on public.service_connectors
for each row execute function public.set_updated_at();

drop trigger if exists set_connected_accounts_updated_at on public.connected_accounts;
create trigger set_connected_accounts_updated_at
before update on public.connected_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_external_contact_ids_updated_at on public.external_contact_ids;
create trigger set_external_contact_ids_updated_at
before update on public.external_contact_ids
for each row execute function public.set_updated_at();

drop trigger if exists set_contact_emails_updated_at on public.contact_emails;
create trigger set_contact_emails_updated_at
before update on public.contact_emails
for each row execute function public.set_updated_at();

drop trigger if exists set_contact_phones_updated_at on public.contact_phones;
create trigger set_contact_phones_updated_at
before update on public.contact_phones
for each row execute function public.set_updated_at();

drop trigger if exists set_interactions_updated_at on public.interactions;
create trigger set_interactions_updated_at
before update on public.interactions
for each row execute function public.set_updated_at();

drop trigger if exists set_external_interaction_sources_updated_at on public.external_interaction_sources;
create trigger set_external_interaction_sources_updated_at
before update on public.external_interaction_sources
for each row execute function public.set_updated_at();

drop trigger if exists set_referrals_updated_at on public.referrals;
create trigger set_referrals_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

drop trigger if exists set_todo_configs_updated_at on public.todo_configs;
create trigger set_todo_configs_updated_at
before update on public.todo_configs
for each row execute function public.set_updated_at();

drop trigger if exists set_todos_updated_at on public.todos;
create trigger set_todos_updated_at
before update on public.todos
for each row execute function public.set_updated_at();

drop trigger if exists set_action_invocations_updated_at on public.action_invocations;
create trigger set_action_invocations_updated_at
before update on public.action_invocations
for each row execute function public.set_updated_at();

drop trigger if exists set_object_review_state_updated_at on public.object_review_state;
create trigger set_object_review_state_updated_at
before update on public.object_review_state
for each row execute function public.set_updated_at();

drop trigger if exists set_sync_cursors_updated_at on public.sync_cursors;
create trigger set_sync_cursors_updated_at
before update on public.sync_cursors
for each row execute function public.set_updated_at();

drop trigger if exists set_import_batches_updated_at on public.import_batches;
create trigger set_import_batches_updated_at
before update on public.import_batches
for each row execute function public.set_updated_at();

drop trigger if exists set_data_exports_updated_at on public.data_exports;
create trigger set_data_exports_updated_at
before update on public.data_exports
for each row execute function public.set_updated_at();

drop trigger if exists set_usage_limits_updated_at on public.usage_limits;
create trigger set_usage_limits_updated_at
before update on public.usage_limits
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.service_connectors enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.external_contact_ids enable row level security;
alter table public.contact_emails enable row level security;
alter table public.contact_phones enable row level security;
alter table public.interactions enable row level security;
alter table public.interaction_participants enable row level security;
alter table public.external_interaction_sources enable row level security;
alter table public.referrals enable row level security;
alter table public.todo_configs enable row level security;
alter table public.todos enable row level security;
alter table public.action_invocations enable row level security;
alter table public.object_review_state enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.import_batches enable row level security;
alter table public.data_exports enable row level security;
alter table public.usage_limits enable row level security;
alter table public.usage_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.metric_snapshots enable row level security;

drop policy if exists "Profiles are owned by auth user" on public.profiles;
create policy "Profiles are owned by auth user"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "User settings are owned by user" on public.user_settings;
create policy "User settings are owned by user"
on public.user_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Service connectors are readable" on public.service_connectors;
create policy "Service connectors are readable"
on public.service_connectors
for select
using (enabled = true);

drop policy if exists "Connected accounts are owned by user" on public.connected_accounts;
create policy "Connected accounts are owned by user"
on public.connected_accounts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Contacts are owned by user" on public.contacts;
create policy "Contacts are owned by user"
on public.contacts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "External contact ids are owned by user" on public.external_contact_ids;
create policy "External contact ids are owned by user"
on public.external_contact_ids
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Contact emails are owned by user" on public.contact_emails;
create policy "Contact emails are owned by user"
on public.contact_emails
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Contact phones are owned by user" on public.contact_phones;
create policy "Contact phones are owned by user"
on public.contact_phones
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Interactions are owned by user" on public.interactions;
create policy "Interactions are owned by user"
on public.interactions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Interaction participants are owned by user" on public.interaction_participants;
create policy "Interaction participants are owned by user"
on public.interaction_participants
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "External interaction sources are owned by user" on public.external_interaction_sources;
create policy "External interaction sources are owned by user"
on public.external_interaction_sources
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Referrals are owned by user" on public.referrals;
create policy "Referrals are owned by user"
on public.referrals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Todo configs are owned by user" on public.todo_configs;
create policy "Todo configs are owned by user"
on public.todo_configs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Todos are owned by user" on public.todos;
create policy "Todos are owned by user"
on public.todos
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Action invocations are owned by user" on public.action_invocations;
create policy "Action invocations are owned by user"
on public.action_invocations
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Object review state is owned by user" on public.object_review_state;
create policy "Object review state is owned by user"
on public.object_review_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Sync cursors are owned by user" on public.sync_cursors;
create policy "Sync cursors are owned by user"
on public.sync_cursors
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Import batches are owned by user" on public.import_batches;
create policy "Import batches are owned by user"
on public.import_batches
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Data exports are owned by user" on public.data_exports;
create policy "Data exports are owned by user"
on public.data_exports
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Usage limits are owned by user" on public.usage_limits;
create policy "Usage limits are owned by user"
on public.usage_limits
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Usage events are owned by user" on public.usage_events;
create policy "Usage events are owned by user"
on public.usage_events
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Audit log is owned by user" on public.audit_log;
create policy "Audit log is owned by user"
on public.audit_log
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Metric snapshots are owned by user" on public.metric_snapshots;
create policy "Metric snapshots are owned by user"
on public.metric_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
