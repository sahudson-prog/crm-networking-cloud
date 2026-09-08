-- Coffeecito closed beta access foundation verifier v0.1
-- Purpose: validate the non-enforcing allowlist foundation without printing emails.

with function_refs as (
  select
    to_regprocedure('public.normalize_app_access_email(text)') as normalize_fn,
    to_regprocedure('public.is_email_authorized_for_app_access(text)') as email_allowed_fn,
    to_regprocedure('public.hook_enforce_app_access_allowlist(jsonb)') as hook_fn,
    to_regrole('supabase_auth_admin') as supabase_auth_admin_role,
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
    select normalize_fn from function_refs where normalize_fn is not null
    union all
    select email_allowed_fn from function_refs where email_allowed_fn is not null
    union all
    select hook_fn from function_refs where hook_fn is not null
  )
),
foundation_checks as (
  select
    'tabla' as check_area,
    'app_access_allowlist' as checked_object,
    case when to_regclass('public.app_access_allowlist') is not null then 'PASS' else 'FAIL' end as observed_status,
    case when to_regclass('public.app_access_allowlist') is not null then 1 else 0 end as observed_count
  union all
  select
    'columnas',
    'app_access_allowlist_minimum_shape',
    case when count(*) = 6 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'app_access_allowlist'
    and column_name in (
      'email_normalized',
      'authorized_at',
      'authorized_by_user_id',
      'revoked_at',
      'revoked_by_user_id',
      'note'
    )
  union all
  select
    'constraint',
    'user_access_profiles_fail_closed_status_values_allowed',
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
    'constraint',
    'app_access_allowlist_primary_key',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from information_schema.table_constraints
  where table_schema = 'public'
    and table_name = 'app_access_allowlist'
    and constraint_type = 'PRIMARY KEY'
  union all
  select
    'funcion',
    'normalize_app_access_email',
    case when normalize_fn is not null then 'PASS' else 'FAIL' end,
    case when normalize_fn is not null then 1 else 0 end
  from function_refs
  union all
  select
    'funcion',
    'security_definer_functions_have_fixed_search_path',
    case when count(*) = 2 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from function_security
  where oid in (
      select email_allowed_fn from function_refs
      union all
      select hook_fn from function_refs
    )
    and prosecdef = true
    and function_config like '%search_path%'
  union all
  select
    'normalizacion',
    'case_insensitive_trim',
    case when public.normalize_app_access_email('  USER@Example.COM  ') = 'user@example.com' then 'PASS' else 'FAIL' end,
    1
  union all
  select
    'funcion',
    'is_email_authorized_for_app_access',
    case when email_allowed_fn is not null then 'PASS' else 'FAIL' end,
    case when email_allowed_fn is not null then 1 else 0 end
  from function_refs
  union all
  select
    'funcion',
    'hook_enforce_app_access_allowlist',
    case when hook_fn is not null then 'PASS' else 'FAIL' end,
    case when hook_fn is not null then 1 else 0 end
  from function_refs
  union all
  select
    'hook',
    'unknown_email_rejected_without_leaking_allowlist',
    case
      when coalesce(public.hook_enforce_app_access_allowlist(
        jsonb_build_object('user', jsonb_build_object('email', 'not-authorized@example.invalid'))
      )->'error'->>'http_code', '') = '403'
      then 'PASS'
      else 'FAIL'
    end,
    1
  union all
  select
    'rls',
    'app_access_allowlist_rls_enabled',
    case when relrowsecurity then 'PASS' else 'FAIL' end,
    case when relrowsecurity then 1 else 0 end
  from pg_class
  join pg_namespace on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and pg_class.relname = 'app_access_allowlist'
  union all
  select
    'policy',
    'app_access_allowlist_admin_policies',
    case when count(*) = 2 then 'PASS' else 'FAIL' end,
    count(*)::integer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'app_access_allowlist'
    and policyname in (
      'App access allowlist is admin readable',
      'App access allowlist is admin writable'
    )
  union all
  select
    'grant',
    'supabase_auth_admin_has_public_schema_usage',
    case
      when supabase_auth_admin_role is not null
        and has_schema_privilege(supabase_auth_admin_role, 'public', 'USAGE')
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_refs
  union all
  select
    'grant',
    'hook_execute_only_for_supabase_auth_admin',
    case
      when supabase_auth_admin_role is not null
        and hook_fn is not null
        and has_function_privilege(supabase_auth_admin_role, hook_fn, 'EXECUTE')
        and anon_role is not null
        and authenticated_role is not null
        and not has_function_privilege(anon_role, hook_fn, 'EXECUTE')
        and not has_function_privilege(authenticated_role, hook_fn, 'EXECUTE')
        and not exists (
          select 1
          from function_security
          where function_security.oid = hook_fn
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
    'email_authorization_helper_not_client_executable',
    case
      when supabase_auth_admin_role is not null
        and email_allowed_fn is not null
        and has_function_privilege(supabase_auth_admin_role, email_allowed_fn, 'EXECUTE')
        and anon_role is not null
        and authenticated_role is not null
        and not has_function_privilege(anon_role, email_allowed_fn, 'EXECUTE')
        and not has_function_privilege(authenticated_role, email_allowed_fn, 'EXECUTE')
        and not exists (
          select 1
          from function_security
          where function_security.oid = email_allowed_fn
            and function_security.public_can_execute = true
        )
      then 'PASS'
      else 'FAIL'
    end,
    1
  from function_refs
)
select *
from foundation_checks
order by check_area, checked_object;
