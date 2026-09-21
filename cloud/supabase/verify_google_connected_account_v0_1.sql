-- Coffeecito Google Connected Account verifier v0.1
-- Purpose: validate canonical verified Google connected account hardening without printing personal data.

with expected_functions as (
  select
    to_regprocedure('public.finalize_google_connected_account_verified(uuid, text, text[])') as finalize_fn,
    to_regprocedure('public.disconnect_current_user_google_connected_account(uuid)') as disconnect_fn,
    to_regrole('anon') as anon_role,
    to_regrole('authenticated') as authenticated_role
),
rls_checks as (
  select
    'rls' as check_area,
    'connected_accounts' as checked_object,
    case when relrowsecurity then 'PASS' else 'FAIL' end as observed_status,
    case when relrowsecurity then 1 else 0 end as observed_count
  from pg_class
  where oid = 'public.connected_accounts'::regclass
),
public_table_grant_checks as (
  select
    'grant' as check_area,
    'PUBLIC_' || lower(expected.privilege_name) || '_connected_accounts' as checked_object,
    case when not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege
      where namespace.nspname = 'public'
        and relation.relname = 'connected_accounts'
        and privilege.grantee = 0
        and privilege.privilege_type = expected.privilege_name
    ) then 'PASS' else 'FAIL' end as observed_status,
    case when not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) privilege
      where namespace.nspname = 'public'
        and relation.relname = 'connected_accounts'
        and privilege.grantee = 0
        and privilege.privilege_type = expected.privilege_name
    ) then 0 else 1 end as observed_count
  from (
    values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE')
  ) as expected(privilege_name)
),
table_grant_checks as (
  select
    'grant' as check_area,
    'authenticated_select_connected_accounts' as checked_object,
    case when has_table_privilege('authenticated', 'public.connected_accounts', 'SELECT') then 'PASS' else 'FAIL' end as observed_status,
    case when has_table_privilege('authenticated', 'public.connected_accounts', 'SELECT') then 1 else 0 end as observed_count
  union all
  select
    'grant',
    role_name || '_select_connected_accounts',
    case when not has_table_privilege(role_name, 'public.connected_accounts', 'SELECT') then 'PASS' else 'FAIL' end,
    case when not has_table_privilege(role_name, 'public.connected_accounts', 'SELECT') then 0 else 1 end
  from (
    values
      ('anon')
  ) as expected(role_name)
  union all
  select
    'grant',
    role_name || '_' || lower(privilege_name) || '_connected_accounts',
    case when not has_table_privilege(role_name, 'public.connected_accounts', privilege_name) then 'PASS' else 'FAIL' end,
    case when not has_table_privilege(role_name, 'public.connected_accounts', privilege_name) then 0 else 1 end
  from (
    values
      ('anon', 'INSERT'),
      ('anon', 'UPDATE'),
      ('anon', 'DELETE'),
      ('authenticated', 'INSERT'),
      ('authenticated', 'UPDATE'),
      ('authenticated', 'DELETE')
  ) as expected(role_name, privilege_name)
),
public_function_grant_checks as (
  select
    'rpc' as check_area,
    'finalize_not_public_executable' as checked_object,
    case when finalize_fn is not null
      and not exists (
        select 1
        from pg_proc function_row
        cross join lateral aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) privilege
        where function_row.oid = finalize_fn
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
      then 'PASS' else 'FAIL' end as observed_status,
    0 as observed_count
  from expected_functions
  union all
  select
    'rpc',
    'disconnect_not_public_executable',
    case when disconnect_fn is not null
      and not exists (
        select 1
        from pg_proc function_row
        cross join lateral aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) privilege
        where function_row.oid = disconnect_fn
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
      then 'PASS' else 'FAIL' end,
    0
  from expected_functions
),
function_grant_checks as (
  select
    'rpc' as check_area,
    'finalize_rpc_exists' as checked_object,
    case when finalize_fn is not null then 'PASS' else 'FAIL' end as observed_status,
    case when finalize_fn is not null then 1 else 0 end as observed_count
  from expected_functions
  union all
  select
    'rpc',
    'disconnect_rpc_exists',
    case when disconnect_fn is not null then 'PASS' else 'FAIL' end,
    case when disconnect_fn is not null then 1 else 0 end
  from expected_functions
  union all
  select
    'rpc',
    'finalize_not_client_executable',
    case when finalize_fn is not null
      and not has_function_privilege('anon', finalize_fn, 'EXECUTE')
      and not has_function_privilege('authenticated', finalize_fn, 'EXECUTE')
      then 'PASS' else 'FAIL' end,
    0
  from expected_functions
  union all
  select
    'rpc',
    'finalize_service_role_executable',
    case when finalize_fn is not null
      and to_regrole('service_role') is not null
      and has_function_privilege('service_role', finalize_fn, 'EXECUTE')
      then 'PASS' else 'FAIL' end,
    0
  from expected_functions
  union all
  select
    'rpc',
    'disconnect_authenticated_only',
    case when disconnect_fn is not null
      and not has_function_privilege('anon', disconnect_fn, 'EXECUTE')
      and has_function_privilege('authenticated', disconnect_fn, 'EXECUTE')
      then 'PASS' else 'FAIL' end,
    0
  from expected_functions
),
function_security_checks as (
  select
    'rpc_security' as check_area,
    proname as checked_object,
    case when prosecdef and array_to_string(coalesce(proconfig, array[]::text[]), ',') like '%search_path=%' then 'PASS' else 'FAIL' end as observed_status,
    0 as observed_count
  from pg_proc
  where oid in (
    select finalize_fn from expected_functions where finalize_fn is not null
    union all
      select disconnect_fn from expected_functions where disconnect_fn is not null
  )
),
policy_checks as (
  select
    'rls_policy' as check_area,
    'connected_accounts_owner_app_access_policy' as checked_object,
    case when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'connected_accounts'
        and policyname = 'Connected accounts are owned by user'
        and qual like '%auth.uid() = user_id%'
        and qual like '%current_user_has_app_access()%'
        and with_check like '%auth.uid() = user_id%'
        and with_check like '%current_user_has_app_access()%'
    ) then 'PASS' else 'FAIL' end as observed_status,
    0 as observed_count
),
index_checks as (
  select
    'index' as check_area,
    'uq_connected_accounts_google_user_email_nonrevoked' as checked_object,
    case when exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'connected_accounts'
        and indexname = 'uq_connected_accounts_google_user_email_nonrevoked'
        and indexdef ilike '%unique%'
        and indexdef ilike '%lower(btrim(account_email))%'
        and indexdef ilike '%provider = ''google''%'
        and indexdef ilike '%revoked_at IS NULL%'
        and indexdef ilike '%status <> ''revoked''%'
    ) then 'PASS' else 'FAIL' end as observed_status,
    0 as observed_count
),
duplicate_checks as (
  select
    'data' as check_area,
    'google_nonrevoked_duplicate_groups' as checked_object,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as observed_status,
    count(*)::bigint as observed_count
  from (
    select user_id, lower(btrim(account_email)) as normalized_email
    from public.connected_accounts
    where provider = 'google'
      and revoked_at is null
      and status <> 'revoked'
      and account_email is not null
      and btrim(account_email) <> ''
    group by user_id, lower(btrim(account_email))
    having count(*) > 1
  ) duplicate_groups
),
revoked_fk_checks as (
  select
    'data' as check_area,
    'refs_to_revoked_duplicate_google_accounts' as checked_object,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as observed_status,
    count(*)::bigint as observed_count
  from public.connected_accounts revoked_account
  where revoked_account.provider = 'google'
    and revoked_account.status = 'revoked'
    and exists (
      select 1
      from public.connected_accounts canonical
      where canonical.user_id = revoked_account.user_id
        and canonical.provider = 'google'
        and canonical.revoked_at is null
        and canonical.status <> 'revoked'
        and lower(btrim(canonical.account_email)) = lower(btrim(revoked_account.account_email))
    )
    and (
      exists (select 1 from public.external_contact_ids item where item.connected_account_id = revoked_account.id)
      or exists (select 1 from public.external_contact_snapshots item where item.connected_account_id = revoked_account.id)
      or exists (select 1 from public.external_interaction_sources item where item.connected_account_id = revoked_account.id)
      or exists (select 1 from public.sync_cursors item where item.connected_account_id = revoked_account.id)
    )
),
scope_checks as (
  select
    'data' as check_area,
    'google_scope_capability_consistency' as checked_object,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as observed_status,
    count(*)::bigint as observed_count
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and (
      exists (
        select 1
        from unnest(account.scopes) as scope_value
        where scope_value not in (
          'https://www.googleapis.com/auth/contacts.readonly',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/calendar.readonly'
        )
      )
      or (cardinality(account.scopes) > 0 and account.effective_scopes_verified_at is null)
      or (cardinality(account.scopes) > 0 and account.effective_scopes_verification_method <> 'google_tokeninfo_userinfo_v0_1')
      or ((account.capabilities ->> 'contacts_read') = 'true') <> ('https://www.googleapis.com/auth/contacts.readonly' = any(account.scopes))
      or ((account.capabilities ->> 'gmail_read') = 'true') <> ('https://www.googleapis.com/auth/gmail.readonly' = any(account.scopes))
      or ((account.capabilities ->> 'calendar_read') = 'true') <> ('https://www.googleapis.com/auth/calendar.readonly' = any(account.scopes))
    )
),
refresh_token_checks as (
  select
    'data' as check_area,
    'google_refresh_tokens_not_persisted' as checked_object,
    case when count(*) = 0 then 'PASS' else 'FAIL' end as observed_status,
    count(*)::bigint as observed_count
  from public.connected_accounts account
  where account.provider = 'google'
    and account.oauth_refresh_token_encrypted is not null
    and btrim(account.oauth_refresh_token_encrypted) <> ''
)
select * from rls_checks
union all select * from public_table_grant_checks
union all select * from table_grant_checks
union all select * from public_function_grant_checks
union all select * from function_grant_checks
union all select * from function_security_checks
union all select * from policy_checks
union all select * from index_checks
union all select * from duplicate_checks
union all select * from revoked_fk_checks
union all select * from scope_checks
union all select * from refresh_token_checks
order by check_area, checked_object;
