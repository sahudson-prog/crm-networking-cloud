-- Synthetic behavior verifier for OBJ-02 R2-A. All fixture changes roll back.

begin;

do $setup$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_other_cycle uuid;
  v_owner_email text := 'r2a-owner-' || gen_random_uuid()::text || '@example.invalid';
  v_other_email text := 'r2a-other-' || gen_random_uuid()::text || '@example.invalid';
begin
  insert into public.app_access_allowlist(email_normalized) values (v_owner_email), (v_other_email);
  insert into auth.users(
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_owner, 'authenticated', 'authenticated', v_owner_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"R2A owner"}', statement_timestamp(), statement_timestamp()),
    (v_other, 'authenticated', 'authenticated', v_other_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{"full_name":"R2A other"}', statement_timestamp(), statement_timestamp());
  insert into public.networking_cycles(
    user_id, objective_type, status, started_on, professional_situation_code_at_start, origin
  ) values (v_other, 'JOB_SEARCH', 'active', null, null, 'legacy')
  returning id into v_other_cycle;
  update public.profiles set professional_situation_code = 'employed' where id = v_other;
  insert into public.contacts(user_id, display_name)
  values (v_other, 'Synthetic other owner');
  if not exists (select 1 from public.professional_situation_transitions where user_id = v_other)
    or not exists (select 1 from public.contact_networking_transitions where user_id = v_other) then
    raise exception 'Cross-owner ledger fixtures were not created';
  end if;
  perform set_config('coffeecito.r2a_owner', v_owner::text, true);
  perform set_config('coffeecito.r2a_other', v_other::text, true);
  perform set_config('coffeecito.r2a_other_cycle', v_other_cycle::text, true);
end;
$setup$;

set local role authenticated;

do $owner_behavior$
declare
  v_owner uuid := current_setting('coffeecito.r2a_owner')::uuid;
  v_other uuid := current_setting('coffeecito.r2a_other')::uuid;
  v_other_cycle uuid := current_setting('coffeecito.r2a_other_cycle')::uuid;
  v_cycle uuid;
  v_contact uuid;
  v_objective uuid;
begin
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.objectives(
    user_id, objective_name, objective_name_normalized, objective_type, priority_level
  ) values (v_owner, 'Empresa R2A', 'empresa r2a', 'COMPANY', 'HIGH')
  returning id, cycle_id into v_objective, v_cycle;

  if v_cycle is null or not exists (
    select 1 from public.networking_cycles
    where id = v_cycle and user_id = v_owner and status = 'active'
      and objective_type = 'JOB_SEARCH' and origin = 'legacy'
      and started_on is null and professional_situation_code_at_start is null
  ) then
    raise exception 'Old-runtime objective insert did not obtain a conservative legacy cycle';
  end if;

  if exists (select 1 from public.networking_cycles where id = v_other_cycle) then
    raise exception 'R2-A cycle read crossed ownership';
  end if;

  begin
    update public.objectives set cycle_id = null where id = v_objective;
    raise exception 'Historical objective cycle unexpectedly changed';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.objectives(
      user_id, cycle_id, objective_name, objective_name_normalized, objective_type
    ) values (v_owner, v_other_cycle,
      'Wrong cycle', 'wrong cycle', 'COMPANY');
    raise exception 'Foreign cycle unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;

  perform public.save_current_user_starting_point_v1(null, 'employed', null);
  perform public.save_current_user_starting_point_v1(null, 'unemployed', null);
  perform public.save_current_user_starting_point_v1(null, 'unemployed', null);

  if (select count(*) from public.professional_situation_transitions where user_id = v_owner) <> 2
    or exists (
      select 1 from public.professional_situation_transitions
      where user_id = v_owner and (cycle_id <> v_cycle or previous_code is not distinct from next_code)
    ) then
    raise exception 'Professional-situation transition ledger is incomplete or noisy';
  end if;

  insert into public.contacts(user_id, display_name, networking_status, networking_focus)
  values (v_owner, 'Synthetic R2A', 'Pendiente', false) returning id into v_contact;
  update public.contacts set networking_status = 'Contactado' where id = v_contact;
  update public.contacts set networking_focus = true where id = v_contact;
  update public.contacts set company = 'No ledger event' where id = v_contact;

  if (select count(*) from public.contact_networking_transitions where user_id = v_owner and contact_id = v_contact) <> 3
    or exists (
      select 1 from public.contact_networking_transitions
      where user_id = v_owner and cycle_id <> v_cycle
    ) then
    raise exception 'Contact networking transition ledger is incomplete or noisy';
  end if;

  if exists (select 1 from public.professional_situation_transitions where user_id = v_other)
    or exists (select 1 from public.contact_networking_transitions where user_id = v_other) then
    raise exception 'R2-A ledger crossed ownership';
  end if;

  perform v_objective;
end;
$owner_behavior$;

reset role;

do $internal_attribution$
declare
  v_owner uuid := current_setting('coffeecito.r2a_owner')::uuid;
begin
  if public.networking_cycle_for_event_v1(v_owner, null) is not null
    or public.networking_cycle_for_event_v1(v_owner, statement_timestamp()) is not null then
    raise exception 'Unknown legacy start or missing event time was attributed to a cycle';
  end if;
end;
$internal_attribution$;

rollback;
