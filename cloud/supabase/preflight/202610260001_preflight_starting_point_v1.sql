-- Read-only preflight for OBJ-02 R1. Returns aggregate catalog diagnostics without user identifiers or values.

begin transaction read only;

with expected_functions(
  function_name, function_signature, return_type, security_definer,
  volatility, authenticated_execute, normalized_body_md5
) as (
  values
    ('validate_networking_start_setting_v1', 'public.validate_networking_start_setting_v1()',
      'trigger', false, 'v', false, 'c9e2538021d503c7abf05907369a8b72'),
    ('current_user_starting_point_v1', 'public.current_user_starting_point_v1()',
      'jsonb', true, 's', true, '72323c779de84fd3616cfae8cefa32a4'),
    ('save_current_user_starting_point_v1', 'public.save_current_user_starting_point_v1(text,text,date)',
      'jsonb', true, 'v', true, '60068fb7758ba91461551807ae34a422')
), column_diagnostics as (
  select
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'profiles'
        and column_row.column_name = 'professional_situation_code'
    ) as object_exists,
    exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'profiles'
        and column_row.column_name = 'professional_situation_code'
        and column_row.data_type = 'text'
        and column_row.is_nullable = 'YES'
        and column_row.column_default is null
        and column_row.is_generated = 'NEVER'
        and column_row.is_identity = 'NO'
    ) as compatible
), networking_values as (
  select
    case
      when pg_catalog.btrim(coalesce(setting.setting_value, '')) ~ '^\d{4}-\d{2}-\d{2}$'
        then pg_catalog.btrim(setting.setting_value)
      when pg_catalog.btrim(coalesce(setting.setting_value, '')) ~ '^\d{1,2}/\d{1,2}/\d{4}$'
        then pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 3)
          || '-' || pg_catalog.lpad(pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 2), 2, '0')
          || '-' || pg_catalog.lpad(pg_catalog.split_part(pg_catalog.btrim(setting.setting_value), '/', 1), 2, '0')
      else null
    end as date_candidate
  from public.user_settings setting
  where setting.setting_key = 'Fecha_Inicio_Networking'
), networking_diagnostics as (
  select
    count(*) as total_rows,
    count(*) filter (
      where date_candidate is null
        or not pg_catalog.pg_input_is_valid(date_candidate, 'date')
        or case
          when pg_catalog.pg_input_is_valid(date_candidate, 'date')
            then date_candidate::date > (pg_catalog.statement_timestamp() at time zone 'UTC')::date
          else false
        end
    ) as incompatible_rows
  from networking_values
), constraint_diagnostics as (
  select
    constraint_row.oid is not null as object_exists,
    coalesce(
      constraint_row.contype = 'c'
      and constraint_row.convalidated
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
        '[[:space:]]+', ' ', 'g'
      ) = 'check (professional_situation_code is null or (professional_situation_code = any (array[''employed''::text, ''unemployed''::text, ''independent''::text, ''studying''::text, ''other''::text, ''prefer_not_to_say''::text])))',
      false
    ) as compatible,
    case when constraint_row.oid is null then null
      else pg_catalog.pg_get_constraintdef(constraint_row.oid, true) end as definition
  from (select true) seed
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
   and constraint_row.conname = 'profiles_professional_situation_code_valid'
), function_diagnostics as (
  select
    expected.function_name,
    expected.function_signature,
    procedure.oid is not null as object_exists,
    case when procedure.oid is null then null else
      pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and language.lanname = 'plpgsql'
      and procedure.prorettype = expected.return_type::pg_catalog.regtype
      and procedure.prosecdef = expected.security_definer
      and procedure.provolatile = expected.volatility
      and procedure.prokind = 'f'
      and not procedure.proisstrict
      and not procedure.proleakproof
      and procedure.proparallel = 'u'
      and coalesce(pg_catalog.array_length(procedure.proconfig, 1), 0) = 1
      and procedure.proconfig[1] in ('search_path=', 'search_path=""')
      and pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
          pg_catalog.chr(13), pg_catalog.chr(10)
        )
      ) = expected.normalized_body_md5
      and acl_diagnostics.compatible
      and overload_diagnostics.unexpected_count = 0
      and dependency_diagnostics.unexpected_count = 0
    end as compatible,
    case when procedure.oid is null then null else pg_catalog.pg_get_userbyid(procedure.proowner) end as owner_name,
    case when procedure.oid is null then null else procedure.prosecdef end as security_definer,
    case when procedure.oid is null then null else procedure.provolatile end as volatility,
    case when procedure.oid is null then null else procedure.proconfig end as configuration,
    case when procedure.oid is null then null else pg_catalog.md5(
      pg_catalog.replace(
        pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
        pg_catalog.chr(13), pg_catalog.chr(10)
      )
    ) end as normalized_body_md5,
    acl_diagnostics.compatible as acl_compatible,
    overload_diagnostics.unexpected_signatures,
    dependency_diagnostics.unexpected_objects
  from expected_functions expected
  left join lateral (
    select procedure_row.*
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid = pg_catalog.to_regprocedure(expected.function_signature)
  ) procedure on true
  left join pg_catalog.pg_language language on language.oid = procedure.prolang
  cross join lateral (
    select
      count(*) as unexpected_count,
      coalesce(
        pg_catalog.jsonb_agg(procedure_row.oid::pg_catalog.regprocedure::text order by procedure_row.oid::pg_catalog.regprocedure::text),
        '[]'::jsonb
      ) as unexpected_signatures
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure_row.pronamespace
    where namespace.nspname = 'public'
      and procedure_row.proname = expected.function_name
      and procedure_row.oid <> coalesce(procedure.oid, 0::oid)
  ) overload_diagnostics
  cross join lateral (
    select
      case when procedure.oid is null then null else
        pg_catalog.has_function_privilege('postgres', procedure.oid, 'EXECUTE WITH GRANT OPTION')
        and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        and not pg_catalog.has_function_privilege('supabase_auth_admin', procedure.oid, 'EXECUTE')
        and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
          = expected.authenticated_execute
        and not exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) acl
          left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
          where acl.privilege_type = 'EXECUTE'
            and acl.grantee <> procedure.proowner
            and not (
              expected.authenticated_execute
              and grantee.rolname = 'authenticated'
              and not acl.is_grantable
            )
        )
      end as compatible
  ) acl_diagnostics
  cross join lateral (
    select
      count(*) as unexpected_count,
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid)
          order by pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid)
        ),
        '[]'::jsonb
      ) as unexpected_objects
    from pg_catalog.pg_depend dependency
    where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      and dependency.refobjid = procedure.oid
      and not (
        expected.function_name = 'validate_networking_start_setting_v1'
        and dependency.classid = 'pg_catalog.pg_trigger'::pg_catalog.regclass
        and exists (
          select 1
          from pg_catalog.pg_trigger trigger_row
          where trigger_row.oid = dependency.objid
            and trigger_row.tgrelid = 'public.user_settings'::pg_catalog.regclass
            and trigger_row.tgname = 'validate_networking_start_setting_v1'
        )
      )
  ) dependency_diagnostics
), trigger_diagnostics as (
  select
    trigger_row.oid is not null as object_exists,
    case when trigger_row.oid is null then null else
      trigger_row.tgfoid = coalesce(
        pg_catalog.to_regprocedure('public.validate_networking_start_setting_v1()'), 0::oid
      )
      and trigger_row.tgtype = 23
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
      and trigger_row.tgqual is null
      and trigger_row.tgnargs = 0
      and trigger_columns.column_names is not distinct from array['setting_key', 'setting_value']::text[]
    end as compatible,
    case when trigger_row.oid is null then null
      else pg_catalog.pg_get_triggerdef(trigger_row.oid, true) end as definition,
    trigger_columns.column_names
  from (select true) seed
  left join pg_catalog.pg_trigger trigger_row
    on trigger_row.tgrelid = 'public.user_settings'::pg_catalog.regclass
   and trigger_row.tgname = 'validate_networking_start_setting_v1'
  left join lateral (
    select pg_catalog.array_agg(attribute.attname::text order by attribute.attname) as column_names
    from pg_catalog.unnest(trigger_row.tgattr::smallint[]) attribute_number
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = trigger_row.tgrelid
     and attribute.attnum = attribute_number
  ) trigger_columns on true
), diagnostics as (
  select
    column_diagnostics.object_exists as column_exists,
    column_diagnostics.compatible as column_compatible,
    constraint_diagnostics.object_exists as constraint_exists,
    constraint_diagnostics.compatible as constraint_compatible,
    constraint_diagnostics.definition as constraint_definition,
    trigger_diagnostics.object_exists as trigger_exists,
    trigger_diagnostics.compatible as trigger_compatible,
    trigger_diagnostics.definition as trigger_definition,
    trigger_diagnostics.column_names as trigger_columns,
    networking_diagnostics.total_rows,
    networking_diagnostics.incompatible_rows,
    (select count(*) from function_diagnostics where object_exists) as existing_function_count,
    (select count(*) from function_diagnostics where compatible is false) as incompatible_function_count,
    (select count(*) from function_diagnostics where jsonb_array_length(unexpected_signatures) > 0) as overload_conflict_count,
    (select count(*) from function_diagnostics where jsonb_array_length(unexpected_objects) > 0) as dependency_conflict_count,
    (select jsonb_object_agg(function_name, jsonb_build_object(
      'signature', function_signature,
      'exists', object_exists,
      'compatible', compatible,
      'owner', owner_name,
      'security_definer', security_definer,
      'volatility', volatility,
      'configuration', configuration,
      'normalized_body_md5', normalized_body_md5,
      'acl_compatible', acl_compatible,
      'unexpected_overloads', unexpected_signatures,
      'unexpected_dependents', unexpected_objects
    ) order by function_name) from function_diagnostics) as functions
  from networking_diagnostics
  cross join column_diagnostics
  cross join constraint_diagnostics
  cross join trigger_diagnostics
), classified as (
  select
    diagnostics.*,
    case
      when (column_exists and not column_compatible)
        or (constraint_exists and not constraint_compatible)
        or incompatible_function_count > 0
        or overload_conflict_count > 0
        or dependency_conflict_count > 0
        or (trigger_exists and not trigger_compatible)
        or incompatible_rows > 0 then 'incompatible'
      when not column_exists and not constraint_exists
        and existing_function_count = 0 and not trigger_exists then 'clean_install'
      when column_exists and constraint_exists
        and existing_function_count = 3 and trigger_exists then 'compatible_contract'
      else 'compatible_partial'
    end as installation_state
  from diagnostics
)
select jsonb_build_object(
  'installation_state', installation_state,
  'networking_start_rows', total_rows,
  'incompatible_networking_start_rows', incompatible_rows,
  'professional_situation_column', jsonb_build_object(
    'exists', column_exists,
    'compatible', case when column_exists then column_compatible else null end
  ),
  'professional_situation_constraint', jsonb_build_object(
    'exists', constraint_exists,
    'compatible', case when constraint_exists then constraint_compatible else null end,
    'definition', constraint_definition
  ),
  'functions', functions,
  'networking_start_trigger', jsonb_build_object(
    'exists', trigger_exists,
    'compatible', case when trigger_exists then trigger_compatible else null end,
    'definition', trigger_definition,
    'columns', trigger_columns
  ),
  'stop_reasons', jsonb_strip_nulls(jsonb_build_object(
    'incompatible_networking_start_rows', case when incompatible_rows > 0 then incompatible_rows end,
    'incompatible_professional_situation_column', case when column_exists and not column_compatible then true end,
    'incompatible_professional_situation_constraint', case when constraint_exists and not constraint_compatible then true end,
    'incompatible_functions', case when incompatible_function_count > 0 then incompatible_function_count end,
    'unexpected_function_overloads', case when overload_conflict_count > 0 then overload_conflict_count end,
    'unexpected_function_dependencies', case when dependency_conflict_count > 0 then dependency_conflict_count end,
    'incompatible_networking_start_trigger', case when trigger_exists and not trigger_compatible then true end
  ))
) as starting_point_v1_preflight
from classified;

rollback;
