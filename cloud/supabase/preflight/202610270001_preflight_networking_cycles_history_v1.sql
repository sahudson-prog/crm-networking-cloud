-- Read-only preflight for OBJ-02 R2-A. Returns aggregate diagnostics only.

begin transaction read only;

with target_relations(name) as (
  values
    ('networking_cycles'),
    ('professional_situation_transitions'),
    ('contact_networking_transitions')
), target_functions(signature) as (
  values
    ('public.validate_networking_cycle_v1()'),
    ('public.active_networking_cycle_id_for_user_v1(uuid)'),
    ('public.networking_cycle_for_event_v1(uuid,timestamptz)'),
    ('public.assign_objective_cycle_v1()'),
    ('public.capture_professional_situation_transition_v1()'),
    ('public.capture_contact_networking_transition_v1()')
), diagnostics as (
  select
    (select count(*) from target_relations where to_regclass('public.' || name) is not null) as existing_relation_count,
    (select count(*) from target_functions where to_regprocedure(signature) is not null) as existing_function_count,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'objectives' and column_name = 'cycle_id'
    ) as objective_cycle_column_exists,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'interactions' and column_name = 'cycle_id'
    ) as unexpected_interaction_cycle_column,
    to_regclass('public.profiles') is not null
      and to_regclass('public.contacts') is not null
      and to_regclass('public.objectives') is not null
      and to_regclass('public.interactions') is not null
      and to_regprocedure('public.current_user_has_app_access()') is not null
      and to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name = 'professional_situation_code' and data_type = 'text'
      ) as prerequisites_present,
    (select count(*) from public.objectives) as existing_objective_count,
    (select count(distinct user_id) from public.objectives) as users_with_objectives,
    (select count(*) from public.profiles where professional_situation_code is not null) as profiles_with_situation,
    (select count(*) from public.contacts) as existing_contact_count,
    (select count(*) from public.interactions) as existing_interaction_count,
    (
      select pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
          pg_catalog.chr(13), pg_catalog.chr(10)
        )
      )
      from pg_catalog.pg_proc procedure
      where procedure.oid = to_regprocedure('public.reset_current_user_app_data_v0_1(text)')
    ) as reset_body_md5,
    (
      select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        pg_catalog.replace(
          pg_catalog.replace(procedure.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
          pg_catalog.chr(13), pg_catalog.chr(10)
        ), 'UTF8'
      ), 'sha256'), 'hex')
      from pg_catalog.pg_proc procedure
      where procedure.oid = to_regprocedure('public.reset_current_user_app_data_v0_1(text)')
    ) as reset_body_sha256,
    (
      select procedure.prosecdef
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and coalesce(pg_catalog.array_length(procedure.proconfig, 1), 0) = 1
        and procedure.proconfig[1] in ('search_path=', 'search_path=""')
        and procedure.proretset
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
        )
      from pg_catalog.pg_proc procedure
      where procedure.oid = to_regprocedure('public.reset_current_user_app_data_v0_1(text)')
    ) as reset_security_matches
)
select jsonb_build_object(
  'installation_state', case
    when not prerequisites_present then 'incompatible'
    when existing_relation_count = 0 and existing_function_count = 0
      and not objective_cycle_column_exists and not unexpected_interaction_cycle_column
      and reset_security_matches
      and reset_body_sha256 in (
        '2e2a05539d97c80704f7cb4c2c05f36bdc3cccbea2af37e5558aa60b8f988799',
        '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d'
      ) then 'clean_install'
    else 'incompatible'
  end,
  'legacy_population', jsonb_build_object(
    'objectives', existing_objective_count,
    'users_with_objectives', users_with_objectives,
    'profiles_with_professional_situation', profiles_with_situation,
    'contacts', existing_contact_count,
    'interactions', existing_interaction_count
  ),
  'target_objects', jsonb_build_object(
    'existing_relations', existing_relation_count,
    'existing_functions', existing_function_count,
    'objectives_cycle_id_exists', objective_cycle_column_exists,
    'interactions_cycle_id_exists', unexpected_interaction_cycle_column
  ),
  'reset_body_md5', reset_body_md5,
  'reset_body_sha256', reset_body_sha256,
  'reset_body_variant', case
    when reset_body_sha256 = '2e2a05539d97c80704f7cb4c2c05f36bdc3cccbea2af37e5558aa60b8f988799'
      then 'canonical_migration'
    when reset_body_sha256 = '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d'
      then 'standalone_without_sync_change_suppressions'
    else 'unknown'
  end,
  'stop_reasons', jsonb_strip_nulls(jsonb_build_object(
    'missing_prerequisites', case when not prerequisites_present then true end,
    'preexisting_r2a_relations', case when existing_relation_count > 0 then existing_relation_count end,
    'preexisting_r2a_functions', case when existing_function_count > 0 then existing_function_count end,
    'preexisting_objectives_cycle_id', case when objective_cycle_column_exists then true end,
    'unexpected_interactions_cycle_id', case when unexpected_interaction_cycle_column then true end,
    'unexpected_reset_contract', case
      when (reset_body_sha256 is distinct from '2e2a05539d97c80704f7cb4c2c05f36bdc3cccbea2af37e5558aa60b8f988799'
        and reset_body_sha256 is distinct from '63b1d83b83d56b0b3717af1059c82672e358ee265ebcd08b5b278d0be7df3a1d')
        or reset_security_matches is distinct from true then true
    end
  ))
) as networking_cycles_history_v1_preflight
from diagnostics;

rollback;
