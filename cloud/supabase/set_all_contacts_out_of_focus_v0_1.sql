-- CRM Networking cloud data fix: set current contacts out of networking focus v0.1
-- Purpose: after a broad contact import, reset current user contacts so focus can be selected manually.
-- Safe guard: runs only when the current dev database has contacts for exactly one user.

do $$
declare
  target_user_id uuid;
  user_count integer;
  updated_count integer;
begin
  select count(distinct user_id)
    into user_count
  from public.contacts;

  if user_count = 0 then
    raise notice 'No contacts found. Nothing to update.';
    return;
  end if;

  if user_count > 1 then
    raise exception 'More than one user has contacts. Filter by user_id before running this fix.';
  end if;

  select user_id
    into target_user_id
  from public.contacts
  limit 1;

  update public.contacts
     set networking_focus = false,
         updated_at = now()
   where user_id = target_user_id
     and networking_focus is distinct from false;

  get diagnostics updated_count = row_count;
  raise notice 'Contacts moved out of networking focus: %', updated_count;
end $$;

select
  count(*) as total_contacts,
  count(*) filter (where networking_focus = true) as contacts_in_focus,
  count(*) filter (where networking_focus = false) as contacts_out_of_focus
from public.contacts;
