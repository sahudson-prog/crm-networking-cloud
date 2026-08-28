-- CRM Networking dev data fix v0.1
-- Purpose: after a Google Contacts import, keep imported pending contacts out of active networking focus.
-- Scope: only the selected dev user, active contacts, status Pendiente, linked to Google.
-- It does not change name, company, role, emails, phones, networking status, headhunter mark or Google links.

create temp table crm_focus_fix_context (
  user_id uuid not null
) on commit drop;

insert into crm_focus_fix_context (user_id)
values ('674317f4-44d6-4311-8460-ecade3ec3620');

alter table public.contacts
  alter column networking_focus set default false;

with target as (
  select user_id from pg_temp.crm_focus_fix_context limit 1
),
candidates_before as (
  select c.id
  from public.contacts c
  join target t on t.user_id = c.user_id
  where c.is_active = true
    and c.networking_focus = true
    and c.networking_status = 'Pendiente'
    and exists (
      select 1
      from public.external_contact_ids e
      where e.user_id = c.user_id
        and e.contact_id = c.id
        and lower(e.provider) = 'google'
        and e.is_active = true
    )
),
updated as (
  update public.contacts c
     set networking_focus = false
  from candidates_before b
  where c.id = b.id
  returning c.id
),
candidates_after as (
  select c.id
  from public.contacts c
  join target t on t.user_id = c.user_id
  where c.is_active = true
    and c.networking_focus = true
    and c.networking_status = 'Pendiente'
    and exists (
      select 1
      from public.external_contact_ids e
      where e.user_id = c.user_id
        and e.contact_id = c.id
        and lower(e.provider) = 'google'
        and e.is_active = true
    )
),
google_non_pending_still_focus as (
  select c.id
  from public.contacts c
  join target t on t.user_id = c.user_id
  where c.is_active = true
    and c.networking_focus = true
    and c.networking_status <> 'Pendiente'
    and exists (
      select 1
      from public.external_contact_ids e
      where e.user_id = c.user_id
        and e.contact_id = c.id
        and lower(e.provider) = 'google'
        and e.is_active = true
    )
)
select
  (select count(*) from candidates_before) as google_pending_focus_before,
  (select count(*) from updated) as updated_rows,
  (select count(*) from candidates_after) as google_pending_focus_after,
  (select count(*) from google_non_pending_still_focus) as google_non_pending_still_in_focus;
