-- Synthetic behavioral verifier for INV-01 PR 1. All changes roll back.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_inviter uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_invited uuid := gen_random_uuid();
  v_unverified uuid := gen_random_uuid();
  v_admin_email text := 'inv-admin-' || gen_random_uuid()::text || '@example.invalid';
  v_inviter_email text := 'inv-inviter-' || gen_random_uuid()::text || '@example.invalid';
  v_legacy_email text := 'inv-legacy-' || gen_random_uuid()::text || '@example.invalid';
  v_invited_email text := 'inv-target-' || gen_random_uuid()::text || '@example.invalid';
  v_unverified_email text := 'inv-unverified-' || gen_random_uuid()::text || '@example.invalid';
  v_pre_authorized_email text := 'inv-allowlisted-' || gen_random_uuid()::text || '@example.invalid';
  v_result jsonb;
  v_invitation_id uuid;
  v_count integer;
  v_allowed boolean;
  v_reason text;
  v_source text;
  v_reset_row record;
  v_boundary_id uuid;
  v_boundary_email text := 'inv-boundary-' || gen_random_uuid()::text || '@example.invalid';
  v_boundary_start timestamptz := '2026-10-25 12:00:00+00'::timestamptz;
  v_blocked_invitation_id uuid;
  v_blocked_email text;
  v_active_block_id uuid;
begin
  insert into public.app_access_allowlist(email_normalized)
  values (v_admin_email), (v_inviter_email), (v_legacy_email), (v_pre_authorized_email);

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_admin, 'authenticated', 'authenticated', v_admin_email, now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    (v_inviter, 'authenticated', 'authenticated', v_inviter_email, now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    (v_legacy, 'authenticated', 'authenticated', v_legacy_email, now(),
      '{"provider":"google","providers":["google"]}', '{}', now(), now());

  insert into public.user_role_assignments(user_id, role_code, assignment_reason)
  values
    (v_admin, 'system_admin', 'INV-01 behavior verifier'),
    (v_legacy, 'beta_tester', 'INV-01 legacy preservation verifier')
  on conflict do nothing;

  if exists (
    select 1 from public.app_invitation_program_settings
    where singleton and (invitations_enabled or registrations_enabled or global_capacity <> 500)
  ) then raise exception 'INV-01 defaults are not inert'; end if;

  perform set_config('request.jwt.claim.sub', v_inviter::text, true);
  begin
    perform public.authorize_current_user_invitation_v1(v_invited_email);
    raise exception 'Closed invitations unexpectedly authorized an email';
  exception when others then
    if sqlerrm not like '%invitations_paused%' then raise; end if;
  end;
  begin
    perform public.admin_update_invitation_program_v1(true, true, 500);
    raise exception 'Non-admin unexpectedly changed invitation controls';
  exception when others then
    if sqlerrm not like '%admin_manage_access_required%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_update_invitation_program_v1(true, false, 500);

  perform set_config('request.jwt.claim.sub', v_inviter::text, true);
  begin
    perform public.authorize_current_user_invitation_v1(v_pre_authorized_email);
    raise exception 'Allowlisted email unexpectedly consumed an invitation slot';
  exception when others then
    if sqlerrm not like '%invitation_email_unavailable%' then raise; end if;
  end;
  for v_count in 1..5 loop
    v_result := public.authorize_current_user_invitation_v1(
      case when v_count = 1 then v_invited_email
        else 'inv-slot-' || v_count::text || '-' || gen_random_uuid()::text || '@example.invalid' end
    );
    if v_result->>'result' <> 'authorized' then raise exception 'Invitation % was not authorized', v_count; end if;
  end loop;

  v_result := public.authorize_current_user_invitation_v1(v_invited_email);
  if v_result->>'result' <> 'existing' or (v_result->>'used_slots')::integer <> 5 then
    raise exception 'Duplicate authorization was not idempotent';
  end if;
  v_invitation_id := (v_result->>'invitation_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_legacy::text, true);
  v_result := public.current_user_invitation_state_v1();
  if jsonb_array_length(v_result->'invitations') <> 0 then
    raise exception 'Invitation state leaked another user''s rows';
  end if;
  perform set_config('request.jwt.claim.sub', v_inviter::text, true);

  begin
    perform public.authorize_current_user_invitation_v1('inv-sixth-' || gen_random_uuid()::text || '@example.invalid');
    raise exception 'Sixth personal invitation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%personal_invitation_limit_reached%' then raise; end if;
  end;

  v_result := public.hook_enforce_app_access_allowlist(jsonb_build_object(
    'user', jsonb_build_object('email', v_invited_email)
  ));
  if v_result = '{}'::jsonb then raise exception 'Hook admitted invitation while registrations were suspended'; end if;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_update_invitation_program_v1(true, true, 500);
  v_result := public.hook_enforce_app_access_allowlist(jsonb_build_object(
    'user', jsonb_build_object('email', v_invited_email)
  ));
  if v_result <> '{}'::jsonb then raise exception 'Hook rejected a valid pending invitation'; end if;

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_invited, 'authenticated', 'authenticated', v_invited_email, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

  perform set_config('request.jwt.claim.sub', v_invited::text, true);
  select bootstrap.allowed, bootstrap.reason, bootstrap.access_source
  into v_allowed, v_reason, v_source
  from public.bootstrap_current_user_invitation_v1() bootstrap;
  if not v_allowed or v_reason <> 'allowed' or v_source <> 'invitation' then
    raise exception 'Verified invitation bootstrap failed: %, %, %', v_allowed, v_reason, v_source;
  end if;

  if not exists (
    select 1 from public.user_access_profiles access_profile
    where access_profile.user_id = v_invited and access_profile.plan_code = 'free'
      and access_profile.account_status = 'active' and access_profile.beta_access_status = 'approved'
  ) or not exists (
    select 1 from public.user_role_assignments assignment
    where assignment.user_id = v_invited and assignment.role_code = 'user' and assignment.is_active
  ) then raise exception 'Invitation bootstrap did not assign free/user'; end if;

  if not exists (
    select 1 from public.app_access_status_for_user(v_invited) access_status
    where access_status.allowed and access_status.reason = 'allowed'
  ) then raise exception 'Registered invitation does not provide durable app access'; end if;

  select bootstrap.allowed, bootstrap.reason, bootstrap.access_source
  into v_allowed, v_reason, v_source
  from public.bootstrap_current_user_invitation_v1() bootstrap;
  if not v_allowed or v_source <> 'invitation' then raise exception 'Bootstrap retry is not idempotent'; end if;
  if (select count(*) from public.app_invitations where registered_user_id = v_invited) <> 1 then
    raise exception 'Bootstrap retry duplicated registration';
  end if;

  if not public.current_user_has_capability('data.delete_account') then
    raise exception 'Free invited user cannot reset own data';
  end if;
  for v_reset_row in select * from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS') loop
    null;
  end loop;
  if not exists (
    select 1 from public.app_invitations
    where registered_user_id = v_invited and invitation_status = 'registered'
  ) then raise exception 'Own-data reset removed invitation authority or restored a slot'; end if;

  perform set_config('request.jwt.claim.sub', v_legacy::text, true);
  select bootstrap.allowed, bootstrap.reason, bootstrap.access_source
  into v_allowed, v_reason, v_source
  from public.bootstrap_current_user_invitation_v1() bootstrap;
  if not v_allowed or v_source <> 'legacy_allowlist' then raise exception 'Legacy beta bootstrap changed source'; end if;
  if not exists (
    select 1 from public.user_access_profiles
    where user_id = v_legacy and plan_code = 'beta_personal'
  ) or not exists (
    select 1 from public.user_role_assignments
    where user_id = v_legacy and role_code = 'beta_tester' and is_active
  ) then raise exception 'Legacy beta plan or role was degraded'; end if;

  -- A pending identity without verified email must remain fail-closed.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_update_invitation_program_v1(true, true, 500);
  perform set_config('request.jwt.claim.sub', v_inviter::text, true);
  -- One registered slot and four pending slots are still consumed; expire one fixture first.
  update public.app_invitations
  set authorized_at = now() - interval '121 hours', expires_at = now() - interval '1 hour'
  where inviter_user_id = v_inviter and invitation_status = 'pending'
    and email_normalized <> v_unverified_email
    and id <> v_invitation_id
    and id = (
      select invitation.id from public.app_invitations invitation
      where invitation.inviter_user_id = v_inviter and invitation.invitation_status = 'pending'
      order by invitation.id limit 1
    );
  perform public.current_user_invitation_state_v1();
  v_result := public.authorize_current_user_invitation_v1(v_unverified_email);
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_unverified, 'authenticated', 'authenticated', v_unverified_email, null,
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
  perform set_config('request.jwt.claim.sub', v_unverified::text, true);
  select bootstrap.allowed, bootstrap.reason, bootstrap.access_source
  into v_allowed, v_reason, v_source
  from public.bootstrap_current_user_invitation_v1() bootstrap;
  if v_allowed or v_reason <> 'email_not_verified' then raise exception 'Unverified email bootstrap did not fail closed'; end if;

  -- An explicit profile block must prevail even after the email becomes verified.
  update auth.users set email_confirmed_at = now() where id = v_unverified;
  update public.user_access_profiles
  set beta_access_status = 'blocked'
  where user_id = v_unverified;
  select bootstrap.allowed, bootstrap.reason, bootstrap.access_source
  into v_allowed, v_reason, v_source
  from public.bootstrap_current_user_invitation_v1() bootstrap;
  if v_allowed or v_reason <> 'administratively_blocked' then
    raise exception 'Blocked profile was reactivated by invitation bootstrap';
  end if;

  -- Cancellation releases the reservation but blocks ordinary reinvitation until an audited lift.
  select invitation.id, invitation.email_normalized
  into v_blocked_invitation_id, v_blocked_email
  from public.app_invitations invitation
  where invitation.inviter_user_id = v_inviter
    and invitation.invitation_status = 'pending'
    and invitation.registered_user_id is null
    and invitation.email_normalized <> v_unverified_email
  order by invitation.authorized_at
  limit 1;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_cancel_invitation_v1(v_blocked_invitation_id, 'synthetic security cancellation');
  perform set_config('request.jwt.claim.sub', v_inviter::text, true);
  begin
    perform public.authorize_current_user_invitation_v1(v_blocked_email);
    raise exception 'Cancelled email was reinvited without an administrative lift';
  exception when others then
    if sqlerrm not like '%invitation_email_blocked%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_lift_invitation_email_block_v1(v_blocked_email, 'synthetic reviewed lift');
  perform set_config('request.jwt.claim.sub', v_inviter::text, true);
  v_result := public.authorize_current_user_invitation_v1(v_blocked_email);
  if v_result->>'result' <> 'authorized' then
    raise exception 'Explicit invitation block lift did not allow a new authorization';
  end if;
  v_active_block_id := (v_result->>'invitation_id')::uuid;

  -- PII cleanup removes email and free text after 90 days, while an active
  -- security block keeps only its fingerprint until an explicit lift.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_cancel_invitation_v1(v_active_block_id, 'synthetic retained block');
  update public.app_invitations
  set cancelled_at = now() - interval '91 days'
  where id in (v_blocked_invitation_id, v_active_block_id);
  if public.admin_purge_invitation_pii_v1() < 2 then
    raise exception '90-day invitation PII cleanup did not purge eligible rows';
  end if;
  if not exists (
    select 1 from public.app_invitations
    where id = v_blocked_invitation_id and email_normalized is null
      and email_fingerprint is null and cancellation_reason is null and pii_purged_at is not null
  ) or not exists (
    select 1 from public.app_invitations
    where id = v_active_block_id and email_normalized is null
      and email_fingerprint is not null and cancellation_reason is null and pii_purged_at is not null
  ) then raise exception 'PII cleanup did not preserve only active block evidence'; end if;
  perform public.admin_lift_invitation_email_block_v1(v_blocked_email, 'synthetic post-purge lift');
  if exists (
    select 1 from public.app_invitations
    where id = v_active_block_id and email_fingerprint is not null
  ) then raise exception 'Lifted post-purge block retained an unnecessary fingerprint'; end if;

  -- A revoked legacy allowlist decision overrides otherwise durable invitation access.
  insert into public.app_access_allowlist (
    email_normalized, authorized_at, authorized_by_user_id, revoked_at, revoked_by_user_id
  ) values (v_invited_email, now(), v_admin, now(), v_admin);
  if not exists (
    select 1 from public.app_access_status_for_user(v_invited) access_status
    where not access_status.allowed and access_status.reason = 'revoked'
  ) then raise exception 'Explicit allowlist revocation did not override invitation access'; end if;
  delete from public.app_access_allowlist where email_normalized = v_invited_email;

  -- Exact boundary: expires_at is not valid at equality and materializes once.
  insert into public.app_invitations (
    inviter_user_id, email_normalized, email_fingerprint,
    authorized_at, expires_at, invitation_status
  ) values (
    v_admin, v_boundary_email,
    public.invitation_email_fingerprint_v1(v_boundary_email),
    v_boundary_start, v_boundary_start + interval '120 hours', 'pending'
  ) returning id into v_boundary_id;
  if public.materialize_expired_invitations_v1(v_boundary_start + interval '120 hours') < 1 then
    raise exception '120-hour boundary did not expire at equality';
  end if;
  if public.materialize_expired_invitations_v1(v_boundary_start + interval '120 hours') <> 0 then
    raise exception 'Expiration was not idempotent';
  end if;
  if (select count(*) from public.app_invitation_events where invitation_id = v_boundary_id and event_type = 'expired') <> 1 then
    raise exception 'Expiration audit was not exactly once';
  end if;

  -- Closing both controls must not affect legacy or already registered users.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_update_invitation_program_v1(false, false, 500);
  if not exists (select 1 from public.app_access_status_for_user(v_legacy) where allowed)
    or not exists (select 1 from public.app_access_status_for_user(v_invited) where allowed) then
    raise exception 'Closing rollout controls revoked durable existing access';
  end if;
end;
$$;

rollback;
