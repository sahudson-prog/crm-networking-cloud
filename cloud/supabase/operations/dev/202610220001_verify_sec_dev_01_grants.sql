-- DEV-only verifier for SEC-DEV-01. This script is read-only.

begin transaction read only;

do $$
declare
  v_table text;
  v_privilege text;
  v_function regprocedure;
  v_select_tables constant text[] := array[
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
  v_insert_tables constant text[] := array[
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
  v_update_tables constant text[] := array[
    'user_settings', 'contacts', 'external_contact_ids',
    'external_contact_snapshots', 'contact_emails', 'contact_phones',
    'interactions', 'external_interaction_sources',
    'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
    'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
    'objectives', 'user_access_profiles', 'user_role_assignments'
  ];
  v_delete_tables constant text[] := array[
    'contact_emails', 'contact_phones', 'objectives',
    'contact_objective_assignments'
  ];
  v_authenticated_functions constant regprocedure[] := array[
    'public.current_user_app_access_status()'::regprocedure,
    'public.current_user_has_app_access()'::regprocedure,
    'public.current_user_has_capability(text)'::regprocedure,
    'public.admin_list_app_access_allowlist()'::regprocedure,
    'public.admin_authorize_app_access_email(text,text)'::regprocedure,
    'public.admin_revoke_app_access_email(text)'::regprocedure,
    'public.admin_get_app_access_diagnostic(uuid)'::regprocedure,
    'public.merge_contacts_deep(uuid,uuid[],jsonb,text)'::regprocedure,
    'public.reset_current_user_app_data_v0_1(text)'::regprocedure,
    'public.apply_ics_import_v1(jsonb)'::regprocedure,
    'public.reconcile_ics_focus_participants_v1(boolean)'::regprocedure,
    'public.admin_list_contact_requests_v1(integer)'::regprocedure,
    'public.admin_update_contact_request_v1(uuid,text,text)'::regprocedure,
    'public.current_user_legal_acceptance_status_v1()'::regprocedure,
    'public.record_current_user_legal_acceptance_v1()'::regprocedure,
    'public.disconnect_current_user_google_connected_account(uuid)'::regprocedure,
    'public.validate_contact_sync_storage_v0_1()'::regprocedure,
    'public.current_user_can_start_connected_oauth_v1(text)'::regprocedure,
    'public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure,
    'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure,
    'public.apply_google_contact_sync_change_v1(uuid,jsonb)'::regprocedure
  ];
  v_service_role_functions constant regprocedure[] := array[
    'public.finalize_google_connected_account_verified(uuid,text,text[])'::regprocedure,
    'public.submit_contact_request_v1(text,text,text,text,text,uuid)'::regprocedure
  ];
  v_auth_admin_functions constant regprocedure[] := array[
    'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure
  ];
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception 'service_role must retain BYPASSRLS for this effective-role check';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ) privilege(privilege_name)
    cross join (values ('anon'), ('service_role'), ('supabase_auth_admin')) grantee(role_name)
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and pg_catalog.has_table_privilege(
        grantee.role_name,
        relation.oid,
        privilege.privilege_name
      )
  ) then
    raise exception 'A non-authenticated client role retains one of the eight public table privileges';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) acl
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and acl.grantee = 0
      and acl.privilege_type in (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      )
  ) then
    raise exception 'PUBLIC retains a direct public table privilege';
  end if;

  for v_table in
    select relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
  loop
    if pg_catalog.has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
      <> (v_table = any(v_select_tables)) then
      raise exception 'authenticated SELECT mismatch on public.%', v_table;
    end if;
    if pg_catalog.has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
      <> (v_table = any(v_insert_tables)) then
      raise exception 'authenticated INSERT mismatch on public.%', v_table;
    end if;
    if pg_catalog.has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
      <> (v_table = any(v_update_tables)) then
      raise exception 'authenticated UPDATE mismatch on public.%', v_table;
    end if;
    if pg_catalog.has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
      <> (v_table = any(v_delete_tables)) then
      raise exception 'authenticated DELETE mismatch on public.%', v_table;
    end if;

    foreach v_privilege in array array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if pg_catalog.has_table_privilege(
        'authenticated',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception 'authenticated % mismatch on public.%', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  if pg_catalog.has_schema_privilege('anon', 'public', 'USAGE, CREATE')
    or pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('supabase_auth_admin', 'public', 'CREATE') then
    raise exception 'A client role retains a forbidden public schema privilege';
  end if;

  if not pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE')
    or not pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE')
    or not pg_catalog.has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') then
    raise exception 'A required public schema USAGE grant is missing';
  end if;

  for v_function in
    select procedure.oid::regprocedure
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
  loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'anon can execute %', v_function;
    end if;
    if pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      <> (v_function = any(v_authenticated_functions)) then
      raise exception 'authenticated EXECUTE mismatch on %', v_function;
    end if;
    if pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
      <> (v_function = any(v_service_role_functions)) then
      raise exception 'service_role EXECUTE mismatch on %', v_function;
    end if;
    if pg_catalog.has_function_privilege('supabase_auth_admin', v_function, 'EXECUTE')
      <> (v_function = any(v_auth_admin_functions)) then
      raise exception 'supabase_auth_admin EXECUTE mismatch on %', v_function;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
      where procedure.oid = v_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute %', v_function;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    join pg_catalog.pg_roles owner_role on owner_role.oid = defaults.defaclrole
    left join pg_catalog.pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
    where owner_role.rolname = 'postgres'
      and coalesce(namespace.nspname, 'public') = 'public'
      and defaults.defaclobjtype in ('r', 'S', 'f')
      and (
        acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')
      )
  ) then
    raise exception 'postgres retains a forbidden default ACL in public';
  end if;
end;
$$;

rollback;
