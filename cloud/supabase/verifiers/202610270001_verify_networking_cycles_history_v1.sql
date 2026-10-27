-- Structural and access verifier for OBJ-02 R2-A.

begin transaction read only;

do $verify$
declare
  v_table text;
  v_function regprocedure;
  v_role text;
  v_privilege text;
  v_trigger_count integer;
  v_policy_name text;
begin
  foreach v_table in array array[
    'networking_cycles',
    'professional_situation_transitions',
    'contact_networking_transitions'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'R2-A table public.% is missing', v_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid = ('public.' || v_table)::regclass
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
        and relation.relrowsecurity
        and not relation.relforcerowsecurity
    ) then
      raise exception 'R2-A table public.% has incompatible owner or RLS flags', v_table;
    end if;

    v_policy_name := case v_table
      when 'networking_cycles' then 'Networking cycles are readable by owner'
      when 'professional_situation_transitions' then 'Professional situation transitions are readable by owner'
      else 'Contact networking transitions are readable by owner'
    end;
    if (select pg_catalog.count(*) from pg_catalog.pg_policies policy
        where policy.schemaname = 'public' and policy.tablename = v_table) <> 1
      or not exists (
        select 1 from pg_catalog.pg_policies policy
        where policy.schemaname = 'public' and policy.tablename = v_table
          and policy.policyname = v_policy_name
          and policy.cmd = 'SELECT'
          and policy.roles = array['authenticated']::name[]
          and policy.with_check is null
          and pg_catalog.regexp_replace(
            pg_catalog.lower(policy.qual), '[[:space:]()]', '', 'g'
          ) in (
            'auth.uid=user_idandcurrent_user_has_app_access',
            'auth.uid=user_idandpublic.current_user_has_app_access'
          )
      ) then
      raise exception 'R2-A owner read policy on public.% is missing or broader than approved', v_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl
      where relation.oid = ('public.' || v_table)::regclass
        and acl.grantee = 0
        and acl.privilege_type = any(array[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        ]::text[])
    ) then
      raise exception 'PUBLIC has a direct table privilege on public.%', v_table;
    end if;

    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      foreach v_privilege in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] loop
        if pg_catalog.has_table_privilege(v_role, 'public.' || v_table, v_privilege)
          is distinct from (v_role = 'authenticated' and v_privilege = 'SELECT') then
          raise exception 'Unexpected % privilege for % on public.%', v_privilege, v_role, v_table;
        end if;
      end loop;
    end loop;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'objectives'
      and column_name = 'cycle_id' and data_type = 'uuid' and is_nullable = 'YES'
  ) then
    raise exception 'objectives.cycle_id is missing or incompatible';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interactions' and column_name = 'cycle_id'
  ) then
    raise exception 'interactions must not persist cycle_id';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index index_row
    where index_row.indexrelid = 'public.uq_networking_cycles_one_active_per_user'::regclass
      and index_row.indisunique and index_row.indisvalid and index_row.indisready
      and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) = '(status = ''active''::text)'
  ) then
    raise exception 'One-active-cycle partial unique index is missing or incompatible';
  end if;

  foreach v_function in array array[
    'public.active_networking_cycle_id_for_user_v1(uuid)'::regprocedure,
    'public.networking_cycle_for_event_v1(uuid,timestamptz)'::regprocedure,
    'public.validate_networking_cycle_v1()'::regprocedure,
    'public.assign_objective_cycle_v1()'::regprocedure,
    'public.capture_professional_situation_transition_v1()'::regprocedure,
    'public.capture_contact_networking_transition_v1()'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = v_function
        and procedure.prosecdef
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and coalesce(pg_catalog.array_length(procedure.proconfig, 1), 0) = 1
        and procedure.proconfig[1] in ('search_path=', 'search_path=""')
    ) then
      raise exception 'R2-A function % has incompatible security metadata', v_function;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) acl
      where procedure.oid = v_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Internal R2-A function % is executable by PUBLIC', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'Internal R2-A function % is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;

  select count(*) into v_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where not trigger_row.tgisinternal and (
    (trigger_row.tgrelid = 'public.networking_cycles'::regclass
      and trigger_row.tgname = 'validate_networking_cycle_v1'
      and trigger_row.tgfoid = 'public.validate_networking_cycle_v1()'::regprocedure)
    or (trigger_row.tgrelid = 'public.objectives'::regclass
      and trigger_row.tgname = 'assign_objective_cycle_v1'
      and trigger_row.tgfoid = 'public.assign_objective_cycle_v1()'::regprocedure)
    or (trigger_row.tgrelid = 'public.profiles'::regclass
      and trigger_row.tgname = 'capture_professional_situation_transition_v1'
      and trigger_row.tgfoid = 'public.capture_professional_situation_transition_v1()'::regprocedure)
    or (trigger_row.tgrelid = 'public.contacts'::regclass
      and trigger_row.tgname = 'capture_contact_networking_transition_v1'
      and trigger_row.tgfoid = 'public.capture_contact_networking_transition_v1()'::regprocedure)
    or (trigger_row.tgrelid = 'public.networking_cycles'::regclass
      and trigger_row.tgname = 'set_networking_cycles_updated_at'
      and trigger_row.tgfoid = 'public.set_updated_at()'::regprocedure)
  );
  if v_trigger_count <> 5 then
    raise exception 'Expected five exact R2-A triggers, found %', v_trigger_count;
  end if;

  if exists (
    select 1 from public.objectives objective
    left join public.networking_cycles cycle on cycle.id = objective.cycle_id
    where objective.cycle_id is null or cycle.user_id is distinct from objective.user_id
  ) then
    raise exception 'Existing objectives are not assigned to an owned cycle';
  end if;
  if exists (
    select user_id from public.networking_cycles where status = 'active'
    group by user_id having count(*) > 1
  ) then
    raise exception 'A user has more than one active cycle';
  end if;
  if exists (
    select 1
    from public.networking_cycles left_cycle
    join public.networking_cycles right_cycle
      on right_cycle.user_id = left_cycle.user_id
     and right_cycle.id > left_cycle.id
     and left_cycle.started_on is not null
     and right_cycle.started_on is not null
     and tstzrange(left_cycle.started_on::timestamp at time zone 'UTC', left_cycle.closed_at, '[)')
       && tstzrange(right_cycle.started_on::timestamp at time zone 'UTC', right_cycle.closed_at, '[)')
  ) then
    raise exception 'Known cycle ranges overlap';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid = 'public.reset_current_user_app_data_v0_1(text)'::regprocedure
      and procedure.prosrc like '%professional_situation_transitions%'
      and procedure.prosrc like '%contact_networking_transitions%'
      and procedure.prosrc like '%networking_cycles%'
  ) then
    raise exception 'Reset RPC does not include the R2-A user-owned tables';
  end if;
end;
$verify$;

rollback;
