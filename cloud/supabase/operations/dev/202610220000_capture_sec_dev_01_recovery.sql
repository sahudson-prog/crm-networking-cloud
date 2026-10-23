-- DEV-only, read-only recovery capture for SEC-DEV-01.
-- Export the single JSON value without truncation before applying remediation.

begin transaction read only;

with role_scope(role_name) as (
  values ('PUBLIC'), ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin')
), default_acl_slots as (
  select
    format('%s:%s:%s', owner_role.rolname, scope.schema_name, object_type.object_type) as object_name,
    owner_role.rolname as owner_name,
    scope.schema_name,
    scope.schema_oid,
    object_type.object_type,
    defaults.oid is not null as row_present,
    defaults.defaclacl
  from pg_catalog.pg_roles owner_role
  cross join (
    select '*'::text as schema_name, 0::oid as schema_oid
    union all
    select namespace.nspname, namespace.oid
    from pg_catalog.pg_namespace namespace
    where namespace.nspname = 'public'
  ) scope
  cross join (values ('r'::"char"), ('S'::"char"), ('f'::"char")) object_type(object_type)
  left join pg_catalog.pg_default_acl defaults
    on defaults.defaclrole = owner_role.oid
   and defaults.defaclnamespace = scope.schema_oid
   and defaults.defaclobjtype = object_type.object_type
  where owner_role.rolname = 'postgres'
), object_inventory as (
  select
    'table'::text as surface,
    namespace.nspname || '.' || relation.relname as object_name,
    pg_get_userbyid(relation.relowner) as owner_name
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')

  union all

  select
    'sequence'::text,
    namespace.nspname || '.' || relation.relname,
    pg_get_userbyid(relation.relowner)
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'S'

  union all

  select
    'function'::text,
    procedure.oid::regprocedure::text,
    pg_get_userbyid(procedure.proowner)
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'

  union all

  select
    'schema'::text,
    namespace.nspname,
    pg_get_userbyid(namespace.nspowner)
  from pg_catalog.pg_namespace namespace
  where namespace.nspname = 'public'

  union all

  select
    'default_acl'::text,
    format('postgres:%s:%s', scope.schema_name, object_type.object_type),
    'postgres'::text
  from (values ('*'), ('public')) scope(schema_name)
  cross join (values ('r'), ('S'), ('f')) object_type(object_type)
), table_acl as (
  select
    'table'::text as surface,
    namespace.nspname || '.' || relation.relname as object_name,
    pg_get_userbyid(acl.grantor) as grantor,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
    acl.privilege_type,
    acl.is_grantable,
    format(
      'grant %s on table %I.%I to %s%s;',
      acl.privilege_type,
      namespace.nspname,
      relation.relname,
      case when acl.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    ) as recovery_sql
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
), sequence_acl as (
  select
    'sequence'::text as surface,
    namespace.nspname || '.' || relation.relname as object_name,
    pg_get_userbyid(acl.grantor) as grantor,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
    acl.privilege_type,
    acl.is_grantable,
    format(
      'grant %s on sequence %I.%I to %s%s;',
      acl.privilege_type,
      namespace.nspname,
      relation.relname,
      case when acl.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    ) as recovery_sql
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, acldefault('S', relation.relowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
    and relation.relkind = 'S'
), function_acl as (
  select
    'function'::text,
    procedure.oid::regprocedure::text,
    pg_get_userbyid(acl.grantor),
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable,
    format(
      'grant %s on function %s to %s%s;',
      acl.privilege_type,
      procedure.oid::regprocedure,
      case when acl.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
), schema_acl as (
  select
    'schema'::text,
    namespace.nspname,
    pg_get_userbyid(acl.grantor),
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable,
    format(
      'grant %s on schema %I to %s%s;',
      acl.privilege_type,
      namespace.nspname,
      case when acl.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from pg_catalog.pg_namespace namespace
  cross join lateral pg_catalog.aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where namespace.nspname = 'public'
), default_acl as (
  select
    'default_acl'::text,
    format('%s:%s:%s', owner_role.rolname, coalesce(namespace.nspname, '*'), defaults.defaclobjtype),
    owner_role.rolname,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    acl.privilege_type,
    acl.is_grantable,
    format(
      'alter default privileges for role %I%s grant %s on %s to %s%s;',
      owner_role.rolname,
      case when namespace.nspname is null then '' else format(' in schema %I', namespace.nspname) end,
      acl.privilege_type,
      case defaults.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' end,
      case when acl.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(acl.grantee)) end,
      case when acl.is_grantable then ' with grant option' else '' end
    )
  from pg_catalog.pg_default_acl defaults
  join pg_catalog.pg_roles owner_role on owner_role.oid = defaults.defaclrole
  left join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
  cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
  join role_scope scoped_role
    on scoped_role.role_name = case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end
  where owner_role.rolname = 'postgres'
    and coalesce(namespace.nspname, 'public') = 'public'
    and defaults.defaclobjtype in ('r', 'S', 'f')
), default_acl_all_entries as (
  select
    slot.object_name,
    pg_get_userbyid(acl.grantor) as grantor,
    case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
    acl.privilege_type,
    acl.is_grantable,
    encode(
      digest(
        convert_to(
          concat_ws(
            chr(31),
            pg_get_userbyid(acl.grantor),
            case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
            acl.privilege_type,
            acl.is_grantable::text
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as entry_fingerprint
  from default_acl_slots slot
  cross join lateral pg_catalog.aclexplode(slot.defaclacl) acl
), default_acl_states as (
  select
    slot.object_name,
    slot.row_present,
    count(entry.object_name) as acl_entry_count,
    encode(
      digest(
        convert_to(
          coalesce(
            string_agg(
              entry.entry_fingerprint,
              '' order by entry.grantor, entry.grantee, entry.privilege_type, entry.is_grantable
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as acl_entries_sha256,
    coalesce(
      jsonb_agg(
        to_jsonb(entry) - 'object_name'
        order by entry.grantor, entry.grantee, entry.privilege_type, entry.is_grantable
      ) filter (where entry.object_name is not null),
      '[]'::jsonb
    ) as acl_entries
  from default_acl_slots slot
  left join default_acl_all_entries entry on entry.object_name = slot.object_name
  group by slot.object_name, slot.row_present
), fingerprinted_default_acl_states as (
  select
    default_acl_states.*,
    encode(
      digest(
        convert_to(
          concat_ws(
            chr(31),
            object_name,
            row_present::text,
            acl_entry_count::text,
            acl_entries_sha256
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as state_fingerprint
  from default_acl_states
), recovery_rows as (
  select * from table_acl
  union all select * from sequence_acl
  union all select * from function_acl
  union all select * from schema_acl
  union all select * from default_acl
), fingerprinted_rows as (
  select
    recovery_rows.*,
    encode(
      digest(
        convert_to(
          concat_ws(chr(31), surface, object_name, grantor, grantee, privilege_type, is_grantable::text, recovery_sql),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as entry_fingerprint
  from recovery_rows
), fingerprinted_objects as (
  select
    object_inventory.*,
    encode(
      digest(
        convert_to(concat_ws(chr(31), surface, object_name, owner_name), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) as object_fingerprint
  from object_inventory
), ordered_rows as (
  select * from fingerprinted_rows
  order by surface, object_name, grantee, privilege_type, grantor, is_grantable
), ordered_objects as (
  select * from fingerprinted_objects
  order by surface, object_name, owner_name
), ordered_default_acl_states as (
  select * from fingerprinted_default_acl_states
  order by object_name
)
select jsonb_build_object(
  'snapshot_version', 3,
  'integrity_algorithm', 'sha256-row-fingerprints-v2',
  'captured_at', transaction_timestamp(),
  'database', current_database(),
  'current_user', current_user,
  'entry_count', (select count(*) from ordered_rows),
  'entries_by_surface', (
    select coalesce(jsonb_object_agg(surface, row_count order by surface), '{}'::jsonb)
    from (select surface, count(*) as row_count from ordered_rows group by surface) counts
  ),
  'entries_sha256', (
    select encode(
      digest(convert_to(coalesce(string_agg(entry_fingerprint, '' order by surface, object_name, grantee, privilege_type, grantor, is_grantable), ''), 'UTF8'), 'sha256'),
      'hex'
    )
    from ordered_rows
  ),
  'object_count', (select count(*) from ordered_objects),
  'objects_by_surface', (
    select coalesce(jsonb_object_agg(surface, row_count order by surface), '{}'::jsonb)
    from (select surface, count(*) as row_count from ordered_objects group by surface) counts
  ),
  'objects_sha256', (
    select encode(
      digest(convert_to(coalesce(string_agg(object_fingerprint, '' order by surface, object_name, owner_name), ''), 'UTF8'), 'sha256'),
      'hex'
    )
    from ordered_objects
  ),
  'default_acl_state_count', (select count(*) from ordered_default_acl_states),
  'default_acl_states_sha256', (
    select encode(
      digest(
        convert_to(
          coalesce(string_agg(state_fingerprint, '' order by object_name), ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from ordered_default_acl_states
  ),
  'default_acl_states', coalesce(
    (
      select jsonb_agg(to_jsonb(ordered_default_acl_states) order by object_name)
      from ordered_default_acl_states
    ),
    '[]'::jsonb
  ),
  'sequence_acl_exception_count', (select count(*) from sequence_acl),
  'sequence_acl_exceptions', coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'object_name', object_name,
          'grantee', grantee,
          'privilege_type', privilege_type,
          'is_grantable', is_grantable
        ) order by object_name, grantee, privilege_type
      )
      from sequence_acl
    ),
    '[]'::jsonb
  ),
  'entries', coalesce(
    (
      select jsonb_agg(
        to_jsonb(ordered_rows)
        order by surface, object_name, grantee, privilege_type, grantor, is_grantable
      )
      from ordered_rows
    ),
    '[]'::jsonb
  ),
  'objects', coalesce(
    (
      select jsonb_agg(
        to_jsonb(ordered_objects)
        order by surface, object_name, owner_name
      )
      from ordered_objects
    ),
    '[]'::jsonb
  )
) as sec_dev_01_recovery_snapshot;

rollback;
