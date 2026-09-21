-- Coffeecito PROD bootstrap: final RLS policies and explicit grants.

begin;

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
alter table public.app_access_allowlist enable row level security;

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

drop policy if exists "App access allowlist is admin readable" on public.app_access_allowlist;
create policy "App access allowlist is admin readable"
on public.app_access_allowlist
for select
to authenticated
using (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "App access allowlist is admin writable" on public.app_access_allowlist;
create policy "App access allowlist is admin writable"
on public.app_access_allowlist
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

-- Start from a fail-closed privilege surface instead of Supabase defaults.
revoke all on schema public from public, anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to authenticated, service_role, supabase_auth_admin;

revoke all on all tables in schema public from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on all sequences in schema public from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on all functions in schema public from public, anon, authenticated, service_role, supabase_auth_admin;

grant select on table
  public.profiles,
  public.user_settings,
  public.service_connectors,
  public.connected_accounts,
  public.contacts,
  public.external_contact_ids,
  public.external_contact_snapshots,
  public.contact_emails,
  public.contact_phones,
  public.headhunter_companies,
  public.headhunter_company_domains,
  public.interactions,
  public.interaction_participants,
  public.external_interaction_sources,
  public.external_interaction_read_diagnostics,
  public.referrals,
  public.todo_configs,
  public.todos,
  public.action_invocations,
  public.object_review_state,
  public.sync_cursors,
  public.import_batches,
  public.data_exports,
  public.usage_limits,
  public.usage_events,
  public.sync_run_logs,
  public.audit_log,
  public.metric_snapshots,
  public.objectives,
  public.contact_objective_assignments,
  public.sync_change_suppressions,
  public.app_capabilities,
  public.app_roles,
  public.app_role_capabilities,
  public.subscription_plans,
  public.subscription_plan_capabilities,
  public.user_access_profiles,
  public.user_role_assignments,
  public.user_capability_overrides,
  public.organizations,
  public.organization_memberships,
  public.user_plan_sponsorships
to authenticated;

grant insert, update on table public.user_settings to authenticated;
grant insert, update on table public.contacts to authenticated;
grant insert, update on table public.external_contact_ids to authenticated;
grant insert, update on table public.external_contact_snapshots to authenticated;
grant insert, update, delete on table public.contact_emails to authenticated;
grant insert, update, delete on table public.contact_phones to authenticated;
grant insert on table public.headhunter_companies to authenticated;
grant insert on table public.headhunter_company_domains to authenticated;
grant insert, update on table public.interactions to authenticated;
grant insert on table public.interaction_participants to authenticated;
grant insert, update on table public.external_interaction_sources to authenticated;
grant insert, update on table public.external_interaction_read_diagnostics to authenticated;
grant insert, update on table public.referrals to authenticated;
grant insert, update on table public.todo_configs to authenticated;
grant insert, update on table public.todos to authenticated;
grant insert, update on table public.action_invocations to authenticated;
grant insert, update on table public.object_review_state to authenticated;
grant insert, update on table public.sync_cursors to authenticated;
grant insert on table public.sync_run_logs to authenticated;
grant insert on table public.audit_log to authenticated;
grant insert, update, delete on table public.objectives to authenticated;
grant insert, delete on table public.contact_objective_assignments to authenticated;
grant insert, update on table public.user_access_profiles to authenticated;
grant insert, update on table public.user_role_assignments to authenticated;

grant execute on function public.current_user_app_access_status() to authenticated;
grant execute on function public.current_user_has_app_access() to authenticated;
grant execute on function public.current_user_has_capability(text) to authenticated;
grant execute on function public.admin_list_app_access_allowlist() to authenticated;
grant execute on function public.admin_authorize_app_access_email(text, text) to authenticated;
grant execute on function public.admin_revoke_app_access_email(text) to authenticated;
grant execute on function public.admin_get_app_access_diagnostic(uuid) to authenticated;
grant execute on function public.merge_contacts_deep(uuid, uuid[], jsonb, text) to authenticated;
grant execute on function public.reset_current_user_app_data_v0_1(text) to authenticated;
grant execute on function public.disconnect_current_user_google_connected_account(uuid) to authenticated;
grant execute on function public.validate_contact_sync_storage_v0_1() to authenticated;

grant execute on function public.finalize_google_connected_account_verified(uuid, text, text[]) to service_role;
grant execute on function public.hook_enforce_app_access_allowlist(jsonb) to supabase_auth_admin;

alter default privileges in schema public revoke all on tables from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role, supabase_auth_admin;

commit;
