do $verify$
declare
  app_function regprocedure;
  expected_capability text;
  expected_functions regprocedure[] := array[
    'public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure,
    'public.current_user_can_start_connected_oauth_v1(text)'::regprocedure,
    'public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure,
    'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure,
    'public.apply_google_contact_sync_change_v1(uuid,jsonb)'::regprocedure,
    'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure
  ];
begin
  foreach expected_capability in array array[
    'connectors.google.use',
    'contacts.sync_external',
    'interactions.sync_email',
    'interactions.sync_calendar'
  ] loop
    if not exists (
      select 1 from public.app_capabilities capability
      where capability.capability_code = expected_capability and capability.is_active = true
    ) then
      raise exception 'Missing active SEC-GOOGLE-01 capability: %', expected_capability;
    end if;
  end loop;

  if not exists (
    select 1 from public.app_role_capabilities
    where role_code = 'beta_tester' and capability_code = 'connectors.google.use'
  ) then
    raise exception 'beta_tester is missing connectors.google.use';
  end if;
  if exists (
    select 1 from public.app_role_capabilities
    where capability_code = 'connectors.google.use' and role_code <> 'beta_tester'
  ) or exists (
    select 1 from public.subscription_plan_capabilities
    where capability_code = 'connectors.google.use'
  ) then
    raise exception 'Initial Google rollout eligibility is broader than beta_tester';
  end if;

  if position('override_mode = ''deny''' in pg_get_functiondef(
    'public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure
  )) = 0 then
    raise exception 'Google rollout resolver does not preserve active deny precedence';
  end if;
  if position('capability.is_active = true' in pg_get_functiondef(
    'public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure
  )) = 0 or position('capability.is_active = true' in pg_get_functiondef(
    'public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure
  )) = 0 then
    raise exception 'Google authorization does not honor inactive capability catalog entries';
  end if;
  if position('explicit_grant' in pg_get_functiondef(
    'public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure
  )) > 0 then
    raise exception 'Google rollout resolver must not use positive user overrides';
  end if;

  foreach app_function in array expected_functions loop
    if not exists (
      select 1 from pg_proc procedure
      where procedure.oid = app_function
        and procedure.prosecdef
        and pg_get_userbyid(procedure.proowner) = 'postgres'
        and exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'SEC-GOOGLE-01 function % has an unsafe owner/security contract', app_function;
    end if;
  end loop;

  if exists (
    select 1
    from unnest(expected_functions) expected(function_oid)
    join pg_catalog.pg_proc procedure on procedure.oid = expected.function_oid
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a SEC-GOOGLE-01 function';
  end if;

  if has_function_privilege('anon', 'public.current_user_can_start_connected_oauth_v1(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.current_user_can_start_connected_oauth_v1(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.current_user_can_start_connected_oauth_v1(text)', 'EXECUTE') then
    raise exception 'Unexpected grants on current_user_can_start_connected_oauth_v1';
  end if;
  if has_function_privilege('anon', 'public.current_user_can_sync_connected_account_v1(uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.current_user_can_sync_connected_account_v1(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.current_user_can_sync_connected_account_v1(uuid,text)', 'EXECUTE') then
    raise exception 'Unexpected grants on current_user_can_sync_connected_account_v1';
  end if;
  if has_function_privilege('anon', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finalize_google_connected_account_verified(uuid,text,text[])', 'EXECUTE') then
    raise exception 'Unexpected grants on finalize_google_connected_account_verified';
  end if;

  if has_function_privilege('anon', 'public.apply_google_contact_sync_change_v1(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.apply_google_contact_sync_change_v1(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.apply_google_contact_sync_change_v1(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Unexpected grants on apply_google_contact_sync_change_v1';
  end if;
  if has_function_privilege('anon', 'public.apply_google_interaction_sync_v1(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.apply_google_interaction_sync_v1(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.apply_google_interaction_sync_v1(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Unexpected grants on apply_google_interaction_sync_v1';
  end if;

  if exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) client(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) denied(privilege_name)
    where has_table_privilege(
      client.role_name,
      'public.connected_accounts',
      denied.privilege_name
    )
  ) or not has_table_privilege('authenticated', 'public.connected_accounts', 'SELECT') then
    raise exception 'connected_accounts does not preserve its RPC-only write contract';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('external_contact_ids', 'external_contact_snapshots', 'external_interaction_sources')
      and not relation.relrowsecurity
  ) then
    raise exception 'A protected provider-provenance table does not have RLS enabled';
  end if;

  if position('current_user_can_sync_connected_account_v1' in pg_get_functiondef(
    'public.apply_google_contact_sync_change_v1(uuid,jsonb)'::regprocedure
  )) = 0 or position('current_user_can_sync_connected_account_v1' in pg_get_functiondef(
    'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure
  )) = 0 then
    raise exception 'A Google writer does not revalidate connected sync authorization';
  end if;

  if position('user_has_provider_rollout_for_user_v1' in pg_get_functiondef(
    'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure
  )) = 0 then
    raise exception 'Google Connected Account finalization does not enforce rollout eligibility';
  end if;

  if not exists (select 1 from public.app_capabilities where capability_code = 'contacts.import_google')
     or not exists (select 1 from public.app_capabilities where capability_code = 'interactions.import_google') then
    raise exception 'Legacy Google capabilities must remain during transition';
  end if;
end;
$verify$;
