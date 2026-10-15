-- Verifies that V1.1 is current while preserving immutable V1.0 acceptance history.
-- Synthetic fixtures are fully rolled back.

begin;

do $verify_structure$
declare
  v_status regprocedure := pg_catalog.to_regprocedure('public.current_user_legal_acceptance_status_v1()');
  v_record regprocedure := pg_catalog.to_regprocedure('public.record_current_user_legal_acceptance_v1()');
  v_function regprocedure;
  v_definition text;
  v_role text;
begin
  foreach v_function in array array[v_status, v_record] loop
    if v_function is null or not exists (
      select 1
      from pg_catalog.pg_proc procedure
      where procedure.oid = v_function
        and procedure.pronargs = 0
        and procedure.prosecdef
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and exists (
          select 1
          from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'V1.1 legal acceptance RPC % has an unsafe execution contract', v_function;
    end if;

    if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated cannot execute V1.1 legal acceptance RPC %', v_function;
    end if;
    foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception '% has unexpected V1.1 legal acceptance RPC access', v_role;
      end if;
    end loop;
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) acl
      where procedure.oid = v_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute V1.1 legal acceptance RPC %', v_function;
    end if;

    select pg_catalog.pg_get_functiondef(v_function) into v_definition;
    if v_definition not like '%auth.uid()%'
      or v_definition not like '%public.current_user_has_app_access()%'
      or v_definition not like '%73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43%'
      or v_definition not like '%653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f%'
      or v_definition not like '%1.1%' then
      raise exception 'Legal acceptance RPC % does not bind the exact V1.1 contract', v_function;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(v_record) into v_definition;
  if pg_catalog.upper(v_definition) not like '%ON CONFLICT ON CONSTRAINT UQ_LEGAL_ACCEPTANCES_USER_CONTRACT DO NOTHING%'
    or pg_catalog.upper(v_definition) like '%UPDATE PUBLIC.LEGAL_ACCEPTANCES%'
    or pg_catalog.upper(v_definition) like '%DELETE FROM PUBLIC.LEGAL_ACCEPTANCES%' then
    raise exception 'V1.1 legal acceptance write RPC is not idempotent and append-only';
  end if;
end;
$verify_structure$;

do $verify_behavior$
declare
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_email text := 'legal-v1-1-' || pg_catalog.gen_random_uuid()::text || '@example.invalid';
  v_status record;
  v_v1_accepted_at timestamptz := '2026-10-15 10:00:00+00'::timestamptz;
  v_v1_1_accepted_at timestamptz;
begin
  insert into public.app_access_allowlist(email_normalized) values (v_email);
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user_id, 'authenticated', 'authenticated', v_email, pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );

  insert into public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    terms_sha256,
    privacy_sha256,
    acceptance_method,
    accepted_at
  ) values (
    v_user_id,
    '1.0',
    '1.0',
    '80323d9b915dd2cb423fe4cfbaed7851675cd070da596117c5bc08214af4cd12',
    'f0ec2f6ecf1ca3f262508942a37f2d057b79449bab20fb6729a5861a6a75fd30',
    'explicit_web',
    v_v1_accepted_at
  );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  select * into v_status from public.current_user_legal_acceptance_status_v1();
  if v_status.accepted
    or v_status.accepted_at is not null
    or v_status.terms_version <> '1.1'
    or v_status.privacy_version <> '1.1' then
    raise exception 'V1.0 acceptance incorrectly satisfies the current V1.1 contract';
  end if;

  select * into v_status from public.record_current_user_legal_acceptance_v1();
  if not v_status.accepted
    or v_status.accepted_at is null
    or v_status.terms_version <> '1.1'
    or v_status.privacy_version <> '1.1'
    or v_status.terms_sha256 <> '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43'
    or v_status.privacy_sha256 <> '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f' then
    raise exception 'V1.1 acceptance was not recorded as the current contract';
  end if;
  v_v1_1_accepted_at := v_status.accepted_at;

  perform public.record_current_user_legal_acceptance_v1();
  if (select pg_catalog.count(*) from public.legal_acceptances acceptance where acceptance.user_id = v_user_id) <> 2
    or (select acceptance.accepted_at from public.legal_acceptances acceptance
        where acceptance.user_id = v_user_id and acceptance.terms_version = '1.0')
      is distinct from v_v1_accepted_at
    or (select acceptance.accepted_at from public.legal_acceptances acceptance
        where acceptance.user_id = v_user_id and acceptance.terms_version = '1.1')
      is distinct from v_v1_1_accepted_at then
    raise exception 'V1.1 retry is not idempotent or V1.0 history was changed';
  end if;

  select * into v_status from public.current_user_legal_acceptance_status_v1();
  if not v_status.accepted or v_status.accepted_at is distinct from v_v1_1_accepted_at then
    raise exception 'Recorded V1.1 acceptance does not satisfy the current contract';
  end if;
end;
$verify_behavior$;

rollback;
