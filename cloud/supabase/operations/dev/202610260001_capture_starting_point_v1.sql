-- Read-only structural capture for the OBJ-02 R1 DEV cutover.
-- The payload contains catalog definitions and ACLs only; it contains no application rows or user identifiers.

begin transaction read only;

with expected_functions(function_name) as (
  values
    ('validate_networking_start_setting_v1'),
    ('current_user_starting_point_v1'),
    ('save_current_user_starting_point_v1')
), column_snapshot as (
  select jsonb_build_object(
    'exists', column_row.column_name is not null,
    'data_type', column_row.data_type,
    'is_nullable', column_row.is_nullable,
    'column_default', column_row.column_default,
    'is_generated', column_row.is_generated,
    'is_identity', column_row.is_identity,
    'dependents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'object', pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid),
        'dependency_type', dependency.deptype
      ) order by pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid))
      from pg_catalog.pg_depend dependency
      where dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
        and dependency.refobjid = 'public.profiles'::pg_catalog.regclass
        and dependency.refobjsubid = coalesce(column_attribute.attnum, 0)
        and column_attribute.attnum is not null
    ), '[]'::jsonb)
  ) as value
  from (select true) seed
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = 'profiles'
   and column_row.column_name = 'professional_situation_code'
  left join pg_catalog.pg_attribute column_attribute
    on column_attribute.attrelid = 'public.profiles'::pg_catalog.regclass
   and column_attribute.attname = 'professional_situation_code'
   and not column_attribute.attisdropped
), constraint_snapshot as (
  select jsonb_build_object(
    'exists', constraint_row.oid is not null,
    'type', constraint_row.contype,
    'validated', constraint_row.convalidated,
    'definition', case when constraint_row.oid is null then null
      else pg_catalog.pg_get_constraintdef(constraint_row.oid, true) end,
    'dependents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'object', pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid),
        'dependency_type', dependency.deptype
      ) order by pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid))
      from pg_catalog.pg_depend dependency
      where dependency.refclassid = 'pg_catalog.pg_constraint'::pg_catalog.regclass
        and dependency.refobjid = constraint_row.oid
    ), '[]'::jsonb)
  ) as value
  from (select true) seed
  left join pg_catalog.pg_constraint constraint_row
    on constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
   and constraint_row.conname = 'profiles_professional_situation_code_valid'
), function_rows as (
  select
    procedure.oid::pg_catalog.regprocedure::text as signature,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    language.lanname as language_name,
    procedure.prosecdef as security_definer,
    procedure.provolatile as volatility,
    procedure.proconfig as configuration,
    procedure.prorettype::pg_catalog.regtype::text as return_type,
    procedure.prokind as function_kind,
    procedure.proisstrict as is_strict,
    procedure.proleakproof as leakproof,
    procedure.proparallel as parallel_safety,
    pg_catalog.md5(
      pg_catalog.replace(
        pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
        pg_catalog.chr(13), pg_catalog.chr(10)
      )
    ) as normalized_body_md5,
    pg_catalog.pg_get_functiondef(procedure.oid) as definition,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) order by acl.grantee, acl.privilege_type, acl.is_grantable)
      from pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) acl
      left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    ), '[]'::jsonb) as acl,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'object', pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid),
        'dependency_type', dependency.deptype
      ) order by pg_catalog.pg_describe_object(dependency.classid, dependency.objid, dependency.objsubid))
      from pg_catalog.pg_depend dependency
      where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and dependency.refobjid = procedure.oid
    ), '[]'::jsonb) as dependents
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_language language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname in (select function_name from expected_functions)
), function_snapshot as (
  select coalesce(
    jsonb_agg(to_jsonb(function_rows) order by signature),
    '[]'::jsonb
  ) as value
  from function_rows
), trigger_snapshot as (
  select jsonb_build_object(
    'exists', trigger_row.oid is not null,
    'definition', case when trigger_row.oid is null then null
      else pg_catalog.pg_get_triggerdef(trigger_row.oid, true) end,
    'function_signature', case when trigger_row.oid is null then null
      else trigger_row.tgfoid::pg_catalog.regprocedure::text end,
    'enabled', trigger_row.tgenabled,
    'type_bits', trigger_row.tgtype,
    'internal', trigger_row.tgisinternal,
    'when_expression', case when trigger_row.tgqual is null then null
      else pg_catalog.pg_get_expr(trigger_row.tgqual, trigger_row.tgrelid) end,
    'arguments_count', trigger_row.tgnargs,
    'columns', trigger_columns.column_names
  ) as value
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
), table_snapshot as (
  select jsonb_object_agg(table_row.relname, jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(table_row.relowner),
    'rls_enabled', table_row.relrowsecurity,
    'rls_forced', table_row.relforcerowsecurity,
    'acl', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) order by acl.grantee, acl.privilege_type, acl.is_grantable)
      from pg_catalog.aclexplode(
        coalesce(table_row.relacl, pg_catalog.acldefault('r', table_row.relowner))
      ) acl
      left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    ), '[]'::jsonb)
  ) order by table_row.relname) as value
  from pg_catalog.pg_class table_row
  join pg_catalog.pg_namespace namespace on namespace.oid = table_row.relnamespace
  where namespace.nspname = 'public'
    and table_row.relname in ('profiles', 'user_settings')
), payload as (
  select jsonb_build_object(
    'scope', 'OBJ-02-R1-starting-point-v1',
    'profiles_professional_situation_column', column_snapshot.value,
    'profiles_professional_situation_constraint', constraint_snapshot.value,
    'r1_functions', function_snapshot.value,
    'networking_start_trigger', trigger_snapshot.value,
    'affected_tables', table_snapshot.value
  ) as value
  from column_snapshot
  cross join constraint_snapshot
  cross join function_snapshot
  cross join trigger_snapshot
  cross join table_snapshot
)
select jsonb_build_object(
  'snapshot_version', 1,
  'integrity_algorithm', 'md5-jsonb-text-v1',
  'payload_bytes', pg_catalog.octet_length(pg_catalog.convert_to(payload.value::text, 'UTF8')),
  'payload_md5', pg_catalog.md5(payload.value::text),
  'payload', payload.value
) as starting_point_v1_structural_capture
from payload;

rollback;
