-- CRM Networking cloud schema v0.1 verification
-- Run this after cloud/supabase/schema_v0_1.sql in Supabase SQL Editor.
-- It only reads metadata; it does not modify data.

with expected_tables(table_name) as (
  values
    ('profiles'),
    ('user_settings'),
    ('service_connectors'),
    ('connected_accounts'),
    ('contacts'),
    ('external_contact_ids'),
    ('contact_emails'),
    ('contact_phones'),
    ('interactions'),
    ('interaction_participants'),
    ('referrals'),
    ('todo_configs'),
    ('todos'),
    ('action_invocations'),
    ('object_review_state'),
    ('sync_cursors'),
    ('import_batches'),
    ('data_exports'),
    ('usage_limits'),
    ('usage_events'),
    ('audit_log'),
    ('metric_snapshots')
),
table_status as (
  select
    e.table_name,
    case when c.table_name is null then false else true end as exists_in_public
  from expected_tables e
  left join information_schema.tables c
    on c.table_schema = 'public'
   and c.table_name = e.table_name
)
select *
from table_status
order by table_name;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'user_settings',
    'service_connectors',
    'connected_accounts',
    'contacts',
    'external_contact_ids',
    'contact_emails',
    'contact_phones',
    'interactions',
    'interaction_participants',
    'referrals',
    'todo_configs',
    'todos',
    'action_invocations',
    'object_review_state',
    'sync_cursors',
    'import_batches',
    'data_exports',
    'usage_limits',
    'usage_events',
    'audit_log',
    'metric_snapshots'
  )
order by c.relname;

select
  schemaname,
  tablename,
  policyname
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'user_settings',
    'service_connectors',
    'connected_accounts',
    'contacts',
    'external_contact_ids',
    'contact_emails',
    'contact_phones',
    'interactions',
    'interaction_participants',
    'referrals',
    'todo_configs',
    'todos',
    'action_invocations',
    'object_review_state',
    'sync_cursors',
    'import_batches',
    'data_exports',
    'usage_limits',
    'usage_events',
    'audit_log',
    'metric_snapshots'
  )
order by tablename, policyname;
