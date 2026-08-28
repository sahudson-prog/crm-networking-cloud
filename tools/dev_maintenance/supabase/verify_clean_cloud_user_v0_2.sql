-- CRM Networking clean cloud verification v0.2
-- Replace the placeholder UUID before running in Supabase SQL Editor.

with target as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
),
user_counts as (
  select 'contacts' as check_name, count(*) as value from public.contacts, target where contacts.user_id = target.user_id
  union all select 'external_contact_ids', count(*) from public.external_contact_ids, target where external_contact_ids.user_id = target.user_id
  union all select 'external_contact_snapshots', count(*) from public.external_contact_snapshots, target where external_contact_snapshots.user_id = target.user_id
  union all select 'contact_emails', count(*) from public.contact_emails, target where contact_emails.user_id = target.user_id
  union all select 'contact_phones', count(*) from public.contact_phones, target where contact_phones.user_id = target.user_id
  union all select 'interactions', count(*) from public.interactions, target where interactions.user_id = target.user_id
  union all select 'interaction_participants', count(*) from public.interaction_participants, target where interaction_participants.user_id = target.user_id
  union all select 'external_interaction_sources', count(*) from public.external_interaction_sources, target where external_interaction_sources.user_id = target.user_id
  union all select 'referrals', count(*) from public.referrals, target where referrals.user_id = target.user_id
  union all select 'todos', count(*) from public.todos, target where todos.user_id = target.user_id
  union all select 'sync_cursors', count(*) from public.sync_cursors, target where sync_cursors.user_id = target.user_id
),
schema_checks as (
  select
    'legacy_columns' as check_name,
    count(*) as value
  from information_schema.columns
  where table_schema = 'public'
    and column_name like 'legacy_%'
)
select
  check_name,
  value,
  case when value = 0 then 'ok' else 'revisar' end as status
from user_counts
union all
select
  check_name,
  value,
  case when value = 0 then 'ok' else 'revisar' end as status
from schema_checks
order by check_name;
