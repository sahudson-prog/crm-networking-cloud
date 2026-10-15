-- Verifies the current legal contract, RPC-only access and idempotent user ownership.
-- Synthetic fixtures are fully rolled back.

begin;

do $verify_structure$
declare
  v_table regclass := pg_catalog.to_regclass('public.legal_acceptances');
  v_status regprocedure := pg_catalog.to_regprocedure('public.current_user_legal_acceptance_status_v1()');
  v_record regprocedure := pg_catalog.to_regprocedure('public.record_current_user_legal_acceptance_v1()');
  v_function regprocedure;
  v_role text;
  v_privilege text;
  v_definition text;
begin
  if v_table is null then
    raise exception 'Missing public.legal_acceptances';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = v_table
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
  ) then
    raise exception 'legal_acceptances must be postgres-owned with RLS enabled and FORCE RLS disabled';
  end if;

  if exists (
    with expected(column_name, type_name, not_null) as (values
      ('id', 'uuid', true),
      ('user_id', 'uuid', true),
      ('terms_version', 'text', true),
      ('privacy_version', 'text', true),
      ('terms_sha256', 'text', true),
      ('privacy_sha256', 'text', true),
      ('acceptance_method', 'text', true),
      ('accepted_at', 'timestamp with time zone', true)
    )
    select 1 from (
      (select attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_table and attribute.attnum > 0 and not attribute.attisdropped
       except select * from expected)
      union all
      (select * from expected
       except select attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_table and attribute.attnum > 0 and not attribute.attisdropped)
    ) differences
  ) then
    raise exception 'legal_acceptances columns differ from the approved contract';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint definition
    where definition.conrelid = v_table
      and definition.contype = 'f'
      and pg_catalog.pg_get_constraintdef(definition.oid) = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint definition
    where definition.conrelid = v_table
      and definition.contype = 'u'
      and definition.conname = 'uq_legal_acceptances_user_contract'
      and pg_catalog.pg_get_constraintdef(definition.oid) =
        'UNIQUE (user_id, terms_version, privacy_version, terms_sha256, privacy_sha256, acceptance_method)'
  ) then
    raise exception 'legal_acceptances ownership or idempotency constraint is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'legal_acceptances'
      and policy.policyname = 'Legal acceptances deny direct client access'
      and policy.cmd = 'ALL'
      and cardinality(policy.roles) = 1
      and array_to_string(policy.roles, ',') = 'authenticated'
      and coalesce(policy.qual, '') in ('false', '(false)')
      and coalesce(policy.with_check, '') in ('false', '(false)')
  ) then
    raise exception 'legal_acceptances deny-all client policy is missing or too broad';
  end if;

  foreach v_privilege in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl
      where relation.oid = v_table
        and acl.grantee = 0
        and acl.privilege_type = v_privilege
    ) then
      raise exception 'PUBLIC has forbidden % privilege on legal_acceptances', v_privilege;
    end if;

    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_table_privilege(v_role, v_table, v_privilege) then
        raise exception '% has forbidden direct % privilege on legal_acceptances', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  foreach v_function in array array[v_status, v_record] loop
    if v_function is null or not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = v_function
        and procedure.pronargs = 0
        and procedure.prosecdef
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'Legal acceptance RPC % has an unsafe signature or execution contract', v_function;
    end if;

    if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated cannot execute legal acceptance RPC %', v_function;
    end if;
    foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception '% has unexpected legal acceptance RPC access', v_role;
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
      raise exception 'PUBLIC can execute legal acceptance RPC %', v_function;
    end if;

    select pg_catalog.pg_get_functiondef(v_function) into v_definition;
    if v_definition not like '%auth.uid()%'
      or v_definition not like '%public.current_user_has_app_access()%' then
      raise exception 'Legal acceptance RPC % does not bind auth.uid() and app access', v_function;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(v_record) into v_definition;
  if pg_catalog.upper(v_definition) not like '%ON CONFLICT ON CONSTRAINT UQ_LEGAL_ACCEPTANCES_USER_CONTRACT DO NOTHING%'
    or pg_catalog.upper(v_definition) like '%UPDATE PUBLIC.LEGAL_ACCEPTANCES%'
    or pg_catalog.upper(v_definition) like '%DELETE FROM PUBLIC.LEGAL_ACCEPTANCES%' then
    raise exception 'Legal acceptance write RPC is not idempotent and append-only';
  end if;
end;
$verify_structure$;

do $verify_behavior$
declare
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_email_a text := 'legal-a-' || pg_catalog.gen_random_uuid()::text || '@example.invalid';
  v_email_b text := 'legal-b-' || pg_catalog.gen_random_uuid()::text || '@example.invalid';
  v_status record;
  v_first_accepted_at timestamptz;
begin
  insert into public.app_access_allowlist(email_normalized)
  values (v_email_a), (v_email_b);

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (
      v_user_a, 'authenticated', 'authenticated', v_email_a, pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      pg_catalog.now(), pg_catalog.now()
    ),
    (
      v_user_b, 'authenticated', 'authenticated', v_email_b, pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      pg_catalog.now(), pg_catalog.now()
    );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true
  );

  select * into v_status from public.current_user_legal_acceptance_status_v1();
  if v_status.accepted or v_status.accepted_at is not null then
    raise exception 'Fresh user unexpectedly has current legal acceptance';
  end if;

  select * into v_status from public.record_current_user_legal_acceptance_v1();
  if not v_status.accepted or v_status.accepted_at is null then
    raise exception 'Explicit legal acceptance was not recorded';
  end if;
  v_first_accepted_at := v_status.accepted_at;

  perform public.record_current_user_legal_acceptance_v1();
  if (select pg_catalog.count(*) from public.legal_acceptances acceptance where acceptance.user_id = v_user_a) <> 1
    or (select acceptance.accepted_at from public.legal_acceptances acceptance where acceptance.user_id = v_user_a)
      is distinct from v_first_accepted_at then
    raise exception 'Legal acceptance retry is not idempotent';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text,
    true
  );

  select * into v_status from public.current_user_legal_acceptance_status_v1();
  if v_status.accepted
    or exists (select 1 from public.legal_acceptances acceptance where acceptance.user_id = v_user_b) then
    raise exception 'Legal acceptance leaked across users';
  end if;

  perform public.record_current_user_legal_acceptance_v1();
  if (select pg_catalog.count(*) from public.legal_acceptances acceptance where acceptance.user_id = v_user_a) <> 1
    or (select pg_catalog.count(*) from public.legal_acceptances acceptance where acceptance.user_id = v_user_b) <> 1 then
    raise exception 'Legal acceptance did not derive ownership independently from auth.uid()';
  end if;
end;
$verify_behavior$;

rollback;
