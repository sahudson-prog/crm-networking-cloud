-- PROD CONTRACT CHANGE: OBJ-02 R2-B. Apply after 202610270001, before the R2-B runtime.
-- Pause writes during installation and activate the R2-B runtime before reopening.
-- Once any cycle is closed, operational writes require an explicit expected context.
begin;

-- The gate remains closed after installation. Only a privileged SQL operator can
-- admit one DEV tester and later open normal access; old browser tokens stay denied.
create table public.r2b_rollout_gate (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('paused', 'test_only', 'open')),
  test_user_id uuid,
  check ((mode = 'test_only') = (test_user_id is not null))
);
insert into public.r2b_rollout_gate(singleton, mode) values (true, 'paused');
alter table public.r2b_rollout_gate enable row level security;
revoke all on public.r2b_rollout_gate from public, anon, authenticated, service_role, supabase_auth_admin;

create or replace function public.set_r2b_rollout_gate(p_mode text, p_test_user_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous text;
begin
  select mode into v_previous from public.r2b_rollout_gate where singleton for update;
  if v_previous is null then raise exception 'r2b_rollout_gate_missing'; end if;
  if (p_mode = 'test_only' and v_previous = 'paused' and p_test_user_id is not null
      and exists (select 1 from auth.users where id = p_test_user_id)) then
    update public.r2b_rollout_gate set mode = 'test_only', test_user_id = p_test_user_id where singleton;
  elsif p_mode = 'open' and v_previous = 'test_only' and p_test_user_id is null then
    update public.r2b_rollout_gate set mode = 'open', test_user_id = null where singleton;
    execute 'grant execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) to service_role';
    execute 'grant execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) to service_role';
  elsif p_mode = 'paused' and v_previous in ('test_only', 'open') and p_test_user_id is null then
    update public.r2b_rollout_gate set mode = 'paused', test_user_id = null where singleton;
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
revoke execute on function public.submit_contact_request_v1(text,text,text,text,text,uuid) from service_role;
revoke execute on function public.finalize_google_connected_account_verified(uuid,text,text[]) from service_role;

-- Preserve the existing effective-access decision, adding only the rollout gate.
-- This function is an existing dependency of RLS and capability checks; replacing
-- it in place keeps those dependencies bound to the same function OID.
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
begin
  select gate.mode, gate.test_user_id into v_gate_mode, v_test_user_id
    from public.r2b_rollout_gate gate where gate.singleton;
  if v_gate_mode is null or v_gate_mode = 'paused'
    or (v_gate_mode = 'test_only' and p_user_id is distinct from v_test_user_id) then
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

alter table public.networking_cycles
  add column cycle_name text,
  add column started_at timestamptz,
  add column timezone_name text,
  add column closed_result text,
  add column closed_recorded_at timestamptz,
  add column start_request_id uuid,
  add column close_request_id uuid,
  add column reset_status_on_start boolean not null default false,
  add column clear_focus_on_start boolean not null default false;

-- R2-A had only civil dates. Keep their UTC interpretation, without inventing legacy starts.
update public.networking_cycles
set started_at = started_on::timestamp at time zone 'UTC', timezone_name = 'UTC'
where started_on is not null;

alter table public.networking_cycles
  add constraint networking_cycle_name_valid check (cycle_name is null or pg_catalog.length(pg_catalog.btrim(cycle_name)) between 1 and 120),
  add constraint networking_cycle_result_valid check (closed_result is null or closed_result in
    ('new_job', 'ended_without_job', 'stopped', 'other', 'prefer_not_to_say')),
  add constraint networking_cycle_user_start_instant check (origin = 'legacy' or started_at is not null),
  add constraint networking_cycle_closed_details check
    (status = 'active' or (closed_result is not null and closed_recorded_at is not null and close_request_id is not null));
create unique index uq_networking_cycle_start_request on public.networking_cycles(user_id, start_request_id)
  where start_request_id is not null;
create unique index uq_networking_cycle_close_request on public.networking_cycles(user_id, close_request_id)
  where close_request_id is not null;

-- These are observations at the moment of close, never reconstructed as state at a backdated end.
create table public.networking_cycle_closed_contacts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid not null references public.networking_cycles(id) on delete cascade,
  contact_id uuid not null,
  networking_status text not null,
  networking_focus boolean not null,
  observed_at timestamptz not null,
  primary key (cycle_id, contact_id)
);
create table public.networking_cycle_closed_assignments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid not null references public.networking_cycles(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  contact_id uuid not null,
  observed_at timestamptz not null,
  primary key (cycle_id, objective_id, contact_id)
);
alter table public.networking_cycle_closed_contacts enable row level security;
alter table public.networking_cycle_closed_assignments enable row level security;
create policy "Closed contact context readable by owner" on public.networking_cycle_closed_contacts
  for select to authenticated using (auth.uid() = user_id and public.current_user_has_app_access());
create policy "Closed assignments readable by owner" on public.networking_cycle_closed_assignments
  for select to authenticated using (auth.uid() = user_id and public.current_user_has_app_access());
revoke all on public.networking_cycle_closed_contacts, public.networking_cycle_closed_assignments
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant select on public.networking_cycle_closed_contacts, public.networking_cycle_closed_assignments to authenticated;

-- A transient write token allows normal contact identity writes to remain direct while
-- detecting stale management writes. The trigger clears it before persistence.
alter table public.contacts add column networking_write_context text;

create or replace function public.validate_networking_cycle_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(new.user_id::text));
  if tg_op = 'UPDATE' then
    if old.status = 'closed' then
      raise exception 'networking_cycle_closed_immutable' using errcode = '42501';
    end if;
    if new.user_id is distinct from old.user_id or new.objective_type is distinct from old.objective_type
      or new.origin is distinct from old.origin
      or new.professional_situation_code_at_start is distinct from old.professional_situation_code_at_start then
      raise exception 'networking_cycle_identity_or_snapshot_immutable' using errcode = '42501';
    end if;
  elsif new.origin <> 'legacy' then
    select profile.professional_situation_code into new.professional_situation_code_at_start
    from public.profiles profile where profile.id = new.user_id;
    if not found then raise exception 'networking_cycle_profile_missing' using errcode = '23503'; end if;
  end if;
  if new.timezone_name is not null and not exists
    (select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.timezone_name) then
    raise exception 'networking_cycle_timezone_invalid' using errcode = '22023';
  end if;
  if new.started_at is not null then
    if new.timezone_name is null or new.started_on is distinct from (new.started_at at time zone new.timezone_name)::date then
      raise exception 'networking_cycle_start_inconsistent' using errcode = '22023';
    end if;
  end if;
  if (new.status = 'active' and new.closed_at is not null)
    or (new.status = 'closed' and new.closed_at is null) then
    raise exception 'networking_cycle_invalid_state' using errcode = '22023';
  end if;
  if new.started_at is not null and new.closed_at is not null and new.closed_at <= new.started_at then
    raise exception 'networking_cycle_invalid_dates' using errcode = '22023';
  end if;
  v_start := new.started_at;
  if v_start is not null and exists (
    select 1 from public.networking_cycles existing
    where existing.user_id = new.user_id and existing.id <> new.id
      and ((existing.started_at is not null and
        pg_catalog.tstzrange(existing.started_at, existing.closed_at, '[)') &&
        pg_catalog.tstzrange(v_start, new.closed_at, '[)'))
      or (existing.started_at is null and existing.closed_at is not null and existing.closed_at > v_start))
  ) then
    raise exception 'networking_cycle_date_overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
drop trigger validate_networking_cycle_v1 on public.networking_cycles;
create trigger validate_networking_cycle_v1 before insert or update on public.networking_cycles
  for each row execute function public.validate_networking_cycle_v1();

create or replace function public.networking_cycle_for_event_v1(p_user_id uuid, p_occurred_at timestamptz)
returns uuid language sql stable security definer set search_path = '' as $$
  with matches as (
    select cycle.id from public.networking_cycles cycle
    where cycle.user_id = p_user_id and p_occurred_at is not null
      and cycle.started_at is not null and p_occurred_at >= cycle.started_at
      and (cycle.closed_at is null or p_occurred_at < cycle.closed_at)
  )
  select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(id))[1] end from matches;
$$;

create or replace function public.current_networking_context_r2b(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select 'active:' || cycle.id::text || ':' || coalesce(cycle.start_request_id, cycle.id)::text
      from public.networking_cycles cycle where cycle.user_id = p_user_id and cycle.status = 'active'),
    'none:' || coalesce((select cycle.id::text from public.networking_cycles cycle
      where cycle.user_id = p_user_id and cycle.status = 'closed'
      order by cycle.closed_recorded_at desc, cycle.id desc limit 1), 'initial')
  );
$$;

create or replace function public.assert_networking_context_r2b(
  p_user_id uuid, p_expected_cycle_id uuid, p_expected_context text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_active uuid; v_context text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(p_user_id::text));
  select cycle.id into v_active from public.networking_cycles cycle
    where cycle.user_id = p_user_id and cycle.status = 'active';
  v_context := public.current_networking_context_r2b(p_user_id);
  if v_active is distinct from p_expected_cycle_id or v_context is distinct from p_expected_context then
    raise exception 'networking_context_stale' using errcode = '40001';
  end if;
  perform pg_catalog.set_config('app.networking_context', v_context, true);
end;
$$;

create or replace function public.assign_objective_cycle_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_active uuid; v_origin text;
begin
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.cycle_id is distinct from old.cycle_id) then
    raise exception 'objective_identity_or_cycle_change_not_allowed' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(new.user_id::text));
  select cycle.id, cycle.origin into v_active, v_origin from public.networking_cycles cycle
    where cycle.user_id = new.user_id and cycle.status = 'active';
  if v_active is null then raise exception 'networking_cycle_required' using errcode = '42501'; end if;
  if new.cycle_id is null and v_origin = 'legacy' and not exists
    (select 1 from public.networking_cycles cycle where cycle.user_id = new.user_id and cycle.status = 'closed') then
    new.cycle_id := v_active;
  end if;
  if new.cycle_id is distinct from v_active then
    raise exception 'objective_cycle_not_active_or_owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_objective_write_r2b()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_cycle uuid; v_active uuid;
begin
  if tg_op = 'DELETE' and pg_catalog.current_setting('app.networking_context', true) = 'reset' then
    return old;
  end if;
  v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_cycle := case when tg_op = 'DELETE' then old.cycle_id else new.cycle_id end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(v_user::text));
  select cycle.id into v_active from public.networking_cycles cycle
    where cycle.user_id = v_user and cycle.status = 'active';
  if v_cycle is distinct from v_active or v_active is null then
    raise exception 'objective_cycle_not_active_or_owned' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then raise exception 'objective_archive_required' using errcode = '42501'; end if;
  if pg_catalog.current_setting('app.networking_context', true) is distinct from public.current_networking_context_r2b(v_user) then
    raise exception 'networking_context_stale' using errcode = '40001';
  end if;
  return new;
end;
$$;
create trigger guard_objective_write_r2b before insert or update or delete on public.objectives
  for each row execute function public.guard_objective_write_r2b();

create or replace function public.guard_assignment_write_r2b()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.contact_objective_assignments%rowtype; v_cycle uuid; v_active uuid; v_context text;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(v_row.user_id::text));
  select objective.cycle_id into v_cycle from public.objectives objective
    where objective.id = v_row.objective_id and objective.user_id = v_row.user_id;
  select cycle.id into v_active from public.networking_cycles cycle
    where cycle.user_id = v_row.user_id and cycle.status = 'active';
  v_context := pg_catalog.current_setting('app.networking_context', true);
  if v_context like 'merge:%' then
    if pg_catalog.substr(v_context, 7) is distinct from public.current_networking_context_r2b(v_row.user_id) then
      raise exception 'networking_context_stale' using errcode = '40001';
    end if;
  elsif v_context = 'reset' then
    null;
  else
    if v_cycle is distinct from v_active or v_active is null then
      raise exception 'assignment_cycle_not_active' using errcode = '42501';
    end if;
    if v_context is distinct from public.current_networking_context_r2b(v_row.user_id) then
      raise exception 'networking_context_stale' using errcode = '40001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_assignment_write_r2b before insert or update or delete on public.contact_objective_assignments
  for each row execute function public.guard_assignment_write_r2b();

create or replace function public.guard_contact_networking_write_r2b()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_active uuid; v_expected text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(new.user_id::text));
  select cycle.id into v_active from public.networking_cycles cycle
    where cycle.user_id = new.user_id and cycle.status = 'active';
  if (tg_op = 'INSERT' and (new.networking_status <> 'Pendiente' or new.networking_focus))
    or (tg_op = 'UPDATE' and (new.networking_status is distinct from old.networking_status
      or new.networking_focus is distinct from old.networking_focus)) then
    v_expected := coalesce(new.networking_write_context,
      pg_catalog.current_setting('app.networking_context', true));
    if v_expected is distinct from public.current_networking_context_r2b(new.user_id)
      and v_expected is distinct from 'merge:' || public.current_networking_context_r2b(new.user_id) then
      raise exception 'networking_context_stale' using errcode = '40001';
    end if;
  end if;
  new.networking_write_context := null;
  return new;
end;
$$;
create trigger guard_contact_networking_write_r2b before insert or update on public.contacts
  for each row execute function public.guard_contact_networking_write_r2b();

drop index public.uq_objectives_user_type_normalized_active;
create unique index uq_objectives_cycle_type_name_active
  on public.objectives(cycle_id, objective_type, objective_name_normalized) where is_active = true;

create or replace function public.start_networking_cycle_r2b(
  p_request_id uuid, p_name text, p_started_at timestamptz, p_timezone text,
  p_expected_cycle_id uuid, p_expected_context text, p_reset_status boolean, p_clear_focus boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_existing public.networking_cycles%rowtype; v_id uuid;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'cycle_request_required' using errcode = '22023'; end if;
  if nullif(pg_catalog.btrim(p_name), '') is null or pg_catalog.length(pg_catalog.btrim(p_name)) > 120 then
    raise exception 'cycle_name_invalid' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(v_user::text));
  select * into v_existing from public.networking_cycles
    where user_id = v_user and start_request_id = p_request_id;
  if found then
    if v_existing.cycle_name is distinct from pg_catalog.btrim(p_name)
      or v_existing.started_at is distinct from p_started_at
      or v_existing.timezone_name is distinct from p_timezone
      or v_existing.reset_status_on_start is distinct from p_reset_status
      or v_existing.clear_focus_on_start is distinct from p_clear_focus then
      raise exception 'cycle_request_conflict' using errcode = '22023'; end if;
    return v_existing.id;
  end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is not null then raise exception 'close_active_cycle_first' using errcode = '42501'; end if;
  if p_started_at is null or p_started_at > pg_catalog.clock_timestamp() then
    raise exception 'cycle_start_invalid' using errcode = '22023'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'cycle_timezone_invalid' using errcode = '22023'; end if;
  insert into public.networking_cycles(user_id, objective_type, status, started_on, started_at,
    timezone_name, cycle_name, origin, start_request_id, reset_status_on_start, clear_focus_on_start)
  values (v_user, 'JOB_SEARCH', 'active', (p_started_at at time zone p_timezone)::date,
    p_started_at, p_timezone, pg_catalog.btrim(p_name), 'user', p_request_id,
    p_reset_status, p_clear_focus) returning id into v_id;
  perform pg_catalog.set_config('app.networking_context', public.current_networking_context_r2b(v_user), true);
  if p_reset_status then
    update public.contacts set networking_status = 'Pendiente'
      where user_id = v_user and is_active and networking_status <> 'Pendiente';
  end if;
  if p_clear_focus then
    update public.contacts set networking_focus = false
      where user_id = v_user and is_active and networking_focus;
  end if;
  update public.todos set status = 'dismissed', resolved_at = pg_catalog.clock_timestamp()
    where user_id = v_user and todo_type = 'NETWORKING_STATUS_CHANGE' and status = 'active';
  return v_id;
end;
$$;

create or replace function public.configure_legacy_networking_cycle_r2b(
  p_request_id uuid, p_cycle_id uuid, p_expected_context text,
  p_name text, p_started_at timestamptz, p_timezone text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_cycle public.networking_cycles%rowtype;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  if nullif(pg_catalog.btrim(p_name), '') is null or pg_catalog.length(pg_catalog.btrim(p_name)) > 120 then
    raise exception 'cycle_name_invalid' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(v_user::text));
  select * into v_cycle from public.networking_cycles where id = p_cycle_id and user_id = v_user for update;
  if not found or v_cycle.origin <> 'legacy' or v_cycle.status <> 'active' then
    raise exception 'legacy_cycle_unavailable' using errcode = '42501'; end if;
  if v_cycle.start_request_id = p_request_id and p_request_id is not null then
    if v_cycle.cycle_name is distinct from pg_catalog.btrim(p_name)
      or v_cycle.started_at is distinct from p_started_at or v_cycle.timezone_name is distinct from p_timezone then
      raise exception 'cycle_request_conflict' using errcode = '22023'; end if;
    return v_cycle.id;
  end if;
  perform public.assert_networking_context_r2b(v_user, p_cycle_id, p_expected_context);
  if v_cycle.start_request_id is not null or v_cycle.started_at is not null or p_request_id is null
    or p_started_at is null or p_started_at > pg_catalog.clock_timestamp() then
    raise exception 'legacy_cycle_already_configured_or_invalid' using errcode = '22023'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'cycle_timezone_invalid' using errcode = '22023'; end if;
  update public.networking_cycles set cycle_name = pg_catalog.btrim(p_name),
    started_at = p_started_at, started_on = (p_started_at at time zone p_timezone)::date,
    timezone_name = p_timezone, start_request_id = p_request_id
    where id = p_cycle_id;
  return p_cycle_id;
end;
$$;

create or replace function public.close_networking_cycle_r2b(
  p_request_id uuid, p_cycle_id uuid, p_expected_context text,
  p_closed_at timestamptz, p_result text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_cycle public.networking_cycles%rowtype; v_now timestamptz;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'cycle_request_required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'), pg_catalog.hashtext(v_user::text));
  select * into v_cycle from public.networking_cycles where id = p_cycle_id and user_id = v_user for update;
  if not found then raise exception 'cycle_not_owned' using errcode = '42501'; end if;
  if v_cycle.close_request_id = p_request_id then
    if v_cycle.closed_at is distinct from p_closed_at or v_cycle.closed_result is distinct from p_result then
      raise exception 'cycle_request_conflict' using errcode = '22023'; end if;
    return v_cycle.id;
  end if;
  if v_cycle.status <> 'active' then raise exception 'cycle_already_closed' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_cycle_id, p_expected_context);
  v_now := pg_catalog.clock_timestamp();
  if p_closed_at is null or p_closed_at > v_now or
    (v_cycle.started_at is not null and p_closed_at <= v_cycle.started_at) then
    raise exception 'cycle_end_invalid' using errcode = '22023'; end if;
  if p_result is null or p_result not in ('new_job', 'ended_without_job', 'stopped', 'other', 'prefer_not_to_say') then
    raise exception 'cycle_result_invalid' using errcode = '22023'; end if;
  update public.networking_cycles set status = 'closed', closed_at = p_closed_at,
    closed_result = p_result, closed_recorded_at = v_now, close_request_id = p_request_id
    where id = p_cycle_id;
  insert into public.networking_cycle_closed_contacts
    (user_id, cycle_id, contact_id, networking_status, networking_focus, observed_at)
  select v_user, p_cycle_id, contact.id, contact.networking_status, contact.networking_focus, v_now
  from public.contacts contact where contact.user_id = v_user and contact.is_active;
  insert into public.networking_cycle_closed_assignments
    (user_id, cycle_id, objective_id, contact_id, observed_at)
  select v_user, p_cycle_id, objective.id, assignment.contact_id, v_now
  from public.objectives objective join public.contact_objective_assignments assignment
    on assignment.objective_id = objective.id and assignment.user_id = v_user
  where objective.user_id = v_user and objective.cycle_id = p_cycle_id;
  update public.todos set status = 'dismissed', resolved_at = v_now
    where user_id = v_user and todo_type = 'NETWORKING_STATUS_CHANGE' and status = 'active';
  return p_cycle_id;
end;
$$;

create or replace function public.save_objective_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_objective_id uuid, p_name text, p_name_normalized text,
  p_type text, p_priority text, p_description text, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is null then raise exception 'networking_cycle_required' using errcode = '42501'; end if;
  if nullif(pg_catalog.btrim(p_name), '') is null or nullif(pg_catalog.btrim(p_name_normalized), '') is null then
    raise exception 'objective_name_required' using errcode = '22023'; end if;
  if p_type not in ('COMPANY','INDUSTRY','ROLE','FUNCTION')
    or p_priority not in ('HIGH','MEDIUM','LOW') then
    raise exception 'objective_value_invalid' using errcode = '22023'; end if;
  if p_objective_id is null then
    insert into public.objectives(user_id, cycle_id, objective_name, objective_name_normalized,
      objective_type, priority_level, objective_description, is_active)
    values (v_user, p_expected_cycle_id, pg_catalog.btrim(p_name), pg_catalog.btrim(p_name_normalized),
      p_type, p_priority, coalesce(p_description, ''), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.objectives set objective_name = pg_catalog.btrim(p_name),
      objective_name_normalized = pg_catalog.btrim(p_name_normalized), objective_type = p_type,
      priority_level = p_priority, objective_description = coalesce(p_description, ''),
      is_active = coalesce(p_is_active, true)
    where id = p_objective_id and user_id = v_user and cycle_id = p_expected_cycle_id
    returning id into v_id;
    if v_id is null then raise exception 'objective_not_in_active_cycle' using errcode = '42501'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.archive_objective_r2b(p_expected_cycle_id uuid, p_expected_context text, p_objective_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is null then raise exception 'networking_cycle_required' using errcode = '42501'; end if;
  update public.objectives set is_active = false
    where id = p_objective_id and user_id = v_user and cycle_id = p_expected_cycle_id;
  if not found then raise exception 'objective_not_in_active_cycle' using errcode = '42501'; end if;
end;
$$;

create or replace function public.replace_contact_objectives_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_contact_id uuid, p_objective_ids uuid[], p_actor text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_ids uuid[] := coalesce(p_objective_ids, array[]::uuid[]);
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is null then raise exception 'networking_cycle_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts where id = p_contact_id and user_id = v_user) then
    raise exception 'contact_not_owned' using errcode = '42501'; end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) id
    where not exists (select 1 from public.objectives objective where objective.id = id
      and objective.user_id = v_user and objective.cycle_id = p_expected_cycle_id and objective.is_active)) then
    raise exception 'objective_not_in_active_cycle' using errcode = '42501'; end if;
  delete from public.contact_objective_assignments assignment using public.objectives objective
    where assignment.user_id = v_user and assignment.contact_id = p_contact_id
      and assignment.objective_id = objective.id and objective.cycle_id = p_expected_cycle_id
      and not (assignment.objective_id = any(v_ids));
  insert into public.contact_objective_assignments(user_id, contact_id, objective_id, assigned_by_actor)
  select v_user, p_contact_id, id, case when p_actor in ('user','coach','system','import') then p_actor else 'user' end
  from (select distinct id from pg_catalog.unnest(v_ids) id) selected
  on conflict (contact_id, objective_id) do nothing;
end;
$$;

create or replace function public.replace_objective_contacts_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_objective_id uuid, p_contact_ids uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_ids uuid[] := coalesce(p_contact_ids, array[]::uuid[]);
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is null or not exists (select 1 from public.objectives objective
    where objective.id = p_objective_id and objective.user_id = v_user
      and objective.cycle_id = p_expected_cycle_id and objective.is_active) then
    raise exception 'objective_not_in_active_cycle' using errcode = '42501'; end if;
  if exists (select 1 from pg_catalog.unnest(v_ids) id
    where not exists (select 1 from public.contacts contact where contact.id = id and contact.user_id = v_user)) then
    raise exception 'contact_not_owned' using errcode = '42501'; end if;
  delete from public.contact_objective_assignments
    where user_id = v_user and objective_id = p_objective_id and not (contact_id = any(v_ids));
  insert into public.contact_objective_assignments(user_id, contact_id, objective_id, assigned_by_actor)
  select v_user, id, p_objective_id, 'user' from (select distinct id from pg_catalog.unnest(v_ids) id) selected
  on conflict (contact_id, objective_id) do nothing;
end;
$$;

create or replace function public.add_objectives_to_contacts_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_contact_ids uuid[], p_objective_ids uuid[], p_actor text
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_contacts uuid[] := coalesce(p_contact_ids, array[]::uuid[]);
  v_objectives uuid[] := coalesce(p_objective_ids, array[]::uuid[]); v_count integer;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if p_expected_cycle_id is null then raise exception 'networking_cycle_required' using errcode = '42501'; end if;
  if exists (select 1 from pg_catalog.unnest(v_contacts) id
    where not exists (select 1 from public.contacts contact where contact.id = id and contact.user_id = v_user)) then
    raise exception 'contact_not_owned' using errcode = '42501'; end if;
  if exists (select 1 from pg_catalog.unnest(v_objectives) id
    where not exists (select 1 from public.objectives objective where objective.id = id
      and objective.user_id = v_user and objective.cycle_id = p_expected_cycle_id and objective.is_active)) then
    raise exception 'objective_not_in_active_cycle' using errcode = '42501'; end if;
  insert into public.contact_objective_assignments(user_id, contact_id, objective_id, assigned_by_actor)
  select v_user, contacts.id, objectives.id,
    case when p_actor in ('user','coach','system','import') then p_actor else 'user' end
  from (select distinct id from pg_catalog.unnest(v_contacts) id) contacts
  cross join (select distinct id from pg_catalog.unnest(v_objectives) id) objectives
  on conflict (contact_id, objective_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.merge_contacts_deep_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_target_contact_id uuid, p_source_contact_ids uuid[],
  p_result jsonb, p_source text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  perform pg_catalog.set_config('app.networking_context', 'merge:' || p_expected_context, true);
  return public.merge_contacts_deep(p_target_contact_id, p_source_contact_ids, p_result, p_source);
end;
$$;

-- The v0.1 reset is a separate, explicitly destructive operation. Extend only its table list.
create or replace function public.reset_current_user_app_data_v0_1(p_confirmation text)
returns table (deleted_table_name text, deleted_row_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  target_user_id uuid := auth.uid(); table_to_delete text; deleted_count integer;
  tables_in_delete_order text[] := array[
    'metric_snapshots', 'usage_events', 'usage_limits', 'data_exports', 'import_batches',
    'sync_change_suppressions', 'sync_run_logs', 'sync_cursors',
    'external_interaction_read_diagnostics', 'object_review_state', 'action_invocations',
    'todos', 'todo_configs', 'referrals',
    'networking_cycle_closed_assignments', 'networking_cycle_closed_contacts',
    'professional_situation_transitions', 'contact_networking_transitions',
    'contact_objective_assignments', 'objectives',
    'external_interaction_sources', 'interaction_participants', 'interactions',
    'contact_emails', 'contact_phones', 'external_contact_snapshots',
    'external_contact_ids', 'contacts', 'networking_cycles', 'connected_accounts',
    'user_settings', 'audit_log'
  ];
begin
  if target_user_id is null then raise exception 'No authenticated user.'; end if;
  if p_confirmation <> 'BORRAR MIS DATOS' then raise exception 'Invalid confirmation phrase.'; end if;
  if not public.current_user_has_capability('data.delete_account') then
    raise exception 'Current user does not have permission to reset app data.'; end if;
  perform pg_catalog.set_config('app.networking_context', 'reset', true);
  foreach table_to_delete in array tables_in_delete_order loop
    execute pg_catalog.format('delete from public.%I where user_id = $1', table_to_delete)
      using target_user_id;
    get diagnostics deleted_count = row_count;
    deleted_table_name := table_to_delete;
    deleted_row_count := deleted_count;
    return next;
  end loop;
end;
$$;

-- Only authenticated users with effective access may invoke the narrow operations.
alter function public.current_networking_context_r2b(uuid) owner to postgres;
alter function public.assert_networking_context_r2b(uuid, uuid, text) owner to postgres;
alter function public.start_networking_cycle_r2b(uuid, text, timestamptz, text, uuid, text, boolean, boolean) owner to postgres;
alter function public.configure_legacy_networking_cycle_r2b(uuid, uuid, text, text, timestamptz, text) owner to postgres;
alter function public.close_networking_cycle_r2b(uuid, uuid, text, timestamptz, text) owner to postgres;
alter function public.save_objective_r2b(uuid, text, uuid, text, text, text, text, text, boolean) owner to postgres;
alter function public.archive_objective_r2b(uuid, text, uuid) owner to postgres;
alter function public.replace_contact_objectives_r2b(uuid, text, uuid, uuid[], text) owner to postgres;
alter function public.replace_objective_contacts_r2b(uuid, text, uuid, uuid[]) owner to postgres;
alter function public.add_objectives_to_contacts_r2b(uuid, text, uuid[], uuid[], text) owner to postgres;
alter function public.merge_contacts_deep_r2b(uuid, text, uuid, uuid[], jsonb, text) owner to postgres;
alter function public.guard_objective_write_r2b() owner to postgres;
alter function public.guard_assignment_write_r2b() owner to postgres;
alter function public.guard_contact_networking_write_r2b() owner to postgres;
alter function public.reset_current_user_app_data_v0_1(text) owner to postgres;
revoke all on function public.current_networking_context_r2b(uuid) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.assert_networking_context_r2b(uuid, uuid, text) from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.start_networking_cycle_r2b(uuid, text, timestamptz, text, uuid, text, boolean, boolean) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.configure_legacy_networking_cycle_r2b(uuid, uuid, text, text, timestamptz, text) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.close_networking_cycle_r2b(uuid, uuid, text, timestamptz, text) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.save_objective_r2b(uuid, text, uuid, text, text, text, text, text, boolean) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.archive_objective_r2b(uuid, text, uuid) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.replace_contact_objectives_r2b(uuid, text, uuid, uuid[], text) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.replace_objective_contacts_r2b(uuid, text, uuid, uuid[]) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.add_objectives_to_contacts_r2b(uuid, text, uuid[], uuid[], text) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.merge_contacts_deep_r2b(uuid, text, uuid, uuid[], jsonb, text) from public, anon, service_role, supabase_auth_admin;
revoke all on function public.guard_objective_write_r2b() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.guard_assignment_write_r2b() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.guard_contact_networking_write_r2b() from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.reset_current_user_app_data_v0_1(text) from public, anon, service_role, supabase_auth_admin;
grant execute on function public.start_networking_cycle_r2b(uuid, text, timestamptz, text, uuid, text, boolean, boolean) to authenticated;
grant execute on function public.configure_legacy_networking_cycle_r2b(uuid, uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.close_networking_cycle_r2b(uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.save_objective_r2b(uuid, text, uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.archive_objective_r2b(uuid, text, uuid) to authenticated;
grant execute on function public.replace_contact_objectives_r2b(uuid, text, uuid, uuid[], text) to authenticated;
grant execute on function public.replace_objective_contacts_r2b(uuid, text, uuid, uuid[]) to authenticated;
grant execute on function public.add_objectives_to_contacts_r2b(uuid, text, uuid[], uuid[], text) to authenticated;
grant execute on function public.merge_contacts_deep_r2b(uuid, text, uuid, uuid[], jsonb, text) to authenticated;
grant execute on function public.reset_current_user_app_data_v0_1(text) to authenticated;
-- The old merge has no expected-cycle parameter and must not remain a client entry point.
revoke execute on function public.merge_contacts_deep(uuid, uuid[], jsonb, text) from authenticated;

commit;
