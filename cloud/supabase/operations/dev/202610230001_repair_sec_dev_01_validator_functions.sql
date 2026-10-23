-- DEV-only SEC-DEV-01 repair for the two confirmed validator-function drifts.
-- Never add this file to migrations and never run it in PROD.
-- Preconditions intentionally match the diagnosed DEV drift, so a clean/canonical
-- environment stops before the first change.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_target record;
  v_index record;
  v_actual_columns text[];
  v_actual_predicate text;
  v_actual_has_user_id boolean;
  v_function_oid oid;
  v_function record;
  v_actual_body text;
  v_expected_body text;
  v_config text[];
  v_public_execute boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'SEC_DEV_01_PRECONDITION: expected current_user postgres, got %', current_user;
  end if;

  if (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'postgres')
  ) <> 5 then
    raise exception 'SEC_DEV_01_PRECONDITION: expected Supabase roles are missing';
  end if;

  for v_target in
    select *
    from (values
      ('external_contact_snapshots'::text, true),
      ('contact_emails', true),
      ('contact_phones', true),
      ('headhunter_companies', false),
      ('headhunter_company_domains', false)
    ) as manifest(table_name, expected_user_id)
  loop
    if pg_catalog.to_regclass(pg_catalog.format('public.%I', v_target.table_name)) is null then
      raise exception 'SEC_DEV_01_PRECONDITION: missing table public.%', v_target.table_name;
    end if;

    select exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = pg_catalog.to_regclass(
              pg_catalog.format('public.%I', v_target.table_name)
            )
        and attribute.attname = 'user_id'
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) into v_actual_has_user_id;

    if v_actual_has_user_id is distinct from v_target.expected_user_id then
      raise exception
        'SEC_DEV_01_PRECONDITION: user_id shape mismatch on public.% (expected %, got %)',
        v_target.table_name,
        v_target.expected_user_id,
        v_actual_has_user_id;
    end if;
  end loop;

  for v_target in
    select *
    from (values
      (
        'uq_external_contact_snapshots_provider_external'::text,
        'present'::text,
        'external_contact_snapshots'::text,
        array['user_id', 'provider', 'external_id']::text[],
        null::text
      ),
      (
        'uq_contact_emails_contact_normalized',
        'present',
        'contact_emails',
        array['user_id', 'contact_id', 'normalized_email']::text[],
        null
      ),
      (
        'uq_contact_phones_contact_normalized',
        'present',
        'contact_phones',
        array['user_id', 'contact_id', 'normalized_phone']::text[],
        null
      ),
      (
        'uq_contact_emails_user_normalized',
        'absent',
        'contact_emails',
        null::text[],
        null
      ),
      (
        'uq_contact_phones_user_normalized',
        'absent',
        'contact_phones',
        null::text[],
        null
      ),
      (
        'uq_headhunter_companies_name_active',
        'present',
        'headhunter_companies',
        array['normalized_name']::text[],
        '(is_active = true)'
      ),
      (
        'uq_headhunter_company_domains_domain_active',
        'present',
        'headhunter_company_domains',
        array['normalized_domain']::text[],
        '(is_active = true)'
      ),
      (
        'uq_headhunter_companies_user_name_active',
        'absent',
        'headhunter_companies',
        null::text[],
        null
      ),
      (
        'uq_headhunter_company_domains_user_domain_active',
        'absent',
        'headhunter_company_domains',
        null::text[],
        null
      )
    ) as manifest(index_name, expected_state, expected_table, expected_columns, expected_predicate)
  loop
    select
      index_class.oid,
      index_definition.indrelid,
      index_definition.indisunique,
      index_definition.indisvalid,
      index_definition.indisready,
      index_definition.indislive,
      index_definition.indnkeyatts
    into v_index
    from pg_catalog.pg_class index_class
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_class.relnamespace
    join pg_catalog.pg_index index_definition
      on index_definition.indexrelid = index_class.oid
    where index_namespace.nspname = 'public'
      and index_class.relname = v_target.index_name
      and index_class.relkind in ('i', 'I');

    if v_target.expected_state = 'absent' then
      if found then
        raise exception 'SEC_DEV_01_PRECONDITION: legacy index public.% still exists', v_target.index_name;
      end if;
      continue;
    end if;

    if not found then
      raise exception 'SEC_DEV_01_PRECONDITION: missing index public.%', v_target.index_name;
    end if;

    select array_agg(
      pg_catalog.pg_get_indexdef(v_index.oid, key_position, true)
      order by key_position
    )
    into v_actual_columns
    from generate_series(1, v_index.indnkeyatts) key_position;

    select pg_catalog.pg_get_expr(index_definition.indpred, index_definition.indrelid)
    into v_actual_predicate
    from pg_catalog.pg_index index_definition
    where index_definition.indexrelid = v_index.oid;

    if v_index.indrelid is distinct from pg_catalog.to_regclass(
         pg_catalog.format('public.%I', v_target.expected_table)
       )
       or not v_index.indisunique
       or not v_index.indisvalid
       or not v_index.indisready
       or not v_index.indislive
       or v_actual_columns is distinct from v_target.expected_columns
       or coalesce(pg_catalog.regexp_replace(v_actual_predicate, '[[:space:]]+', '', 'g'), '')
          <> coalesce(pg_catalog.regexp_replace(v_target.expected_predicate, '[[:space:]]+', '', 'g'), '') then
      raise exception 'SEC_DEV_01_PRECONDITION: index contract mismatch on public.%', v_target.index_name;
    end if;
  end loop;

  for v_target in
    select *
    from (values
      (
        'public.validate_contact_sync_storage_v0_1()'::text,
        true,
        $contact$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.external_contact_snapshots') is null then
    missing_or_stale := array_append(missing_or_stale, 'external_contact_snapshots table');
  end if;

  if to_regclass('public.uq_external_contact_snapshots_provider_external') is null then
    missing_or_stale := array_append(missing_or_stale, 'external contact snapshot unique index');
  end if;

  if to_regclass('public.uq_contact_emails_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact email per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_phones_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact phone per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_emails_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global email unique index still exists');
  end if;

  if to_regclass('public.uq_contact_phones_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global phone unique index still exists');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'CONTACT_SYNC_STORAGE_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$contact$::text
      ),
      (
        'public.validate_headhunter_company_master_v0_1()'::text,
        false,
        $headhunter_legacy$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_user_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_user_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$headhunter_legacy$::text
      )
    ) as manifest(signature, authenticated_execute, expected_body)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_target.signature);
    if v_function_oid is null then
      raise exception 'SEC_DEV_01_PRECONDITION: missing function %', v_target.signature;
    end if;

    select
      procedure.prokind,
      procedure.proowner,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proconfig,
      procedure.prosrc,
      language_definition.lanname,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
      pg_catalog.pg_get_function_result(procedure.oid) as result_type
    into v_function
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language_definition
      on language_definition.oid = procedure.prolang
    where procedure.oid = v_function_oid;

    v_actual_body := replace(
      replace(v_function.prosrc, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    );
    v_expected_body := replace(
      replace(v_target.expected_body, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    );
    select coalesce(
      array_agg(pg_catalog.regexp_replace(config, '[[:space:]]+', '', 'g') order by config),
      array[]::text[]
    )
    into v_config
    from unnest(coalesce(v_function.proconfig, array[]::text[])) config;

    if v_function.prokind <> 'f'
       or v_function.owner_name <> 'postgres'
       or v_function.lanname <> 'plpgsql'
       or not v_function.prosecdef
       or v_function.provolatile <> 'v'
       or v_function.result_type <> 'jsonb'
       or v_config is distinct from array['search_path=public,pg_temp']::text[]
       or v_actual_body is distinct from v_expected_body then
      raise exception 'SEC_DEV_01_PRECONDITION: function contract mismatch on %', v_target.signature;
    end if;

    select exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          (select procedure.proacl from pg_catalog.pg_proc procedure where procedure.oid = v_function_oid),
          pg_catalog.acldefault('f', v_function.proowner)
        )
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_public_execute;

    if v_public_execute
       or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('supabase_auth_admin', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
          is distinct from v_target.authenticated_execute
       or not pg_catalog.has_function_privilege('postgres', v_function_oid, 'EXECUTE') then
      raise exception 'SEC_DEV_01_PRECONDITION: EXECUTE contract mismatch on %', v_target.signature;
    end if;
  end loop;
end;
$preconditions$;

create temporary table sec_dev_01_validator_function_snapshot
on commit drop
as
select
  procedure.oid,
  procedure.oid::regprocedure::text as signature,
  procedure.proowner,
  procedure.proacl
from pg_catalog.pg_proc procedure
where procedure.oid in (
  'public.validate_contact_sync_storage_v0_1()'::regprocedure,
  'public.validate_headhunter_company_master_v0_1()'::regprocedure
);

alter function public.validate_contact_sync_storage_v0_1()
  set search_path = '';

create or replace function public.validate_headhunter_company_master_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

do $postconditions$
declare
  v_target record;
  v_function_oid oid;
  v_function record;
  v_snapshot record;
  v_actual_body text;
  v_expected_body text;
  v_config text[];
  v_public_execute boolean;
  v_result jsonb;
begin
  for v_target in
    select *
    from (values
      (
        'public.validate_contact_sync_storage_v0_1()'::text,
        true,
        $contact$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.external_contact_snapshots') is null then
    missing_or_stale := array_append(missing_or_stale, 'external_contact_snapshots table');
  end if;

  if to_regclass('public.uq_external_contact_snapshots_provider_external') is null then
    missing_or_stale := array_append(missing_or_stale, 'external contact snapshot unique index');
  end if;

  if to_regclass('public.uq_contact_emails_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact email per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_phones_contact_normalized') is null then
    missing_or_stale := array_append(missing_or_stale, 'contact phone per-contact unique index');
  end if;

  if to_regclass('public.uq_contact_emails_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global email unique index still exists');
  end if;

  if to_regclass('public.uq_contact_phones_user_normalized') is not null then
    missing_or_stale := array_append(missing_or_stale, 'old global phone unique index still exists');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'CONTACT_SYNC_STORAGE_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$contact$::text
      ),
      (
        'public.validate_headhunter_company_master_v0_1()'::text,
        false,
        $headhunter$
declare
  missing_or_stale text[] := array[]::text[];
begin
  if to_regclass('public.headhunter_companies') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_companies table');
  end if;

  if to_regclass('public.headhunter_company_domains') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter_company_domains table');
  end if;

  if to_regclass('public.uq_headhunter_companies_name_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company name unique index');
  end if;

  if to_regclass('public.uq_headhunter_company_domains_domain_active') is null then
    missing_or_stale := array_append(missing_or_stale, 'headhunter company domain unique index');
  end if;

  if array_length(missing_or_stale, 1) is not null then
    raise exception 'HEADHUNTER_COMPANY_MASTER_NOT_READY: %', array_to_string(missing_or_stale, ', ');
  end if;

  return jsonb_build_object('ok', true);
end;
$headhunter$::text
      )
    ) as manifest(signature, authenticated_execute, expected_body)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_target.signature);
    select
      procedure.oid,
      procedure.proowner,
      procedure.proacl,
      procedure.prokind,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proconfig,
      procedure.prosrc,
      language_definition.lanname,
      pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
      pg_catalog.pg_get_function_result(procedure.oid) as result_type
    into v_function
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language_definition
      on language_definition.oid = procedure.prolang
    where procedure.oid = v_function_oid;

    select *
    into v_snapshot
    from sec_dev_01_validator_function_snapshot snapshot
    where snapshot.oid = v_function_oid;

    v_actual_body := replace(
      replace(v_function.prosrc, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    );
    v_expected_body := replace(
      replace(v_target.expected_body, chr(13) || chr(10), chr(10)),
      chr(13),
      chr(10)
    );
    select coalesce(
      array_agg(pg_catalog.regexp_replace(config, '[[:space:]]+', '', 'g') order by config),
      array[]::text[]
    )
    into v_config
    from unnest(coalesce(v_function.proconfig, array[]::text[])) config;

    if v_function_oid is null
       or v_function.oid is distinct from v_snapshot.oid
       or v_function.proowner is distinct from v_snapshot.proowner
       or v_function.proacl is distinct from v_snapshot.proacl
       or v_function.prokind <> 'f'
       or v_function.owner_name <> 'postgres'
       or v_function.lanname <> 'plpgsql'
       or not v_function.prosecdef
       or v_function.provolatile <> 'v'
       or v_function.result_type <> 'jsonb'
       or cardinality(v_config) <> 1
       or v_config[1] not in ('search_path=', 'search_path=""')
       or v_actual_body is distinct from v_expected_body then
      raise exception 'SEC_DEV_01_POSTCONDITION: function contract mismatch on %', v_target.signature;
    end if;

    select exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(v_function.proacl, pg_catalog.acldefault('f', v_function.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_public_execute;

    if v_public_execute
       or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('supabase_auth_admin', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
          is distinct from v_target.authenticated_execute
       or not pg_catalog.has_function_privilege('postgres', v_function_oid, 'EXECUTE') then
      raise exception 'SEC_DEV_01_POSTCONDITION: EXECUTE contract mismatch on %', v_target.signature;
    end if;

    execute pg_catalog.format('select %s', v_target.signature) into v_result;
    if v_result is distinct from '{"ok": true}'::jsonb then
      raise exception 'SEC_DEV_01_POSTCONDITION: validator returned unexpected result for %', v_target.signature;
    end if;
  end loop;
end;
$postconditions$;

select
  procedure.oid::regprocedure::text as function,
  pg_catalog.pg_get_userbyid(procedure.proowner) as owner,
  procedure.prosecdef as security_definer,
  procedure.proconfig,
  encode(
    extensions.digest(
      convert_to(
        replace(replace(procedure.prosrc, chr(13) || chr(10), chr(10)), chr(13), chr(10)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) as normalized_body_sha256
from pg_catalog.pg_proc procedure
where procedure.oid in (
  'public.validate_contact_sync_storage_v0_1()'::regprocedure,
  'public.validate_headhunter_company_master_v0_1()'::regprocedure
)
order by function;

commit;
