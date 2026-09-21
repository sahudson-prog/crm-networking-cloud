-- Refuse to run the baseline over an existing or partially initialized app DB.

do $$
declare
  existing_table text;
  app_tables text[] := array[
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
    'organization_memberships', 'user_plan_sponsorships',
    'app_access_allowlist'
  ];
begin
  if current_user <> 'postgres' then
    raise exception 'Bootstrap must run as postgres so SECURITY DEFINER ownership is deterministic; current_user is %', current_user;
  end if;
  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) required_role(role_name)
    where not exists (
      select 1 from pg_catalog.pg_roles database_role where database_role.rolname = required_role.role_name
    )
  ) then
    raise exception 'Bootstrap requires the standard Supabase database roles';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Bootstrap requires a Supabase database with auth.users';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Bootstrap requires the standard Supabase auth.uid() helper';
  end if;
  if (select count(*) from auth.users) <> 0 then
    raise exception 'Bootstrap requires an empty Supabase Auth user store';
  end if;

  foreach existing_table in array app_tables loop
    if to_regclass(format('public.%I', existing_table)) is not null then
      raise exception 'Bootstrap requires an empty database; found public.%', existing_table;
    end if;
  end loop;
end;
$$;
