-- PROD read-only capture for SEC-GOOGLE-01 expand recovery.
-- Run together with the aggregate rollout preflight before applying 202610210001.
-- The single result contains only catalog/configuration data; it contains no
-- user ids, emails, provider tokens or application-owned records.

begin transaction read only;

with function_manifest(signature, expected_before_expand) as (
  values
    ('public.user_has_provider_rollout_for_user_v1(uuid,text)', false),
    ('public.current_user_can_start_connected_oauth_v1(text)', false),
    ('public.current_user_can_sync_connected_account_v1(uuid,text)', false),
    ('public.finalize_google_connected_account_verified(uuid,text,text[])', true),
    ('public.apply_google_interaction_sync_v1(uuid,jsonb)', false),
    ('public.apply_google_contact_sync_change_v1(uuid,jsonb)', false)
), capability_manifest(capability_code) as (
  values
    ('connectors.google.use'),
    ('contacts.sync_external'),
    ('interactions.sync_email'),
    ('interactions.sync_calendar')
), function_state as (
  select
    manifest.signature,
    manifest.expected_before_expand,
    procedure.oid is not null as exists,
    case when procedure.oid is null then null else pg_catalog.pg_get_userbyid(procedure.proowner) end as owner_name,
    case when procedure.oid is null then null else language.lanname end as language_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile::text as volatility,
    procedure.proparallel::text as parallel_safety,
    procedure.proisstrict as strict,
    procedure.proleakproof as leakproof,
    procedure.proconfig,
    case when procedure.oid is null then null else procedure.proacl::text end as raw_acl,
    case when procedure.oid is null then null else pg_catalog.pg_get_functiondef(procedure.oid) end as definition,
    case when procedure.oid is null then null else md5(procedure.prosrc) end as body_md5,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by acl.grantee, acl.privilege_type, acl.is_grantable
      )
      from pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
    ), '[]'::jsonb) as acl_entries,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'dependent_class', dependency.classid::regclass::text,
          'dependent_object', dependency.objid::text,
          'dependency_type', dependency.deptype
        )
        order by dependency.classid, dependency.objid, dependency.deptype
      )
      from pg_catalog.pg_depend dependency
      where procedure.oid is not null
        and dependency.refclassid = 'pg_catalog.pg_proc'::regclass
        and dependency.refobjid = procedure.oid
        and dependency.deptype not in ('i', 'e')
    ), '[]'::jsonb) as dependents
  from function_manifest manifest
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(manifest.signature)
  left join pg_catalog.pg_language language on language.oid = procedure.prolang
), capability_state as (
  select
    manifest.capability_code,
    capability.capability_code is not null as exists,
    case when capability.capability_code is null then null else to_jsonb(capability) end as row_value,
    (select count(*) from public.app_role_capabilities role_grant
      where role_grant.capability_code = manifest.capability_code) as role_grant_count,
    (select count(*) from public.subscription_plan_capabilities plan_grant
      where plan_grant.capability_code = manifest.capability_code) as plan_grant_count,
    (select count(*) from public.user_capability_overrides override_row
      where override_row.capability_code = manifest.capability_code) as override_count
  from capability_manifest manifest
  left join public.app_capabilities capability
    on capability.capability_code = manifest.capability_code
), beta_role_grants as (
  select
    manifest.capability_code,
    role_grant.capability_code is not null as exists,
    case when role_grant.capability_code is null then null else to_jsonb(role_grant) end as row_value
  from capability_manifest manifest
  left join public.app_role_capabilities role_grant
    on role_grant.role_code = 'beta_tester'
   and role_grant.capability_code = manifest.capability_code
), connected_accounts_state as (
  select jsonb_build_object(
    'exists', relation.oid is not null,
    'owner', case when relation.oid is null then null else pg_catalog.pg_get_userbyid(relation.relowner) end,
    'rls_enabled', relation.relrowsecurity,
    'force_rls', relation.relforcerowsecurity,
    'raw_acl', relation.relacl::text,
    'acl_entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        )
        order by acl.grantee, acl.privilege_type, acl.is_grantable
      )
      from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
    ), '[]'::jsonb),
    'client_privileges', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'role', role_name,
          'privilege', privilege_name,
          'has_privilege', case
            when role_name = 'PUBLIC' then exists(
              select 1
              from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) acl
              where acl.grantee = 0 and acl.privilege_type = privilege_name
            )
            else pg_catalog.has_table_privilege(role_name, 'public.connected_accounts', privilege_name)
          end
        ) order by role_name, privilege_name
      )
      from (values ('PUBLIC'), ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')) roles(role_name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) privileges(privilege_name)
    ), '[]'::jsonb)
  ) as value
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = 'connected_accounts'
), stop_reasons as (
  select reason
  from (
    select 'executor_is_not_postgres' where current_user <> 'postgres'
    union all select 'missing_beta_tester_role' where not exists (select 1 from public.app_roles where role_code = 'beta_tester')
    union all select 'planned_capability_already_exists:' || capability_code from capability_state where exists
    union all select 'unexpected_pre_expand_function_state:' || signature from function_state where exists <> expected_before_expand
    union all select 'finalize_owner_is_not_postgres' from function_state where signature like '%finalize_google_connected_account_verified%' and owner_name <> 'postgres'
    union all select 'finalize_is_not_security_definer' from function_state where signature like '%finalize_google_connected_account_verified%' and security_definer is not true
    union all select 'finalize_search_path_is_not_empty' from function_state where signature like '%finalize_google_connected_account_verified%' and not ('search_path=' = any(coalesce(proconfig, array[]::text[])) or 'search_path=""' = any(coalesce(proconfig, array[]::text[])))
    union all select 'unexpected_finalize_acl_grantee' from function_state state, jsonb_array_elements(state.acl_entries) entry where state.signature like '%finalize_google_connected_account_verified%' and entry->>'grantee' not in ('postgres', 'service_role')
    union all select 'finalize_service_role_execute_missing' where not pg_catalog.has_function_privilege('service_role', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE')
    union all select 'finalize_client_execute_present:' || role_name from (values ('anon'), ('authenticated'), ('supabase_auth_admin')) roles(role_name) where pg_catalog.has_function_privilege(role_name, 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE')
    union all select 'finalize_public_execute_present' from function_state state, jsonb_array_elements(state.acl_entries) entry where state.signature like '%finalize_google_connected_account_verified%' and entry->>'grantee' = 'PUBLIC' and entry->>'privilege' = 'EXECUTE'
    union all select 'connected_accounts_missing' where not exists (select 1 from connected_accounts_state)
    union all select 'connected_accounts_owner_is_not_postgres' from connected_accounts_state where value->>'owner' <> 'postgres'
    union all select 'connected_accounts_rls_contract_mismatch' from connected_accounts_state where (value->>'rls_enabled')::boolean is not true or (value->>'force_rls')::boolean is true
    union all select 'connected_accounts_privilege_mismatch:' || (entry->>'role') || ':' || (entry->>'privilege')
      from connected_accounts_state state, jsonb_array_elements(state.value->'client_privileges') entry
      where (entry->>'has_privilege')::boolean is distinct from (
        entry->>'role' = 'authenticated' and entry->>'privilege' = 'SELECT'
      )
  ) failures(reason)
), payload as (
  select jsonb_build_object(
    'capture_version', 'sec-google-01-expand-v1',
    'captured_at', clock_timestamp(),
    'database_name', current_database(),
    'executor', current_user,
    'server_version_num', current_setting('server_version_num'),
    'manifest', jsonb_build_object('capabilities', 4, 'functions', 6, 'tables', 1),
    'stop_reasons', coalesce((select jsonb_agg(reason order by reason) from stop_reasons), '[]'::jsonb),
    'capabilities', (select jsonb_agg(to_jsonb(state) order by capability_code) from capability_state state),
    'beta_tester_role_grants', (select jsonb_agg(to_jsonb(state) order by capability_code) from beta_role_grants state),
    'functions', (select jsonb_agg(to_jsonb(state) order by signature) from function_state state),
    'connected_accounts', (select value from connected_accounts_state)
  ) as value
), encoded as (
  select value::text as payload_text from payload
)
select jsonb_build_object(
  'capture_version', 'sec-google-01-expand-envelope-v1',
  'payload_encoding', 'base64-utf8',
  'payload_md5', md5(payload_text),
  'payload_bytes', octet_length(convert_to(payload_text, 'UTF8')),
  'payload_base64', encode(convert_to(payload_text, 'UTF8'), 'base64')
) as sec_google_01_expand_capture
from encoded;

rollback;
