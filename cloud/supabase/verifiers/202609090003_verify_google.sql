-- Fails unless Google Connected Account uses the canonical server-finalized contract.

do $$
declare
  finalize_function regprocedure := 'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure;
  disconnect_function regprocedure := 'public.disconnect_current_user_google_connected_account(uuid)'::regprocedure;
begin
  if not exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'connected_accounts'
      and column_definition.column_name = 'effective_scopes_verified_at'
  ) or not exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'connected_accounts'
      and column_definition.column_name = 'effective_scopes_verification_method'
  ) then
    raise exception 'Canonical Google verification columns are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class index_relation on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_namespace index_namespace on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'public'
      and index_relation.relname = 'uq_connected_accounts_google_user_email_nonrevoked'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and lower(pg_get_indexdef(index_definition.indexrelid)) like
        '%(user_id, provider, lower(btrim(account_email)))%'
      and lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)) like '%provider = ''google''%'
      and lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)) like '%revoked_at is null%'
      and lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)) like '%status <> ''revoked''%'
      and lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)) like '%account_email is not null%'
      and lower(pg_get_expr(index_definition.indpred, index_definition.indrelid)) like '%btrim(account_email) <> ''''%'
  ) then
    raise exception 'Canonical active Google identity index is missing or malformed';
  end if;

  if not has_table_privilege('authenticated', 'public.connected_accounts', 'SELECT') then
    raise exception 'authenticated is missing SELECT on connected_accounts';
  end if;
  if has_table_privilege('authenticated', 'public.connected_accounts', 'INSERT, UPDATE, DELETE')
    or has_table_privilege('anon', 'public.connected_accounts', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'A client role has forbidden Connected Account privileges';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
    where relation.oid = 'public.connected_accounts'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'PUBLIC has direct privileges on connected_accounts';
  end if;

  if not has_function_privilege('service_role', finalize_function, 'EXECUTE')
    or has_function_privilege('authenticated', finalize_function, 'EXECUTE')
    or has_function_privilege('anon', finalize_function, 'EXECUTE') then
    raise exception 'Google finalize RPC grants are incorrect';
  end if;
  if not has_function_privilege('authenticated', disconnect_function, 'EXECUTE')
    or has_function_privilege('anon', disconnect_function, 'EXECUTE')
    or has_function_privilege('service_role', disconnect_function, 'EXECUTE') then
    raise exception 'Google disconnect RPC grants are incorrect';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
    where procedure.oid in (finalize_function, disconnect_function)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a Google Connected Account RPC';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid in (finalize_function, disconnect_function)
      and (
        not procedure.prosecdef
        or pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
      )
  ) then
    raise exception 'Google RPCs must be SECURITY DEFINER with empty search_path';
  end if;

  if exists (
    select 1 from public.connected_accounts
    where oauth_refresh_token_encrypted is not null
  ) then
    raise exception 'Persisted refresh tokens are forbidden';
  end if;
end;
$$;
