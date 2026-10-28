-- OBJ-02 R2-B read-only structural, access and invariant verifier.
begin transaction read only;

do $verify$
declare v_table text; v_function regprocedure; v_trigger text;
begin
  if to_regclass('public.r2b_rollout_gate') is null
    or (select count(*) from public.r2b_rollout_gate where singleton) <> 1
    or pg_catalog.has_table_privilege('authenticated', 'public.r2b_rollout_gate', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.r2b_rollout_gate', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.r2b_rollout_gate', 'UPDATE')
    or not exists (select 1 from pg_catalog.pg_class c
      where c.oid = 'public.r2b_rollout_gate'::regclass and c.relrowsecurity) then
    raise exception 'R2-B rollout gate invalid'; end if;
  if (select mode = 'open' from public.r2b_rollout_gate where singleton)
    is distinct from pg_catalog.has_function_privilege('service_role',
      'public.submit_contact_request_v1(text,text,text,text,text,uuid)', 'EXECUTE')
    or (select mode = 'open' from public.r2b_rollout_gate where singleton)
    is distinct from pg_catalog.has_function_privilege('service_role',
      'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE') then
    raise exception 'R2-B service writer gate invalid'; end if;
  if not exists (select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.app_access_status_for_user(uuid)'::regprocedure
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig[1] in ('search_path=', 'search_path=""')
      and pg_catalog.strpos(p.prosrc, 'r2b_rollout_gate') > 0) then
    raise exception 'R2-B effective-access gate invalid'; end if;
  if not exists (select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.set_r2b_rollout_gate(text,uuid)'::regprocedure
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig[1] in ('search_path=', 'search_path=""'))
    or pg_catalog.has_function_privilege('authenticated',
      'public.set_r2b_rollout_gate(text,uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'public.set_r2b_rollout_gate(text,uuid)', 'EXECUTE') then
    raise exception 'R2-B rollout transition function invalid'; end if;
  foreach v_table in array array['networking_cycle_closed_contacts', 'networking_cycle_closed_assignments'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'R2-B table % missing', v_table; end if;
    if not exists (select 1 from pg_catalog.pg_class c
      where c.oid = ('public.' || v_table)::regclass and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') then
      raise exception 'R2-B table % owner/RLS invalid', v_table; end if;
    if (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = v_table) <> 1
      or not pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
      or pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'R2-B table % access invalid', v_table; end if;
  end loop;

  foreach v_function in array array[
    'public.start_networking_cycle_r2b(uuid,text,timestamptz,text,uuid,text,boolean,boolean)'::regprocedure,
    'public.configure_legacy_networking_cycle_r2b(uuid,uuid,text,text,timestamptz,text)'::regprocedure,
    'public.close_networking_cycle_r2b(uuid,uuid,text,timestamptz,text)'::regprocedure,
    'public.save_objective_r2b(uuid,text,uuid,text,text,text,text,text,boolean)'::regprocedure,
    'public.archive_objective_r2b(uuid,text,uuid)'::regprocedure,
    'public.replace_contact_objectives_r2b(uuid,text,uuid,uuid[],text)'::regprocedure,
    'public.replace_objective_contacts_r2b(uuid,text,uuid,uuid[])'::regprocedure,
    'public.add_objectives_to_contacts_r2b(uuid,text,uuid[],uuid[],text)'::regprocedure,
    'public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)'::regprocedure
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_function
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig[1] in ('search_path=', 'search_path=""'))
      or not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'R2-B RPC % security invalid', v_function; end if;
  end loop;
  if pg_catalog.has_function_privilege('authenticated',
    'public.merge_contacts_deep(uuid,uuid[],jsonb,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
    'public.assert_networking_context_r2b(uuid,uuid,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
    'public.current_networking_context_r2b(uuid)', 'EXECUTE') then
    raise exception 'Unscoped merge or internal context remains executable'; end if;

  foreach v_trigger in array array['guard_objective_write_r2b', 'guard_assignment_write_r2b',
    'guard_contact_networking_write_r2b'] loop
    if not exists (select 1 from pg_catalog.pg_trigger t where t.tgname = v_trigger and not t.tgisinternal) then
      raise exception 'R2-B trigger % missing', v_trigger; end if;
  end loop;
  if to_regclass('public.uq_objectives_cycle_type_name_active') is null
    or to_regclass('public.uq_objectives_user_type_normalized_active') is not null
    or to_regclass('public.uq_networking_cycle_start_request') is null
    or to_regclass('public.uq_networking_cycle_close_request') is null then
    raise exception 'R2-B uniqueness indexes invalid'; end if;
  if exists (select 1 from public.networking_cycles c where c.status = 'closed'
    and (c.closed_at is null or c.closed_result is null or c.closed_recorded_at is null))
    or exists (select 1 from public.networking_cycles c where c.origin = 'user' and c.started_at is null)
    or exists (select 1 from public.objectives o join public.networking_cycles c on c.id = o.cycle_id
      where c.user_id <> o.user_id) then
    raise exception 'R2-B data invariant invalid'; end if;
end;
$verify$;

select jsonb_build_object('verdict', 'pass',
  'cycles', (select count(*) from public.networking_cycles),
  'closed_cycles', (select count(*) from public.networking_cycles where status = 'closed'),
  'closed_contact_observations', (select count(*) from public.networking_cycle_closed_contacts),
  'closed_assignments', (select count(*) from public.networking_cycle_closed_assignments))
  as networking_cycle_operations_v1_verifier;

rollback;
