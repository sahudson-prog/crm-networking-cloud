-- Structural verifier for OBJ-02 R1. Read-only and fail-closed.

begin transaction read only;

do $$
declare
  expected_function record;
  function_row record;
  client_role text;
  function_signature regprocedure;
  trigger_columns text[];
  expected_constraint text := 'check (professional_situation_code is null or (professional_situation_code = any (array[''employed''::text, ''unemployed''::text, ''independent''::text, ''studying''::text, ''other''::text, ''prefer_not_to_say''::text])))';
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'professional_situation_code'
      and data_type = 'text'
      and is_nullable = 'YES'
      and column_default is null
      and is_generated = 'NEVER'
      and is_identity = 'NO'
  ) then
    raise exception 'profiles.professional_situation_code is missing or incompatible';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.conname = 'profiles_professional_situation_code_valid'
      and constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
        '[[:space:]]+', ' ', 'g'
      ) = expected_constraint
  ) then
    raise exception 'Professional situation constraint is missing or incompatible';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'authenticated received broad UPDATE on profiles';
  end if;

  for expected_function in
    select *
    from (values
      (
        'validate_networking_start_setting_v1',
        'public.validate_networking_start_setting_v1()',
        'trigger', false, 'v', false,
        'c9e2538021d503c7abf05907369a8b72'
      ),
      (
        'current_user_starting_point_v1',
        'public.current_user_starting_point_v1()',
        'jsonb', true, 's', true,
        '72323c779de84fd3616cfae8cefa32a4'
      ),
      (
        'save_current_user_starting_point_v1',
        'public.save_current_user_starting_point_v1(text,text,date)',
        'jsonb', true, 'v', true,
        '60068fb7758ba91461551807ae34a422'
      )
    ) as expected(
      function_name, function_signature, return_type, security_definer,
      volatility, authenticated_execute, normalized_body_md5
    )
  loop
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = expected_function.function_name
        and procedure.oid <> coalesce(
          pg_catalog.to_regprocedure(expected_function.function_signature), 0::oid
        )
    ) then
      raise exception 'Unexpected overload exists for %', expected_function.function_name;
    end if;

    select
      procedure.oid,
      procedure.proowner,
      procedure.proacl,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proconfig,
      procedure.prorettype,
      procedure.prolang,
      procedure.prokind,
      procedure.proisstrict,
      procedure.proleakproof,
      procedure.proparallel,
      pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
          pg_catalog.chr(13), pg_catalog.chr(10)
        )
      ) as normalized_body_md5
    into function_row
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(expected_function.function_signature);

    if function_row.oid is null then
      raise exception 'Function % is missing', expected_function.function_signature;
    end if;

    if pg_catalog.pg_get_userbyid(function_row.proowner) <> 'postgres'
      or (select language.lanname from pg_catalog.pg_language language where language.oid = function_row.prolang) <> 'plpgsql'
      or function_row.prorettype <> expected_function.return_type::pg_catalog.regtype
      or function_row.prosecdef <> expected_function.security_definer
      or function_row.provolatile <> expected_function.volatility
      or function_row.prokind <> 'f'
      or function_row.proisstrict
      or function_row.proleakproof
      or function_row.proparallel <> 'u'
      or coalesce(pg_catalog.array_length(function_row.proconfig, 1), 0) <> 1
      or function_row.proconfig[1] not in ('search_path=', 'search_path=""')
      or function_row.normalized_body_md5 <> expected_function.normalized_body_md5 then
      raise exception 'Function % has an incompatible definition or security configuration',
        expected_function.function_signature;
    end if;

    if not pg_catalog.has_function_privilege('postgres', function_row.oid, 'EXECUTE WITH GRANT OPTION')
      or pg_catalog.has_function_privilege('public', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin', function_row.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
        <> expected_function.authenticated_execute
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
        ) acl
        left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> function_row.proowner
          and not (
            expected_function.authenticated_execute
            and grantee.rolname = 'authenticated'
            and not acl.is_grantable
          )
      ) then
      raise exception 'Function % has incompatible EXECUTE privileges',
        expected_function.function_signature;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_depend dependency
      where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and dependency.refobjid = function_row.oid
        and not (
          expected_function.function_name = 'validate_networking_start_setting_v1'
          and dependency.classid = 'pg_catalog.pg_trigger'::pg_catalog.regclass
          and exists (
            select 1
            from pg_catalog.pg_trigger trigger_row
            where trigger_row.oid = dependency.objid
              and trigger_row.tgrelid = 'public.user_settings'::pg_catalog.regclass
              and trigger_row.tgname = 'validate_networking_start_setting_v1'
          )
        )
    ) then
      raise exception 'Function % has unexpected dependent objects',
        expected_function.function_signature;
    end if;
  end loop;

  select pg_catalog.array_agg(attribute.attname::text order by attribute.attname)
  into trigger_columns
  from pg_catalog.pg_trigger trigger_row
  cross join lateral pg_catalog.unnest(trigger_row.tgattr::smallint[]) attribute_number
  join pg_catalog.pg_attribute attribute
    on attribute.attrelid = trigger_row.tgrelid
   and attribute.attnum = attribute_number
  where trigger_row.tgrelid = 'public.user_settings'::regclass
    and trigger_row.tgname = 'validate_networking_start_setting_v1';

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.user_settings'::regclass
      and trigger_row.tgname = 'validate_networking_start_setting_v1'
      and trigger_row.tgfoid = 'public.validate_networking_start_setting_v1()'::regprocedure
      and trigger_row.tgtype = 23
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
      and trigger_row.tgqual is null
      and trigger_row.tgnargs = 0
  ) or trigger_columns is distinct from array['setting_key', 'setting_value']::text[] then
    raise exception 'Networking-start validation trigger is missing or incompatible';
  end if;

  if pg_catalog.pg_get_functiondef('public.save_current_user_starting_point_v1(text,text,date)'::regprocedure)
      not like '%Fecha_Inicio_Networking%'
    or pg_catalog.pg_get_functiondef('public.save_current_user_starting_point_v1(text,text,date)'::regprocedure)
      not like '%on conflict (user_id, setting_key)%'
    or pg_catalog.pg_get_functiondef('public.save_current_user_starting_point_v1(text,text,date)'::regprocedure)
      not like '%where v_date_value is not null%' then
    raise exception 'Starting-point write does not preserve the existing networking date source of truth';
  end if;
end;
$$;

rollback;
