-- CRM Networking dev diagnostic v0.1
-- Purpose: inspect why a Google contact edit is classified as new instead of modified.
-- Read-only: this query does not change data.

with target as (
  select '674317f4-44d6-4311-8460-ecade3ec3620'::uuid as user_id
),
matching_contacts as (
  select
    c.id,
    c.display_name,
    c.company,
    c.role,
    c.networking_status,
    c.networking_focus,
    c.is_active,
    c.created_at,
    c.updated_at
  from public.contacts c
  join target t on t.user_id = c.user_id
  where lower(c.display_name) like '%abdullah%'
),
matching_links as (
  select
    e.contact_id,
    e.external_id,
    e.is_active,
    e.connected_account_id,
    e.last_seen_at,
    e.metadata
  from public.external_contact_ids e
  join target t on t.user_id = e.user_id
  where lower(e.provider) = 'google'
    and (
      e.contact_id in (select id from matching_contacts)
      or lower(e.external_id) like '%abdullah%'
      or e.metadata::text ilike '%abdullah%'
    )
),
matching_snapshots as (
  select
    s.external_id,
    s.display_name,
    s.company,
    s.role,
    s.emails,
    s.phones,
    s.metadata,
    s.is_deleted,
    s.last_seen_at,
    s.updated_at
  from public.external_contact_snapshots s
  join target t on t.user_id = s.user_id
  where lower(s.provider) = 'google'
    and (
      lower(s.display_name) like '%abdullah%'
      or s.external_id in (select external_id from matching_links)
      or s.metadata::text ilike '%abdullah%'
    )
),
link_counts as (
  select
    count(*) filter (where c.id is not null) as active_contacts,
    count(distinct e.external_id) as google_links
  from public.contacts c
  join target t on t.user_id = c.user_id
  left join public.external_contact_ids e
    on e.user_id = c.user_id
   and e.contact_id = c.id
   and lower(e.provider) = 'google'
   and e.is_active = true
  where c.is_active = true
)
select
  '01_contactos_locales' as section,
  id::text as object_id,
  display_name as title,
  jsonb_build_object(
    'company', company,
    'role', role,
    'networking_status', networking_status,
    'networking_focus', networking_focus,
    'is_active', is_active,
    'created_at', created_at,
    'updated_at', updated_at
  ) as detail
from matching_contacts

union all

select
  '02_ids_google_guardados' as section,
  contact_id::text as object_id,
  external_id as title,
  jsonb_build_object(
    'is_active', is_active,
    'connected_account_id', connected_account_id,
    'last_seen_at', last_seen_at,
    'metadata', metadata
  ) as detail
from matching_links

union all

select
  '03_snapshots_google' as section,
  external_id as object_id,
  display_name as title,
  jsonb_build_object(
    'company', company,
    'role', role,
    'emails', emails,
    'phones', phones,
    'is_deleted', is_deleted,
    'last_seen_at', last_seen_at,
    'updated_at', updated_at,
    'metadata', metadata
  ) as detail
from matching_snapshots

union all

select
  '04_conteos_generales' as section,
  'active_contacts_vs_google_links' as object_id,
  'Conteo general' as title,
  jsonb_build_object(
    'active_contacts', active_contacts,
    'google_links', google_links
  ) as detail
from link_counts

order by section, title;
