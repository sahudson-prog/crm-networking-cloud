-- LOCAL TEST FIXTURE ONLY. Never install this file in DEV or PROD.
-- Exact function bodies from local-ops/dev-test-auth-01/02_Install-DevMultiTester.sql.
-- Matches owner-reported DEV hashes 8fa17c0c... and 989795c4....
-- Constraint from 07_Expand-DevTwoAdditionalTesters.sql. No identities or memberships.
alter table public.r2b_rollout_gate
  add column additional_test_user_ids uuid[] not null default '{}'::uuid[];
alter table public.r2b_rollout_gate
  add constraint r2b_additional_test_users_limited check (
    cardinality(additional_test_user_ids) <= 2
    and array_position(additional_test_user_ids, null) is null
    and (cardinality(additional_test_user_ids) = 0
      or (array_ndims(additional_test_user_ids) = 1
        and array_lower(additional_test_user_ids, 1) = 1))
    and (mode = 'test_only' or cardinality(additional_test_user_ids) = 0)
    and (test_user_id is null or not (test_user_id = any(additional_test_user_ids)))
    and (cardinality(additional_test_user_ids) <> 2
      or additional_test_user_ids[1] is distinct from additional_test_user_ids[2])
  );

create or replace function public.set_r2b_rollout_gate(p_mode text, p_test_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous text;
begin
  select mode into v_previous from public.r2b_rollout_gate where singleton for update;
  if v_previous is null then raise exception 'r2b_rollout_gate_missing'; end if;
  if (p_mode = 'test_only' and v_previous = 'paused' and p_test_user_id is not null
      and exists (select 1 from auth.users where id = p_test_user_id)) then
    update public.r2b_rollout_gate
      set mode = 'test_only', test_user_id = p_test_user_id,
          additional_test_user_ids = '{}'::uuid[] where singleton;
  elsif p_mode = 'open' and v_previous = 'test_only' and p_test_user_id is null then
    update public.r2b_rollout_gate
      set mode = 'open', test_user_id = null,
          additional_test_user_ids = '{}'::uuid[] where singleton;
    execute 'grant execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) to service_role';
    execute 'grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to service_role';
  elsif p_mode = 'paused' and v_previous in ('test_only', 'open') and p_test_user_id is null then
    update public.r2b_rollout_gate
      set mode = 'paused', test_user_id = null,
          additional_test_user_ids = '{}'::uuid[] where singleton;
    execute 'revoke execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) from service_role';
    execute 'revoke execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) from service_role';
  else
    raise exception 'r2b_rollout_transition_invalid' using errcode = '22023';
  end if;
end;
$$;
alter function public.set_r2b_rollout_gate(text, uuid) owner to postgres;
revoke all on function public.set_r2b_rollout_gate(text, uuid)
  from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.app_access_status_for_user(p_user_id uuid)
returns table(allowed boolean, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email_normalized text;
  v_allowlist_found boolean;
  v_allowlist_revoked_at timestamptz;
  v_has_registered_invitation boolean;
  v_account_status text;
  v_beta_access_status text;
  v_gate_mode text;
  v_test_user_id uuid;
  v_additional_test_user_ids uuid[];
begin
  select gate.mode, gate.test_user_id, gate.additional_test_user_ids
    into v_gate_mode, v_test_user_id, v_additional_test_user_ids
    from public.r2b_rollout_gate gate where gate.singleton;
  if v_gate_mode is null or v_gate_mode = 'paused'
    or (v_gate_mode = 'test_only'
      and p_user_id is distinct from v_test_user_id
      and not coalesce(p_user_id = any(v_additional_test_user_ids), false)) then
    return query select false, 'maintenance'::text;
    return;
  end if;
  if p_user_id is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;
  select public.normalize_app_access_email(auth_user.email)
    into v_email_normalized from auth.users auth_user where auth_user.id = p_user_id;
  if not found then
    return query select false, 'auth_user_missing'::text;
    return;
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    return query select false, 'profile_missing'::text;
    return;
  end if;
  select true, allowlist.revoked_at into v_allowlist_found, v_allowlist_revoked_at
    from public.app_access_allowlist allowlist where allowlist.email_normalized = v_email_normalized;
  if coalesce(v_allowlist_found, false) and v_allowlist_revoked_at is not null then
    return query select false, 'revoked'::text;
    return;
  end if;
  select exists (select 1 from public.app_invitations invitation
    where invitation.registered_user_id = p_user_id and invitation.invitation_status = 'registered')
    into v_has_registered_invitation;
  if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation) then
    return query select false, 'not_authorized'::text;
    return;
  end if;
  select access_profile.account_status, access_profile.beta_access_status
    into v_account_status, v_beta_access_status
    from public.user_access_profiles access_profile where access_profile.user_id = p_user_id;
  if not found or v_account_status <> 'active' then
    return query select false, 'account_inactive'::text;
    return;
  end if;
  if v_beta_access_status <> 'approved' then
    return query select false, 'access_not_approved'::text;
    return;
  end if;
  return query select true, 'allowed'::text;
end;
$$;
alter function public.app_access_status_for_user(uuid) owner to postgres;
revoke all on function public.app_access_status_for_user(uuid)
  from public, anon, authenticated, service_role, supabase_auth_admin;
