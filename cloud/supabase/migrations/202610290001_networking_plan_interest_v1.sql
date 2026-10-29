-- PROD CONTRACT CHANGE: OBJ-02 Avísame. Apply after the R2-B migrations.
-- Additive for the prior runtime; cycle changes and data reset do not alter notices.
begin;

do $preconditions$
begin
  if pg_catalog.to_regclass('auth.users') is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regprocedure('public.current_user_has_app_access()') is null
    or pg_catalog.to_regprocedure('public.normalize_app_access_email(text)') is null
    or pg_catalog.to_regclass('public.networking_cycles') is null then
    raise exception 'networking_plan_interest_prerequisites_missing';
  end if;
  if pg_catalog.to_regclass('public.networking_plan_interest') is not null
    or pg_catalog.to_regclass('public.networking_plan_notice_modes') is not null
    or pg_catalog.to_regprocedure('public.request_networking_plan_notice_v1(text)') is not null
    or pg_catalog.to_regprocedure('public.withdraw_networking_plan_notice_v1(text)') is not null then
    raise exception 'networking_plan_interest_contract_already_exists';
  end if;
end;
$preconditions$;

create table public.networking_plan_notice_modes (
  objective_type text primary key check (objective_type in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND')),
  is_open boolean not null default true
);
insert into public.networking_plan_notice_modes(objective_type)
  values ('BUSINESS_DEVELOPMENT'), ('PERSONAL_BRAND');
alter table public.networking_plan_notice_modes owner to postgres;
alter table public.networking_plan_notice_modes enable row level security;
revoke all on table public.networking_plan_notice_modes
  from public, anon, authenticated, service_role, supabase_auth_admin;

create table public.networking_plan_interest (
  user_id uuid not null references auth.users(id) on delete cascade,
  objective_type text not null check (objective_type in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND')),
  email_at_request text not null check (
    email_at_request = public.normalize_app_access_email(email_at_request)
    and pg_catalog.strpos(email_at_request, '@') > 1
  ),
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, objective_type)
);
alter table public.networking_plan_interest owner to postgres;
alter table public.networking_plan_interest enable row level security;
create policy "Own active networking plan interest is readable" on public.networking_plan_interest
  for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());
revoke all on table public.networking_plan_interest
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant select on table public.networking_plan_interest to authenticated;

create function public.request_networking_plan_notice_v1(p_objective_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
begin
  if v_user_id is null or public.current_user_has_app_access() is distinct from true then
    raise exception 'networking_plan_notice_access_required' using errcode = '42501';
  end if;
  if p_objective_type is null or p_objective_type not in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND') then
    raise exception 'networking_plan_notice_modality_invalid' using errcode = '22023';
  end if;
  select public.normalize_app_access_email(usr.email) into v_email
    from auth.users usr where usr.id = v_user_id;
  if v_email is null or pg_catalog.strpos(v_email, '@') <= 1 then
    raise exception 'networking_plan_notice_email_missing' using errcode = '22023';
  end if;
  perform 1 from public.networking_plan_notice_modes
    where objective_type = p_objective_type and is_open for share;
  if not found then
    raise exception 'networking_plan_notice_closed' using errcode = '42501';
  end if;
  insert into public.networking_plan_interest(user_id, objective_type, email_at_request)
    values (v_user_id, p_objective_type, v_email)
    on conflict (user_id, objective_type) do nothing;
  return true;
end;
$$;

create function public.withdraw_networking_plan_notice_v1(p_objective_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or public.current_user_has_app_access() is distinct from true then
    raise exception 'networking_plan_notice_access_required' using errcode = '42501';
  end if;
  if p_objective_type is null or p_objective_type not in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND') then
    raise exception 'networking_plan_notice_modality_invalid' using errcode = '22023';
  end if;
  delete from public.networking_plan_interest
    where user_id = v_user_id and objective_type = p_objective_type;
  return true;
end;
$$;

alter function public.request_networking_plan_notice_v1(text) owner to postgres;
alter function public.withdraw_networking_plan_notice_v1(text) owner to postgres;
revoke all on function public.request_networking_plan_notice_v1(text),
  public.withdraw_networking_plan_notice_v1(text)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.request_networking_plan_notice_v1(text),
  public.withdraw_networking_plan_notice_v1(text) to authenticated;

commit;
