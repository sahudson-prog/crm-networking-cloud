-- CRM Networking dev reset v0.2
-- Purpose: clean one Supabase dev user before loading data from connected providers.
-- Destructive: deletes app data for the selected user in public schema.
-- It does not delete auth.users, public.profiles, public.user_settings, service_connectors or connected_accounts.
-- Replace the placeholder UUID before running in Supabase SQL Editor.

create temp table crm_reset_context (
  user_id uuid not null
) on commit drop;

insert into crm_reset_context (user_id)
values ('674317f4-44d6-4311-8460-ecade3ec3620');

do $$
declare
  target_user_id uuid;
begin
  select user_id into target_user_id from pg_temp.crm_reset_context limit 1;

  if target_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Replace the placeholder user_id before running this reset.';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'No public.profiles row found for user_id %', target_user_id;
  end if;

  -- Remove old development-only columns/indexes if they still exist in the database.
  drop index if exists public.uq_contacts_legacy_app_contact_id;
  drop index if exists public.uq_contacts_legacy_google_id;
  drop index if exists public.uq_interactions_legacy_entry_id;
  drop index if exists public.uq_referrals_legacy_referral_id;
  drop index if exists public.uq_todos_legacy_todo_id;

  alter table public.contacts drop column if exists legacy_app_contact_id;
  alter table public.contacts drop column if exists legacy_google_id;
  alter table public.contacts drop column if exists legacy_milestones;
  alter table public.contacts drop column if exists legacy_notes;
  alter table public.interactions drop column if exists legacy_entry_id;
  alter table public.referrals drop column if exists legacy_referral_id;
  alter table public.todos drop column if exists legacy_todo_id;

  -- Clean app data for this user. Keep login/profile/settings/connections so the user can continue testing.
  delete from public.metric_snapshots where user_id = target_user_id;
  delete from public.usage_events where user_id = target_user_id;
  delete from public.usage_limits where user_id = target_user_id;
  delete from public.data_exports where user_id = target_user_id;
  delete from public.import_batches where user_id = target_user_id;
  delete from public.sync_cursors where user_id = target_user_id;
  delete from public.object_review_state where user_id = target_user_id;
  delete from public.action_invocations where user_id = target_user_id;
  delete from public.todos where user_id = target_user_id;
  delete from public.todo_configs where user_id = target_user_id;
  delete from public.referrals where user_id = target_user_id;
  delete from public.external_interaction_sources where user_id = target_user_id;
  delete from public.interaction_participants where user_id = target_user_id;
  delete from public.interactions where user_id = target_user_id;
  delete from public.contact_emails where user_id = target_user_id;
  delete from public.contact_phones where user_id = target_user_id;
  delete from public.external_contact_snapshots where user_id = target_user_id;
  delete from public.external_contact_ids where user_id = target_user_id;
  delete from public.contacts where user_id = target_user_id;
end $$;

with target as (
  select user_id from pg_temp.crm_reset_context limit 1
),
counts as (
  select 'contacts' as table_name, count(*) as remaining_rows from public.contacts, target where contacts.user_id = target.user_id
  union all select 'external_contact_ids', count(*) from public.external_contact_ids, target where external_contact_ids.user_id = target.user_id
  union all select 'contact_emails', count(*) from public.contact_emails, target where contact_emails.user_id = target.user_id
  union all select 'contact_phones', count(*) from public.contact_phones, target where contact_phones.user_id = target.user_id
  union all select 'external_contact_snapshots', count(*) from public.external_contact_snapshots, target where external_contact_snapshots.user_id = target.user_id
  union all select 'interactions', count(*) from public.interactions, target where interactions.user_id = target.user_id
  union all select 'interaction_participants', count(*) from public.interaction_participants, target where interaction_participants.user_id = target.user_id
  union all select 'external_interaction_sources', count(*) from public.external_interaction_sources, target where external_interaction_sources.user_id = target.user_id
  union all select 'referrals', count(*) from public.referrals, target where referrals.user_id = target.user_id
  union all select 'todo_configs', count(*) from public.todo_configs, target where todo_configs.user_id = target.user_id
  union all select 'todos', count(*) from public.todos, target where todos.user_id = target.user_id
  union all select 'action_invocations', count(*) from public.action_invocations, target where action_invocations.user_id = target.user_id
  union all select 'object_review_state', count(*) from public.object_review_state, target where object_review_state.user_id = target.user_id
  union all select 'sync_cursors', count(*) from public.sync_cursors, target where sync_cursors.user_id = target.user_id
  union all select 'import_batches', count(*) from public.import_batches, target where import_batches.user_id = target.user_id
  union all select 'data_exports', count(*) from public.data_exports, target where data_exports.user_id = target.user_id
  union all select 'usage_limits', count(*) from public.usage_limits, target where usage_limits.user_id = target.user_id
  union all select 'usage_events', count(*) from public.usage_events, target where usage_events.user_id = target.user_id
  union all select 'metric_snapshots', count(*) from public.metric_snapshots, target where metric_snapshots.user_id = target.user_id
)
select *
from counts
order by table_name;
