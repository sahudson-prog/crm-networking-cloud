-- Coffeecito closed beta access enforcement v0.1
-- Purpose:
-- - Activate a central effective-access decision.
-- - Make capabilities and app-owned RLS depend on that decision.
-- - Make the auth user creation trigger fail-closed if the Auth Hook is not active.
--
-- Apply only after:
-- 1. add_app_access_allowlist_foundation_v0_1.sql
-- 2. the existing admin email has been added to public.app_access_allowlist
-- 3. verify_app_access_allowlist_foundation_v0_1.sql passes
--
-- This migration does not enable the remote Auth Hook by itself.

begin;

create or replace function public.current_user_app_access_status()
returns table(allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_email_normalized text;
  v_revoked_at timestamptz;
  v_account_status text;
  v_beta_access_status text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  select auth_user.email
  into v_email
  from auth.users auth_user
  where auth_user.id = v_user_id;

  if not found then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_user_id
  ) then
    return query select false, 'profile_missing'::text;
    return;
  end if;

  v_email_normalized := public.normalize_app_access_email(v_email);

  select allowlist.revoked_at
  into v_revoked_at
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email_normalized;

  if not found then
    return query select false, 'not_allowlisted'::text;
    return;
  end if;

  if v_revoked_at is not null then
    return query select false, 'revoked'::text;
    return;
  end if;

  select access_profile.account_status, access_profile.beta_access_status
  into v_account_status, v_beta_access_status
  from public.user_access_profiles access_profile
  where access_profile.user_id = v_user_id;

  if not found or v_account_status <> 'active' then
    return query select false, 'account_inactive'::text;
    return;
  end if;

  if v_beta_access_status <> 'approved' then
    return query select false, 'access_not_approved'::text;
    return;
  end if;

  return query select true, 'allowed'::text;
end;
$$;

create or replace function public.current_user_has_app_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select access_status.allowed
    from public.current_user_app_access_status() access_status
    limit 1
  ), false);
$$;

create or replace function public.current_user_has_capability(p_capability_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_profile as (
    select auth.uid() as user_id
  ),
  active_user as (
    select user_id
    from current_profile
    where user_id is not null
      and public.current_user_has_app_access()
  ),
  denied as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode = 'deny'
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  explicit_grant as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode in ('grant', 'limit')
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  role_grant as (
    select 1
    from public.user_role_assignments assignment
    join public.app_role_capabilities role_capability
      on role_capability.role_code = assignment.role_code
    join public.app_roles role
      on role.role_code = assignment.role_code
    join active_user on active_user.user_id = assignment.user_id
    where role_capability.capability_code = p_capability_code
      and assignment.is_active = true
      and role.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    limit 1
  ),
  plan_grant as (
    select 1
    from public.user_access_profiles access_profile
    join public.subscription_plans plan
      on plan.plan_code = access_profile.plan_code
    join public.subscription_plan_capabilities plan_capability
      on plan_capability.plan_code = access_profile.plan_code
    join active_user on active_user.user_id = access_profile.user_id
    where plan_capability.capability_code = p_capability_code
      and access_profile.account_status = 'active'
      and access_profile.beta_access_status = 'approved'
      and plan.is_active = true
    limit 1
  )
  select exists(select 1 from active_user)
    and not exists(select 1 from denied)
    and (
      exists(select 1 from explicit_grant)
      or exists(select 1 from role_grant)
      or exists(select 1 from plan_grant)
    );
$$;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_authorized boolean;
begin
  v_is_authorized := public.is_email_authorized_for_app_access(new.email);

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

  if v_is_authorized then
    insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
    values (new.id, 'beta_personal', 'active', 'approved')
    on conflict (user_id) do update
    set account_status = 'active',
        beta_access_status = 'approved',
        plan_code = coalesce(public.user_access_profiles.plan_code, excluded.plan_code);

    insert into public.user_role_assignments (user_id, role_code, assignment_reason)
    values (new.id, 'user', 'Asignacion automatica al crear cuenta autorizada')
    on conflict do nothing;
  else
    insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
    values (new.id, 'beta_personal', 'beta_pending', 'pending')
    on conflict (user_id) do update
    set account_status = case
          when public.user_access_profiles.account_status = 'closed' then 'closed'
          else 'beta_pending'
        end,
        beta_access_status = case
          when public.user_access_profiles.beta_access_status = 'blocked' then 'blocked'
          else 'pending'
        end;
  end if;

  return new;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.service_connectors enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.external_contact_ids enable row level security;
alter table public.external_contact_snapshots enable row level security;
alter table public.contact_emails enable row level security;
alter table public.contact_phones enable row level security;
alter table public.headhunter_companies enable row level security;
alter table public.headhunter_company_domains enable row level security;
alter table public.interactions enable row level security;
alter table public.interaction_participants enable row level security;
alter table public.external_interaction_sources enable row level security;
alter table public.external_interaction_read_diagnostics enable row level security;
alter table public.referrals enable row level security;
alter table public.todo_configs enable row level security;
alter table public.todos enable row level security;
alter table public.action_invocations enable row level security;
alter table public.object_review_state enable row level security;
alter table public.sync_cursors enable row level security;
alter table public.import_batches enable row level security;
alter table public.data_exports enable row level security;
alter table public.usage_limits enable row level security;
alter table public.usage_events enable row level security;
alter table public.sync_run_logs enable row level security;
alter table public.audit_log enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.objectives enable row level security;
alter table public.contact_objective_assignments enable row level security;
alter table public.sync_change_suppressions enable row level security;
alter table public.app_capabilities enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_role_capabilities enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_capabilities enable row level security;
alter table public.user_access_profiles enable row level security;
alter table public.user_role_assignments enable row level security;
alter table public.user_capability_overrides enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.user_plan_sponsorships enable row level security;

drop policy if exists "Profiles are owned by auth user" on public.profiles;
create policy "Profiles are owned by auth user"
on public.profiles
for all
using (
  (auth.uid() = id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
)
with check (
  (auth.uid() = id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "User settings are owned by user" on public.user_settings;
create policy "User settings are owned by user"
on public.user_settings
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Service connectors are readable" on public.service_connectors;
create policy "Service connectors are readable"
on public.service_connectors
for select
to authenticated
using (enabled = true and public.current_user_has_app_access());

drop policy if exists "Connected accounts are owned by user" on public.connected_accounts;
create policy "Connected accounts are owned by user"
on public.connected_accounts
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Contacts are owned by user" on public.contacts;
create policy "Contacts are owned by user"
on public.contacts
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "External contact ids are owned by user" on public.external_contact_ids;
create policy "External contact ids are owned by user"
on public.external_contact_ids
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "External contact snapshots are owned by user" on public.external_contact_snapshots;
create policy "External contact snapshots are owned by user"
on public.external_contact_snapshots
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Contact emails are owned by user" on public.contact_emails;
create policy "Contact emails are owned by user"
on public.contact_emails
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Contact phones are owned by user" on public.contact_phones;
create policy "Contact phones are owned by user"
on public.contact_phones
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Headhunter companies are owned by user" on public.headhunter_companies;
drop policy if exists "Headhunter companies are globally readable" on public.headhunter_companies;
drop policy if exists "Headhunter companies are manageable in beta" on public.headhunter_companies;
drop policy if exists "Headhunter companies are admin writable" on public.headhunter_companies;
create policy "Headhunter companies are globally readable"
on public.headhunter_companies
for select
to authenticated
using (is_active = true and public.current_user_has_app_access());
create policy "Headhunter companies are admin writable"
on public.headhunter_companies
for all
to authenticated
using (public.current_user_has_capability('admin.manage_global_masters'))
with check (public.current_user_has_capability('admin.manage_global_masters'));

drop policy if exists "Headhunter company domains are owned by user" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are globally readable" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are manageable in beta" on public.headhunter_company_domains;
drop policy if exists "Headhunter company domains are admin writable" on public.headhunter_company_domains;
create policy "Headhunter company domains are globally readable"
on public.headhunter_company_domains
for select
to authenticated
using (is_active = true and public.current_user_has_app_access());
create policy "Headhunter company domains are admin writable"
on public.headhunter_company_domains
for all
to authenticated
using (public.current_user_has_capability('admin.manage_global_masters'))
with check (public.current_user_has_capability('admin.manage_global_masters'));

drop policy if exists "Interactions are owned by user" on public.interactions;
create policy "Interactions are owned by user"
on public.interactions
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Interaction participants are owned by user" on public.interaction_participants;
create policy "Interaction participants are owned by user"
on public.interaction_participants
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "External interaction sources are owned by user" on public.external_interaction_sources;
create policy "External interaction sources are owned by user"
on public.external_interaction_sources
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "External interaction read diagnostics are owned by user" on public.external_interaction_read_diagnostics;
create policy "External interaction read diagnostics are owned by user"
on public.external_interaction_read_diagnostics
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Referrals are owned by user" on public.referrals;
create policy "Referrals are owned by user"
on public.referrals
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Todo configs are owned by user" on public.todo_configs;
create policy "Todo configs are owned by user"
on public.todo_configs
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Todos are owned by user" on public.todos;
create policy "Todos are owned by user"
on public.todos
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Action invocations are owned by user" on public.action_invocations;
create policy "Action invocations are owned by user"
on public.action_invocations
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Object review state is owned by user" on public.object_review_state;
create policy "Object review state is owned by user"
on public.object_review_state
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Sync cursors are owned by user" on public.sync_cursors;
create policy "Sync cursors are owned by user"
on public.sync_cursors
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Import batches are owned by user" on public.import_batches;
create policy "Import batches are owned by user"
on public.import_batches
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Data exports are owned by user" on public.data_exports;
create policy "Data exports are owned by user"
on public.data_exports
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Usage limits are owned by user" on public.usage_limits;
create policy "Usage limits are owned by user"
on public.usage_limits
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Usage events are owned by user" on public.usage_events;
create policy "Usage events are owned by user"
on public.usage_events
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Sync run logs are owned by user" on public.sync_run_logs;
create policy "Sync run logs are owned by user"
on public.sync_run_logs
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Audit log is owned by user" on public.audit_log;
create policy "Audit log is owned by user"
on public.audit_log
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Metric snapshots are owned by user" on public.metric_snapshots;
create policy "Metric snapshots are owned by user"
on public.metric_snapshots
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Objectives are owned by user" on public.objectives;
create policy "Objectives are owned by user"
on public.objectives
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Contact objective assignments are owned by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are readable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are insertable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are updatable by user" on public.contact_objective_assignments;
drop policy if exists "Contact objective assignments are deletable by user" on public.contact_objective_assignments;

create policy "Contact objective assignments are readable by user"
on public.contact_objective_assignments
for select
using (auth.uid() = user_id and public.current_user_has_app_access());

create policy "Contact objective assignments are deletable by user"
on public.contact_objective_assignments
for delete
using (auth.uid() = user_id and public.current_user_has_app_access());

create policy "Contact objective assignments are insertable by user"
on public.contact_objective_assignments
for insert
with check (
  auth.uid() = user_id
  and public.current_user_has_app_access()
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
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (
  auth.uid() = user_id
  and public.current_user_has_app_access()
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

drop policy if exists "Sync change suppressions are owned by user" on public.sync_change_suppressions;
create policy "Sync change suppressions are owned by user"
on public.sync_change_suppressions
for all
using (auth.uid() = user_id and public.current_user_has_app_access())
with check (auth.uid() = user_id and public.current_user_has_app_access());

drop policy if exists "Capabilities are readable" on public.app_capabilities;
create policy "Capabilities are readable"
on public.app_capabilities
for select
to authenticated
using (is_active = true and public.current_user_has_app_access());

drop policy if exists "Capabilities are admin manageable" on public.app_capabilities;
create policy "Capabilities are admin manageable"
on public.app_capabilities
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Roles are readable" on public.app_roles;
create policy "Roles are readable"
on public.app_roles
for select
to authenticated
using (is_active = true and public.current_user_has_app_access());

drop policy if exists "Roles are admin manageable" on public.app_roles;
create policy "Roles are admin manageable"
on public.app_roles
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Role capabilities are readable" on public.app_role_capabilities;
create policy "Role capabilities are readable"
on public.app_role_capabilities
for select
to authenticated
using (public.current_user_has_app_access());

drop policy if exists "Role capabilities are admin manageable" on public.app_role_capabilities;
create policy "Role capabilities are admin manageable"
on public.app_role_capabilities
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Plans are readable" on public.subscription_plans;
create policy "Plans are readable"
on public.subscription_plans
for select
to authenticated
using (is_active = true and public.current_user_has_app_access());

drop policy if exists "Plans are admin manageable" on public.subscription_plans;
create policy "Plans are admin manageable"
on public.subscription_plans
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Plan capabilities are readable" on public.subscription_plan_capabilities;
create policy "Plan capabilities are readable"
on public.subscription_plan_capabilities
for select
to authenticated
using (public.current_user_has_app_access());

drop policy if exists "Plan capabilities are admin manageable" on public.subscription_plan_capabilities;
create policy "Plan capabilities are admin manageable"
on public.subscription_plan_capabilities
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User access profiles are visible to owner or admin" on public.user_access_profiles;
create policy "User access profiles are visible to owner or admin"
on public.user_access_profiles
for select
to authenticated
using (
  (auth.uid() = user_id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "User access profiles are admin manageable" on public.user_access_profiles;
create policy "User access profiles are admin manageable"
on public.user_access_profiles
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User roles are visible to owner or admin" on public.user_role_assignments;
create policy "User roles are visible to owner or admin"
on public.user_role_assignments
for select
to authenticated
using (
  (auth.uid() = user_id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "User roles are admin manageable" on public.user_role_assignments;
create policy "User roles are admin manageable"
on public.user_role_assignments
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User capability overrides are visible to owner or admin" on public.user_capability_overrides;
create policy "User capability overrides are visible to owner or admin"
on public.user_capability_overrides
for select
to authenticated
using (
  (auth.uid() = user_id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "User capability overrides are admin manageable" on public.user_capability_overrides;
create policy "User capability overrides are admin manageable"
on public.user_capability_overrides
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Organizations are visible to members or admin" on public.organizations;
create policy "Organizations are visible to members or admin"
on public.organizations
for select
to authenticated
using (
  public.current_user_has_app_access()
  and (
    public.current_user_has_capability('admin.manage_access')
    or exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = organizations.id
        and membership.user_id = auth.uid()
        and membership.membership_status = 'active'
    )
  )
);

drop policy if exists "Organizations are admin manageable" on public.organizations;
create policy "Organizations are admin manageable"
on public.organizations
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Organization memberships are visible to owner or admin" on public.organization_memberships;
create policy "Organization memberships are visible to owner or admin"
on public.organization_memberships
for select
to authenticated
using (
  (auth.uid() = user_id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "Organization memberships are admin manageable" on public.organization_memberships;
create policy "Organization memberships are admin manageable"
on public.organization_memberships
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User plan sponsorships are visible to owner or admin" on public.user_plan_sponsorships;
create policy "User plan sponsorships are visible to owner or admin"
on public.user_plan_sponsorships
for select
to authenticated
using (
  (auth.uid() = user_id and public.current_user_has_app_access())
  or public.current_user_has_capability('admin.manage_access')
);

drop policy if exists "User plan sponsorships are admin manageable" on public.user_plan_sponsorships;
create policy "User plan sponsorships are admin manageable"
on public.user_plan_sponsorships
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

revoke execute on function public.current_user_app_access_status() from public;
revoke execute on function public.current_user_app_access_status() from anon;
grant execute on function public.current_user_app_access_status() to authenticated;

revoke execute on function public.current_user_has_app_access() from public;
revoke execute on function public.current_user_has_app_access() from anon;
grant execute on function public.current_user_has_app_access() to authenticated;

revoke execute on function public.current_user_has_capability(text) from public;
revoke execute on function public.current_user_has_capability(text) from anon;
grant execute on function public.current_user_has_capability(text) to authenticated;

comment on function public.current_user_app_access_status() is 'RPC minima read-only para que frontend y diagnostico consulten si el usuario actual puede usar Coffeecito y por que.';
comment on function public.current_user_has_app_access() is 'Decision booleana central de acceso efectivo: sesion, perfil, allowlist activa y access profile activo/aprobado.';
comment on function public.current_user_has_capability(text) is 'Evalua capabilities solo si el usuario actual tiene acceso efectivo a Coffeecito.';
comment on function public.handle_new_auth_user_profile() is 'Crea perfil al alta Auth. Falla cerrado: usuarios no allowlisted quedan pendientes y sin rol base automatico.';

commit;
