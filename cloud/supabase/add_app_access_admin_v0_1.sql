-- Coffeecito closed beta access administration v0.1
-- Purpose:
-- - Add narrow admin RPCs for allowlist support operations.
-- - Keep auth.users and app_access_allowlist access behind SQL contracts.
-- - Reuse the effective app access decision for frontend and admin diagnostics.
--
-- Apply only after:
-- 1. add_app_access_allowlist_foundation_v0_1.sql
-- 2. enforce_app_access_allowlist_v0_1.sql

begin;

create or replace function public.app_access_status_for_user(p_user_id uuid)
returns table(allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_email_normalized text;
  v_revoked_at timestamptz;
  v_account_status text;
  v_beta_access_status text;
begin
  if p_user_id is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  select auth_user.email
  into v_email
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if not found then
    return query select false, 'auth_user_missing'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_user_id
  ) then
    return query select false, 'profile_missing'::text;
    return;
  end if;

  v_email_normalized := public.normalize_app_access_email(v_email);

  select allowlist.revoked_at
  into v_revoked_at
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email_normalized;

  if not found then
    return query select false, 'not_allowlisted'::text;
    return;
  end if;

  if v_revoked_at is not null then
    return query select false, 'revoked'::text;
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

create or replace function public.current_user_app_access_status()
returns table(allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  return query
  select access_status.allowed, access_status.reason
  from public.app_access_status_for_user(v_user_id) access_status;
end;
$$;

create or replace function public.user_has_capability_for_user(
  p_user_id uuid,
  p_capability_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_user as (
    select p_user_id as user_id
    where p_user_id is not null
      and exists (
        select 1
        from public.app_access_status_for_user(p_user_id) access_status
        where access_status.allowed = true
      )
  ),
  denied as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode = 'deny'
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  explicit_grant as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode in ('grant', 'limit')
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  role_grant as (
    select 1
    from public.user_role_assignments assignment
    join public.app_role_capabilities role_capability
      on role_capability.role_code = assignment.role_code
    join public.app_roles role
      on role.role_code = assignment.role_code
    join active_user on active_user.user_id = assignment.user_id
    where role_capability.capability_code = p_capability_code
      and assignment.is_active = true
      and role.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    limit 1
  ),
  plan_grant as (
    select 1
    from public.user_access_profiles access_profile
    join public.subscription_plans plan
      on plan.plan_code = access_profile.plan_code
    join public.subscription_plan_capabilities plan_capability
      on plan_capability.plan_code = access_profile.plan_code
    join active_user on active_user.user_id = access_profile.user_id
    where plan_capability.capability_code = p_capability_code
      and access_profile.account_status = 'active'
      and access_profile.beta_access_status = 'approved'
      and plan.is_active = true
    limit 1
  )
  select exists(select 1 from active_user)
    and not exists(select 1 from denied)
    and (
      exists(select 1 from explicit_grant)
      or exists(select 1 from role_grant)
      or exists(select 1 from plan_grant)
    );
$$;

create or replace function public.current_user_has_capability(p_capability_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_capability_for_user(auth.uid(), p_capability_code);
$$;

create or replace function public.admin_list_app_access_allowlist()
returns table(
  email text,
  allowlist_status text,
  authorized_at timestamptz,
  revoked_at timestamptz,
  note text,
  registered boolean,
  user_id uuid,
  auth_provider text,
  access_allowed boolean,
  access_reason text,
  account_status text,
  beta_access_status text,
  plan_code text,
  roles text[],
  capabilities text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin.manage_access required' using errcode = '42501';
  end if;

  return query
  with allowlist_rows as (
    select
      allowlist.email_normalized,
      allowlist.authorized_at,
      allowlist.revoked_at,
      allowlist.note
    from public.app_access_allowlist allowlist
  ),
  auth_matches as (
    select distinct on (public.normalize_app_access_email(auth_user.email))
      public.normalize_app_access_email(auth_user.email) as email_normalized,
      auth_user.id as user_id,
      auth_user.raw_app_meta_data->>'provider' as auth_provider
    from auth.users auth_user
    where public.normalize_app_access_email(auth_user.email) is not null
    order by public.normalize_app_access_email(auth_user.email), auth_user.created_at desc
  )
  select
    allowlist_rows.email_normalized as email,
    case when allowlist_rows.revoked_at is null then 'authorized' else 'revoked' end as allowlist_status,
    allowlist_rows.authorized_at,
    allowlist_rows.revoked_at,
    allowlist_rows.note,
    auth_matches.user_id is not null as registered,
    auth_matches.user_id,
    coalesce(auth_matches.auth_provider, '') as auth_provider,
    access_status.allowed as access_allowed,
    access_status.reason as access_reason,
    access_profile.account_status,
    access_profile.beta_access_status,
    access_profile.plan_code,
    coalesce(active_roles.roles, array[]::text[]) as roles,
    coalesce(effective_capabilities.capabilities, array[]::text[]) as capabilities
  from allowlist_rows
  left join auth_matches on auth_matches.email_normalized = allowlist_rows.email_normalized
  left join public.user_access_profiles access_profile on access_profile.user_id = auth_matches.user_id
  left join lateral (
    select status_row.allowed, status_row.reason
    from public.app_access_status_for_user(auth_matches.user_id) status_row
    where auth_matches.user_id is not null
    limit 1
  ) access_status on true
  left join lateral (
    select array_agg(assignment.role_code order by assignment.role_code) as roles
    from public.user_role_assignments assignment
    where assignment.user_id = auth_matches.user_id
      and assignment.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
  ) active_roles on true
  left join lateral (
    select array_agg(capability.capability_code order by capability.capability_area, capability.capability_code) as capabilities
    from public.app_capabilities capability
    where capability.is_active = true
      and public.user_has_capability_for_user(auth_matches.user_id, capability.capability_code)
  ) effective_capabilities on true
  order by allowlist_rows.email_normalized;
end;
$$;

create or replace function public.admin_authorize_app_access_email(
  p_email text,
  p_note text default null
)
returns table(
  email text,
  allowlist_status text,
  authorized_at timestamptz,
  revoked_at timestamptz,
  note text,
  registered boolean,
  user_id uuid,
  auth_provider text,
  access_allowed boolean,
  access_reason text,
  account_status text,
  beta_access_status text,
  plan_code text,
  roles text[],
  capabilities text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_email text;
  v_before jsonb;
  v_after jsonb;
  v_registered_user_id uuid;
  v_account_status text;
  v_beta_access_status text;
  v_can_promote boolean := false;
begin
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin.manage_access required' using errcode = '42501';
  end if;

  v_actor_user_id := auth.uid();
  v_email := public.normalize_app_access_email(p_email);

  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select to_jsonb(allowlist)
  into v_before
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email;

  insert into public.app_access_allowlist (
    email_normalized,
    authorized_at,
    authorized_by_user_id,
    revoked_at,
    revoked_by_user_id,
    note
  )
  values (
    v_email,
    now(),
    v_actor_user_id,
    null,
    null,
    nullif(btrim(coalesce(p_note, '')), '')
  )
  on conflict (email_normalized) do update
  set authorized_at = now(),
      authorized_by_user_id = v_actor_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), public.app_access_allowlist.note);

  select auth_user.id
  into v_registered_user_id
  from auth.users auth_user
  where public.normalize_app_access_email(auth_user.email) = v_email
  order by auth_user.created_at desc
  limit 1;

  if v_registered_user_id is not null and exists (
    select 1 from public.profiles profile where profile.id = v_registered_user_id
  ) then
    select access_profile.account_status, access_profile.beta_access_status
    into v_account_status, v_beta_access_status
    from public.user_access_profiles access_profile
    where access_profile.user_id = v_registered_user_id;

    if found and v_account_status = 'beta_pending' and v_beta_access_status = 'pending' then
      update public.user_access_profiles access_profile
      set account_status = 'active',
          beta_access_status = 'approved'
      where access_profile.user_id = v_registered_user_id;
      v_can_promote := true;
    end if;

    if v_can_promote then
      insert into public.user_role_assignments (user_id, role_code, granted_by_user_id, assignment_reason)
      select
        v_registered_user_id,
        'user',
        v_actor_user_id,
        'Asignacion automatica al autorizar acceso beta'
      where not exists (
        select 1
        from public.user_role_assignments existing_assignment
        where existing_assignment.user_id = v_registered_user_id
          and existing_assignment.role_code = 'user'
          and existing_assignment.is_active = true
      )
      on conflict do nothing;
    end if;
  end if;

  select to_jsonb(allowlist)
  into v_after
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email;

  insert into public.audit_log (user_id, actor, action, object_type, before_json, after_json)
  values (
    v_actor_user_id,
    'admin',
    case when v_before is null then 'app_access_authorize' else 'app_access_reauthorize' end,
    'app_access_allowlist',
    v_before,
    v_after
  );

  return query
  select *
  from public.admin_list_app_access_allowlist() row
  where row.email = v_email;
end;
$$;

create or replace function public.admin_revoke_app_access_email(p_email text)
returns table(
  email text,
  allowlist_status text,
  authorized_at timestamptz,
  revoked_at timestamptz,
  note text,
  registered boolean,
  user_id uuid,
  auth_provider text,
  access_allowed boolean,
  access_reason text,
  account_status text,
  beta_access_status text,
  plan_code text,
  roles text[],
  capabilities text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_actor_email text;
  v_email text;
  v_before jsonb;
  v_after jsonb;
begin
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin.manage_access required' using errcode = '42501';
  end if;

  v_actor_user_id := auth.uid();
  v_email := public.normalize_app_access_email(p_email);

  if v_email is null or position('@' in v_email) <= 1 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select public.normalize_app_access_email(auth_user.email)
  into v_actor_email
  from auth.users auth_user
  where auth_user.id = v_actor_user_id;

  if v_email = v_actor_email then
    raise exception 'cannot revoke own app access' using errcode = '42501';
  end if;

  select to_jsonb(allowlist)
  into v_before
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email;

  if v_before is null then
    raise exception 'email is not allowlisted' using errcode = 'P0002';
  end if;

  update public.app_access_allowlist allowlist
  set revoked_at = now(),
      revoked_by_user_id = v_actor_user_id
  where allowlist.email_normalized = v_email;

  select to_jsonb(allowlist)
  into v_after
  from public.app_access_allowlist allowlist
  where allowlist.email_normalized = v_email;

  insert into public.audit_log (user_id, actor, action, object_type, before_json, after_json)
  values (
    v_actor_user_id,
    'admin',
    'app_access_revoke',
    'app_access_allowlist',
    v_before,
    v_after
  );

  return query
  select *
  from public.admin_list_app_access_allowlist() row
  where row.email = v_email;
end;
$$;

create or replace function public.admin_get_app_access_diagnostic(p_user_id uuid)
returns table(
  user_id uuid,
  email text,
  auth_provider text,
  allowlist_status text,
  account_status text,
  beta_access_status text,
  plan_code text,
  roles text[],
  capabilities text[],
  allowed boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin.manage_access required' using errcode = '42501';
  end if;

  return query
  with target_user as (
    select
      auth_user.id as user_id,
      public.normalize_app_access_email(auth_user.email) as email,
      auth_user.raw_app_meta_data->>'provider' as auth_provider
    from auth.users auth_user
    where auth_user.id = p_user_id
    limit 1
  )
  select
    target_user.user_id,
    target_user.email,
    coalesce(target_user.auth_provider, '') as auth_provider,
    case
      when allowlist.email_normalized is null then 'missing'
      when allowlist.revoked_at is not null then 'revoked'
      else 'authorized'
    end as allowlist_status,
    access_profile.account_status,
    access_profile.beta_access_status,
    access_profile.plan_code,
    coalesce(active_roles.roles, array[]::text[]) as roles,
    coalesce(effective_capabilities.capabilities, array[]::text[]) as capabilities,
    access_status.allowed,
    access_status.reason
  from target_user
  left join public.app_access_allowlist allowlist on allowlist.email_normalized = target_user.email
  left join public.user_access_profiles access_profile on access_profile.user_id = target_user.user_id
  left join lateral (
    select status_row.allowed, status_row.reason
    from public.app_access_status_for_user(target_user.user_id) status_row
    limit 1
  ) access_status on true
  left join lateral (
    select array_agg(assignment.role_code order by assignment.role_code) as roles
    from public.user_role_assignments assignment
    where assignment.user_id = target_user.user_id
      and assignment.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
  ) active_roles on true
  left join lateral (
    select array_agg(capability.capability_code order by capability.capability_area, capability.capability_code) as capabilities
    from public.app_capabilities capability
    where capability.is_active = true
      and public.user_has_capability_for_user(target_user.user_id, capability.capability_code)
  ) effective_capabilities on true;
end;
$$;

revoke execute on function public.app_access_status_for_user(uuid) from public;
revoke execute on function public.app_access_status_for_user(uuid) from anon;
revoke execute on function public.app_access_status_for_user(uuid) from authenticated;

revoke execute on function public.user_has_capability_for_user(uuid, text) from public;
revoke execute on function public.user_has_capability_for_user(uuid, text) from anon;
revoke execute on function public.user_has_capability_for_user(uuid, text) from authenticated;

revoke select, insert, update, delete on table public.app_access_allowlist from public;
revoke select, insert, update, delete on table public.app_access_allowlist from anon;
revoke select, insert, update, delete on table public.app_access_allowlist from authenticated;

revoke execute on function public.admin_list_app_access_allowlist() from public;
revoke execute on function public.admin_list_app_access_allowlist() from anon;
grant execute on function public.admin_list_app_access_allowlist() to authenticated;

revoke execute on function public.admin_authorize_app_access_email(text, text) from public;
revoke execute on function public.admin_authorize_app_access_email(text, text) from anon;
grant execute on function public.admin_authorize_app_access_email(text, text) to authenticated;

revoke execute on function public.admin_revoke_app_access_email(text) from public;
revoke execute on function public.admin_revoke_app_access_email(text) from anon;
grant execute on function public.admin_revoke_app_access_email(text) to authenticated;

revoke execute on function public.admin_get_app_access_diagnostic(uuid) from public;
revoke execute on function public.admin_get_app_access_diagnostic(uuid) from anon;
grant execute on function public.admin_get_app_access_diagnostic(uuid) to authenticated;

comment on function public.app_access_status_for_user(uuid) is 'Internal helper for resolving effective Coffeecito access for a registered Auth user without exposing auth.users.';
comment on function public.user_has_capability_for_user(uuid, text) is 'Internal helper for resolving effective capabilities for a user after app access is allowed.';
comment on function public.admin_list_app_access_allowlist() is 'Admin RPC to list closed beta allowlist entries with safe registration and access diagnostics.';
comment on function public.admin_authorize_app_access_email(text, text) is 'Admin RPC to authorize or reauthorize an email for the closed beta. Does not create Auth users.';
comment on function public.admin_revoke_app_access_email(text) is 'Admin RPC to revoke closed beta allowlist access without deleting users or data.';
comment on function public.admin_get_app_access_diagnostic(uuid) is 'Admin RPC to inspect effective access for a registered user without exposing Auth internals.';

commit;
