-- Structural verifier for OBJ-02 R1. Read-only and fail-closed.

begin transaction read only;

do $$
declare
  function_row record;
  client_role text;
  function_signature regprocedure;
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

  select
    procedure.prosecdef,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    procedure.proconfig
  into function_row
  from pg_catalog.pg_proc procedure
  where procedure.oid = 'public.validate_networking_start_setting_v1()'::regprocedure;

  if function_row.prosecdef
    or function_row.owner_name <> 'postgres'
    or not exists (
      select 1 from unnest(function_row.proconfig) config
      where config in ('search_path=', 'search_path=""')
    ) then
    raise exception 'Networking-start trigger function has unsafe owner/security/search_path';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.user_settings'::regclass
      and trigger_row.tgname = 'validate_networking_start_setting_v1'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgfoid = 'public.validate_networking_start_setting_v1()'::regprocedure
  ) then
    raise exception 'Networking-start validation trigger is missing or disabled';
  end if;

  foreach function_signature in array array[
    'public.current_user_starting_point_v1()'::regprocedure,
    'public.save_current_user_starting_point_v1(text,text,date)'::regprocedure
  ] loop
    select
      procedure.prosecdef,
      procedure.provolatile,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
      procedure.proconfig,
      pg_catalog.pg_get_functiondef(procedure.oid) as definition
    into function_row
    from pg_catalog.pg_proc procedure
    where procedure.oid = function_signature;

    if not function_row.prosecdef
      or function_row.owner_name <> 'postgres'
      or not exists (
        select 1 from unnest(function_row.proconfig) config
        where config in ('search_path=', 'search_path=""')
      ) then
      raise exception 'Starting-point RPC % has unsafe owner/security/search_path', function_signature;
    end if;
    if function_row.definition not like '%auth.uid()%'
      or function_row.definition not like '%current_user_has_app_access()%'
      or function_row.definition like '%p_user_id%' then
      raise exception 'Starting-point RPC % does not derive ownership and access safely', function_signature;
    end if;
  end loop;

  foreach client_role in array array['public', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
    if has_function_privilege(client_role, 'public.validate_networking_start_setting_v1()', 'EXECUTE') then
      raise exception '% can execute internal networking-start trigger function', client_role;
    end if;
  end loop;

  if (select provolatile from pg_catalog.pg_proc where oid = 'public.current_user_starting_point_v1()'::regprocedure) <> 's'
    or (select provolatile from pg_catalog.pg_proc where oid = 'public.save_current_user_starting_point_v1(text,text,date)'::regprocedure) <> 'v' then
    raise exception 'Starting-point RPC volatility is unexpected';
  end if;

  foreach client_role in array array['public', 'anon', 'service_role', 'supabase_auth_admin'] loop
    foreach function_signature in array array[
      'public.current_user_starting_point_v1()'::regprocedure,
      'public.save_current_user_starting_point_v1(text,text,date)'::regprocedure
    ] loop
      if has_function_privilege(client_role, function_signature, 'EXECUTE') then
        raise exception '% can execute starting-point RPC %', client_role, function_signature;
      end if;
    end loop;
  end loop;

  if not has_function_privilege('authenticated', 'public.current_user_starting_point_v1()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.save_current_user_starting_point_v1(text,text,date)', 'EXECUTE') then
    raise exception 'authenticated is missing a required starting-point RPC grant';
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
