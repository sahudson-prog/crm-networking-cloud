-- Verifies the auth-user trigger function and its effective EXECUTE surface.

do $verify$
declare
  v_function regprocedure := pg_catalog.to_regprocedure('public.handle_new_auth_user_profile()');
  v_role text;
begin
  if v_function is null then
    raise exception 'Missing public.handle_new_auth_user_profile()';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = v_function
      and procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(procedure.proconfig, array[]::text[])) config
        where config in ('search_path=', 'search_path=""')
      )
  ) then
    raise exception 'Auth trigger function must remain SECURITY DEFINER, postgres-owned, with empty search_path';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_definition
    join pg_catalog.pg_class relation on relation.oid = trigger_definition.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'users'
      and trigger_definition.tgname = 'on_auth_user_created_profile'
      and trigger_definition.tgfoid = v_function
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled in ('O', 'A')
      and pg_catalog.pg_get_triggerdef(trigger_definition.oid) like '%AFTER INSERT ON auth.users%'
      and pg_catalog.pg_get_triggerdef(trigger_definition.oid) like '%FOR EACH ROW%'
  ) then
    raise exception 'Auth user creation trigger is missing, disabled, or detached from the function';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid = v_function
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute internal auth trigger function';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
      raise exception '% can execute internal auth trigger function', v_role;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege('postgres', v_function, 'EXECUTE') then
    raise exception 'postgres cannot execute its auth trigger function';
  end if;
end;
$verify$;
