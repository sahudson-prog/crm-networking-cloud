-- PROD CONTRACT CHANGE: OBJ-02 R2-A cycle foundation and narrow transition history.
-- Expand-only: no cycle close/reset API is exposed and legacy dates remain unknown.

begin;

do $preconditions$
declare
  v_reset_function record;
  v_existing_objects text[];
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.contacts') is null
    or to_regclass('public.objectives') is null
    or to_regclass('public.interactions') is null
    or to_regprocedure('public.current_user_has_app_access()') is null
    or to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is null then
    raise exception 'networking_cycles_history_v1 prerequisites are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'professional_situation_code' and data_type = 'text'
  ) then
    raise exception 'profiles.professional_situation_code is missing or incompatible';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'objectives' and column_name = 'cycle_id'
  ) then
    raise exception 'objectives.cycle_id already exists; classify the existing contract before applying R2-A';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interactions' and column_name = 'cycle_id'
  ) then
    raise exception 'interactions.cycle_id already exists; classify the existing contract before applying R2-A';
  end if;

  select pg_catalog.array_agg(object_name order by object_name)
  into v_existing_objects
  from (
    select target.name as object_name
    from pg_catalog.unnest(array[
      'networking_cycles',
      'professional_situation_transitions',
      'contact_networking_transitions'
    ]::text[]) target(name)
    where pg_catalog.to_regclass(pg_catalog.format('public.%I', target.name)) is not null
    union all
    select target.signature
    from pg_catalog.unnest(array[
      'public.validate_networking_cycle_v1()',
      'public.active_networking_cycle_id_for_user_v1(uuid)',
      'public.networking_cycle_for_event_v1(uuid,timestamptz)',
      'public.assign_objective_cycle_v1()',
      'public.capture_professional_situation_transition_v1()',
      'public.capture_contact_networking_transition_v1()'
    ]::text[]) target(signature)
    where pg_catalog.to_regprocedure(target.signature) is not null
  ) existing;

  if v_existing_objects is not null then
    raise exception 'R2-A named objects already exist: %', pg_catalog.array_to_string(v_existing_objects, ', ');
  end if;

  select
    procedure.prosecdef,
    procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.replace(
        pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
        pg_catalog.chr(13), pg_catalog.chr(10)
      ), 'UTF8'
    ), 'sha256'), 'hex') as normalized_body_sha256,
    procedure.proretset
      and procedure.prorettype = 'record'::pg_catalog.regtype
      and procedure.prokind = 'f'
      and procedure.prolang = (select language.oid from pg_catalog.pg_language language where language.lanname = 'plpgsql')
      and procedure.provolatile = 'v'
      and not procedure.proisstrict
      and not procedure.proleakproof
      and procedure.proparallel = 'u'
      and procedure.proargnames = array['p_confirmation', 'deleted_table_name', 'deleted_row_count']::text[]
      and procedure.proallargtypes = array[
        'text'::pg_catalog.regtype::oid, 'text'::pg_catalog.regtype::oid,
        'integer'::pg_catalog.regtype::oid
      ]::oid[]
      and procedure.proargmodes = array['i', 't', 't']::"char"[]
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('supabase_auth_admin', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) acl
        where acl.privilege_type = 'EXECUTE'
          and (
            acl.grantee not in (procedure.proowner, 'authenticated'::pg_catalog.regrole::oid)
            or (acl.grantee = 'authenticated'::pg_catalog.regrole::oid and acl.is_grantable)
          )
      ) as compatible_signature_and_acl
  into v_reset_function
  from pg_catalog.pg_proc procedure
  where procedure.oid = 'public.reset_current_user_app_data_v0_1(text)'::pg_catalog.regprocedure;

  if not v_reset_function.prosecdef
    or v_reset_function.owner_name <> 'postgres'
    or coalesce(pg_catalog.array_length(v_reset_function.proconfig, 1), 0) <> 1
    or v_reset_function.proconfig[1] not in ('search_path=', 'search_path=""')
    or v_reset_function.compatible_signature_and_acl is distinct from true
    or (
      v_reset_function.normalized_body_sha256 is distinct from
        '2e2a05539d97c80704f7cb4c2c05f36bdc3cccbea2af37e5558aa60b8f988799'
      and v_reset_function.normalized_body_sha256 is distinct from
        '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d'
    ) then
    raise exception 'reset_current_user_app_data_v0_1 differs from the R2-A baseline';
  end if;
end;
$preconditions$;

create table public.networking_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  objective_type text not null check (
    objective_type in ('JOB_SEARCH', 'BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND')
  ),
  status text not null default 'active' check (status in ('active', 'closed')),
  started_on date,
  closed_at timestamptz,
  professional_situation_code_at_start text check (
    professional_situation_code_at_start is null
    or professional_situation_code_at_start in (
      'employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say'
    )
  ),
  origin text not null default 'user' check (origin in ('user', 'legacy')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint networking_cycles_dates_valid check (
    (status = 'active' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  ),
  constraint networking_cycles_user_start_required check (
    origin = 'legacy' or started_on is not null
  )
);

create unique index uq_networking_cycles_one_active_per_user
  on public.networking_cycles(user_id)
  where status = 'active';
create index idx_networking_cycles_user_history
  on public.networking_cycles(user_id, started_on, closed_at, created_at);

alter table public.objectives add column cycle_id uuid;
alter table public.objectives
  add constraint objectives_cycle_id_fkey foreign key (cycle_id)
  references public.networking_cycles(id) on delete restrict;
create index idx_objectives_user_cycle_active
  on public.objectives(user_id, cycle_id, is_active, objective_name);

create table public.professional_situation_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid references public.networking_cycles(id) on delete restrict,
  previous_code text,
  next_code text,
  changed_by_user_id uuid,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint professional_situation_transition_previous_valid check (
    previous_code is null or previous_code in (
      'employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say'
    )
  ),
  constraint professional_situation_transition_next_valid check (
    next_code is null or next_code in (
      'employed', 'unemployed', 'independent', 'studying', 'other', 'prefer_not_to_say'
    )
  ),
  constraint professional_situation_transition_is_real check (previous_code is distinct from next_code)
);
create index idx_professional_situation_transitions_user_time
  on public.professional_situation_transitions(user_id, changed_at, id);

create table public.contact_networking_transitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  cycle_id uuid references public.networking_cycles(id) on delete restrict,
  event_kind text not null check (event_kind in ('initialized', 'changed')),
  previous_status text,
  next_status text,
  previous_focus boolean,
  next_focus boolean,
  changed_fields text[] not null,
  changed_by_user_id uuid,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint contact_networking_transition_previous_status_valid check (
    previous_status is null or previous_status in (
      'Pendiente', 'Contactado', 'Agendado', 'Cita concretada', 'Agradecimiento enviado'
    )
  ),
  constraint contact_networking_transition_next_status_valid check (
    next_status in (
      'Pendiente', 'Contactado', 'Agendado', 'Cita concretada', 'Agradecimiento enviado'
    )
  ),
  constraint contact_networking_transition_fields_valid check (
    pg_catalog.cardinality(changed_fields) > 0
    and changed_fields <@ array['networking_status', 'networking_focus']::text[]
  )
);
create index idx_contact_networking_transitions_user_time
  on public.contact_networking_transitions(user_id, changed_at, id);
create index idx_contact_networking_transitions_contact_time
  on public.contact_networking_transitions(contact_id, changed_at, id)
  where contact_id is not null;

create or replace function public.active_networking_cycle_id_for_user_v1(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cycle.id
  from public.networking_cycles cycle
  where cycle.user_id = p_user_id and cycle.status = 'active'
  order by cycle.created_at desc, cycle.id
  limit 1;
$$;

create or replace function public.networking_cycle_for_event_v1(
  p_user_id uuid,
  p_occurred_at timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with matches as (
    select cycle.id
    from public.networking_cycles cycle
    where p_occurred_at is not null
      and cycle.user_id = p_user_id
      and cycle.started_on is not null
      and p_occurred_at >= (cycle.started_on::timestamp at time zone 'UTC')
      and (cycle.closed_at is null or p_occurred_at < cycle.closed_at)
  )
  select case when pg_catalog.count(*) = 1 then (pg_catalog.array_agg(id))[1] end
  from matches;
$$;

create or replace function public.validate_networking_cycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('networking-cycle'),
    pg_catalog.hashtext(new.user_id::text)
  );

  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.objective_type is distinct from old.objective_type
    or new.origin is distinct from old.origin
    or new.professional_situation_code_at_start is distinct from old.professional_situation_code_at_start
  ) then
    raise exception 'networking_cycle_identity_or_snapshot_immutable' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and new.origin <> 'legacy' then
    select profile.professional_situation_code
    into new.professional_situation_code_at_start
    from public.profiles profile
    where profile.id = new.user_id;
    if not found then
      raise exception 'networking_cycle_profile_missing' using errcode = '23503';
    end if;
  end if;

  if new.started_on is not null and new.closed_at is not null
    and new.closed_at <= (new.started_on::timestamp at time zone 'UTC') then
    raise exception 'networking_cycle_invalid_dates' using errcode = '22023';
  end if;

  if (new.status = 'active' and new.closed_at is not null)
    or (new.status = 'closed' and new.closed_at is null) then
    raise exception 'networking_cycle_invalid_state' using errcode = '22023';
  end if;

  if new.started_on is not null and exists (
    select 1
    from public.networking_cycles existing
    where existing.user_id = new.user_id
      and existing.id <> new.id
      and existing.started_on is not null
      and pg_catalog.tstzrange(
        existing.started_on::timestamp at time zone 'UTC', existing.closed_at, '[)'
      ) && pg_catalog.tstzrange(
        new.started_on::timestamp at time zone 'UTC', new.closed_at, '[)'
      )
  ) then
    raise exception 'networking_cycle_date_overlap' using errcode = '23P01';
  end if;

  return new;
end;
$$;

create or replace function public.assign_objective_cycle_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle_id uuid;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'objective_owner_change_not_allowed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.cycle_id is distinct from old.cycle_id then
    raise exception 'objective_cycle_change_not_allowed' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('networking-cycle'),
    pg_catalog.hashtext(new.user_id::text)
  );

  if new.cycle_id is null then
    v_cycle_id := public.active_networking_cycle_id_for_user_v1(new.user_id);
    if v_cycle_id is null then
      insert into public.networking_cycles(
        user_id, objective_type, status, started_on,
        professional_situation_code_at_start, origin
      ) values (
        new.user_id, 'JOB_SEARCH', 'active', null, null, 'legacy'
      ) returning id into v_cycle_id;
    end if;
    new.cycle_id := v_cycle_id;
  elsif not exists (
    select 1 from public.networking_cycles cycle
    where cycle.id = new.cycle_id
      and cycle.user_id = new.user_id
      and cycle.status = 'active'
  ) then
    raise exception 'objective_cycle_not_active_or_owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.capture_professional_situation_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.professional_situation_code is distinct from new.professional_situation_code then
    insert into public.professional_situation_transitions(
      user_id, cycle_id, previous_code, next_code, changed_by_user_id, changed_at
    ) values (
      new.id,
      public.active_networking_cycle_id_for_user_v1(new.id),
      old.professional_situation_code,
      new.professional_situation_code,
      auth.uid(),
      pg_catalog.clock_timestamp()
    );
  end if;
  return new;
end;
$$;

create or replace function public.capture_contact_networking_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    v_fields := array['networking_status', 'networking_focus']::text[];
  else
    if old.networking_status is distinct from new.networking_status then
      v_fields := pg_catalog.array_append(v_fields, 'networking_status');
    end if;
    if old.networking_focus is distinct from new.networking_focus then
      v_fields := pg_catalog.array_append(v_fields, 'networking_focus');
    end if;
    if pg_catalog.cardinality(v_fields) = 0 then
      return new;
    end if;
  end if;

  insert into public.contact_networking_transitions(
    user_id, contact_id, cycle_id, event_kind,
    previous_status, next_status, previous_focus, next_focus,
    changed_fields, changed_by_user_id, changed_at
  ) values (
    new.user_id,
    new.id,
    public.active_networking_cycle_id_for_user_v1(new.user_id),
    case when tg_op = 'INSERT' then 'initialized' else 'changed' end,
    case when tg_op = 'INSERT' then null else old.networking_status end,
    new.networking_status,
    case when tg_op = 'INSERT' then null else old.networking_focus end,
    new.networking_focus,
    v_fields,
    auth.uid(),
    pg_catalog.clock_timestamp()
  );
  return new;
end;
$$;

alter function public.active_networking_cycle_id_for_user_v1(uuid) owner to postgres;
alter function public.networking_cycle_for_event_v1(uuid, timestamptz) owner to postgres;
alter function public.validate_networking_cycle_v1() owner to postgres;
alter function public.assign_objective_cycle_v1() owner to postgres;
alter function public.capture_professional_situation_transition_v1() owner to postgres;
alter function public.capture_contact_networking_transition_v1() owner to postgres;

revoke all on function public.active_networking_cycle_id_for_user_v1(uuid)
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.networking_cycle_for_event_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.validate_networking_cycle_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.assign_objective_cycle_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.capture_professional_situation_transition_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.capture_contact_networking_transition_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;

create trigger validate_networking_cycle_v1
before insert or update of user_id, objective_type, status, started_on, closed_at,
  professional_situation_code_at_start, origin
on public.networking_cycles
for each row execute function public.validate_networking_cycle_v1();

create trigger set_networking_cycles_updated_at
before update on public.networking_cycles
for each row execute function public.set_updated_at();

insert into public.networking_cycles(
  user_id, objective_type, status, started_on,
  professional_situation_code_at_start, origin
)
select distinct objective.user_id, 'JOB_SEARCH', 'active', null::date, null::text, 'legacy'
from public.objectives objective;

update public.objectives objective
set cycle_id = cycle.id
from public.networking_cycles cycle
where cycle.user_id = objective.user_id
  and cycle.status = 'active'
  and objective.cycle_id is null;

create trigger assign_objective_cycle_v1
before insert or update of user_id, cycle_id on public.objectives
for each row execute function public.assign_objective_cycle_v1();

create trigger capture_professional_situation_transition_v1
after update of professional_situation_code on public.profiles
for each row execute function public.capture_professional_situation_transition_v1();

create trigger capture_contact_networking_transition_v1
after insert or update of networking_status, networking_focus on public.contacts
for each row execute function public.capture_contact_networking_transition_v1();

alter table public.networking_cycles owner to postgres;
alter table public.professional_situation_transitions owner to postgres;
alter table public.contact_networking_transitions owner to postgres;

alter table public.networking_cycles enable row level security;
alter table public.professional_situation_transitions enable row level security;
alter table public.contact_networking_transitions enable row level security;

create policy "Networking cycles are readable by owner"
on public.networking_cycles for select to authenticated
using (auth.uid() = user_id and public.current_user_has_app_access());

create policy "Professional situation transitions are readable by owner"
on public.professional_situation_transitions for select to authenticated
using (auth.uid() = user_id and public.current_user_has_app_access());

create policy "Contact networking transitions are readable by owner"
on public.contact_networking_transitions for select to authenticated
using (auth.uid() = user_id and public.current_user_has_app_access());

revoke all privileges on table
  public.networking_cycles,
  public.professional_situation_transitions,
  public.contact_networking_transitions
from public, anon, authenticated, service_role, supabase_auth_admin;
grant select on table
  public.networking_cycles,
  public.professional_situation_transitions,
  public.contact_networking_transitions
to authenticated;

create or replace function public.reset_current_user_app_data_v0_1(p_confirmation text)
returns table (
  deleted_table_name text,
  deleted_row_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  table_to_delete text;
  deleted_count integer;
  tables_in_delete_order text[] := array[
    'metric_snapshots', 'usage_events', 'usage_limits', 'data_exports', 'import_batches',
    'sync_change_suppressions', 'sync_run_logs', 'sync_cursors',
    'external_interaction_read_diagnostics', 'object_review_state', 'action_invocations',
    'todos', 'todo_configs', 'referrals',
    'professional_situation_transitions', 'contact_networking_transitions',
    'contact_objective_assignments', 'objectives',
    'external_interaction_sources', 'interaction_participants', 'interactions',
    'contact_emails', 'contact_phones', 'external_contact_snapshots',
    'external_contact_ids', 'contacts', 'networking_cycles', 'connected_accounts',
    'user_settings', 'audit_log'
  ];
begin
  if target_user_id is null then
    raise exception 'No authenticated user.';
  end if;
  if p_confirmation <> 'BORRAR MIS DATOS' then
    raise exception 'Invalid confirmation phrase.';
  end if;
  if not public.current_user_has_capability('data.delete_account') then
    raise exception 'Current user does not have permission to reset app data.';
  end if;

  foreach table_to_delete in array tables_in_delete_order loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', table_to_delete)) is null then
      deleted_table_name := table_to_delete;
      deleted_row_count := 0;
      return next;
    elsif not exists (
      select 1 from information_schema.columns column_definition
      where column_definition.table_schema = 'public'
        and column_definition.table_name = table_to_delete
        and column_definition.column_name = 'user_id'
    ) then
      raise exception 'Reset table % exists but does not have user_id column.', table_to_delete;
    else
      execute pg_catalog.format('delete from public.%I where user_id = $1', table_to_delete)
      using target_user_id;
      get diagnostics deleted_count = row_count;
      deleted_table_name := table_to_delete;
      deleted_row_count := deleted_count;
      return next;
    end if;
  end loop;
end;
$$;

alter function public.reset_current_user_app_data_v0_1(text) owner to postgres;
revoke all on function public.reset_current_user_app_data_v0_1(text)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.reset_current_user_app_data_v0_1(text) to authenticated;

comment on table public.networking_cycles is
  'OBJ-02 cycle instances. Legacy cycles intentionally keep unknown dates and start snapshot NULL.';
comment on table public.professional_situation_transitions is
  'Actual professional-situation transitions captured after R2-A; no legacy history is inferred.';
comment on table public.contact_networking_transitions is
  'PII-minimized ledger of actual contact networking status/focus initialization and changes.';
comment on function public.networking_cycle_for_event_v1(uuid, timestamptz) is
  'Internal temporal attribution helper. Returns NULL when event time is absent or no single known cycle contains it.';

commit;
