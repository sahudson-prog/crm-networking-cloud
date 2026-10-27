-- Synthetic behavior verifier for OBJ-02 R1. All fixture changes roll back.

begin;

do $setup$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_owner_email text := 'starting-point-owner-' || gen_random_uuid()::text || '@example.invalid';
  v_other_email text := 'starting-point-other-' || gen_random_uuid()::text || '@example.invalid';
  v_situation text;
begin
  insert into public.app_access_allowlist(email_normalized)
  values (v_owner_email), (v_other_email);

  insert into auth.users(
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_owner, 'authenticated', 'authenticated', v_owner_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"Nombre previo"}', statement_timestamp(), statement_timestamp()),
    (v_other, 'authenticated', 'authenticated', v_other_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"Otra persona"}', statement_timestamp(), statement_timestamp());

  foreach v_situation in array array[
    'employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say'
  ] loop
    update public.profiles
    set professional_situation_code = v_situation
    where id = v_owner;
  end loop;
  update public.profiles set professional_situation_code = null where id = v_owner;
  begin
    update public.profiles set professional_situation_code = 'unexpected' where id = v_owner;
    raise exception 'Unexpected professional situation was accepted';
  exception when check_violation then null;
  end;

  update public.user_settings
  set setting_value = '2021-04-05'
  where user_id = v_owner
    and setting_key = 'Fecha_Inicio_Networking';

  perform set_config('coffeecito.verify_starting_point_owner', v_owner::text, true);
  perform set_config('coffeecito.verify_starting_point_other', v_other::text, true);
end;
$setup$;

set local role authenticated;

do $owner_behavior$
declare
  v_owner uuid := current_setting('coffeecito.verify_starting_point_owner')::uuid;
  v_other uuid := current_setting('coffeecito.verify_starting_point_other')::uuid;
  v_result jsonb;
  v_rows bigint;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_result := public.current_user_starting_point_v1();
  if v_result->>'full_name' <> 'Nombre previo'
    or v_result->>'professional_situation_code' is not null
    or v_result->>'networking_start_date' <> '2021-04-05' then
    raise exception 'Legacy starting-point values were not preserved';
  end if;

  v_result := public.save_current_user_starting_point_v1(
    '  Nombre   Confirmado  ', 'employed', date '2020-01-02'
  );
  if v_result <> jsonb_build_object(
    'full_name', 'Nombre Confirmado',
    'professional_situation_code', 'employed',
    'networking_start_date', '2020-01-02'
  ) then
    raise exception 'Starting-point save returned an unexpected payload: %', v_result;
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_owner
      and profile.full_name = 'Nombre Confirmado'
      and profile.professional_situation_code = 'employed'
  ) or not exists (
    select 1 from public.user_settings setting
    where setting.user_id = v_owner
      and setting.setting_key = 'Fecha_Inicio_Networking'
      and setting.setting_value = '2020-01-02'
  ) then
    raise exception 'Starting-point fields were not persisted atomically';
  end if;

  v_result := public.save_current_user_starting_point_v1('Nombre actualizado', null, null);
  if v_result->>'full_name' <> 'Nombre actualizado'
    or v_result->>'professional_situation_code' <> 'employed'
    or v_result->>'networking_start_date' <> '2020-01-02' then
    raise exception 'Partial update overwrote an unsubmitted starting-point field';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.id = v_other
      and (profile.full_name <> 'Otra persona' or profile.professional_situation_code is not null)
  ) then
    raise exception 'Starting-point save crossed the auth.uid ownership boundary';
  end if;

  begin
    perform public.save_current_user_starting_point_v1('Cambio parcial', 'invalid', current_date);
    raise exception 'Invalid situation unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_current_user_starting_point_v1('Cambio parcial', 'studying', current_date + 1);
    raise exception 'Future networking date unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_current_user_starting_point_v1('   ', 'studying', current_date);
    raise exception 'Blank name unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;

  if not exists (
    select 1 from public.profiles profile
    join public.user_settings setting on setting.user_id = profile.id
    where profile.id = v_owner
      and profile.full_name = 'Nombre actualizado'
      and profile.professional_situation_code = 'employed'
      and setting.setting_key = 'Fecha_Inicio_Networking'
      and setting.setting_value = '2020-01-02'
  ) then
    raise exception 'A rejected write left a partial update';
  end if;

  insert into public.user_settings(user_id, setting_key, setting_value)
  values (v_owner, 'starting-point-unrelated', 'preserved');

  insert into public.user_settings(user_id, setting_key, setting_value)
  values (v_owner, 'Fecha_Inicio_Networking', '5/4/2021')
  on conflict (user_id, setting_key) do update set setting_value = excluded.setting_value;
  if not exists (
    select 1 from public.user_settings
    where user_id = v_owner
      and setting_key = 'Fecha_Inicio_Networking'
      and setting_value = '5/4/2021'
  ) then
    raise exception 'A valid legacy networking date was not preserved';
  end if;

  begin
    update public.user_settings
    set setting_value = ''
    where user_id = v_owner and setting_key = 'Fecha_Inicio_Networking';
    raise exception 'Empty direct networking date unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.user_settings
    set setting_value = 'not-a-date'
    where user_id = v_owner and setting_key = 'Fecha_Inicio_Networking';
    raise exception 'Malformed direct networking date unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.user_settings
    set setting_value = pg_catalog.to_char(
      (pg_catalog.statement_timestamp() at time zone 'UTC')::date + 1,
      'YYYY-MM-DD'
    )
    where user_id = v_owner and setting_key = 'Fecha_Inicio_Networking';
    raise exception 'Future direct networking date unexpectedly persisted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.user_settings
    set setting_key = 'Fecha_Inicio_Networking', setting_value = 'invalid-key-change'
    where user_id = v_owner and setting_key = 'starting-point-unrelated';
    raise exception 'Invalid networking date introduced by key change';
  exception when invalid_parameter_value then null;
  end;

  update public.user_settings
  set setting_value = '2020-01-02'
  where user_id = v_owner and setting_key = 'Fecha_Inicio_Networking';

  update public.user_settings
  set setting_value = '2020-01-03'
  where user_id = v_other and setting_key = 'Fecha_Inicio_Networking';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'Direct networking-date write crossed the ownership boundary';
  end if;

  if not exists (
    select 1 from public.user_settings
    where user_id = v_owner and setting_key = 'starting-point-unrelated' and setting_value = 'preserved'
  ) then
    raise exception 'Networking-date validation changed an unrelated setting';
  end if;
end;
$owner_behavior$;

reset role;

update public.user_access_profiles
set account_status = 'paused'
where user_id = current_setting('coffeecito.verify_starting_point_owner')::uuid;

set local role authenticated;

do $revoked_access$
begin
  perform set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_starting_point_owner'), true);
  begin
    perform public.save_current_user_starting_point_v1('No debe guardar', 'other', current_date);
    raise exception 'Paused user unexpectedly updated starting-point data';
  exception when insufficient_privilege then
    if sqlerrm <> 'app_access_denied' then raise; end if;
  end;
end;
$revoked_access$;

reset role;
rollback;
