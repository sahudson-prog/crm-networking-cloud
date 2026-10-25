-- Synthetic behavior verifier for the INV-01 administrative read boundary.
-- All fixtures and overrides roll back.

begin;

do $setup$
declare
  v_admin uuid := gen_random_uuid();
  v_regular uuid := gen_random_uuid();
  v_admin_email text := 'inv-admin-state-' || gen_random_uuid()::text || '@example.invalid';
  v_regular_email text := 'inv-regular-state-' || gen_random_uuid()::text || '@example.invalid';
  v_pending_email text := 'inv-pending-state-' || gen_random_uuid()::text || '@example.invalid';
  v_pending_before integer;
  v_registered_before integer;
begin
  if exists (
    select 1 from public.app_invitation_program_settings
    where singleton and (invitations_enabled or registrations_enabled)
  ) then
    raise exception 'INV-01 controls must remain closed for this verifier';
  end if;

  insert into public.app_access_allowlist(email_normalized)
  values (v_admin_email), (v_regular_email);
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_admin, 'authenticated', 'authenticated', v_admin_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{}', statement_timestamp(), statement_timestamp()),
    (v_regular, 'authenticated', 'authenticated', v_regular_email, statement_timestamp(),
      '{"provider":"google","providers":["google"]}', '{}', statement_timestamp(), statement_timestamp());

  insert into public.user_role_assignments(user_id, role_code, assignment_reason)
  values (v_admin, 'system_admin', 'INV-01 admin state verifier')
  on conflict do nothing;
  insert into public.user_capability_overrides(
    user_id, capability_code, override_mode, override_reason
  ) values (
    v_admin, 'invitations.authorize', 'deny',
    'INV-01 admin state must not require invitation authorization'
  );

  select
    count(*) filter (where invitation_status = 'pending' and expires_at > statement_timestamp())::integer,
    count(*) filter (where invitation_status = 'registered')::integer
  into v_pending_before, v_registered_before
  from public.app_invitations;

  insert into public.app_invitations(
    inviter_user_id, email_normalized, email_fingerprint,
    invitation_status, authorized_at
  ) values (
    v_regular, v_pending_email,
    public.invitation_email_fingerprint_v1(v_pending_email),
    'pending', statement_timestamp()
  );

  perform set_config('coffeecito.verify_inv_admin', v_admin::text, true);
  perform set_config('coffeecito.verify_inv_regular', v_regular::text, true);
  perform set_config('coffeecito.verify_inv_pending_before', v_pending_before::text, true);
  perform set_config('coffeecito.verify_inv_registered_before', v_registered_before::text, true);
end;
$setup$;

set local role authenticated;

do $verify_allowed$
declare
  v_result jsonb;
  v_keys text[];
begin
  perform set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_inv_admin'), true);
  if public.current_user_has_capability('invitations.authorize') then
    raise exception 'Admin fixture unexpectedly retains invitations.authorize';
  end if;
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'Admin fixture is missing admin.manage_access';
  end if;

  v_result := public.admin_invitation_program_state_v1();
  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result) key;
  if v_keys <> array[
    'available_capacity', 'global_capacity', 'invitations_enabled',
    'pending_reservations', 'registered_users', 'registrations_enabled',
    'updated_at', 'used_capacity'
  ] then
    raise exception 'Administrative invitation state returned unexpected fields: %', v_keys;
  end if;
  if (v_result->>'invitations_enabled')::boolean
    or (v_result->>'registrations_enabled')::boolean then
    raise exception 'Administrative read did not preserve closed controls';
  end if;
  if (v_result->>'pending_reservations')::integer
      <> current_setting('coffeecito.verify_inv_pending_before')::integer + 1
    or (v_result->>'registered_users')::integer
      <> current_setting('coffeecito.verify_inv_registered_before')::integer
    or (v_result->>'used_capacity')::integer
      <> (v_result->>'pending_reservations')::integer + (v_result->>'registered_users')::integer then
    raise exception 'Administrative invitation aggregates are inconsistent';
  end if;

  perform set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_inv_regular'), true);
  begin
    perform public.admin_invitation_program_state_v1();
    raise exception 'Regular user unexpectedly read administrative invitation state';
  exception when insufficient_privilege then
    if sqlerrm not like '%admin_manage_access_required%' then raise; end if;
  end;
end;
$verify_allowed$;

reset role;

insert into public.user_capability_overrides(
  user_id, capability_code, override_mode, override_reason
) values (
  current_setting('coffeecito.verify_inv_admin')::uuid,
  'admin.manage_access', 'deny', 'INV-01 effective admin deny verifier'
);

set local role authenticated;

do $verify_deny$
begin
  perform set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_inv_admin'), true);
  begin
    perform public.admin_invitation_program_state_v1();
    raise exception 'Effective admin deny unexpectedly allowed administrative invitation state';
  exception when insufficient_privilege then
    if sqlerrm not like '%admin_manage_access_required%' then raise; end if;
  end;
end;
$verify_deny$;

reset role;
rollback;
