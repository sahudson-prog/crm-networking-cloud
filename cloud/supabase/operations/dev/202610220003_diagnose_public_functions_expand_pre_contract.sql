-- DEV-only diagnostic for SEC-DEV-01 after SEC-GOOGLE-01 expand and before contract.
-- Read-only and non-fail-fast: every public routine is returned with all findings.

begin transaction read only;

with expected_contract (
  signature,
  canonical_contract,
  expand_pre_contract,
  expected_security_definer,
  expected_owner,
  expected_empty_search_path,
  expected_authenticated_execute,
  expected_service_role_execute,
  expected_supabase_auth_admin_execute
) as (
  values
    ('public.set_updated_at()', 'internal', 'internal', null::boolean, null::text, null::boolean, false, false, false),
    ('public.normalize_app_access_email(text)', 'internal', 'internal', null::boolean, null::text, null::boolean, false, false, false),
    ('public.is_email_authorized_for_app_access(text)', 'internal', 'internal', true, 'postgres', true, false, false, false),
    ('public.app_access_status_for_user(uuid)', 'internal', 'internal', true, 'postgres', true, false, false, false),
    ('public.user_has_capability_for_user(uuid,text)', 'internal', 'internal', true, 'postgres', true, false, false, false),
    ('public.handle_new_auth_user_profile()', 'internal', 'internal', true, 'postgres', true, false, false, false),
    ('public.validate_headhunter_company_master_v0_1()', 'internal', 'internal', true, 'postgres', true, false, false, false),
    ('public.user_has_provider_rollout_for_user_v1(uuid,text)', 'absent_pre_expand', 'internal', true, 'postgres', true, false, false, false),

    ('public.current_user_app_access_status()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.current_user_has_app_access()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.current_user_has_capability(text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_list_app_access_allowlist()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_authorize_app_access_email(text,text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_revoke_app_access_email(text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_get_app_access_diagnostic(uuid)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.merge_contacts_deep(uuid,uuid[],jsonb,text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.reset_current_user_app_data_v0_1(text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.apply_ics_import_v1(jsonb)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.reconcile_ics_focus_participants_v1(boolean)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_list_contact_requests_v1(integer)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.admin_update_contact_request_v1(uuid,text,text)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.current_user_legal_acceptance_status_v1()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.record_current_user_legal_acceptance_v1()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.disconnect_current_user_google_connected_account(uuid)', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.validate_contact_sync_storage_v0_1()', 'authenticated_rpc', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.current_user_can_start_connected_oauth_v1(text)', 'absent_pre_expand', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.current_user_can_sync_connected_account_v1(uuid,text)', 'absent_pre_expand', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.apply_google_contact_sync_change_v1(uuid,jsonb)', 'absent_pre_expand', 'authenticated_rpc', true, 'postgres', true, true, false, false),
    ('public.apply_google_interaction_sync_v1(uuid,jsonb)', 'absent_pre_expand', 'authenticated_rpc', true, 'postgres', true, true, false, false),

    ('public.finalize_google_connected_account_verified(uuid,text,text[])', 'service_role_rpc', 'service_role_rpc', true, 'postgres', true, false, true, false),
    ('public.submit_contact_request_v1(text,text,text,text,text,uuid)', 'service_role_rpc', 'service_role_rpc', true, 'postgres', true, false, true, false),
    ('public.hook_enforce_app_access_allowlist(jsonb)', 'auth_hook', 'auth_hook', true, 'postgres', true, false, false, true)
),
actual_routines as (
  select
    procedure.oid,
    format(
      '%s.%s(%s)',
      namespace.nspname,
      procedure.proname,
      regexp_replace(pg_catalog.oidvectortypes(procedure.proargtypes), '\s+', '', 'g')
    ) as signature,
    case procedure.prokind
      when 'f' then 'function'
      when 'p' then 'procedure'
      when 'a' then 'aggregate'
      when 'w' then 'window'
      else procedure.prokind::text
    end as routine_kind,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    procedure.prosecdef as security_definer,
    to_jsonb(coalesce(procedure.proconfig, array[]::text[])) as proconfig,
    coalesce(
      (
        select jsonb_agg(config order by config)
        from unnest(coalesce(procedure.proconfig, array[]::text[])) config
        where config like 'search_path=%'
      ),
      '[]'::jsonb
    ) as search_path_settings,
    exists (
      select 1
      from unnest(coalesce(procedure.proconfig, array[]::text[])) config
      where config in ('search_path=', 'search_path=""')
    ) as has_empty_search_path,
    exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    (
      select has_function_privilege(role_definition.oid, procedure.oid, 'EXECUTE')
      from pg_catalog.pg_roles role_definition
      where role_definition.rolname = 'anon'
    ) as anon_execute,
    (
      select has_function_privilege(role_definition.oid, procedure.oid, 'EXECUTE')
      from pg_catalog.pg_roles role_definition
      where role_definition.rolname = 'authenticated'
    ) as authenticated_execute,
    (
      select has_function_privilege(role_definition.oid, procedure.oid, 'EXECUTE')
      from pg_catalog.pg_roles role_definition
      where role_definition.rolname = 'service_role'
    ) as service_role_execute,
    (
      select has_function_privilege(role_definition.oid, procedure.oid, 'EXECUTE')
      from pg_catalog.pg_roles role_definition
      where role_definition.rolname = 'supabase_auth_admin'
    ) as supabase_auth_admin_execute,
    (
      select has_function_privilege(role_definition.oid, procedure.oid, 'EXECUTE')
      from pg_catalog.pg_roles role_definition
      where role_definition.rolname = 'postgres'
    ) as postgres_execute
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
),
inventory as (
  select
    coalesce(actual.signature, expected.signature) as signature,
    actual.oid,
    actual.routine_kind,
    actual.owner_name,
    actual.security_definer,
    actual.proconfig,
    actual.search_path_settings,
    actual.has_empty_search_path,
    actual.public_execute,
    actual.anon_execute,
    actual.authenticated_execute,
    actual.service_role_execute,
    actual.supabase_auth_admin_execute,
    actual.postgres_execute,
    expected.canonical_contract,
    expected.expand_pre_contract,
    expected.expected_security_definer,
    expected.expected_owner,
    expected.expected_empty_search_path,
    coalesce(expected.expected_authenticated_execute, false) as expected_authenticated_execute,
    coalesce(expected.expected_service_role_execute, false) as expected_service_role_execute,
    coalesce(expected.expected_supabase_auth_admin_execute, false) as expected_supabase_auth_admin_execute
  from actual_routines actual
  full join expected_contract expected using (signature)
),
evaluated as (
  select
    inventory.*,
    array_remove(array[
      case when oid is null then 'EXPECTED_ROUTINE_MISSING' end,
      case when oid is not null and public_execute is distinct from false then 'PUBLIC_EXECUTE_MISMATCH' end,
      case when oid is not null and anon_execute is distinct from false then 'ANON_EXECUTE_MISMATCH_OR_ROLE_MISSING' end,
      case when oid is not null and authenticated_execute is distinct from expected_authenticated_execute then 'AUTHENTICATED_EXECUTE_MISMATCH_OR_ROLE_MISSING' end,
      case when oid is not null and service_role_execute is distinct from expected_service_role_execute then 'SERVICE_ROLE_EXECUTE_MISMATCH_OR_ROLE_MISSING' end,
      case when oid is not null and supabase_auth_admin_execute is distinct from expected_supabase_auth_admin_execute then 'SUPABASE_AUTH_ADMIN_EXECUTE_MISMATCH_OR_ROLE_MISSING' end,
      case
        when oid is not null
          and expected_security_definer is not null
          and security_definer is distinct from expected_security_definer
        then 'SECURITY_DEFINER_MISMATCH'
      end,
      case
        when oid is not null
          and expected_owner is not null
          and owner_name is distinct from expected_owner
        then 'OWNER_MISMATCH'
      end,
      case
        when oid is not null
          and expected_empty_search_path is true
          and has_empty_search_path is distinct from true
        then 'EMPTY_SEARCH_PATH_MISSING'
      end
    ], null)::text[] as findings
  from inventory
)
select
  signature,
  routine_kind,
  canonical_contract,
  expand_pre_contract,
  case
    when oid is null then 'DRIFT_AGAINST_EXPAND_PRE_CONTRACT'
    when cardinality(findings) > 0 then 'DRIFT_AGAINST_EXPAND_PRE_CONTRACT'
    when expand_pre_contract is null then 'UNCLASSIFIED_REQUIRES_REVIEW'
    when canonical_contract = 'absent_pre_expand' then 'EXPECTED_EXPAND_DELTA'
    else 'MATCH_EXPAND_PRE_CONTRACT'
  end as diagnostic_status,
  case
    when expand_pre_contract is null then 'No explicit routine-property contract; generic no-client-EXECUTE contract still applies.'
    when canonical_contract = 'absent_pre_expand' then 'Added by SEC-GOOGLE-01 expand; not a verifier incompatibility in pre-contract DEV.'
    else 'Covered by the canonical verifier contract.'
  end as contract_interpretation,
  owner_name,
  security_definer,
  proconfig,
  search_path_settings,
  has_empty_search_path,
  public_execute,
  anon_execute,
  authenticated_execute,
  service_role_execute,
  supabase_auth_admin_execute,
  postgres_execute,
  expected_security_definer,
  expected_owner,
  expected_empty_search_path,
  expected_authenticated_execute,
  expected_service_role_execute,
  expected_supabase_auth_admin_execute,
  to_jsonb(findings) as findings
from evaluated
order by
  case
    when oid is null or cardinality(findings) > 0 then 0
    when expand_pre_contract is null then 1
    when canonical_contract = 'absent_pre_expand' then 2
    else 3
  end,
  signature;

rollback;
