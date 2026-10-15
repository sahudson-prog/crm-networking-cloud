-- Verifies the networking start invariant and the auth-user trigger behavior.
-- Synthetic rows are enclosed in this transaction and never persist.

begin;

do $verify$
declare
  v_function regprocedure := pg_catalog.to_regprocedure('public.handle_new_auth_user_profile()');
  v_function_definition text;
  v_relation record;
  v_authenticated_privileges text[];
  v_role text;
  v_role_privileges text[];
  v_allowed_user uuid := gen_random_uuid();
  v_pending_user uuid := gen_random_uuid();
  v_allowed_email text := 'networking-start-allowed-' || v_allowed_user::text || '@example.invalid';
  v_pending_email text := 'networking-start-pending-' || v_pending_user::text || '@example.invalid';
begin
  if v_function is null then
    raise exception 'Missing public.handle_new_auth_user_profile()';
  end if;

  select pg_catalog.pg_get_functiondef(v_function)
  into v_function_definition;

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
    raise exception 'handle_new_auth_user_profile must remain SECURITY DEFINER, postgres-owned, with empty search_path';
  end if;

  if pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'public.is_email_authorized_for_app_access(new.email)') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'insert into public.profiles') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'insert into public.user_settings') = 0
    or pg_catalog.strpos(v_function_definition, '''Fecha_Inicio_Networking''') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'new.created_at at time zone ''utc''') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'on conflict (user_id, setting_key) do nothing') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'insert into public.user_access_profiles') = 0
    or pg_catalog.strpos(v_function_definition, '''active'', ''approved''') = 0
    or pg_catalog.strpos(v_function_definition, '''beta_pending'', ''pending''') = 0
    or pg_catalog.strpos(pg_catalog.lower(v_function_definition), 'insert into public.user_role_assignments') = 0 then
    raise exception 'handle_new_auth_user_profile is missing networking-start or access-contract behavior';
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
      and pg_catalog.pg_get_triggerdef(trigger_definition.oid) like '%AFTER INSERT ON auth.users%'
  ) then
    raise exception 'Auth user creation trigger is missing or does not call handle_new_auth_user_profile';
  end if;

  if exists (
    select 1
    from public.profiles profile
    left join public.user_settings setting
      on setting.user_id = profile.id
     and setting.setting_key = 'Fecha_Inicio_Networking'
    where setting.user_id is null
  ) then
    raise exception 'A profile is missing Fecha_Inicio_Networking';
  end if;

  if exists (
    select 1
    from public.user_settings setting
    where setting.setting_key = 'Fecha_Inicio_Networking'
      and (setting.setting_value is null or pg_catalog.btrim(setting.setting_value) = '')
  ) then
    raise exception 'Fecha_Inicio_Networking contains a null or empty value';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'user_settings'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 2
      and index_definition.indnatts = 2
      and (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
      ) = array['user_id', 'setting_key']::text[]
  ) then
    raise exception 'user_settings must retain exact unique identity (user_id, setting_key)';
  end if;

  select
    pg_catalog.pg_get_userbyid(relation.relowner) as owner_name,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    relation.relacl,
    relation.relowner
  into v_relation
  from pg_catalog.pg_class relation
  where relation.oid = 'public.user_settings'::regclass;

  if v_relation.owner_name <> 'postgres'
    or not v_relation.relrowsecurity
    or v_relation.relforcerowsecurity then
    raise exception 'user_settings ownership or RLS contract changed';
  end if;

  select coalesce(pg_catalog.array_agg(distinct acl.privilege_type order by acl.privilege_type), array[]::text[])
  into v_authenticated_privileges
  from pg_catalog.aclexplode(coalesce(v_relation.relacl, pg_catalog.acldefault('r', v_relation.relowner))) acl
  where acl.grantee = pg_catalog.to_regrole('authenticated');

  if v_authenticated_privileges <> array['INSERT', 'SELECT', 'UPDATE']::text[] then
    raise exception 'authenticated user_settings privileges changed: %', v_authenticated_privileges;
  end if;

  foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
    select coalesce(pg_catalog.array_agg(distinct acl.privilege_type order by acl.privilege_type), array[]::text[])
    into v_role_privileges
    from pg_catalog.aclexplode(coalesce(v_relation.relacl, pg_catalog.acldefault('r', v_relation.relowner))) acl
    where acl.grantee = pg_catalog.to_regrole(v_role);

    if pg_catalog.cardinality(v_role_privileges) <> 0 then
      raise exception '% unexpectedly has direct user_settings privileges: %', v_role, v_role_privileges;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.aclexplode(coalesce(v_relation.relacl, pg_catalog.acldefault('r', v_relation.relowner))) acl
    where acl.grantee = 0
  ) then
    raise exception 'PUBLIC unexpectedly has direct user_settings privileges';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
      raise exception '% can execute internal auth trigger function directly', v_role;
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
    raise exception 'PUBLIC can execute internal auth trigger function directly';
  end if;

  insert into public.app_access_allowlist (email_normalized)
  values (v_allowed_email);

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (
      v_allowed_user,
      'authenticated',
      'authenticated',
      v_allowed_email,
      '2024-03-01 02:30:00+00'::timestamptz,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '2024-02-29 23:30:00-03'::timestamptz,
      '2024-03-01 02:30:00+00'::timestamptz
    ),
    (
      v_pending_user,
      'authenticated',
      'authenticated',
      v_pending_email,
      '2024-06-14 21:30:00+00'::timestamptz,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '2024-06-15 00:30:00+03'::timestamptz,
      '2024-06-14 21:30:00+00'::timestamptz
    );

  if not exists (
    select 1
    from public.user_settings
    where user_id = v_allowed_user
      and setting_key = 'Fecha_Inicio_Networking'
      and setting_value = '2024-03-01'
  ) or not exists (
    select 1
    from public.user_settings
    where user_id = v_pending_user
      and setting_key = 'Fecha_Inicio_Networking'
      and setting_value = '2024-06-14'
  ) then
    raise exception 'Auth user trigger did not persist the UTC registration date';
  end if;

  if not exists (
    select 1
    from public.user_access_profiles
    where user_id = v_allowed_user
      and account_status = 'active'
      and beta_access_status = 'approved'
  ) or not exists (
    select 1
    from public.user_role_assignments
    where user_id = v_allowed_user
      and role_code = 'user'
  ) then
    raise exception 'Allowed auth user provisioning contract changed';
  end if;

  if not exists (
    select 1
    from public.user_access_profiles
    where user_id = v_pending_user
      and account_status = 'beta_pending'
      and beta_access_status = 'pending'
  ) or exists (
    select 1
    from public.user_role_assignments
    where user_id = v_pending_user
      and role_code = 'user'
  ) then
    raise exception 'Non-allowlisted auth user no longer fails closed';
  end if;
end;
$verify$;

rollback;
