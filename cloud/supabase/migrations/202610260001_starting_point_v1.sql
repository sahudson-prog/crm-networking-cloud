-- PROD CONTRACT CHANGE: OBJ-02 R1 starting-point profile data and narrow own-user RPCs.
-- This migration performs no backfill and preserves all existing profile/settings values.

begin;

do $preconditions$
declare
  v_constraint record;
  v_expected_constraint text := 'check (professional_situation_code is null or (professional_situation_code = any (array[''employed''::text, ''unemployed''::text, ''independent''::text, ''studying''::text, ''other''::text, ''prefer_not_to_say''::text])))';
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
      and (data_type <> 'text' or is_nullable <> 'YES')
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

drop trigger if exists validate_networking_start_setting_v1 on public.user_settings;
create trigger validate_networking_start_setting_v1
before insert or update of setting_key, setting_value on public.user_settings
for each row execute function public.validate_networking_start_setting_v1();

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
