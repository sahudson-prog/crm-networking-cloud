-- Verifies the installed iCalendar Apply boundary without writing fixture data.

begin;

do $verify$
declare
  apply_function regprocedure := 'public.apply_ics_import_v1(jsonb)'::regprocedure;
  function_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class table_relation
      on table_relation.oid = index_definition.indrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where table_namespace.nspname = 'public'
      and table_relation.relname = 'external_interaction_sources'
      and index_definition.indisunique
      and index_definition.indisvalid
      and index_definition.indisready
      and index_definition.indpred is not null
      and index_definition.indexprs is null
      and index_definition.indnkeyatts = 4
      and (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(index_definition.indkey::smallint[])
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_definition.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= index_definition.indnkeyatts
      ) = array['user_id', 'provider', 'source_service', 'external_id']::text[]
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_expr(index_definition.indpred, index_definition.indrelid)),
        '[[:space:]()]',
        '',
        'g'
      ) in ('is_active', 'is_active=true', 'is_activeistrue')
  ) then
    raise exception 'apply_ics_import_v1 requires the active external interaction identity index';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension extension
    join pg_catalog.pg_namespace namespace on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception 'apply_ics_import_v1 requires pgcrypto in the extensions schema';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = apply_function
      and (
        procedure.prorettype <> 'jsonb'::regtype
        or not procedure.prosecdef
        or pg_catalog.pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not exists (
          select 1
          from pg_catalog.unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
      )
  ) then
    raise exception 'apply_ics_import_v1 signature, owner, SECURITY DEFINER, or search_path changed';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', apply_function, 'EXECUTE')
    or pg_catalog.has_function_privilege('supabase_auth_admin', apply_function, 'EXECUTE') then
    raise exception 'apply_ics_import_v1 grants are incorrect';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid = apply_function
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute apply_ics_import_v1';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(apply_function)),
    '\s+', ' ', 'g'
  ) into function_definition;

  if pg_catalog.strpos(function_definition, 'v_user_id uuid := auth.uid()') = 0
    or pg_catalog.strpos(function_definition, 'public.current_user_has_app_access()') = 0
    or pg_catalog.strpos(function_definition, 'pg_advisory_xact_lock') = 0
    or pg_catalog.strpos(function_definition, 'extensions.digest') = 0
    or pg_catalog.strpos(function_definition, 'ics_uid_sha256_') = 0
    or pg_catalog.strpos(function_definition, 'pg_catalog.jsonb_array_length(p_items) > 500') = 0
    or pg_catalog.strpos(function_definition, 'v_total_participants > 5000') = 0
    or pg_catalog.strpos(function_definition, 'all-day event is not supported') = 0
    or pg_catalog.strpos(function_definition, '5 * 1024 * 1024') = 0 then
    raise exception 'apply_ics_import_v1 is missing an identity, access, locking, or limit guard';
  end if;

  if pg_catalog.strpos(function_definition, $$provider = 'icalendar'$$) = 0
    or pg_catalog.strpos(function_definition, $$source_service = 'ics_import'$$) = 0
    or pg_catalog.strpos(function_definition, $$external_object_type = 'calendar_event'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_interaction.provider <> 'icalendar'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_source.prevent_reimport$$) = 0
    or pg_catalog.strpos(function_definition, $$pg_catalog.to_jsonb(v_interaction)->>'is_deleted'$$) = 0
    or pg_catalog.strpos(function_definition, $$pg_catalog.to_jsonb(v_interaction)->>'prevent_reimport'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_interaction.metadata->'deleted'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_interaction.metadata->'dismissed'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_interaction.metadata->'prevent_reimport'$$) = 0
    or pg_catalog.strpos(function_definition, $$v_interaction.is_deleted$$) > 0
    or pg_catalog.strpos(function_definition, $$v_interaction.prevent_reimport$$) > 0 then
    raise exception 'apply_ics_import_v1 provenance guards changed';
  end if;
end;
$verify$;

rollback;
