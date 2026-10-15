-- Structural contract for the A3.5 networking-start boundary in .ics Apply.
begin;

do $verify$
declare
  apply_function regprocedure := 'public.apply_ics_import_v1(jsonb)'::regprocedure;
  definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = apply_function
      and procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and exists (
        select 1
        from pg_catalog.unnest(coalesce(procedure.proconfig, array[]::text[])) config
        where config in ('search_path=', 'search_path=""')
      )
  ) then
    raise exception 'apply_ics_import_v1 owner, SECURITY DEFINER, or search_path changed';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('supabase_auth_admin', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('public', apply_function, 'EXECUTE') then
    raise exception 'apply_ics_import_v1 grants are incorrect';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(apply_function::oid))
  into definition;
  if pg_catalog.strpos(definition, 'fecha_inicio_networking') = 0
    or pg_catalog.strpos(definition, 'from public.user_settings') = 0
    or pg_catalog.strpos(definition, 'setting.user_id = v_user_id') = 0
    or pg_catalog.strpos(definition, 'for share') = 0
    or pg_catalog.strpos(definition, 'at time zone ''utc''') = 0
    or pg_catalog.strpos(definition, 'interval ''12 months''') = 0
    or pg_catalog.strpos(definition, 'pg_catalog.make_date') = 0
    or pg_catalog.strpos(definition, 'pg_catalog.split_part(v_networking_start_value') = 0
    or pg_catalog.strpos(definition, 'ics_import_networking_start_required') = 0
    or pg_catalog.strpos(definition, 'v_event_start_date := (v_occurred_at at time zone ''utc'')::date') = 0
    or pg_catalog.strpos(definition, 'v_event_start_date < v_minimum_start_date') = 0
    or pg_catalog.strpos(definition, 'ics_import_before_networking_start') = 0 then
    raise exception 'apply_ics_import_v1 networking-start contract changed';
  end if;
end;
$verify$;

rollback;
