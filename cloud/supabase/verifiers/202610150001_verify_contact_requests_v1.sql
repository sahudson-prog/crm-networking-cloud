-- Verifies the public contact intake storage, capability and RPC-only privilege surface.

do $verify$
declare
  v_table regclass := pg_catalog.to_regclass('public.contact_requests');
  v_submit regprocedure := pg_catalog.to_regprocedure('public.submit_contact_request_v1(text,text,text,text,text,uuid)');
  v_list regprocedure := pg_catalog.to_regprocedure('public.admin_list_contact_requests_v1(integer)');
  v_update regprocedure := pg_catalog.to_regprocedure('public.admin_update_contact_request_v1(uuid,text,text)');
  v_function regprocedure;
  v_privilege text;
  v_role text;
begin
  if v_table is null then
    raise exception 'Missing public.contact_requests';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = v_table
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
  ) then
    raise exception 'contact_requests must be postgres-owned with RLS enabled and FORCE RLS disabled';
  end if;

  if exists (
    with expected(column_name, type_name, not_null) as (values
      ('id', 'uuid', true),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true),
      ('requester_name', 'text', false),
      ('requester_email', 'text', true),
      ('reason', 'text', true),
      ('privacy_subreason', 'text', false),
      ('message', 'text', true),
      ('user_id', 'uuid', false),
      ('status', 'text', true),
      ('identity_verification_status', 'text', true)
    )
    select 1 from (
      (select attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_table and attribute.attnum > 0 and not attribute.attisdropped
       except select * from expected)
      union all
      (select * from expected
       except select attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_table and attribute.attnum > 0 and not attribute.attisdropped)
    ) differences
  ) then
    raise exception 'contact_requests columns differ from the approved contract';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint definition
    where definition.conrelid = v_table and definition.contype = 'p'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint definition
    where definition.conrelid = v_table
      and definition.contype = 'f'
      and pg_catalog.pg_get_constraintdef(definition.oid) like '%FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL%'
  ) then
    raise exception 'contact_requests primary key or optional auth user relationship is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'contact_requests'
      and policy.policyname = 'Contact requests are admin readable'
      and policy.cmd = 'SELECT'
      and cardinality(policy.roles) = 1
      and array_to_string(policy.roles, ',') = 'authenticated'
      and coalesce(policy.qual, '') like '%admin.manage_contact_requests%'
  ) then
    raise exception 'contact_requests admin read policy is missing or too broad';
  end if;

  foreach v_privilege in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl
      where relation.oid = v_table
        and acl.grantee = 0
        and acl.privilege_type = v_privilege
    ) then
      raise exception 'PUBLIC has forbidden % privilege on contact_requests', v_privilege;
    end if;

    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_table_privilege(v_role, v_table, v_privilege) then
        raise exception '% has forbidden direct % privilege on contact_requests', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  if not exists (
    select 1 from public.app_capabilities capability
    where capability.capability_code = 'admin.manage_contact_requests'
      and capability.capability_area = 'admin'
      and capability.is_active
  ) or not exists (
    select 1 from public.app_role_capabilities role_capability
    where role_capability.role_code = 'system_admin'
      and role_capability.capability_code = 'admin.manage_contact_requests'
  ) then
    raise exception 'Contact request capability or system_admin mapping is missing';
  end if;

  foreach v_function in array array[v_submit, v_list, v_update] loop
    if v_function is null or not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = v_function
        and procedure.prosecdef
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'Contact request RPC % must be SECURITY DEFINER, postgres-owned, with empty search_path', v_function;
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
      raise exception 'PUBLIC can execute contact request RPC %', v_function;
    end if;
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_submit, 'EXECUTE') then
      raise exception '% can execute internal submit_contact_request_v1', v_role;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('service_role', v_submit, 'EXECUTE') then
    raise exception 'service_role cannot execute submit_contact_request_v1';
  end if;

  foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_list, 'EXECUTE')
      or pg_catalog.has_function_privilege(v_role, v_update, 'EXECUTE') then
      raise exception '% has unexpected contact request admin RPC access', v_role;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege('authenticated', v_list, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_update, 'EXECUTE') then
    raise exception 'authenticated is missing contact request admin RPC access';
  end if;
end;
$verify$;
