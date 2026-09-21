-- Coffeecito closed beta access enforcement verifier v0.1
-- Purpose: validate effective access enforcement without printing emails or personal data.

with function_refs as (
  select
    to_regprocedure('public.current_user_app_access_status()') as access_status_fn,
    to_regprocedure('public.current_user_has_app_access()') as has_app_access_fn,
    to_regprocedure('public.current_user_has_capability(text)') as has_capability_fn,
    to_regprocedure('public.handle_new_auth_user_profile()') as auth_trigger_fn,
    to_regrole('anon') as anon_role,
    to_regrole('authenticated') as authenticated_role
),
function_security as (
  select
    pg_proc.oid,
    pg_proc.prosecdef,
    array_to_string(coalesce(pg_proc.proconfig, array[]::text[]), ',') as function_config,
    exists (
      select 1
      from aclexplode(coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))) privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) as public_can_execute
  from pg_proc
  where pg_proc.oid in (
    select access_status_fn from function_refs where access_status_fn is not null
    union all
    select has_app_access_fn from function_refs where has_app_access_fn is not null
    union all
    select has_capability_fn from function_refs where has_capability_fn is not null
    union all
    select auth_trigger_fn from function_refs where auth_trigger_fn is not null
  )
),
function_defs as (
  select
    case
      when access_status_fn is null then ''
      else pg_get_functiondef(access_status_fn)
    end as access_status_definition,
    case
      when has_capability_fn is null then ''
      else pg_get_functiondef(has_capability_fn)
    end as capability_definition,
    case
      when auth_trigger_fn is null then ''
      else pg_get_functiondef(auth_trigger_fn)
    end as trigger_definition
  from function_refs
),
app_owned_policy_tables(table_name, policy_name) as (
  values
    ('profiles', 'Profiles are owned by auth user'),
    ('user_settings', 'User settings are owned by user'),
    ('connected_accounts', 'Connected accounts are owned by user'),
    ('contacts', 'Contacts are owned by user'),
    ('external_contact_ids', 'External contact ids are owned by user'),
    ('external_contact_snapshots', 'External contact snapshots are owned by user'),
    ('contact_emails', 'Contact emails are owned by user'),
    ('contact_phones', 'Contact phones are owned by user'),
    ('interactions', 'Interactions are owned by user'),
    ('interaction_participants', 'Interaction participants are owned by user'),
    ('external_interaction_sources', 'External interaction sources are owned by user'),
    ('external_interaction_read_diagnostics', 'External interaction read diagnostics are owned by user'),
    ('referrals', 'Referrals are owned by user'),
    ('todo_configs', 'Todo configs are owned by user'),
    ('todos', 'Todos are owned by user'),
    ('action_invocations', 'Action invocations are owned by user'),
    ('object_review_state', 'Object review state is owned by user'),
    ('sync_cursors', 'Sync cursors are owned by user'),
    ('import_batches', 'Import batches are owned by user'),
    ('data_exports', 'Data exports are owned by user'),
    ('usage_limits', 'Usage limits are owned by user'),
    ('usage_events', 'Usage events are owned by user'),
    ('sync_run_logs', 'Sync run logs are owned by user'),
    ('audit_log', 'Audit log is owned by user'),
    ('metric_snapshots', 'Metric snapshots are owned by user'),
    ('objectives', 'Objectives are owned by user'),
    ('sync_change_suppressions', 'Sync change suppressions are owned by user')
),
contact_objective_policy_names(policy_name) as (
  values
    ('Contact objective assignments are readable by user'),
    ('Contact objective assignments are insertable by user'),
    ('Contact objective assignments are updatable by user'),
    ('Contact objective assignments are deletable by user')
),
global_read_policy_tables(table_name, policy_name) as (
  values
    ('service_connectors', 'Service connectors are readable'),
    ('headhunter_companies', 'Headhunter companies are globally readable'),
    ('headhunter_company_domains', 'Headhunter company domains are globally readable'),
    ('app_capabilities', 'Capabilities are readable'),
    ('app_roles', 'Roles are readable'),
    ('app_role_capabilities', 'Role capabilities are readable'),
    ('subscription_plans', 'Plans are readable'),
    ('subscription_plan_capabilities', 'Plan capabilities are readable')
),
access_admin_policy_tables(table_name, policy_name) as (
  values
    ('user_access_profiles', 'User access profiles are visible to owner or admin'),
    ('user_access_profiles', 'User access profiles are admin manageable'),
    ('user_role_assignments', 'User roles are visible to owner or admin'),
    ('user_role_assignments', 'User roles are admin manageable'),
    ('user_capability_overrides', 'User capability overrides are visible to owner or admin'),
    ('user_capability_overrides', 'User capability overrides are admin manageable'),
    ('organizations', 'Organizations are visible to members or admin'),
    ('organizations', 'Organizations are admin manageable'),
    ('organization_memberships', 'Organization memberships are visible to owner or admin'),
    ('organization_memberships', 'Organization memberships are admin manageable'),
    ('user_plan_sponsorships', 'User plan sponsorships are visible to owner or admin'),
    ('user_plan_sponsorships', 'User plan sponsorships are admin manageable')
),
enforcement_checks as (
  select
    'funcion' as check_area,
    'current_user_app_access_status' as checked_object,
    case when access_status_fn is not null then 'PASS' else 'FAIL' end as observed_status,
    case when access_status_fn is not null then 1 else 0 end as observed_count
  from function_refs
  union all
  select
    'funcion',
    'current_user_has_app_access',
    case when has_app_access_fn is not null then 'PASS' else 'FAIL' end,
    case when has_app_access_fn is not null then 1 else 0 end
  from function_refs
  union all
  select
    'funcion',
    'security_definer_functions_have_fixed_search_path',
    case when count(*) = 4 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from function_security
  where oid in (
      select access_status_fn from function_refs
      union all
      select has_app_access_fn from function_refs
      union all
      select has_capability_fn from function_refs
      union all
      select auth_trigger_fn from function_refs
    )
    and prosecdef = true
    and function_config like '%search_path%'
  union all
  select
    'rpc',
    'access_status_granted_only_to_authenticated',
    case
      when access_status_fn is not null
        and authenticated_role is not null
        and has_function_privilege(authenticated_role, access_status_fn, 'EXECUTE')
        and anon_role is not null
        and not has_function_privilege(anon_role, access_status_fn, 'EXECUTE')
        and not exists (
          select 1
          from function_security
          where function_security.oid = access_status_fn
            and function_security.public_can_execute = true
        )
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_refs
  union all
  select
    'grant',
    'has_app_access_granted_only_to_authenticated',
    case
      when has_app_access_fn is not null
        and authenticated_role is not null
        and has_function_privilege(authenticated_role, has_app_access_fn, 'EXECUTE')
        and anon_role is not null
        and not has_function_privilege(anon_role, has_app_access_fn, 'EXECUTE')
        and not exists (
          select 1
          from function_security
          where function_security.oid = has_app_access_fn
            and function_security.public_can_execute = true
        )
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_refs
  union all
  select
    'grant',
    'capability_not_granted_to_anon',
    case
      when has_capability_fn is not null
        and anon_role is not null
        and not has_function_privilege(anon_role, has_capability_fn, 'EXECUTE')
        and not exists (
          select 1
          from function_security
          where function_security.oid = has_capability_fn
            and function_security.public_can_execute = true
        )
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_refs
  union all
  select
    'capability',
    'current_user_has_capability_guarded_by_app_access',
    case
      when exists (
        select 1
        from pg_depend dependency
        join function_refs on true
        where dependency.objid = function_refs.has_capability_fn
          and dependency.refobjid = function_refs.has_app_access_fn
      )
      or capability_definition like '%current_user_has_app_access%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'auth_email',
    'access_status_uses_auth_users_not_profiles_email',
    case
      when access_status_definition like '%auth.users%'
        and access_status_definition not like '%profile.email%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'constraint',
    'fail_closed_status_values_allowed',
    case when count(distinct check_name) = 2 then 'PASS' else 'FAIL' end,
    count(distinct check_name)::integer
  from (
    select 'account_status_beta_pending' as check_name
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'user_access_profiles'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%account_status%'
      and pg_get_constraintdef(constraint_row.oid) like '%beta_pending%'
    union all
    select 'beta_access_status_pending'
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'user_access_profiles'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%beta_access_status%'
      and pg_get_constraintdef(constraint_row.oid) like '%pending%'
  ) allowed_values
  union all
  select
    'trigger',
    'handle_new_auth_user_profile_fail_closed',
    case
      when trigger_definition like '%is_email_authorized_for_app_access%'
        and trigger_definition like '%beta_pending%'
        and trigger_definition like '%pending%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'trigger',
    'on_auth_user_created_profile_uses_fail_closed_function',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from pg_trigger auth_trigger
  join pg_class relation on relation.oid = auth_trigger.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  join function_refs on function_refs.auth_trigger_fn = auth_trigger.tgfoid
  where namespace.nspname = 'auth'
    and relation.relname = 'users'
    and auth_trigger.tgname = 'on_auth_user_created_profile'
    and not auth_trigger.tgisinternal
  union all
  select
    'rls',
    'app_owned_tables_rls_enabled',
    case when count(*) = (select count(*) from app_owned_policy_tables) then 'PASS' else 'FAIL' end,
    count(*)::integer
  from app_owned_policy_tables expected
  join pg_class relation
    on relation.relname = expected.table_name
  join pg_namespace namespace
    on namespace.oid = relation.relnamespace
   and namespace.nspname = 'public'
  where relation.relrowsecurity = true
  union all
  select
    'policy',
    'app_owned_policies_guarded_by_app_access',
    case when count(*) = (select count(*) from app_owned_policy_tables) then 'PASS' else 'FAIL' end,
    count(*)::integer
  from app_owned_policy_tables expected
  join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = expected.table_name
   and policy.policyname = expected.policy_name
  where coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '') like '%current_user_has_app_access%'
  union all
  select
    'policy',
    'contact_objective_assignment_policies_guarded_by_app_access',
    case when count(*) = 4 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from contact_objective_policy_names expected
  join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = 'contact_objective_assignments'
   and policy.policyname = expected.policy_name
  where coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '') like '%current_user_has_app_access%'
  union all
  select
    'policy',
    'global_read_policies_guarded_by_app_access',
    case when count(*) = (select count(*) from global_read_policy_tables) then 'PASS' else 'FAIL' end,
    count(*)::integer
  from global_read_policy_tables expected
  join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = expected.table_name
   and policy.policyname = expected.policy_name
  where coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '') like '%current_user_has_app_access%'
  union all
  select
    'policy',
    'access_admin_policies_present_and_guarded',
    case when count(*) = (select count(*) from access_admin_policy_tables) then 'PASS' else 'FAIL' end,
    count(*)::integer
  from access_admin_policy_tables expected
  join pg_policies policy
    on policy.schemaname = 'public'
   and policy.tablename = expected.table_name
   and policy.policyname = expected.policy_name
  where coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '') like '%current_user_has%'
  union all
  select
    'rpc',
    'not_authenticated_reason_available',
    case
      when exists (
        select 1
        from public.current_user_app_access_status() status
        where status.allowed = false
          and status.reason = 'not_authenticated'
      )
      then 'PASS'
      else 'FAIL'
    end,
    1
)
select *
from enforcement_checks
order by check_area, checked_object;
