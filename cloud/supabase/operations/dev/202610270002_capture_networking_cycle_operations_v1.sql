-- OBJ-02 R2-B DEV: capture the R2-A contract immediately before installation.
-- Catalog definitions and aggregate counts only; no user IDs, contact data or tokens.
-- This is diagnostic evidence, not a row-level backup or a restore script.
begin transaction isolation level repeatable read read only;

with relation_manifest(name) as (
  values ('networking_cycles'), ('objectives'), ('contact_objective_assignments'),
    ('contacts'), ('todos'), ('contact_networking_transitions')
), function_manifest(signature) as (
  values
    ('public.app_access_status_for_user(uuid)'),
    ('public.validate_networking_cycle_v1()'),
    ('public.assign_objective_cycle_v1()'),
    ('public.networking_cycle_for_event_v1(uuid,timestamptz)'),
    ('public.capture_contact_networking_transition_v1()'),
    ('public.reset_current_user_app_data_v0_1(text)'),
    ('public.merge_contacts_deep(uuid,uuid[],jsonb,text)'),
    ('public.submit_contact_request_v1(text,text,text,text,text,uuid)'),
    ('public.finalize_google_connected_account_verified(uuid,text,text[])')
), relation_state as (
  select manifest.name, relation.oid,
    jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(relation.relowner),
      'rls_enabled', relation.relrowsecurity,
      'rls_forced', relation.relforcerowsecurity,
      'raw_acl', relation.relacl::text,
      'authenticated_privileges', jsonb_build_object(
        'select', pg_catalog.has_table_privilege('authenticated', relation.oid, 'SELECT'),
        'insert', pg_catalog.has_table_privilege('authenticated', relation.oid, 'INSERT'),
        'update', pg_catalog.has_table_privilege('authenticated', relation.oid, 'UPDATE'),
        'delete', pg_catalog.has_table_privilege('authenticated', relation.oid, 'DELETE')),
      'service_role_privileges', jsonb_build_object(
        'select', pg_catalog.has_table_privilege('service_role', relation.oid, 'SELECT'),
        'insert', pg_catalog.has_table_privilege('service_role', relation.oid, 'INSERT'),
        'update', pg_catalog.has_table_privilege('service_role', relation.oid, 'UPDATE'),
        'delete', pg_catalog.has_table_privilege('service_role', relation.oid, 'DELETE')),
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', attribute.attname,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'not_null', attribute.attnotnull,
          'default', pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
          'identity', attribute.attidentity,
          'generated', attribute.attgenerated
        ) order by attribute.attnum)
        from pg_catalog.pg_attribute attribute
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid = attribute.attrelid and default_row.adnum = attribute.attnum
        where attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
      ), '[]'::jsonb),
      'constraints', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', constraint_row.conname,
          'type', constraint_row.contype,
          'validated', constraint_row.convalidated,
          'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
        ) order by constraint_row.conname)
        from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid = relation.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        select jsonb_agg(jsonb_build_object('name', index_row.indexname,
          'definition', index_row.indexdef) order by index_row.indexname)
        from pg_catalog.pg_indexes index_row
        where index_row.schemaname = 'public' and index_row.tablename = manifest.name
      ), '[]'::jsonb),
      'triggers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', trigger_row.tgname,
          'enabled', trigger_row.tgenabled,
          'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
        ) order by trigger_row.tgname)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid = relation.oid and not trigger_row.tgisinternal
      ), '[]'::jsonb),
      'policies', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', policy_row.policyname,
          'command', policy_row.cmd,
          'roles', policy_row.roles,
          'using', policy_row.qual,
          'with_check', policy_row.with_check
        ) order by policy_row.policyname)
        from pg_catalog.pg_policies policy_row
        where policy_row.schemaname = 'public' and policy_row.tablename = manifest.name
      ), '[]'::jsonb)
    ) as contract
  from relation_manifest manifest
  left join pg_catalog.pg_namespace namespace on namespace.nspname = 'public'
  left join pg_catalog.pg_class relation
    on relation.relnamespace = namespace.oid and relation.relname = manifest.name
), function_state as (
  select manifest.signature, procedure.oid,
    jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile,
      'configuration', procedure.proconfig,
      'raw_acl', procedure.proacl::text,
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
      'service_role_execute', pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE'),
      'definition', case when procedure.oid is null then null
        else pg_catalog.pg_get_functiondef(procedure.oid) end,
      'normalized_body_md5', pg_catalog.md5(pg_catalog.replace(
        pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
        pg_catalog.chr(13), pg_catalog.chr(10)))
    ) as contract
  from function_manifest manifest
  left join pg_catalog.pg_proc procedure
    on procedure.oid = pg_catalog.to_regprocedure(manifest.signature)
), aggregate_data as (
  select jsonb_build_object(
    'cycles_total', (select count(*) from public.networking_cycles),
    'cycles_by_origin_status', coalesce((select jsonb_agg(jsonb_build_object(
      'origin', origin, 'status', status, 'rows', rows) order by origin, status)
      from (select origin, status, count(*) as rows from public.networking_cycles
        group by origin, status) grouped), '[]'::jsonb),
    'cycles_unknown_start', (select count(*) from public.networking_cycles where started_on is null),
    'cycles_closed', (select count(*) from public.networking_cycles where status = 'closed'),
    'objectives_total', (select count(*) from public.objectives),
    'objectives_active', (select count(*) from public.objectives where is_active),
    'objectives_without_cycle', (select count(*) from public.objectives where cycle_id is null),
    'objectives_cycle_owner_mismatch', (select count(*) from public.objectives objective
      left join public.networking_cycles cycle on cycle.id = objective.cycle_id
      where objective.cycle_id is not null and
        (cycle.id is null or cycle.user_id is distinct from objective.user_id)),
    'assignments_total', (select count(*) from public.contact_objective_assignments),
    'assignments_owner_mismatch', (select count(*) from public.contact_objective_assignments assignment
      left join public.objectives objective on objective.id = assignment.objective_id
      left join public.contacts contact on contact.id = assignment.contact_id
      where objective.id is null or contact.id is null
        or objective.user_id is distinct from assignment.user_id
        or contact.user_id is distinct from assignment.user_id),
    'contacts_total', (select count(*) from public.contacts),
    'contacts_active', (select count(*) from public.contacts where is_active),
    'contacts_active_focus', (select count(*) from public.contacts where is_active and networking_focus),
    'contacts_by_status', coalesce((select jsonb_agg(jsonb_build_object(
      'status', networking_status, 'rows', rows) order by networking_status)
      from (select networking_status, count(*) as rows from public.contacts
        group by networking_status) grouped), '[]'::jsonb),
    'active_networking_todos', (select count(*) from public.todos
      where todo_type = 'NETWORKING_STATUS_CHANGE' and status = 'active'),
    'contact_networking_transitions', (select count(*) from public.contact_networking_transitions),
    'contact_transitions_without_cycle', (select count(*) from public.contact_networking_transitions
      where cycle_id is null)
  ) as value
), payload as (
  select jsonb_build_object(
    'scope', 'OBJ-02-R2-B-before-202610270002',
    'relations', (select jsonb_object_agg(name, contract order by name) from relation_state),
    'functions', (select jsonb_object_agg(signature, contract order by signature) from function_state),
    'aggregate_data', aggregate_data.value
  ) as value from aggregate_data
), completeness as (
  select
    coalesce((select jsonb_agg(name order by name) from relation_state where oid is null), '[]'::jsonb)
      as missing_relations,
    coalesce((select jsonb_agg(signature order by signature) from function_state where oid is null), '[]'::jsonb)
      as missing_functions,
    pg_catalog.to_regclass('public.r2b_rollout_gate') is null
      and pg_catalog.to_regclass('public.networking_cycle_closed_contacts') is null
      and pg_catalog.to_regprocedure(
        'public.start_networking_cycle_r2b(uuid,text,timestamptz,text,uuid,text,boolean,boolean)') is null
      as before_r2b
)
select jsonb_build_object(
  'capture_state', case when completeness.before_r2b
    and completeness.missing_relations = '[]'::jsonb
    and completeness.missing_functions = '[]'::jsonb
    and (aggregate_data.value ->> 'cycles_closed')::bigint = 0
    and (aggregate_data.value ->> 'objectives_without_cycle')::bigint = 0
    and (aggregate_data.value ->> 'objectives_cycle_owner_mismatch')::bigint = 0
    and (aggregate_data.value ->> 'assignments_owner_mismatch')::bigint = 0
    then 'complete' else 'incompatible' end,
  'before_r2b', completeness.before_r2b,
  'missing_relations', completeness.missing_relations,
  'missing_functions', completeness.missing_functions,
  'snapshot_version', 1,
  'integrity_algorithm', 'md5-jsonb-text-v1',
  'payload_bytes', pg_catalog.octet_length(pg_catalog.convert_to(payload.value::text, 'UTF8')),
  'payload_md5', pg_catalog.md5(payload.value::text),
  'payload', payload.value
) as networking_cycle_operations_v1_capture
from payload cross join completeness cross join aggregate_data;

rollback;
