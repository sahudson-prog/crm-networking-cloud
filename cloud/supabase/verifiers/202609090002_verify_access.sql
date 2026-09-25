-- Fails unless app access, catalogs, policies and client grants are fail-closed.

do $$
declare
  table_name text;
  critical_policy record;
  internal_function regprocedure;
  app_function regprocedure;
  client_role text;
  discovered_tables text[];
  classified_tables text[];
  select_tables text[] := array[
    'profiles', 'user_settings', 'service_connectors', 'connected_accounts',
    'contacts', 'external_contact_ids', 'external_contact_snapshots',
    'contact_emails', 'contact_phones', 'headhunter_companies',
    'headhunter_company_domains', 'interactions', 'interaction_participants',
    'external_interaction_sources', 'external_interaction_read_diagnostics',
    'referrals', 'todo_configs', 'todos', 'action_invocations',
    'object_review_state', 'sync_cursors', 'import_batches', 'data_exports',
    'usage_limits', 'usage_events', 'sync_run_logs', 'audit_log',
    'metric_snapshots', 'objectives', 'contact_objective_assignments',
    'sync_change_suppressions', 'app_capabilities', 'app_roles',
    'app_role_capabilities', 'subscription_plans',
    'subscription_plan_capabilities', 'user_access_profiles',
    'user_role_assignments', 'user_capability_overrides', 'organizations',
    'organization_memberships', 'user_plan_sponsorships'
  ];
  insert_tables text[] := array[
    'user_settings', 'contacts', 'external_contact_ids',
    'external_contact_snapshots', 'contact_emails', 'contact_phones',
    'headhunter_companies', 'headhunter_company_domains', 'interactions',
    'interaction_participants', 'external_interaction_sources',
    'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
    'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
    'sync_run_logs', 'audit_log', 'objectives',
    'contact_objective_assignments', 'user_access_profiles',
    'user_role_assignments'
  ];
  update_tables text[] := array[
    'user_settings', 'contacts', 'external_contact_ids',
    'external_contact_snapshots', 'contact_emails', 'contact_phones',
    'interactions', 'external_interaction_sources',
    'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
    'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
    'objectives', 'user_access_profiles', 'user_role_assignments'
  ];
  delete_tables text[] := array[
    'contact_emails', 'contact_phones', 'objectives',
    'contact_objective_assignments'
  ];
  no_authenticated_table_privileges text[] := array[
    'app_access_allowlist'
  ];
  internal_functions regprocedure[] := array[
    'public.set_updated_at()'::regprocedure,
    'public.normalize_app_access_email(text)'::regprocedure,
    'public.is_email_authorized_for_app_access(text)'::regprocedure,
    'public.app_access_status_for_user(uuid)'::regprocedure,
    'public.user_has_capability_for_user(uuid,text)'::regprocedure,
    'public.handle_new_auth_user_profile()'::regprocedure,
    'public.validate_headhunter_company_master_v0_1()'::regprocedure
  ];
  authenticated_functions regprocedure[] := array[
    'public.current_user_app_access_status()'::regprocedure,
    'public.current_user_has_app_access()'::regprocedure,
    'public.current_user_has_capability(text)'::regprocedure,
    'public.admin_list_app_access_allowlist()'::regprocedure,
    'public.admin_authorize_app_access_email(text,text)'::regprocedure,
    'public.admin_revoke_app_access_email(text)'::regprocedure,
    'public.admin_get_app_access_diagnostic(uuid)'::regprocedure,
    'public.merge_contacts_deep(uuid,uuid[],jsonb,text)'::regprocedure,
    'public.reset_current_user_app_data_v0_1(text)'::regprocedure,
    'public.disconnect_current_user_google_connected_account(uuid)'::regprocedure,
    'public.validate_contact_sync_storage_v0_1()'::regprocedure
  ];
  security_definer_functions regprocedure[];
begin
  select coalesce(array_agg(relation.relname order by relation.relname), array[]::text[])
  into discovered_tables
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and not exists (
      select 1
      from pg_catalog.pg_depend dependency
      join pg_catalog.pg_extension extension_definition
        on extension_definition.oid = dependency.refobjid
      where dependency.classid = 'pg_class'::regclass
        and dependency.objid = relation.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    );

  classified_tables := select_tables || insert_tables || update_tables || delete_tables
    || no_authenticated_table_privileges;

  foreach table_name in array discovered_tables loop
    if array_position(classified_tables, table_name) is null then
      raise exception 'App-owned table public.% has no authenticated privilege classification', table_name;
    end if;
  end loop;

  for table_name in
    select distinct contract.table_name
    from unnest(classified_tables) as contract(table_name)
  loop
    if array_position(discovered_tables, table_name) is null then
      raise exception 'Authenticated privilege matrix references missing or non-app-owned table public.%', table_name;
    end if;
  end loop;

  foreach table_name in array no_authenticated_table_privileges loop
    if array_position(select_tables, table_name) is not null
      or array_position(insert_tables, table_name) is not null
      or array_position(update_tables, table_name) is not null
      or array_position(delete_tables, table_name) is not null then
      raise exception 'No-privilege table public.% also appears in an authenticated privilege matrix', table_name;
    end if;
  end loop;

  security_definer_functions := array_remove(
    array_remove(internal_functions, 'public.set_updated_at()'::regprocedure),
    'public.normalize_app_access_email(text)'::regprocedure
  ) || authenticated_functions || array[
    'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure,
    'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure
  ];

  for critical_policy in
    select * from (values
      ('Profiles are owned by auth user', 'profiles', 'ALL', 'public'),
      ('Connected accounts are owned by user', 'connected_accounts', 'ALL', 'public'),
      ('Contacts are owned by user', 'contacts', 'ALL', 'public'),
      ('Sync change suppressions are owned by user', 'sync_change_suppressions', 'ALL', 'public'),
      ('Capabilities are readable', 'app_capabilities', 'SELECT', 'authenticated'),
      ('User access profiles are visible to owner or admin', 'user_access_profiles', 'SELECT', 'authenticated'),
      ('Contact objective assignments are insertable by user', 'contact_objective_assignments', 'INSERT', 'public'),
      ('Headhunter companies are admin writable', 'headhunter_companies', 'ALL', 'authenticated'),
      ('Headhunter company domains are admin writable', 'headhunter_company_domains', 'ALL', 'authenticated'),
      ('App access allowlist is admin readable', 'app_access_allowlist', 'SELECT', 'authenticated'),
      ('App access allowlist is admin writable', 'app_access_allowlist', 'ALL', 'authenticated')
    ) as expected(policy_name, table_name, command_name, role_name)
  loop
    if not exists (
      select 1 from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = critical_policy.table_name
        and policy.policyname = critical_policy.policy_name
        and policy.cmd = critical_policy.command_name
        and cardinality(policy.roles) = 1
        and array_to_string(policy.roles, ',') = critical_policy.role_name
    ) then
      raise exception 'Critical RLS policy % has an unexpected table, command or role', critical_policy.policy_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('connected_accounts', 'contacts', 'sync_change_suppressions')
      and policy.policyname in (
        'Connected accounts are owned by user',
        'Contacts are owned by user',
        'Sync change suppressions are owned by user'
      )
      and (
        coalesce(policy.qual, '') not like '%auth.uid()%'
        or coalesce(policy.qual, '') not like '%user_id%'
        or coalesce(policy.qual, '') not like '%current_user_has_app_access()%'
        or coalesce(policy.with_check, '') not like '%auth.uid()%'
        or coalesce(policy.with_check, '') not like '%user_id%'
        or coalesce(policy.with_check, '') not like '%current_user_has_app_access()%'
      )
  ) then
    raise exception 'A critical ownership policy has an unexpected USING or WITH CHECK expression';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'profiles'
      and policy.policyname = 'Profiles are owned by auth user'
      and coalesce(policy.qual, '') like '%auth.uid()%'
      and coalesce(policy.qual, '') like '%current_user_has_app_access()%'
      and coalesce(policy.qual, '') like '%admin.manage_access%'
      and coalesce(policy.with_check, '') like '%auth.uid()%'
      and coalesce(policy.with_check, '') like '%current_user_has_app_access()%'
      and coalesce(policy.with_check, '') like '%admin.manage_access%'
  ) then
    raise exception 'Profiles policy has an unexpected USING or WITH CHECK expression';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'contact_objective_assignments'
      and policy.policyname = 'Contact objective assignments are insertable by user'
      and coalesce(policy.with_check, '') like '%auth.uid()%'
      and coalesce(policy.with_check, '') like '%current_user_has_app_access()%'
      and coalesce(policy.with_check, '') like '%contacts_for_assignment%'
      and coalesce(policy.with_check, '') like '%objectives_for_assignment%'
      and policy.qual is null
  ) then
    raise exception 'Objective assignment INSERT policy does not enforce both owned relations';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'app_capabilities'
      and policy.policyname = 'Capabilities are readable'
      and coalesce(policy.qual, '') like '%is_active%'
      and coalesce(policy.qual, '') like '%current_user_has_app_access()%'
      and policy.with_check is null
  ) then
    raise exception 'Capabilities SELECT policy has an unexpected USING or WITH CHECK expression';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'user_access_profiles'
      and policy.policyname = 'User access profiles are visible to owner or admin'
      and coalesce(policy.qual, '') like '%auth.uid()%'
      and coalesce(policy.qual, '') like '%current_user_has_app_access()%'
      and coalesce(policy.qual, '') like '%admin.manage_access%'
      and policy.with_check is null
  ) then
    raise exception 'User access profile SELECT policy has an unexpected USING or WITH CHECK expression';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'app_access_allowlist'
      and policy.policyname = 'App access allowlist is admin readable'
      and coalesce(policy.qual, '') like '%current_user_has_capability(%'
      and coalesce(policy.qual, '') like '%admin.manage_access%'
      and policy.with_check is null
  ) then
    raise exception 'Allowlist SELECT policy has an unexpected USING or WITH CHECK expression';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('app_access_allowlist', 'headhunter_companies', 'headhunter_company_domains')
      and policy.cmd = 'ALL'
      and (
        coalesce(policy.qual, '') not like '%current_user_has_capability(%'
        or coalesce(policy.with_check, '') not like '%current_user_has_capability(%'
      )
  ) then
    raise exception 'A critical admin policy has an unexpected USING or WITH CHECK expression';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'app_access_allowlist'
      and policy.policyname = 'App access allowlist is admin writable'
      and coalesce(policy.qual, '') like '%admin.manage_access%'
      and coalesce(policy.with_check, '') like '%admin.manage_access%'
  ) or exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('headhunter_companies', 'headhunter_company_domains')
      and policy.cmd = 'ALL'
      and (
        coalesce(policy.qual, '') not like '%admin.manage_global_masters%'
        or coalesce(policy.with_check, '') not like '%admin.manage_global_masters%'
      )
  ) then
    raise exception 'A critical admin policy uses an unexpected capability';
  end if;

  foreach table_name in array discovered_tables loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = table_name
        and relation.relkind in ('r', 'p')
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_policies policy
      where policy.schemaname = 'public' and policy.tablename = table_name
    ) then
      raise exception 'public.% has no RLS policy', table_name;
    end if;

    if has_table_privilege('anon', format('public.%I', table_name), 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'anon has direct privileges on public.%', table_name;
    end if;
    if has_table_privilege('service_role', format('public.%I', table_name), 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception 'service_role has an unneeded direct table grant on public.%', table_name;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
      where relation.oid = format('public.%I', table_name)::regclass
        and acl.grantee = 0
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception 'PUBLIC has direct privileges on public.%', table_name;
    end if;

    if has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      <> (array_position(select_tables, table_name) is not null) then
      raise exception 'Unexpected authenticated SELECT grant on public.%', table_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      <> (array_position(insert_tables, table_name) is not null) then
      raise exception 'Unexpected authenticated INSERT grant on public.%', table_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      <> (array_position(update_tables, table_name) is not null) then
      raise exception 'Unexpected authenticated UPDATE grant on public.%', table_name;
    end if;
    if has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
      <> (array_position(delete_tables, table_name) is not null) then
      raise exception 'Unexpected authenticated DELETE grant on public.%', table_name;
    end if;
  end loop;

  foreach table_name in array array['app_access_allowlist', 'connected_accounts'] loop
    if has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') then
      raise exception 'authenticated has forbidden direct DML on public.%', table_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.app_access_allowlist', 'SELECT') then
    raise exception 'authenticated has forbidden direct SELECT on app_access_allowlist';
  end if;
  if not has_table_privilege('authenticated', 'public.connected_accounts', 'SELECT') then
    raise exception 'authenticated must retain SELECT on connected_accounts';
  end if;
  if has_table_privilege('authenticated', 'public.interaction_participants', 'UPDATE, DELETE') then
    raise exception 'merge-only participant UPDATE/DELETE leaked to authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.object_review_state', 'DELETE') then
    raise exception 'merge-only object review DELETE leaked to authenticated';
  end if;

  foreach table_name in array array[
    'app_capabilities', 'app_roles', 'app_role_capabilities',
    'subscription_plans', 'subscription_plan_capabilities',
    'organizations', 'organization_memberships', 'user_plan_sponsorships'
  ] loop
    if has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT, UPDATE, DELETE') then
      raise exception 'authenticated has forbidden catalog/organization DML on public.%', table_name;
    end if;
  end loop;

  foreach client_role in array array['anon', 'authenticated'] loop
    foreach internal_function in array internal_functions loop
      if has_function_privilege(client_role, internal_function, 'EXECUTE') then
        raise exception '% can execute internal helper %', client_role, internal_function;
      end if;
    end loop;
  end loop;

  foreach internal_function in array internal_functions loop
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = internal_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute internal helper %', internal_function;
    end if;
  end loop;

  foreach app_function in array authenticated_functions loop
    if not has_function_privilege('authenticated', app_function, 'EXECUTE') then
      raise exception 'authenticated cannot execute required RPC %', app_function;
    end if;
  end loop;

  for app_function in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
  loop
    if has_function_privilege('anon', app_function, 'EXECUTE') then
      raise exception 'anon can execute public function %', app_function;
    end if;
    if has_function_privilege('authenticated', app_function, 'EXECUTE')
      <> (app_function = any(authenticated_functions)) then
      raise exception 'Unexpected authenticated EXECUTE grant on %', app_function;
    end if;
    if has_function_privilege('service_role', app_function, 'EXECUTE')
      <> (app_function = 'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure) then
      raise exception 'Unexpected service_role EXECUTE grant on %', app_function;
    end if;
    if has_function_privilege('supabase_auth_admin', app_function, 'EXECUTE')
      <> (app_function = 'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure) then
      raise exception 'Unexpected supabase_auth_admin EXECUTE grant on %', app_function;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = app_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute public function %', app_function;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.current_user_app_access_status()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.current_user_has_app_access()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.current_user_has_capability(text)', 'EXECUTE') then
    raise exception 'authenticated is missing a required public access function';
  end if;

  if not has_function_privilege('supabase_auth_admin', 'public.hook_enforce_app_access_allowlist(jsonb)', 'EXECUTE') then
    raise exception 'supabase_auth_admin cannot execute the Before User Created hook';
  end if;
  if has_function_privilege('authenticated', 'public.hook_enforce_app_access_allowlist(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.hook_enforce_app_access_allowlist(jsonb)', 'EXECUTE') then
    raise exception 'A client role can execute the Auth hook directly';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_definition
    where trigger_definition.tgname = 'on_auth_user_created_profile'
      and not trigger_definition.tgisinternal
  ) then
    raise exception 'Missing auth user profile trigger';
  end if;

  foreach app_function in array security_definer_functions loop
    if not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = app_function and procedure.prosecdef
    ) then
      raise exception 'Coffeecito function % is not SECURITY DEFINER', app_function;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = app_function
        and exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'Coffeecito SECURITY DEFINER function % does not use an empty search_path', app_function;
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = app_function
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
    ) then
      raise exception 'Coffeecito SECURITY DEFINER function % is not owned by postgres', app_function;
    end if;
  end loop;

  if pg_has_role('anon', 'postgres', 'MEMBER')
    or pg_has_role('authenticated', 'postgres', 'MEMBER') then
    raise exception 'A client role can inherit the SECURITY DEFINER owner';
  end if;
end;
$$;
