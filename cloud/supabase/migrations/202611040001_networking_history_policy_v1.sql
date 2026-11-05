-- UX-DATE-01 foundation. Runtime/import cutover requires the complete package.
begin;

-- Serialize the legacy-data check with existing cycle writers until the guard exists.
lock table public.networking_cycles in share row exclusive mode;

do $preflight$
begin
  if exists (select 1 from public.networking_cycles
    where (started_at is not null and not isfinite(started_at))
       or (started_on is not null and not isfinite(started_on))) then
    raise exception 'cycle_start_nonfinite_existing' using errcode = '22023';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('networking_history_floor_v1','current_user_networking_history_policy_v1',
      'admin_set_networking_history_policy_v1','current_user_history_window_v1','enforce_cycle_start_policy_v1'))
    or to_regclass('public.networking_history_policy') is not null
    or to_regprocedure('public.current_user_history_window_v1()') is not null
    or to_regprocedure('public.networking_history_floor_v1(text,integer,timestamp with time zone)') is not null
    or to_regprocedure('public.current_user_networking_history_policy_v1(text)') is not null
    or to_regprocedure('public.admin_set_networking_history_policy_v1(integer,bigint)') is not null
    or to_regprocedure('public.enforce_cycle_start_policy_v1()') is not null then
    raise exception 'history_policy_objects_already_exist' using errcode = '55000';
  end if;
  if to_regprocedure('public.current_user_has_app_access()') is null
    or to_regprocedure('public.current_networking_context_r2b(uuid)') is null
    or to_regprocedure('public.current_user_has_capability(text)') is null
    or to_regprocedure('public.start_networking_cycle_r2b(uuid,text,timestamp with time zone,text,uuid,text,boolean,boolean)') is null
    or to_regprocedure('public.configure_legacy_networking_cycle_r2b(uuid,uuid,text,text,timestamp with time zone,text)') is null
    or not exists (select 1 from pg_trigger where tgrelid = 'public.networking_cycles'::regclass
      and tgname = 'validate_networking_cycle_v1' and not tgisinternal and tgenabled = 'O') then
    raise exception 'history_policy_prerequisite_missing' using errcode = '55000';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.networking_cycles'::regclass
    and tgname = 'enforce_cycle_start_policy_v1') then
    raise exception 'history_policy_trigger_conflict' using errcode = '55000';
  end if;
end;
$preflight$;

create table public.networking_history_policy (
  singleton boolean primary key default true check (singleton),
  max_history_months integer not null default 6 check (max_history_months between 1 and 12),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.networking_history_policy owner to postgres;
alter table public.networking_history_policy enable row level security;
revoke all on public.networking_history_policy from public, anon, authenticated, service_role, supabase_auth_admin;
insert into public.networking_history_policy(singleton) values (true);

-- Calendar arithmetic is performed on the cycle's civil day, not on UTC hours.
-- PostgreSQL resolves a missing local midnight forward and an ambiguous one
-- using its standard-time offset. The same DB result is used by all consumers.
create function public.networking_history_floor_v1(p_timezone text, p_months integer, p_now timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p_now is null or not pg_catalog.isfinite(p_now) or p_months is null or p_months not between 1 and 12
    or p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'history_policy_invalid_time' using errcode = '22023';
  end if;
  return (((p_now at time zone p_timezone)::date - pg_catalog.make_interval(months => p_months))::date)::timestamp
    at time zone p_timezone;
end;
$$;

create function public.current_user_networking_history_policy_v1(p_timezone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_policy public.networking_history_policy%rowtype;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'app_access_denied' using errcode = '42501';
  end if;
  select * into strict v_policy from public.networking_history_policy where singleton;
  return pg_catalog.jsonb_build_object('max_months', v_policy.max_history_months, 'revision', v_policy.revision,
    'earliest_start', public.networking_history_floor_v1(p_timezone, v_policy.max_history_months, statement_timestamp()),
    'as_of', statement_timestamp());
end;
$$;

create function public.admin_set_networking_history_policy_v1(p_months integer, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_policy public.networking_history_policy%rowtype;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_capability('admin.manage_access'), false) then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;
  if p_months is null or p_months not between 1 and 12 then
    raise exception 'history_policy_invalid_months' using errcode = '22023';
  end if;
  select * into strict v_policy from public.networking_history_policy where singleton for update;
  if not coalesce(public.current_user_has_capability('admin.manage_access'), false) then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;
  if p_expected_revision is distinct from v_policy.revision then
    raise exception 'history_policy_stale' using errcode = '40001';
  end if;
  if p_months <> v_policy.max_history_months then
    update public.networking_history_policy set max_history_months = p_months,
      revision = revision + 1, updated_at = statement_timestamp(), updated_by = auth.uid() where singleton;
  end if;
  return public.current_user_networking_history_policy_v1('UTC');
end;
$$;

create function public.current_user_history_window_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_policy public.networking_history_policy%rowtype; v_cycle public.networking_cycles%rowtype;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'app_access_denied' using errcode = '42501';
  end if;
  select * into strict v_policy from public.networking_history_policy where singleton;
  select * into v_cycle from public.networking_cycles where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'history_active_cycle_required' using errcode = '55000'; end if;
  if v_cycle.started_at is null or v_cycle.timezone_name is null then
    raise exception 'history_cycle_start_required' using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object('cycle_id', v_cycle.id, 'context', public.current_networking_context_r2b(auth.uid()),
    'max_months', v_policy.max_history_months, 'revision', v_policy.revision, 'timezone', v_cycle.timezone_name,
    'effective_start', greatest(v_cycle.started_at,
      public.networking_history_floor_v1(v_cycle.timezone_name, v_policy.max_history_months, statement_timestamp())));
end;
$$;

create function public.enforce_cycle_start_policy_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_months integer;
begin
  if (new.started_at is not null and not pg_catalog.isfinite(new.started_at))
    or (new.started_on is not null and not pg_catalog.isfinite(new.started_on)) then
    raise exception 'cycle_start_nonfinite' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.started_at is not null and
    (new.started_at is distinct from old.started_at or new.started_on is distinct from old.started_on
      or new.timezone_name is distinct from old.timezone_name) then
    raise exception 'cycle_start_immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.origin <> 'legacy' then
    select max_history_months into strict v_months from public.networking_history_policy where singleton for share;
    if new.started_at is null or not pg_catalog.isfinite(new.started_at)
      or new.started_at > statement_timestamp()
      or new.started_at < public.networking_history_floor_v1(new.timezone_name, v_months, statement_timestamp()) then
      raise exception 'cycle_start_outside_policy' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger enforce_cycle_start_policy_v1 before insert or update on public.networking_cycles
for each row execute function public.enforce_cycle_start_policy_v1();

alter function public.networking_history_floor_v1(text,integer,timestamptz) owner to postgres;
alter function public.current_user_networking_history_policy_v1(text) owner to postgres;
alter function public.admin_set_networking_history_policy_v1(integer,bigint) owner to postgres;
alter function public.current_user_history_window_v1() owner to postgres;
alter function public.enforce_cycle_start_policy_v1() owner to postgres;
revoke all on function public.networking_history_floor_v1(text,integer,timestamptz),
  public.current_user_networking_history_policy_v1(text), public.admin_set_networking_history_policy_v1(integer,bigint),
  public.current_user_history_window_v1(), public.enforce_cycle_start_policy_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.current_user_networking_history_policy_v1(text),
  public.admin_set_networking_history_policy_v1(integer,bigint), public.current_user_history_window_v1() to authenticated;
commit;
