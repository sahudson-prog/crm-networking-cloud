-- Structural/security verifier for the INV-01 administrative read boundary.

begin transaction read only;

do $$
declare
  v_function regprocedure := to_regprocedure('public.admin_invitation_program_state_v1()');
  v_definition text;
  v_role text;
begin
  if v_function is null then
    raise exception 'Missing public.admin_invitation_program_state_v1()';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid = v_function
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.prorettype = 'jsonb'::regtype
      and exists (
        select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
        where config in ('search_path=', 'search_path=""')
      )
  ) then
    raise exception 'Administrative invitation state RPC has unexpected owner/security/volatility/search_path/return type';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
    raise exception 'authenticated cannot execute administrative invitation state RPC';
  end if;
  foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
      raise exception 'Role % can execute administrative invitation state RPC', v_role;
    end if;
  end loop;
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
    raise exception 'PUBLIC can execute administrative invitation state RPC';
  end if;

  v_definition := lower(pg_catalog.pg_get_functiondef(v_function));
  if position('auth.uid()' in v_definition) = 0
    or position('current_user_has_capability(''admin.manage_access'')' in v_definition) = 0
    or position('current_user_has_capability(''invitations.authorize'')' in v_definition) > 0 then
    raise exception 'Administrative invitation state RPC does not enforce only admin.manage_access';
  end if;
  if position('email_normalized' in v_definition) > 0
    or position('email_fingerprint' in v_definition) > 0
    or position('inviter_user_id' in v_definition) > 0
    or position('registered_user_id' in v_definition) > 0
    or position('updated_by_user_id' in v_definition) > 0
    or position('app_invitation_events' in v_definition) > 0 then
    raise exception 'Administrative invitation state RPC references private invitation or actor fields';
  end if;
end;
$$;

rollback;
