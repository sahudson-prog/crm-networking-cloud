-- Coffeecito closed beta access administration verifier v0.1
-- Purpose: validate admin allowlist RPCs without printing emails or personal data.

with function_refs as (
  select
    to_regprocedure('public.app_access_status_for_user(uuid)') as user_access_status_fn,
    to_regprocedure('public.user_has_capability_for_user(uuid, text)') as user_capability_fn,
    to_regprocedure('public.current_user_app_access_status()') as current_access_status_fn,
    to_regprocedure('public.current_user_has_capability(text)') as current_capability_fn,
    to_regprocedure('public.admin_list_app_access_allowlist()') as admin_list_fn,
    to_regprocedure('public.admin_authorize_app_access_email(text, text)') as admin_authorize_fn,
    to_regprocedure('public.admin_revoke_app_access_email(text)') as admin_revoke_fn,
    to_regprocedure('public.admin_get_app_access_diagnostic(uuid)') as admin_diagnostic_fn,
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
    select user_access_status_fn from function_refs where user_access_status_fn is not null
    union all select user_capability_fn from function_refs where user_capability_fn is not null
    union all select current_access_status_fn from function_refs where current_access_status_fn is not null
    union all select current_capability_fn from function_refs where current_capability_fn is not null
    union all select admin_list_fn from function_refs where admin_list_fn is not null
    union all select admin_authorize_fn from function_refs where admin_authorize_fn is not null
    union all select admin_revoke_fn from function_refs where admin_revoke_fn is not null
    union all select admin_diagnostic_fn from function_refs where admin_diagnostic_fn is not null
  )
),
function_defs as (
  select
    case when user_access_status_fn is null then '' else pg_get_functiondef(user_access_status_fn) end as user_access_status_definition,
    case when user_capability_fn is null then '' else pg_get_functiondef(user_capability_fn) end as user_capability_definition,
    case when current_access_status_fn is null then '' else pg_get_functiondef(current_access_status_fn) end as current_access_status_definition,
    case when current_capability_fn is null then '' else pg_get_functiondef(current_capability_fn) end as current_capability_definition,
    case when admin_list_fn is null then '' else pg_get_functiondef(admin_list_fn) end as admin_list_definition,
    case when admin_authorize_fn is null then '' else pg_get_functiondef(admin_authorize_fn) end as admin_authorize_definition,
    case when admin_revoke_fn is null then '' else pg_get_functiondef(admin_revoke_fn) end as admin_revoke_definition,
    case when admin_diagnostic_fn is null then '' else pg_get_functiondef(admin_diagnostic_fn) end as admin_diagnostic_definition
  from function_refs
),
admin_rpc_refs(function_oid) as (
  select admin_list_fn from function_refs
  union all select admin_authorize_fn from function_refs
  union all select admin_revoke_fn from function_refs
  union all select admin_diagnostic_fn from function_refs
),
internal_helper_refs(function_oid) as (
  select user_access_status_fn from function_refs
  union all select user_capability_fn from function_refs
),
admin_rpc_definitions(check_name, definition_text) as (
  select 'admin_list_app_access_allowlist', admin_list_definition from function_defs
  union all select 'admin_authorize_app_access_email', admin_authorize_definition from function_defs
  union all select 'admin_revoke_app_access_email', admin_revoke_definition from function_defs
  union all select 'admin_get_app_access_diagnostic', admin_diagnostic_definition from function_defs
),
admin_checks as (
  select
    'funcion' as check_area,
    'admin_access_functions_exist' as checked_object,
    case
      when user_access_status_fn is not null
        and user_capability_fn is not null
        and current_access_status_fn is not null
        and current_capability_fn is not null
        and admin_list_fn is not null
        and admin_authorize_fn is not null
        and admin_revoke_fn is not null
        and admin_diagnostic_fn is not null
      then 'PASS'
      else 'FAIL'
    end as observed_status,
    (
      (case when user_access_status_fn is not null then 1 else 0 end) +
      (case when user_capability_fn is not null then 1 else 0 end) +
      (case when current_access_status_fn is not null then 1 else 0 end) +
      (case when current_capability_fn is not null then 1 else 0 end) +
      (case when admin_list_fn is not null then 1 else 0 end) +
      (case when admin_authorize_fn is not null then 1 else 0 end) +
      (case when admin_revoke_fn is not null then 1 else 0 end) +
      (case when admin_diagnostic_fn is not null then 1 else 0 end)
    )::integer as observed_count
  from function_refs
  union all
  select
    'funcion',
    'security_definer_functions_have_fixed_search_path',
    case when count(*) = 8 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from function_security
  where prosecdef = true
    and function_config like '%search_path%'
  union all
  select
    'grant',
    'admin_rpcs_granted_only_to_authenticated',
    case when count(*) = 4 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from admin_rpc_refs
  join function_refs on true
  join function_security on function_security.oid = admin_rpc_refs.function_oid
  where admin_rpc_refs.function_oid is not null
    and function_refs.authenticated_role is not null
    and function_refs.anon_role is not null
    and has_function_privilege(function_refs.authenticated_role, admin_rpc_refs.function_oid, 'EXECUTE')
    and not has_function_privilege(function_refs.anon_role, admin_rpc_refs.function_oid, 'EXECUTE')
    and function_security.public_can_execute = false
  union all
  select
    'grant',
    'internal_helpers_not_client_executable',
    case when count(*) = 2 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from internal_helper_refs
  join function_refs on true
  join function_security on function_security.oid = internal_helper_refs.function_oid
  where internal_helper_refs.function_oid is not null
    and function_refs.authenticated_role is not null
    and function_refs.anon_role is not null
    and not has_function_privilege(function_refs.authenticated_role, internal_helper_refs.function_oid, 'EXECUTE')
    and not has_function_privilege(function_refs.anon_role, internal_helper_refs.function_oid, 'EXECUTE')
    and function_security.public_can_execute = false
  union all
  select
    'grant',
    'allowlist_has_no_direct_client_crud_grants',
    case
      when table_ref.table_oid is not null
        and function_refs.authenticated_role is not null
        and function_refs.anon_role is not null
        and not has_table_privilege(function_refs.authenticated_role, table_ref.table_oid, 'SELECT')
        and not has_table_privilege(function_refs.authenticated_role, table_ref.table_oid, 'INSERT')
        and not has_table_privilege(function_refs.authenticated_role, table_ref.table_oid, 'UPDATE')
        and not has_table_privilege(function_refs.authenticated_role, table_ref.table_oid, 'DELETE')
        and not has_table_privilege(function_refs.anon_role, table_ref.table_oid, 'SELECT')
        and not has_table_privilege(function_refs.anon_role, table_ref.table_oid, 'INSERT')
        and not has_table_privilege(function_refs.anon_role, table_ref.table_oid, 'UPDATE')
        and not has_table_privilege(function_refs.anon_role, table_ref.table_oid, 'DELETE')
        and table_ref.public_crud_grants = 0
      then 'PASS'
      else 'FAIL'
    end,
    case
      when table_ref.table_oid is not null then 1
      else 0
    end
  from function_refs
  cross join lateral (
    select
      relation.oid as table_oid,
      count(privilege.*) filter (
        where privilege.grantee = 0
          and privilege.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      ) as public_crud_grants
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    left join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege on true
    where namespace.nspname = 'public'
      and relation.relname = 'app_access_allowlist'
    group by relation.oid
  ) table_ref
  union all
  select
    'capability',
    'admin_rpcs_check_manage_access',
    case when count(*) = 4 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from admin_rpc_definitions
  where definition_text like '%current_user_has_capability%'
    and definition_text like '%admin.manage_access%'
  union all
  select
    'access',
    'authorize_does_not_create_missing_access_profile',
    case
      when admin_authorize_definition not like '%insert into public.user_access_profiles%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'access',
    'authorize_only_promotes_historical_pending_profile',
    case
      when admin_authorize_definition like '%v_account_status = ''beta_pending''%'
        and admin_authorize_definition like '%v_beta_access_status = ''pending''%'
        and admin_authorize_definition like '%account_status = ''active''%'
        and admin_authorize_definition like '%beta_access_status = ''approved''%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'access',
    'authorize_does_not_promote_closed_paused_or_blocked',
    case
      when admin_authorize_definition not like '%closed%'
        and admin_authorize_definition not like '%paused%'
        and admin_authorize_definition not like '%blocked%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'role',
    'historical_promotion_only_creates_base_user_role_when_no_active_assignment_exists',
    case
      when admin_authorize_definition like '%insert into public.user_role_assignments%'
        and admin_authorize_definition like '%role_code = ''user''%'
        and admin_authorize_definition like '%existing_assignment.is_active = true%'
        and admin_authorize_definition like '%not exists%'
        and admin_authorize_definition not like '%set is_active = true%'
        and admin_authorize_definition not like '%existing_assignment.starts_at%'
        and admin_authorize_definition not like '%existing_assignment.expires_at%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'revoke',
    'revoke_blocks_self_revocation_using_auth_email',
    case
      when admin_revoke_definition like '%v_actor_user_id := auth.uid()%'
        and admin_revoke_definition like '%from auth.users auth_user%'
        and admin_revoke_definition like '%where auth_user.id = v_actor_user_id%'
        and admin_revoke_definition like '%public.normalize_app_access_email(auth_user.email)%'
        and admin_revoke_definition like '%if v_email = v_actor_email then%'
        and admin_revoke_definition like '%cannot revoke own app access%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'auth',
    'registered_email_comes_from_auth_users',
    case
      when admin_list_definition like '%auth.users%'
        and admin_diagnostic_definition like '%auth.users%'
        and admin_list_definition not like '%profiles profile%email%'
        and admin_diagnostic_definition not like '%profiles profile%email%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'access',
    'current_status_uses_shared_user_status_helper',
    case
      when current_access_status_definition like '%app_access_status_for_user%'
        and user_access_status_definition like '%app_access_allowlist%'
        and user_access_status_definition like '%user_access_profiles%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'capability',
    'current_capability_uses_shared_user_capability_helper',
    case
      when current_capability_definition like '%user_has_capability_for_user%'
        and user_capability_definition like '%app_access_status_for_user%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'allowlist',
    'allowlist_rls_enabled',
    case when relation.relrowsecurity then 'PASS' else 'FAIL' end,
    case when relation.relrowsecurity then 1 else 0 end
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'app_access_allowlist'
  union all
  select
    'allowlist',
    'allowlist_admin_policies_guarded',
    case when count(*) = 2 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'app_access_allowlist'
    and policy.policyname in (
      'App access allowlist is admin readable',
      'App access allowlist is admin writable'
    )
    and coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '') like '%admin.manage_access%'
  union all
  select
    'audit',
    'admin_mutations_write_audit_log',
    case
      when admin_authorize_definition like '%audit_log%'
        and admin_revoke_definition like '%audit_log%'
        and admin_authorize_definition like '%app_access_authorize%'
        and admin_revoke_definition like '%app_access_revoke%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
  union all
  select
    'pii',
    'admin_rpcs_do_not_expose_auth_sensitive_fields',
    case
      when admin_list_definition not like '%raw_user_meta_data%'
        and admin_list_definition not like '%encrypted%'
        and admin_list_definition not like '%token%'
        and admin_list_definition not like '%identities%'
        and admin_diagnostic_definition not like '%raw_user_meta_data%'
        and admin_diagnostic_definition not like '%encrypted%'
        and admin_diagnostic_definition not like '%token%'
        and admin_diagnostic_definition not like '%identities%'
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_defs
)
select *
from admin_checks
order by check_area, checked_object;
