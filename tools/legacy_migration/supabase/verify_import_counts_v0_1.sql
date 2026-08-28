-- CRM Networking import count verification v0.1
-- Replace the UUID below with the imported Supabase Auth user id before running.
-- This query only reads counts.

with target_user as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
expected(table_name, expected_count) as (
  values
    ('profiles', 1),
    ('user_settings', 1),
    ('contacts', 1357),
    ('external_contact_ids', 1356),
    ('contact_emails', 434),
    ('contact_phones', 1463),
    ('interactions', 232),
    ('interaction_participants', 233),
    ('referrals', 6),
    ('todo_configs', 18),
    ('todos', 22),
    ('object_review_state', 0),
    ('sync_cursors', 3),
    ('import_batches', 1)
),
actual(table_name, actual_count) as (
  select 'profiles', count(*) from public.profiles p join target_user u on p.id = u.user_id
  union all select 'user_settings', count(*) from public.user_settings t join target_user u on t.user_id = u.user_id
  union all select 'contacts', count(*) from public.contacts t join target_user u on t.user_id = u.user_id
  union all select 'external_contact_ids', count(*) from public.external_contact_ids t join target_user u on t.user_id = u.user_id
  union all select 'contact_emails', count(*) from public.contact_emails t join target_user u on t.user_id = u.user_id
  union all select 'contact_phones', count(*) from public.contact_phones t join target_user u on t.user_id = u.user_id
  union all select 'interactions', count(*) from public.interactions t join target_user u on t.user_id = u.user_id
  union all select 'interaction_participants', count(*) from public.interaction_participants t join target_user u on t.user_id = u.user_id
  union all select 'referrals', count(*) from public.referrals t join target_user u on t.user_id = u.user_id
  union all select 'todo_configs', count(*) from public.todo_configs t join target_user u on t.user_id = u.user_id
  union all select 'todos', count(*) from public.todos t join target_user u on t.user_id = u.user_id
  union all select 'object_review_state', count(*) from public.object_review_state t join target_user u on t.user_id = u.user_id
  union all select 'sync_cursors', count(*) from public.sync_cursors t join target_user u on t.user_id = u.user_id
  union all select 'import_batches', count(*) from public.import_batches t join target_user u on t.user_id = u.user_id
)
select
  e.table_name,
  e.expected_count,
  a.actual_count,
  (e.expected_count = a.actual_count) as matches_expected
from expected e
left join actual a on a.table_name = e.table_name
order by e.table_name;
