-- CRM Networking dev diagnostic v0.1
-- Purpose: inspect why a Google contact appears as new even if it seems present in the app.
-- Read-only: these queries do not change data.
--
-- Ready for Sergio dev user:
-- user_id = 674317f4-44d6-4311-8460-ecade3ec3620
-- search_text = alienor
-- To inspect another contact, change only the value in the params block.
--
-- Run each query separately. Do not run all blocks at once if Supabase is low on temp space.

-- 01. Find matching app contacts by name or email.
with params as (
  select
    '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id,
    'alienor'::text as search_text
)
select
  c.id as contact_id,
  c.display_name,
  c.company,
  c.role,
  c.networking_status,
  c.networking_focus,
  c.is_active,
  c.created_at,
  c.updated_at
from public.contacts c
cross join params p
where c.user_id = p.user_id
  and c.is_active = true
  and (
    lower(coalesce(c.display_name, '')) like '%' || lower(p.search_text) || '%'
    or exists (
      select 1
      from public.contact_emails ce
      where ce.user_id = c.user_id
        and ce.contact_id = c.id
        and lower(coalesce(ce.email, '')) like '%' || lower(p.search_text) || '%'
    )
  )
order by c.display_name
limit 25;

-- 02. After query 01, copy the contact_id for Alienor.
-- Then replace the null below with that id, for example:
-- 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid as contact_id
-- Shows emails, phones and saved Google IDs for that app contact.
with params as (
  select
    '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id,
    null::uuid as contact_id
)
select
  'email' as section,
  ce.contact_id,
  ce.email as value,
  ce.normalized_email as normalized_value,
  ce.source,
  ce.is_primary,
  null::text as google_external_id,
  null::boolean as google_id_active,
  null::timestamptz as google_last_seen_at
from public.contact_emails ce
cross join params p
where ce.user_id = p.user_id
  and ce.contact_id = p.contact_id

union all

select
  'phone' as section,
  cp.contact_id,
  cp.phone as value,
  cp.normalized_phone as normalized_value,
  cp.source,
  cp.is_primary,
  null::text as google_external_id,
  null::boolean as google_id_active,
  null::timestamptz as google_last_seen_at
from public.contact_phones cp
cross join params p
where cp.user_id = p.user_id
  and cp.contact_id = p.contact_id

union all

select
  'google_id' as section,
  e.contact_id,
  null::text as value,
  null::text as normalized_value,
  null::text as source,
  null::boolean as is_primary,
  e.external_id as google_external_id,
  e.is_active as google_id_active,
  e.last_seen_at as google_last_seen_at
from public.external_contact_ids e
cross join params p
where e.user_id = p.user_id
  and e.contact_id = p.contact_id
  and lower(e.provider) = 'google'
order by section, value nulls last, google_external_id nulls last;

-- 03. After query 02, copy the google_external_id and replace GOOGLE_EXTERNAL_ID_HERE.
-- Then replace the null below with that id, for example:
-- 'people/c1234567890'::text as google_external_id
-- Shows the last saved snapshot for that Google contact.
with params as (
  select
    '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id,
    null::text as google_external_id
)
select
  s.external_id,
  s.display_name,
  s.company,
  s.role,
  s.emails,
  s.phones,
  s.is_deleted,
  s.last_seen_at,
  s.updated_at,
  s.metadata->'previous_resource_names' as previous_resource_names
from public.external_contact_snapshots s
cross join params p
where s.user_id = p.user_id
  and lower(s.provider) = 'google'
  and s.external_id = p.google_external_id
limit 5;

-- 04. Small general counts. Use this only after the targeted checks above.
with params as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
)
select
  (select count(*)
   from public.contacts c
   cross join params p
   where c.user_id = p.user_id
     and c.is_active = true) as active_contacts,
  (select count(*)
   from public.external_contact_ids e
   cross join params p
   where e.user_id = p.user_id
     and lower(e.provider) = 'google'
     and e.is_active = true) as active_google_links,
  (select count(*)
   from public.external_contact_snapshots s
   cross join params p
   where s.user_id = p.user_id
     and lower(s.provider) = 'google'
     and coalesce(s.is_deleted, false) = false) as active_google_snapshots;
