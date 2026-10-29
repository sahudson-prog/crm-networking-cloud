-- Structural and authorization contract; run after migration, without user data.
begin transaction read only;

do $verify$
declare v_table pg_catalog.pg_class%rowtype; v_proc pg_catalog.pg_proc%rowtype;
  v_name text; v_role text; v_privilege text;
begin
  if (select pg_catalog.count(*) from public.networking_plan_notice_modes) <> 2
    or not exists (select 1 from public.networking_plan_notice_modes
      where objective_type = 'BUSINESS_DEVELOPMENT')
    or not exists (select 1 from public.networking_plan_notice_modes
      where objective_type = 'PERSONAL_BRAND')
    or not exists (select 1 from pg_catalog.pg_class where oid = pg_catalog.to_regclass('public.networking_plan_notice_modes')
      and relowner = 'postgres'::pg_catalog.regrole and relrowsecurity and not relforcerowsecurity)
    or pg_catalog.has_table_privilege('authenticated', 'public.networking_plan_notice_modes', 'SELECT')
    or pg_catalog.has_table_privilege('anon', 'public.networking_plan_notice_modes', 'SELECT') then
    raise exception 'interest_modes_contract_mismatch';
  end if;
  select * into v_table from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.networking_plan_interest');
  if not found or v_table.relowner <> 'postgres'::pg_catalog.regrole
    or not v_table.relrowsecurity or v_table.relforcerowsecurity then
    raise exception 'interest_table_security_mismatch';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_attribute
      where attrelid = v_table.oid and attnum > 0 and not attisdropped) <> 4
    or not exists (select 1 from pg_catalog.pg_constraint
      where conrelid = v_table.oid and contype = 'p'
        and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, objective_type)')
    or not exists (select 1 from pg_catalog.pg_constraint
      where conrelid = v_table.oid and contype = 'f'
        and pg_catalog.pg_get_constraintdef(oid) like '%REFERENCES auth.users(id) ON DELETE CASCADE%') then
    raise exception 'interest_table_shape_mismatch';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'networking_plan_interest') <> 1
    or not exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'networking_plan_interest'
        and policyname = 'Own active networking plan interest is readable'
        and cmd = 'SELECT' and roles = array['authenticated']::name[]
        and qual like '%user_id = auth.uid()%'
        and qual like '%current_user_has_app_access()%'
        and qual like '%auth.uid()%') then
    raise exception 'interest_rls_policy_mismatch';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', v_table.oid, 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', v_table.oid, 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', v_table.oid, 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', v_table.oid, 'DELETE')
    or pg_catalog.has_table_privilege('anon', v_table.oid, 'SELECT')
    or pg_catalog.has_table_privilege('service_role', v_table.oid, 'SELECT') then
    raise exception 'interest_table_acl_mismatch';
  end if;
  foreach v_name in array array['networking_plan_interest', 'networking_plan_notice_modes'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      foreach v_privilege in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] loop
        if pg_catalog.has_table_privilege(v_role, 'public.' || v_name, v_privilege)
          is distinct from (v_name = 'networking_plan_interest' and v_role = 'authenticated'
            and v_privilege = 'SELECT') then
          raise exception 'interest_table_privilege_mismatch: %.%.%', v_name, v_role, v_privilege;
        end if;
      end loop;
    end loop;
  end loop;
  foreach v_name in array array[
    'request_networking_plan_notice_v1', 'withdraw_networking_plan_notice_v1'
  ] loop
    select * into v_proc from pg_catalog.pg_proc
      where oid = pg_catalog.to_regprocedure('public.' || v_name || '(text)');
    if not found or v_proc.proowner <> 'postgres'::pg_catalog.regrole
      or not v_proc.prosecdef or pg_catalog.cardinality(v_proc.proconfig) is distinct from 1
      or (v_proc.proconfig[1] in ('search_path=', 'search_path=""')) is distinct from true
      or v_proc.prorettype <> 'boolean'::pg_catalog.regtype
      or not pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin', v_proc.oid, 'EXECUTE') then
      raise exception 'interest_rpc_contract_mismatch: %', v_name;
    end if;
  end loop;
end;
$verify$;

select 'PASS' as verdict, 'networking_plan_interest_v1' as contract;
rollback;
