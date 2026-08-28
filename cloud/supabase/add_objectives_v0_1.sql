-- CRM Networking cloud objectives v0.1
-- Purpose: add user-owned professional search objectives and contact assignments.
-- Safe to rerun in the development database.
-- Review before production and ensure profile/admin policies are aligned.

create table if not exists public.objectives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  objective_name text not null,
  objective_name_normalized text not null,
  objective_type text not null
    check (objective_type in ('COMPANY', 'INDUSTRY', 'ROLE', 'FUNCTION')),
  priority_level text not null default 'MEDIUM'
    check (priority_level in ('HIGH', 'MEDIUM', 'LOW')),
  objective_description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint objectives_name_not_blank check (btrim(objective_name) <> ''),
  constraint objectives_normalized_name_not_blank check (btrim(objective_name_normalized) <> '')
);

create table if not exists public.contact_objective_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  assigned_by_actor text not null default 'user'
    check (assigned_by_actor in ('user', 'coach', 'system', 'import')),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_objectives_user_type_normalized_active
  on public.objectives(user_id, objective_type, objective_name_normalized)
  where is_active = true;

create index if not exists idx_objectives_user_type_active
  on public.objectives(user_id, objective_type, is_active, objective_name);

create unique index if not exists uq_contact_objective_assignments_contact_objective
  on public.contact_objective_assignments(contact_id, objective_id);

create index if not exists idx_contact_objective_assignments_user_contact
  on public.contact_objective_assignments(user_id, contact_id);

create index if not exists idx_contact_objective_assignments_user_objective
  on public.contact_objective_assignments(user_id, objective_id);

drop trigger if exists set_objectives_updated_at on public.objectives;
create trigger set_objectives_updated_at
before update on public.objectives
for each row execute function public.set_updated_at();

drop trigger if exists set_contact_objective_assignments_updated_at on public.contact_objective_assignments;
create trigger set_contact_objective_assignments_updated_at
before update on public.contact_objective_assignments
for each row execute function public.set_updated_at();

alter table public.objectives enable row level security;
alter table public.contact_objective_assignments enable row level security;

drop policy if exists "Objectives are owned by user" on public.objectives;
create policy "Objectives are owned by user"
on public.objectives
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Contact objective assignments are owned by user" on public.contact_objective_assignments;
create policy "Contact objective assignments are owned by user"
on public.contact_objective_assignments
for all
using (
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
)
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
