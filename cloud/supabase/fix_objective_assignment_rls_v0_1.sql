-- CRM Networking cloud objective assignments RLS fix v0.1
-- Purpose: make objective assignment reads simple and keep ownership checks on writes.
-- Safe to rerun in the development database.

alter table public.objectives enable row level security;
alter table public.contact_objective_assignments enable row level security;

drop policy if exists "Objectives are owned by user" on public.objectives;
create policy "Objectives are owned by user"
on public.objectives
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Contact objective assignments are owned by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are readable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are insertable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are updatable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are deletable by user" on public.contact_objective_assignments;

create policy "Contact objective assignments are readable by user"
on public.contact_objective_assignments
for select
using (auth.uid() = user_id);

create policy "Contact objective assignments are deletable by user"
on public.contact_objective_assignments
for delete
using (auth.uid() = user_id);

create policy "Contact objective assignments are insertable by user"
on public.contact_objective_assignments
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.contacts contacts_for_assignment
    where contacts_for_assignment.id = contact_objective_assignments.contact_id
      and contacts_for_assignment.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.objectives objectives_for_assignment
    where objectives_for_assignment.id = contact_objective_assignments.objective_id
      and objectives_for_assignment.user_id = auth.uid()
  )
);

create policy "Contact objective assignments are updatable by user"
on public.contact_objective_assignments
for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.contacts contacts_for_assignment
    where contacts_for_assignment.id = contact_objective_assignments.contact_id
      and contacts_for_assignment.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.objectives objectives_for_assignment
    where objectives_for_assignment.id = contact_objective_assignments.objective_id
      and objectives_for_assignment.user_id = auth.uid()
  )
);
