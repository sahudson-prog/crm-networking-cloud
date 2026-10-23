-- DEV-only SEC-DEV-01 recovery for the two validator functions repaired by
-- 202610230001. Never add this file to migrations and never run it in PROD.
-- This operation deliberately restores the diagnosed prior DEV state, including
-- both non-empty search_path settings and the two legacy headhunter index names.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_target record;
  v_function_oid oid;
  v_function record;
  v_actual_body text;
  v_expected_body text;
  v_config text[];
  v_public_execute boolean;
  v_result jsonb;
begin
  if current_user <> 'postgres' then
    raise exception 'SEC_DEV_01_RECOVERY_PRECONDITION: expected current_user postgres, got %', current_user;
  end if;

  if (
    select count(*)
    from pg_catalog.pg_roles
    where rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'postgres')
  ) <> 5 then
    raise exception 'SEC_DEV_01_RECOVERY_PRECONDITION: expected Supabase roles are missing';
  end if;

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
    if v_function_oid is null then
      raise exception 'SEC_DEV_01_RECOVERY_PRECONDITION: missing function %', v_target.signature;
    end if;

    select
      procedure.prokind,
      procedure.proowner,
      procedure.proacl,
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

    select exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(v_function.proacl, pg_catalog.acldefault('f', v_function.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) into v_public_execute;

    if v_function.prokind <> 'f'
       or v_function.owner_name <> 'postgres'
       or v_function.lanname <> 'plpgsql'
       or not v_function.prosecdef
       or v_function.provolatile <> 'v'
       or v_function.result_type <> 'jsonb'
       or cardinality(v_config) <> 1
       or v_config[1] not in ('search_path=', 'search_path=""')
       or v_actual_body is distinct from v_expected_body
       or v_public_execute
       or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('supabase_auth_admin', v_function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
          is distinct from v_target.authenticated_execute
       or not pg_catalog.has_function_privilege('postgres', v_function_oid, 'EXECUTE') then
      raise exception 'SEC_DEV_01_RECOVERY_PRECONDITION: repaired contract mismatch on %', v_target.signature;
    end if;

    execute pg_catalog.format('select %s', v_target.signature) into v_result;
    if v_result is distinct from '{"ok": true}'::jsonb then
      raise exception 'SEC_DEV_01_RECOVERY_PRECONDITION: validator returned unexpected result for %', v_target.signature;
    end if;
  end loop;
end;
$preconditions$;

create temporary table sec_dev_01_validator_function_recovery_snapshot
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
  set search_path = public, pg_temp;

create or replace function public.validate_headhunter_company_master_v0_1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
    from sec_dev_01_validator_function_recovery_snapshot snapshot
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
       or v_config is distinct from array['search_path=public,pg_temp']::text[]
       or v_actual_body is distinct from v_expected_body then
      raise exception 'SEC_DEV_01_RECOVERY_POSTCONDITION: function contract mismatch on %', v_target.signature;
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
      raise exception 'SEC_DEV_01_RECOVERY_POSTCONDITION: EXECUTE contract mismatch on %', v_target.signature;
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
