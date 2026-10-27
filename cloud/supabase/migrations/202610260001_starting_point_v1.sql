-- PROD CONTRACT CHANGE: OBJ-02 R1 starting-point profile data and narrow own-user RPCs.
-- This migration performs no backfill and preserves all existing profile/settings values.

begin;

do $preconditions$
declare
  v_constraint record;
  v_expected_constraint text := 'check (professional_situation_code is null or (professional_situation_code = any (array[''employed''::text, ''unemployed''::text, ''independent''::text, ''studying''::text, ''other''::text, ''prefer_not_to_say''::text])))';
  v_expected_function record;
  v_function record;
  v_trigger record;
  v_trigger_columns text[];
  v_invalid_networking_dates bigint := 0;
  v_networking_date date;
  v_networking_value text;
  v_utc_today date := (pg_catalog.statement_timestamp() at time zone 'UTC')::date;
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.user_settings') is null
    or to_regprocedure('public.current_user_has_app_access()') is null then
    raise exception 'starting_point_v1 prerequisites are missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'professional_situation_code'
      and (
        data_type <> 'text'
        or is_nullable <> 'YES'
        or column_default is not null
        or is_generated <> 'NEVER'
        or is_identity <> 'NO'
      )
  ) then
    raise exception 'profiles.professional_situation_code has an incompatible definition';
  end if;

  select
    constraint_row.contype,
    constraint_row.convalidated,
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
      '[[:space:]]+', ' ', 'g'
    ) as normalized_definition
  into v_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.profiles'::regclass
    and constraint_row.conname = 'profiles_professional_situation_code_valid';

  if found and (
    v_constraint.contype <> 'c'
    or not v_constraint.convalidated
    or v_constraint.normalized_definition <> v_expected_constraint
  ) then
    raise exception 'profiles_professional_situation_code_valid has an incompatible definition';
  end if;

  for v_expected_function in
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
        and procedure.proname = v_expected_function.function_name
        and procedure.oid <> coalesce(
          pg_catalog.to_regprocedure(v_expected_function.function_signature), 0::oid
        )
    ) then
      raise exception 'Unexpected overload exists for %', v_expected_function.function_name;
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
    into v_function
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_expected_function.function_signature);

    if v_function.oid is null then
      continue;
    end if;

    if pg_catalog.pg_get_userbyid(v_function.proowner) <> 'postgres'
      or (select language.lanname from pg_catalog.pg_language language where language.oid = v_function.prolang) <> 'plpgsql'
      or v_function.prorettype <> v_expected_function.return_type::pg_catalog.regtype
      or v_function.prosecdef <> v_expected_function.security_definer
      or v_function.provolatile <> v_expected_function.volatility
      or v_function.prokind <> 'f'
      or v_function.proisstrict
      or v_function.proleakproof
      or v_function.proparallel <> 'u'
      or coalesce(pg_catalog.array_length(v_function.proconfig, 1), 0) <> 1
      or v_function.proconfig[1] not in ('search_path=', 'search_path=""')
      or v_function.normalized_body_md5 <> v_expected_function.normalized_body_md5 then
      raise exception 'Function % has an incompatible definition or security configuration',
        v_expected_function.function_signature;
    end if;

    if not pg_catalog.has_function_privilege('postgres', v_function.oid, 'EXECUTE WITH GRANT OPTION')
      or pg_catalog.has_function_privilege('public', v_function.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_function.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin', v_function.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
        <> v_expected_function.authenticated_execute
      or exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(v_function.proacl, pg_catalog.acldefault('f', v_function.proowner))
        ) acl
        left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee <> v_function.proowner
          and not (
            v_expected_function.authenticated_execute
            and grantee.rolname = 'authenticated'
            and not acl.is_grantable
          )
      ) then
      raise exception 'Function % has incompatible EXECUTE privileges',
        v_expected_function.function_signature;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_depend dependency
      where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and dependency.refobjid = v_function.oid
        and not (
          v_expected_function.function_name = 'validate_networking_start_setting_v1'
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
        v_expected_function.function_signature;
    end if;
  end loop;

  select
    trigger_row.oid,
    trigger_row.tgfoid,
    trigger_row.tgtype,
    trigger_row.tgenabled,
    trigger_row.tgisinternal,
    trigger_row.tgqual,
    trigger_row.tgnargs,
    pg_catalog.pg_get_triggerdef(trigger_row.oid, true) as definition
  into v_trigger
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.user_settings'::pg_catalog.regclass
    and trigger_row.tgname = 'validate_networking_start_setting_v1';

  if v_trigger.oid is not null then
    select pg_catalog.array_agg(attribute.attname::text order by attribute.attname)
    into v_trigger_columns
    from pg_catalog.pg_trigger trigger_row
    cross join lateral pg_catalog.unnest(trigger_row.tgattr::smallint[]) attribute_number
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = trigger_row.tgrelid
     and attribute.attnum = attribute_number
    where trigger_row.oid = v_trigger.oid;

    if v_trigger.tgfoid <> coalesce(
        pg_catalog.to_regprocedure('public.validate_networking_start_setting_v1()'), 0::oid
      )
      or v_trigger.tgtype <> 23
      or v_trigger.tgenabled <> 'O'
      or v_trigger.tgisinternal
      or v_trigger.tgqual is not null
      or v_trigger.tgnargs <> 0
      or v_trigger_columns is distinct from array['setting_key', 'setting_value']::text[] then
      raise exception 'Trigger validate_networking_start_setting_v1 has an incompatible definition';
    end if;
  end if;

  for v_networking_value in
    select setting.setting_value
    from public.user_settings setting
    where setting.setting_key = 'Fecha_Inicio_Networking'
  loop
    begin
      v_networking_value := pg_catalog.btrim(coalesce(v_networking_value, ''));
      if v_networking_value ~ '^\d{4}-\d{2}-\d{2}$' then
        v_networking_date := v_networking_value::date;
      elsif v_networking_value ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
        v_networking_date := pg_catalog.make_date(
          pg_catalog.split_part(v_networking_value, '/', 3)::integer,
          pg_catalog.split_part(v_networking_value, '/', 2)::integer,
          pg_catalog.split_part(v_networking_value, '/', 1)::integer
        );
      else
        v_invalid_networking_dates := v_invalid_networking_dates + 1;
        continue;
      end if;
      if v_networking_date > v_utc_today then
        v_invalid_networking_dates := v_invalid_networking_dates + 1;
      end if;
    exception when datetime_field_overflow or invalid_datetime_format or invalid_text_representation then
      v_invalid_networking_dates := v_invalid_networking_dates + 1;
    end;
  end loop;

  if v_invalid_networking_dates > 0 then
    raise exception 'Fecha_Inicio_Networking has % incompatible existing row(s)', v_invalid_networking_dates;
  end if;
end;
$preconditions$;

alter table public.profiles
  add column if not exists professional_situation_code text;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.conname = 'profiles_professional_situation_code_valid'
  ) then
    alter table public.profiles
      add constraint profiles_professional_situation_code_valid check (
        professional_situation_code is null
        or professional_situation_code in (
          'employed',
          'unemployed',
          'independent',
          'studying',
          'other',
          'prefer_not_to_say'
        )
      );
  end if;
end;
$constraint$;

comment on column public.profiles.professional_situation_code is
  'Situacion profesional declarada por el usuario. Nullable para preservar perfiles legacy; usa el catalogo cerrado de OBJ-02 R1.';

create or replace function public.validate_networking_start_setting_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_networking_date date;
  v_networking_value text := pg_catalog.btrim(coalesce(new.setting_value, ''));
  v_utc_today date := (pg_catalog.statement_timestamp() at time zone 'UTC')::date;
begin
  if new.setting_key <> 'Fecha_Inicio_Networking' then
    return new;
  end if;

  begin
    if v_networking_value ~ '^\d{4}-\d{2}-\d{2}$' then
      v_networking_date := v_networking_value::date;
    elsif v_networking_value ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      v_networking_date := pg_catalog.make_date(
        pg_catalog.split_part(v_networking_value, '/', 3)::integer,
        pg_catalog.split_part(v_networking_value, '/', 2)::integer,
        pg_catalog.split_part(v_networking_value, '/', 1)::integer
      );
    else
      raise exception 'starting_point_invalid_networking_start_date' using errcode = '22023';
    end if;
  exception when datetime_field_overflow or invalid_datetime_format or invalid_text_representation then
    raise exception 'starting_point_invalid_networking_start_date' using errcode = '22023';
  end;

  if v_networking_date > v_utc_today then
    raise exception 'starting_point_invalid_networking_start_date' using errcode = '22023';
  end if;
  return new;
end;
$$;

alter function public.validate_networking_start_setting_v1() owner to postgres;
revoke all on function public.validate_networking_start_setting_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;

do $trigger$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.user_settings'::pg_catalog.regclass
      and trigger_row.tgname = 'validate_networking_start_setting_v1'
  ) then
    create trigger validate_networking_start_setting_v1
    before insert or update of setting_key, setting_value on public.user_settings
    for each row execute function public.validate_networking_start_setting_v1();
  end if;
end;
$trigger$;

create or replace function public.current_user_starting_point_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'starting_point_not_authenticated' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'app_access_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'full_name', coalesce(profile.full_name, ''),
    'professional_situation_code', profile.professional_situation_code,
    'networking_start_date', setting.setting_value
  )
  into v_result
  from public.profiles profile
  left join public.user_settings setting
    on setting.user_id = profile.id
   and setting.setting_key = 'Fecha_Inicio_Networking'
  where profile.id = v_user_id;

  if not found then
    raise exception 'starting_point_profile_missing' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.save_current_user_starting_point_v1(
  p_full_name text default null,
  p_professional_situation_code text default null,
  p_networking_start_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_full_name text := case when p_full_name is null then null
    else pg_catalog.regexp_replace(pg_catalog.btrim(p_full_name), '[[:space:]]+', ' ', 'g') end;
  v_situation text := case when p_professional_situation_code is null then null
    else pg_catalog.btrim(p_professional_situation_code) end;
  v_date_value text;
  v_utc_today date := (pg_catalog.statement_timestamp() at time zone 'UTC')::date;
begin
  if v_user_id is null then
    raise exception 'starting_point_not_authenticated' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'app_access_denied' using errcode = '42501';
  end if;
  if p_full_name is null and p_professional_situation_code is null and p_networking_start_date is null then
    raise exception 'starting_point_no_changes' using errcode = '22023';
  end if;
  if p_full_name is not null and (v_full_name = '' or pg_catalog.char_length(v_full_name) > 160) then
    raise exception 'starting_point_invalid_full_name' using errcode = '22023';
  end if;
  if p_professional_situation_code is not null and v_situation not in (
    'employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say'
  ) then
    raise exception 'starting_point_invalid_professional_situation' using errcode = '22023';
  end if;
  if p_networking_start_date is not null and p_networking_start_date > v_utc_today then
    raise exception 'starting_point_invalid_networking_start_date' using errcode = '22023';
  end if;

  perform 1 from public.profiles profile where profile.id = v_user_id for update;
  if not found then
    raise exception 'starting_point_profile_missing' using errcode = 'P0002';
  end if;

  v_date_value := case when p_networking_start_date is null then null
    else pg_catalog.to_char(p_networking_start_date, 'YYYY-MM-DD') end;

  update public.profiles profile
  set full_name = coalesce(v_full_name, profile.full_name),
      professional_situation_code = coalesce(v_situation, profile.professional_situation_code)
  where profile.id = v_user_id;

  insert into public.user_settings(user_id, setting_key, setting_value)
  select v_user_id, 'Fecha_Inicio_Networking', v_date_value
  where v_date_value is not null
  on conflict (user_id, setting_key) do update
  set setting_value = excluded.setting_value;

  return public.current_user_starting_point_v1();
end;
$$;

alter function public.current_user_starting_point_v1() owner to postgres;
alter function public.save_current_user_starting_point_v1(text, text, date) owner to postgres;

revoke all on function public.current_user_starting_point_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.save_current_user_starting_point_v1(text, text, date)
  from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function public.current_user_starting_point_v1() to authenticated;
grant execute on function public.save_current_user_starting_point_v1(text, text, date) to authenticated;

comment on function public.current_user_starting_point_v1() is
  'Lee solo el punto de partida del usuario autenticado con acceso efectivo.';
comment on function public.save_current_user_starting_point_v1(text, text, date) is
  'Guarda atomicamente nombre, situacion profesional y Fecha_Inicio_Networking del usuario autenticado. No inicia imports ni sync.';

commit;
