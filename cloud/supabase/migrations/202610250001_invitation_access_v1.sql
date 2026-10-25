-- INV-01 PR 1: inert invitation access foundation.
-- Both rollout switches are created closed. This migration does not enable invitations.

begin;

create or replace function public.invitation_email_fingerprint_v1(p_email text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select case
    when public.normalize_app_access_email(p_email) is null then null
    else extensions.digest(
      pg_catalog.convert_to(public.normalize_app_access_email(p_email), 'UTF8'),
      'sha256'
    )
  end;
$$;

create or replace function public.invitation_personal_limit_for_user_v1(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- V1 is intentionally uniform. This is the single extension point for a
  -- future plan/profile-specific limit without duplicating quota enforcement.
  select case when p_user_id is null then 0 else 5 end;
$$;

create or replace function public.invitation_expires_at_v1(p_authorized_at timestamptz)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- A fixed hour interval is independent of the session time zone. Keeping the
  -- calculation here makes the generated column the single 120-hour contract.
  select p_authorized_at + interval '120 hours';
$$;

create or replace function public.ensure_invitation_user_role_v1(
  p_user_id uuid,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_role_assignments assignment
  set starts_at = p_now,
      expires_at = null,
      assignment_reason = 'INV-01 invitation registration'
  where assignment.user_id = p_user_id
    and assignment.role_code = 'user'
    and assignment.is_active = true
    and (assignment.starts_at > p_now
      or (assignment.expires_at is not null and assignment.expires_at <= p_now));

  insert into public.user_role_assignments (
    user_id, role_code, assignment_reason, is_active, starts_at
  )
  select p_user_id, 'user', 'INV-01 invitation registration', true, p_now
  where not exists (
    select 1 from public.user_role_assignments assignment
    where assignment.user_id = p_user_id and assignment.role_code = 'user'
      and assignment.is_active = true
      and assignment.starts_at <= p_now
      and (assignment.expires_at is null or assignment.expires_at > p_now)
  );
end;
$$;

create table if not exists public.app_invitation_program_settings (
  singleton boolean primary key default true check (singleton),
  invitations_enabled boolean not null default false,
  registrations_enabled boolean not null default false,
  global_capacity integer not null default 500 check (global_capacity between 1 and 100000),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null
);

create table if not exists public.app_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.profiles(id) on delete restrict,
  email_normalized text,
  email_fingerprint bytea,
  invitation_status text not null default 'pending'
    check (invitation_status in ('pending', 'registered', 'expired', 'cancelled')),
  authorized_at timestamptz not null,
  expires_at timestamptz generated always as (
    public.invitation_expires_at_v1(authorized_at)
  ) stored,
  registered_user_id uuid references public.profiles(id) on delete restrict,
  registered_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.profiles(id) on delete set null,
  cancellation_reason text,
  reinvite_blocked_at timestamptz,
  reinvite_blocked_by_user_id uuid references public.profiles(id) on delete set null,
  reinvite_unblocked_at timestamptz,
  reinvite_unblocked_by_user_id uuid references public.profiles(id) on delete set null,
  pii_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_invitations_email_shape check (
    email_normalized is null or (
      email_normalized = public.normalize_app_access_email(email_normalized)
      and position('@' in email_normalized) > 1
    )
  ),
  constraint app_invitations_email_fingerprint_matches check (
    email_normalized is null
    or email_fingerprint = public.invitation_email_fingerprint_v1(email_normalized)
  ),
  constraint app_invitations_active_email_required check (
    invitation_status not in ('pending', 'registered')
    or (email_normalized is not null and email_fingerprint is not null and pii_purged_at is null)
  ),
  constraint app_invitations_registered_lifecycle check (
    (invitation_status = 'registered' and registered_user_id is not null and registered_at is not null
      and cancelled_at is null)
    or (invitation_status <> 'registered' and registered_user_id is null and registered_at is null)
  ),
  constraint app_invitations_cancelled_lifecycle check (
    (invitation_status = 'cancelled' and cancelled_at is not null
      and cancelled_by_user_id is not null
      and (pii_purged_at is not null or nullif(btrim(cancellation_reason), '') is not null)
      and reinvite_blocked_at is not null and reinvite_blocked_by_user_id is not null)
    or (invitation_status <> 'cancelled' and cancelled_at is null and cancelled_by_user_id is null
      and cancellation_reason is null and reinvite_blocked_at is null
      and reinvite_blocked_by_user_id is null and reinvite_unblocked_at is null
      and reinvite_unblocked_by_user_id is null)
  ),
  constraint app_invitations_unblock_pair check (
    (reinvite_unblocked_at is null and reinvite_unblocked_by_user_id is null)
    or (reinvite_unblocked_at is not null and reinvite_unblocked_by_user_id is not null)
  )
);

create table if not exists public.app_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.app_invitations(id) on delete restrict,
  event_type text not null check (event_type in (
    'authorized', 'expired', 'registered', 'cancelled', 'reinvite_unblocked',
    'pii_purged', 'program_updated'
  )),
  actor_user_id uuid references public.profiles(id) on delete set null,
  subject_user_id uuid references public.profiles(id) on delete set null,
  event_at timestamptz not null,
  event_details jsonb not null default '{}'::jsonb,
  constraint app_invitation_events_details_object check (jsonb_typeof(event_details) = 'object')
);

create unique index if not exists uq_app_invitations_active_email
  on public.app_invitations(email_normalized)
  where invitation_status in ('pending', 'registered') and email_normalized is not null;
create unique index if not exists uq_app_invitations_registered_user
  on public.app_invitations(registered_user_id)
  where invitation_status = 'registered';
create index if not exists idx_app_invitations_inviter_status
  on public.app_invitations(inviter_user_id, invitation_status, authorized_at desc);
create index if not exists idx_app_invitations_pending_expiry
  on public.app_invitations(expires_at)
  where invitation_status = 'pending';
create index if not exists idx_app_invitations_blocked_fingerprint
  on public.app_invitations(email_fingerprint)
  where invitation_status = 'cancelled' and reinvite_blocked_at is not null
    and reinvite_unblocked_at is null;
create unique index if not exists uq_app_invitation_events_once
  on public.app_invitation_events(invitation_id, event_type)
  where invitation_id is not null;
create index if not exists idx_app_invitation_events_invitation_time
  on public.app_invitation_events(invitation_id, event_at desc);

drop trigger if exists set_app_invitation_program_settings_updated_at
  on public.app_invitation_program_settings;
create trigger set_app_invitation_program_settings_updated_at
before update on public.app_invitation_program_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_app_invitations_updated_at on public.app_invitations;
create trigger set_app_invitations_updated_at
before update on public.app_invitations
for each row execute function public.set_updated_at();

insert into public.app_invitation_program_settings (
  singleton, invitations_enabled, registrations_enabled, global_capacity
)
values (true, false, false, 500)
on conflict (singleton) do nothing;

insert into public.app_capabilities (
  capability_code, display_name, capability_area, description, is_active
)
values (
  'invitations.authorize',
  'Autorizar invitaciones',
  'invitations',
  'Autorizar y consultar invitaciones propias cuando el programa esta habilitado.',
  true
)
on conflict (capability_code) do update
set display_name = excluded.display_name,
    capability_area = excluded.capability_area,
    description = excluded.description,
    is_active = true;

insert into public.app_role_capabilities (role_code, capability_code)
select role.role_code, 'invitations.authorize'
from public.app_roles role
where role.role_code in ('user', 'beta_tester')
on conflict (role_code, capability_code) do nothing;

-- Audited before this migration: the only runtime consumer is the own-data reset RPC,
-- which derives auth.uid() and does not include invitation authority tables.
insert into public.subscription_plan_capabilities (
  plan_code, capability_code, capability_limit_json
)
select plan.plan_code, 'data.delete_account', '{}'::jsonb
from public.subscription_plans plan
where plan.plan_code = 'free'
on conflict (plan_code, capability_code) do nothing;

create or replace function public.materialize_expired_invitations_v1(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.app_invitations invitation
    set invitation_status = 'expired'
    where invitation.invitation_status = 'pending'
      and invitation.expires_at <= p_now
    returning invitation.id
  ), inserted_events as (
    insert into public.app_invitation_events (
      invitation_id, event_type, event_at, event_details
    )
    select expired.id, 'expired', p_now, '{}'::jsonb
    from expired
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$$;

create or replace function public.invitation_program_state_for_user_v1(
  p_user_id uuid,
  p_now timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select program.invitations_enabled, program.registrations_enabled, program.global_capacity
    from public.app_invitation_program_settings program
    where program.singleton = true
  ), effective_limit as (
    select public.invitation_personal_limit_for_user_v1(p_user_id) as personal_limit
  ), personal_counts as (
    select count(*)::integer as used_slots,
      min(invitation.expires_at) filter (
        where invitation.invitation_status = 'pending' and invitation.expires_at > p_now
      ) as next_expiry_at
    from public.app_invitations invitation
    where invitation.inviter_user_id = p_user_id
      and (
        invitation.invitation_status = 'registered'
        or (invitation.invitation_status = 'pending' and invitation.expires_at > p_now)
      )
  ), capacity as (
    select count(*)::integer as used_capacity
    from public.app_invitations invitation
    where invitation.invitation_status = 'registered'
       or (invitation.invitation_status = 'pending' and invitation.expires_at > p_now)
  ), invitation_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', invitation.id,
      'email', invitation.email_normalized,
      'status', invitation.invitation_status,
      'authorized_at', invitation.authorized_at,
      'expires_at', case when invitation.invitation_status = 'pending' then invitation.expires_at else null end,
      'registered_at', invitation.registered_at
    ) order by invitation.authorized_at desc), '[]'::jsonb) as rows
    from public.app_invitations invitation
    where invitation.inviter_user_id = p_user_id
      and invitation.invitation_status in ('pending', 'registered')
  )
  select jsonb_build_object(
    'personal_limit', effective_limit.personal_limit,
    'used_slots', personal_counts.used_slots,
    'available_slots', greatest(0, effective_limit.personal_limit - personal_counts.used_slots),
    'next_expiry_at', personal_counts.next_expiry_at,
    'global_capacity', settings.global_capacity,
    'used_capacity', capacity.used_capacity,
    'invitations_enabled', settings.invitations_enabled,
    'registrations_enabled', settings.registrations_enabled,
    'invitations', invitation_rows.rows
  )
  from settings, effective_limit, personal_counts, capacity, invitation_rows;
$$;

create or replace function public.is_email_authorized_for_invitation_registration_v1(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with identity as (
    select public.normalize_app_access_email(p_email) as email_normalized,
      public.invitation_email_fingerprint_v1(p_email) as email_fingerprint,
      clock_timestamp() as decision_at
  )
  select exists (
    select 1
    from public.app_invitation_program_settings program, identity
    where program.singleton = true
      and program.registrations_enabled = true
      and not exists (
        select 1
        from public.app_invitations blocked
        where blocked.invitation_status = 'cancelled'
          and blocked.email_fingerprint = identity.email_fingerprint
          and blocked.reinvite_blocked_at is not null
          and blocked.reinvite_unblocked_at is null
      )
      and exists (
        select 1
        from public.app_invitations invitation
        where invitation.email_normalized = identity.email_normalized
          and invitation.invitation_status = 'pending'
          and invitation.expires_at > identity.decision_at
      )
  );
$$;

create or replace function public.hook_enforce_app_access_allowlist(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := event->'user'->>'email';
  v_email_normalized text := public.normalize_app_access_email(event->'user'->>'email');
begin
  if public.is_email_authorized_for_app_access(v_email) then
    return '{}'::jsonb;
  end if;

  if exists (
    select 1
    from public.app_access_allowlist allowlist
    where allowlist.email_normalized = v_email_normalized
      and allowlist.revoked_at is not null
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Coffeecito esta disponible por invitacion.'
    ));
  end if;

  if public.is_email_authorized_for_invitation_registration_v1(v_email) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Coffeecito esta disponible por invitacion.'
  ));
end;
$$;

create or replace function public.app_access_status_for_user(p_user_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email_normalized text;
  v_allowlist_found boolean;
  v_allowlist_revoked_at timestamptz;
  v_has_registered_invitation boolean;
  v_account_status text;
  v_beta_access_status text;
begin
  if p_user_id is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  select public.normalize_app_access_email(auth_user.email)
  into v_email_normalized
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if not found then
    return query select false, 'auth_user_missing'::text;
    return;
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    return query select false, 'profile_missing'::text;
    return;
  end if;

  select true, allowlist.revoked_at
  into v_allowlist_found, v_allowlist_revoked_at
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email_normalized;

  if coalesce(v_allowlist_found, false) and v_allowlist_revoked_at is not null then
    return query select false, 'revoked'::text;
    return;
  end if;

  select exists (
    select 1
    from public.app_invitations invitation
    where invitation.registered_user_id = p_user_id
      and invitation.invitation_status = 'registered'
  ) into v_has_registered_invitation;

  if not (coalesce(v_allowlist_found, false) or v_has_registered_invitation) then
    return query select false, 'not_authorized'::text;
    return;
  end if;

  select access_profile.account_status, access_profile.beta_access_status
  into v_account_status, v_beta_access_status
  from public.user_access_profiles access_profile
  where access_profile.user_id = p_user_id;

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

create or replace function public.current_user_invitation_state_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
begin
  if v_user_id is null then raise exception 'not_authenticated'; end if;
  if not public.current_user_has_capability('invitations.authorize') then
    raise exception 'invitation_capability_required';
  end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  perform 1 from public.profiles where id = v_user_id for update;
  v_now := clock_timestamp();
  perform public.materialize_expired_invitations_v1(v_now);
  return public.invitation_program_state_for_user_v1(v_user_id, v_now);
end;
$$;

create or replace function public.authorize_current_user_invitation_v1(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := public.normalize_app_access_email(p_email);
  v_fingerprint bytea := public.invitation_email_fingerprint_v1(p_email);
  v_now timestamptz;
  v_invitation_id uuid;
  v_personal_count integer;
  v_personal_limit integer;
  v_capacity_count integer;
  v_settings public.app_invitation_program_settings%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'not_authenticated'; end if;
  if v_email is null or position('@' in v_email) <= 1 then raise exception 'invalid_email'; end if;
  if not public.current_user_has_capability('invitations.authorize') then
    raise exception 'invitation_capability_required';
  end if;

  select * into strict v_settings
  from public.app_invitation_program_settings
  where singleton = true
  for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invitation-email:' || v_email, 0));
  perform 1 from public.profiles where id = v_user_id for update;
  v_now := clock_timestamp();
  perform public.materialize_expired_invitations_v1(v_now);

  if not public.current_user_has_capability('invitations.authorize') then
    raise exception 'invitation_capability_required';
  end if;

  if exists (
    select 1 from auth.users auth_user
    where auth_user.id = v_user_id
      and public.normalize_app_access_email(auth_user.email) = v_email
  ) then
    raise exception 'cannot_invite_self';
  end if;

  select invitation.id into v_invitation_id
  from public.app_invitations invitation
  where invitation.inviter_user_id = v_user_id
    and invitation.email_normalized = v_email
    and invitation.invitation_status in ('pending', 'registered')
  order by invitation.authorized_at desc
  limit 1;

  if v_invitation_id is not null then
    return public.invitation_program_state_for_user_v1(v_user_id, v_now)
      || jsonb_build_object('result', 'existing', 'invitation_id', v_invitation_id);
  end if;

  if exists (
    select 1 from public.app_invitations blocked
    where blocked.email_fingerprint = v_fingerprint
      and blocked.invitation_status = 'cancelled'
      and blocked.reinvite_blocked_at is not null
      and blocked.reinvite_unblocked_at is null
  ) then
    raise exception 'invitation_email_blocked';
  end if;

  if public.is_email_authorized_for_app_access(v_email) or exists (
    select 1
    from auth.users auth_user
    cross join lateral public.app_access_status_for_user(auth_user.id) access_status
    where public.normalize_app_access_email(auth_user.email) = v_email
      and access_status.allowed = true
  ) or exists (
    select 1 from public.app_invitations invitation
    where invitation.email_normalized = v_email
      and invitation.invitation_status in ('pending', 'registered')
  ) then
    raise exception 'invitation_email_unavailable';
  end if;

  if not v_settings.invitations_enabled then raise exception 'invitations_paused'; end if;

  select count(*)::integer into v_personal_count
  from public.app_invitations invitation
  where invitation.inviter_user_id = v_user_id
    and (invitation.invitation_status = 'registered'
      or (invitation.invitation_status = 'pending' and invitation.expires_at > v_now));
  v_personal_limit := public.invitation_personal_limit_for_user_v1(v_user_id);
  if v_personal_count >= v_personal_limit then raise exception 'personal_invitation_limit_reached'; end if;

  select count(*)::integer into v_capacity_count
  from public.app_invitations invitation
  where invitation.invitation_status = 'registered'
     or (invitation.invitation_status = 'pending' and invitation.expires_at > v_now);
  if v_capacity_count >= v_settings.global_capacity then raise exception 'invitation_capacity_reached'; end if;

  insert into public.app_invitations (
    inviter_user_id, email_normalized, email_fingerprint,
    authorized_at, invitation_status
  ) values (
    v_user_id, v_email, v_fingerprint,
    v_now, 'pending'
  ) returning id into v_invitation_id;

  insert into public.app_invitation_events (
    invitation_id, event_type, actor_user_id, event_at, event_details
  ) values (v_invitation_id, 'authorized', v_user_id, v_now, '{}'::jsonb);

  v_result := public.invitation_program_state_for_user_v1(v_user_id, v_now);
  return v_result || jsonb_build_object('result', 'authorized', 'invitation_id', v_invitation_id);
end;
$$;

create or replace function public.bootstrap_current_user_invitation_v1()
returns table(allowed boolean, reason text, access_source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_fingerprint bytea;
  v_now timestamptz;
  v_invitation public.app_invitations%rowtype;
  v_account_status text;
  v_beta_access_status text;
  v_registrations_enabled boolean;
begin
  if v_user_id is null then return query select false, 'not_authenticated', null::text; return; end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  select public.normalize_app_access_email(auth_user.email), auth_user.email_confirmed_at
  into v_email, v_email_confirmed_at
  from auth.users auth_user
  where auth_user.id = v_user_id
  for update;
  if not found then return query select false, 'auth_user_missing', null::text; return; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invitation-email:' || coalesce(v_email, ''), 0));
  perform 1 from public.profiles where id = v_user_id for update;
  v_fingerprint := public.invitation_email_fingerprint_v1(v_email);

  select access_profile.account_status, access_profile.beta_access_status
  into v_account_status, v_beta_access_status
  from public.user_access_profiles access_profile
  where access_profile.user_id = v_user_id
  for update;

  if not found then return query select false, 'access_profile_missing', null::text; return; end if;
  if v_account_status in ('paused', 'closed') or v_beta_access_status = 'blocked' then
    return query select false, 'administratively_blocked', null::text; return;
  end if;

  if exists (
    select 1 from public.app_access_allowlist allowlist
    where allowlist.email_normalized = v_email and allowlist.revoked_at is not null
  ) then return query select false, 'revoked', null::text; return; end if;

  if public.is_email_authorized_for_app_access(v_email) then
    if v_account_status = 'active' and v_beta_access_status = 'approved' then
      return query select true, 'allowed', 'legacy_allowlist';
    else
      return query select false, 'access_not_active', null::text;
    end if;
    return;
  end if;

  select * into v_invitation
  from public.app_invitations invitation
    where invitation.registered_user_id = v_user_id
      and invitation.invitation_status = 'registered'
  for update;
  if found then
    v_now := clock_timestamp();
    if v_account_status = 'active' and v_beta_access_status = 'approved' then
      perform public.ensure_invitation_user_role_v1(v_user_id, v_now);
      return query select true, 'allowed', 'invitation';
    else
      return query select false, 'access_not_active', null::text;
    end if;
    return;
  end if;

  if v_email_confirmed_at is null then
    return query select false, 'email_not_verified', null::text; return;
  end if;

  if exists (
    select 1 from public.app_invitations blocked
    where blocked.email_fingerprint = v_fingerprint
      and blocked.invitation_status = 'cancelled'
      and blocked.reinvite_blocked_at is not null
      and blocked.reinvite_unblocked_at is null
  ) then return query select false, 'invitation_email_blocked', null::text; return; end if;

  select * into v_invitation
  from public.app_invitations invitation
  where invitation.email_normalized = v_email
    and invitation.invitation_status = 'pending'
  order by invitation.authorized_at desc
  limit 1
  for update;

  if not found then return query select false, 'invitation_missing', null::text; return; end if;

  -- clock_timestamp(), unlike now(), reflects time spent waiting on every
  -- lock that participates in the expiration and conversion decision.
  v_now := clock_timestamp();

  if v_invitation.expires_at <= v_now then
    update public.app_invitations set invitation_status = 'expired'
    where id = v_invitation.id and invitation_status = 'pending';
    insert into public.app_invitation_events (invitation_id, event_type, event_at, event_details)
    values (v_invitation.id, 'expired', v_now, '{}'::jsonb)
    on conflict do nothing;
    return query select false, 'invitation_expired', null::text; return;
  end if;

  select program.registrations_enabled into v_registrations_enabled
  from public.app_invitation_program_settings program where program.singleton = true;
  if not v_registrations_enabled then
    return query select false, 'invitation_registrations_suspended', null::text; return;
  end if;

  update public.app_invitations
  set invitation_status = 'registered', registered_user_id = v_user_id, registered_at = v_now
  where id = v_invitation.id and invitation_status = 'pending';

  update public.user_access_profiles access_profile
  set plan_code = case
        when access_profile.account_status = 'beta_pending'
          and access_profile.beta_access_status = 'pending' then 'free'
        else coalesce(access_profile.plan_code, 'free')
      end,
      account_status = 'active',
      beta_access_status = 'approved'
  where access_profile.user_id = v_user_id;

  perform public.ensure_invitation_user_role_v1(v_user_id, v_now);

  insert into public.app_invitation_events (
    invitation_id, event_type, actor_user_id, subject_user_id, event_at, event_details
  ) values (v_invitation.id, 'registered', v_user_id, v_user_id, v_now, '{}'::jsonb);

  return query select true, 'allowed', 'invitation';
end;
$$;

create or replace function public.admin_update_invitation_program_v1(
  p_invitations_enabled boolean,
  p_registrations_enabled boolean,
  p_global_capacity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_settings public.app_invitation_program_settings%rowtype;
begin
  if v_user_id is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;
  if p_global_capacity is null or p_global_capacity < 1 or p_global_capacity > 100000 then
    raise exception 'invalid_global_capacity';
  end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  v_now := clock_timestamp();
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;

  update public.app_invitation_program_settings
  set invitations_enabled = p_invitations_enabled,
      registrations_enabled = p_registrations_enabled,
      global_capacity = p_global_capacity,
      updated_by_user_id = v_user_id
  where singleton = true
  returning * into v_settings;

  insert into public.app_invitation_events (
    event_type, actor_user_id, event_at, event_details
  ) values (
    'program_updated', v_user_id, v_now,
    jsonb_build_object(
      'invitations_enabled', p_invitations_enabled,
      'registrations_enabled', p_registrations_enabled,
      'global_capacity', p_global_capacity
    )
  );

  return jsonb_build_object(
    'invitations_enabled', v_settings.invitations_enabled,
    'registrations_enabled', v_settings.registrations_enabled,
    'global_capacity', v_settings.global_capacity,
    'updated_at', v_settings.updated_at
  );
end;
$$;

create or replace function public.admin_cancel_invitation_v1(
  p_invitation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_invitation public.app_invitations%rowtype;
begin
  if v_user_id is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'cancellation_reason_required';
  end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  select * into v_invitation from public.app_invitations
  where id = p_invitation_id for update;
  if not found then raise exception 'invitation_not_found'; end if;
  v_now := clock_timestamp();
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;

  if v_invitation.invitation_status <> 'pending' then
    raise exception 'only_pending_invitations_can_be_cancelled';
  end if;
  if v_invitation.expires_at <= v_now then
    perform public.materialize_expired_invitations_v1(v_now);
    return jsonb_build_object('result', 'expired', 'invitation_id', p_invitation_id);
  end if;

  update public.app_invitations
  set invitation_status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by_user_id = v_user_id,
      cancellation_reason = btrim(p_reason),
      reinvite_blocked_at = v_now,
      reinvite_blocked_by_user_id = v_user_id
  where id = p_invitation_id;

  insert into public.app_invitation_events (
    invitation_id, event_type, actor_user_id, event_at, event_details
  ) values (p_invitation_id, 'cancelled', v_user_id, v_now, '{}'::jsonb);

  return jsonb_build_object('result', 'cancelled', 'invitation_id', p_invitation_id);
end;
$$;

create or replace function public.admin_lift_invitation_email_block_v1(
  p_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := public.normalize_app_access_email(p_email);
  v_fingerprint bytea := public.invitation_email_fingerprint_v1(p_email);
  v_now timestamptz;
  v_ids uuid[];
begin
  if v_user_id is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;
  if v_email is null or position('@' in v_email) <= 1 then raise exception 'invalid_email'; end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 500 then
    raise exception 'unblock_reason_required';
  end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invitation-email:' || v_email, 0));
  v_now := clock_timestamp();
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;

  with unblocked as (
    update public.app_invitations invitation
    set reinvite_unblocked_at = v_now,
        reinvite_unblocked_by_user_id = v_user_id,
        email_fingerprint = case
          when invitation.pii_purged_at is not null then null
          else invitation.email_fingerprint
        end
    where invitation.invitation_status = 'cancelled'
      and invitation.email_fingerprint = v_fingerprint
      and invitation.reinvite_blocked_at is not null
      and invitation.reinvite_unblocked_at is null
    returning invitation.id
  ) select array_agg(id) into v_ids from unblocked;

  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'invitation_block_not_found'; end if;

  insert into public.app_invitation_events (
    invitation_id, event_type, actor_user_id, event_at, event_details
  )
    select id, 'reinvite_unblocked', v_user_id, v_now,
      jsonb_build_object('reason', btrim(p_reason))
  from unnest(v_ids) id;

  return jsonb_build_object('result', 'unblocked', 'affected_invitations', cardinality(v_ids));
end;
$$;

create or replace function public.admin_purge_invitation_pii_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_ids uuid[];
  v_purged_event_details integer;
begin
  if v_user_id is null or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;

  perform 1 from public.app_invitation_program_settings where singleton = true for update;
  v_now := clock_timestamp();
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required';
  end if;
  perform public.materialize_expired_invitations_v1(v_now);

  with purged as (
    update public.app_invitations invitation
    set email_normalized = null,
        cancellation_reason = null,
        email_fingerprint = case
          when invitation.invitation_status = 'cancelled'
            and invitation.reinvite_blocked_at is not null
            and invitation.reinvite_unblocked_at is null
          then invitation.email_fingerprint
          else null
        end,
        pii_purged_at = v_now
    where invitation.pii_purged_at is null
      and (
        (invitation.invitation_status = 'expired'
          and invitation.expires_at <= v_now - interval '90 days')
        or (invitation.invitation_status = 'cancelled'
          and invitation.cancelled_at <= v_now - interval '90 days')
      )
    returning invitation.id
  ) select array_agg(id) into v_ids from purged;

  update public.app_invitation_events invitation_event
  set event_details = invitation_event.event_details - 'reason'
  where invitation_event.event_type = 'reinvite_unblocked'
    and invitation_event.event_at <= v_now - interval '90 days'
    and invitation_event.event_details ? 'reason';
  get diagnostics v_purged_event_details = row_count;

  insert into public.app_invitation_events (
    invitation_id, event_type, actor_user_id, event_at, event_details
  )
  select id, 'pii_purged', v_user_id, v_now, '{}'::jsonb
  from unnest(coalesce(v_ids, array[]::uuid[])) id
  on conflict do nothing;

  return coalesce(cardinality(v_ids), 0) + v_purged_event_details;
end;
$$;

alter table public.app_invitation_program_settings enable row level security;
alter table public.app_invitations enable row level security;
alter table public.app_invitation_events enable row level security;

drop policy if exists "Invitation program is RPC only" on public.app_invitation_program_settings;
create policy "Invitation program is RPC only"
on public.app_invitation_program_settings for all to authenticated
using (false) with check (false);
drop policy if exists "Invitations are RPC only" on public.app_invitations;
create policy "Invitations are RPC only"
on public.app_invitations for all to authenticated
using (false) with check (false);
drop policy if exists "Invitation events are RPC only" on public.app_invitation_events;
create policy "Invitation events are RPC only"
on public.app_invitation_events for all to authenticated
using (false) with check (false);

alter table public.app_invitation_program_settings owner to postgres;
alter table public.app_invitations owner to postgres;
alter table public.app_invitation_events owner to postgres;

revoke all on table public.app_invitation_program_settings from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on table public.app_invitations from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on table public.app_invitation_events from public, anon, authenticated, service_role, supabase_auth_admin;

alter function public.invitation_email_fingerprint_v1(text) owner to postgres;
alter function public.invitation_personal_limit_for_user_v1(uuid) owner to postgres;
alter function public.invitation_expires_at_v1(timestamptz) owner to postgres;
alter function public.ensure_invitation_user_role_v1(uuid, timestamptz) owner to postgres;
alter function public.materialize_expired_invitations_v1(timestamptz) owner to postgres;
alter function public.invitation_program_state_for_user_v1(uuid, timestamptz) owner to postgres;
alter function public.is_email_authorized_for_invitation_registration_v1(text) owner to postgres;
alter function public.hook_enforce_app_access_allowlist(jsonb) owner to postgres;
alter function public.app_access_status_for_user(uuid) owner to postgres;
alter function public.current_user_invitation_state_v1() owner to postgres;
alter function public.authorize_current_user_invitation_v1(text) owner to postgres;
alter function public.bootstrap_current_user_invitation_v1() owner to postgres;
alter function public.admin_update_invitation_program_v1(boolean, boolean, integer) owner to postgres;
alter function public.admin_cancel_invitation_v1(uuid, text) owner to postgres;
alter function public.admin_lift_invitation_email_block_v1(text, text) owner to postgres;
alter function public.admin_purge_invitation_pii_v1() owner to postgres;

revoke all on function public.invitation_email_fingerprint_v1(text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.invitation_personal_limit_for_user_v1(uuid) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.invitation_expires_at_v1(timestamptz) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.ensure_invitation_user_role_v1(uuid, timestamptz) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.materialize_expired_invitations_v1(timestamptz) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.invitation_program_state_for_user_v1(uuid, timestamptz) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.is_email_authorized_for_invitation_registration_v1(text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.hook_enforce_app_access_allowlist(jsonb) from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.hook_enforce_app_access_allowlist(jsonb) to supabase_auth_admin;
revoke all on function public.app_access_status_for_user(uuid) from public, anon, authenticated, service_role, supabase_auth_admin;

revoke all on function public.current_user_invitation_state_v1() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.authorize_current_user_invitation_v1(text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.bootstrap_current_user_invitation_v1() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.admin_update_invitation_program_v1(boolean, boolean, integer) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.admin_cancel_invitation_v1(uuid, text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.admin_lift_invitation_email_block_v1(text, text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.admin_purge_invitation_pii_v1() from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function public.current_user_invitation_state_v1() to authenticated;
grant execute on function public.authorize_current_user_invitation_v1(text) to authenticated;
grant execute on function public.bootstrap_current_user_invitation_v1() to authenticated;
grant execute on function public.admin_update_invitation_program_v1(boolean, boolean, integer) to authenticated;
grant execute on function public.admin_cancel_invitation_v1(uuid, text) to authenticated;
grant execute on function public.admin_lift_invitation_email_block_v1(text, text) to authenticated;
grant execute on function public.admin_purge_invitation_pii_v1() to authenticated;

comment on table public.app_invitation_program_settings is 'Singleton rollout controls and capacity for INV-01. Both switches default closed.';
comment on table public.app_invitations is 'Authoritative invitation lifecycle. Not deleted by own-data reset.';
comment on table public.app_invitation_events is 'Invitation lifecycle audit without email payloads; transition rows remain while temporary reason text may be minimized after 90 days.';
comment on function public.current_user_invitation_state_v1() is 'Stable PR 2 boundary for invitation quota, controls and own pending/registered invitations.';
comment on function public.authorize_current_user_invitation_v1(text) is 'Atomically reserves one personal slot and global capacity without sending a message.';
comment on function public.bootstrap_current_user_invitation_v1() is 'Authenticated idempotent bootstrap: converts a verified pending invitation and assigns free/user.';
comment on function public.admin_purge_invitation_pii_v1() is 'Manual admin purge for eligible expired/cancelled invitation PII after 90 days; scheduling is an activation gate.';

commit;
