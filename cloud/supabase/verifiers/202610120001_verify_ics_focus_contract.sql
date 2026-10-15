-- Structural contract for A3.4 Focus-only .ics Apply and participant recovery.
begin;

do $verify$
declare
  apply_function regprocedure := 'public.apply_ics_import_v1(jsonb)'::regprocedure;
  reconcile_function regprocedure := 'public.reconcile_ics_focus_participants_v1(boolean)'::regprocedure;
  function_oid oid;
  definition text;
begin
  foreach function_oid in array array[apply_function::oid, reconcile_function::oid]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_proc procedure
      where procedure.oid = function_oid
        and procedure.prosecdef
        and exists (
          select 1
          from pg_catalog.unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    ) then
      raise exception 'ICS Focus function owner, SECURITY DEFINER, or search_path changed';
    end if;
    if not pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin', function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE') then
      raise exception 'ICS Focus function grants are incorrect';
    end if;
  end loop;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(apply_function::oid)) into definition;
  if pg_catalog.strpos(definition, 'ics_import_stale_focus') = 0
    or pg_catalog.strpos(definition, 'contact.networking_focus') = 0
    or pg_catalog.strpos(definition, 'count(distinct contact.id) = 1') = 0
    or pg_catalog.strpos(definition, 'participant.contact_id is null') = 0 then
    raise exception 'apply_ics_import_v1 Focus revalidation contract changed';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(reconcile_function::oid)) into definition;
  if pg_catalog.strpos(definition, 'source.provider = ''icalendar''') = 0
    or pg_catalog.strpos(definition, 'source.source_service = ''ics_import''') = 0
    or pg_catalog.strpos(definition, 'participant.contact_id is null') = 0
    or pg_catalog.strpos(definition, 'contact.networking_focus') = 0
    or pg_catalog.strpos(definition, 'interaction.import_ics.reconcile_focus') = 0 then
    raise exception 'reconcile_ics_focus_participants_v1 provenance or audit contract changed';
  end if;
end;
$verify$;

rollback;
