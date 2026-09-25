-- Fails unless an empty Coffeecito PROD bootstrap has the complete structure
-- and contains no user-owned or environment-specific rows.

do $$
declare
  table_name text;
  row_count bigint;
  discovered_tables text[];
  expected_tables text[] := array[
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
  empty_tables text[] := array[
    'profiles', 'user_settings', 'service_connectors', 'connected_accounts',
    'contacts', 'external_contact_ids', 'external_contact_snapshots',
    'contact_emails', 'contact_phones', 'interactions',
    'interaction_participants', 'external_interaction_sources',
    'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
    'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
    'import_batches', 'data_exports', 'usage_limits', 'usage_events',
    'sync_run_logs', 'audit_log', 'metric_snapshots', 'objectives',
    'contact_objective_assignments', 'sync_change_suppressions',
    'user_access_profiles', 'user_role_assignments',
    'user_capability_overrides', 'organizations',
    'organization_memberships', 'user_plan_sponsorships',
    'app_access_allowlist'
  ];
begin
  if to_regclass('auth.users') is null then
    raise exception 'Supabase auth.users is missing';
  end if;
  if (select count(*) from auth.users) <> 0 then
    raise exception 'Bootstrap verification requires auth.users to be empty';
  end if;

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

  foreach table_name in array expected_tables loop
    if array_position(discovered_tables, table_name) is null then
      raise exception 'Missing expected table public.%', table_name;
    end if;
  end loop;

  foreach table_name in array discovered_tables loop
    if array_position(expected_tables, table_name) is null then
      raise exception 'Unclassified app-owned table public.%', table_name;
    end if;

    if not coalesce((
      select catalog.relrowsecurity
      from pg_catalog.pg_class catalog
      join pg_catalog.pg_namespace namespace on namespace.oid = catalog.relnamespace
      where namespace.nspname = 'public'
        and catalog.relname = table_name
        and catalog.relkind in ('r', 'p')
    ), false) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
  end loop;

  foreach table_name in array empty_tables loop
    execute format('select count(*) from public.%I', table_name) into row_count;
    if row_count <> 0 then
      raise exception 'Expected public.% to be empty after bootstrap; found % rows', table_name, row_count;
    end if;
  end loop;

  if exists (
    with expected(capability_code, capability_area) as (values
      ('admin.manage_access', 'admin'),
      ('admin.manage_global_masters', 'admin'),
      ('admin.view_diagnostics', 'admin'),
      ('coach.automate', 'coach'),
      ('coach.use', 'coach'),
      ('contacts.import_google', 'contacts'),
      ('contacts.manage', 'contacts'),
      ('data.delete_account', 'data'),
      ('data.export', 'data'),
      ('interactions.import_google', 'interactions')
    )
    select 1 from (
      (select capability_code, capability_area from public.app_capabilities where is_active
       except select capability_code, capability_area from expected)
      union all
      (select capability_code, capability_area from expected
       except select capability_code, capability_area from public.app_capabilities where is_active)
    ) differences
  ) or (select count(*) from public.app_capabilities) <> 10 then
    raise exception 'Canonical capability keys or areas differ from the approved seed';
  end if;

  if exists (
    with expected(role_code) as (values
      ('beta_tester'), ('sponsor_admin'), ('support_admin'), ('system_admin'), ('user')
    )
    select 1 from (
      (select role_code from public.app_roles where is_active and is_system_role
       except select role_code from expected)
      union all
      (select role_code from expected
       except select role_code from public.app_roles where is_active and is_system_role)
    ) differences
  ) or (select count(*) from public.app_roles) <> 5 then
    raise exception 'Canonical role keys differ from the approved seed';
  end if;

  if exists (
    with expected(role_code, capability_code) as (values
      ('beta_tester', 'coach.use'),
      ('beta_tester', 'contacts.import_google'),
      ('beta_tester', 'contacts.manage'),
      ('beta_tester', 'interactions.import_google'),
      ('sponsor_admin', 'admin.view_diagnostics'),
      ('support_admin', 'admin.view_diagnostics'),
      ('system_admin', 'admin.manage_access'),
      ('system_admin', 'admin.manage_global_masters'),
      ('system_admin', 'admin.view_diagnostics'),
      ('system_admin', 'data.delete_account'),
      ('user', 'coach.use'),
      ('user', 'contacts.import_google'),
      ('user', 'contacts.manage'),
      ('user', 'interactions.import_google')
    )
    select 1 from (
      (select role_code, capability_code from public.app_role_capabilities
       except select role_code, capability_code from expected)
      union all
      (select role_code, capability_code from expected
       except select role_code, capability_code from public.app_role_capabilities)
    ) differences
  ) then
    raise exception 'Canonical role/capability mappings differ from the approved seed';
  end if;

  if exists (
    with expected(plan_code, tier_rank, is_public) as (values
      ('beta_personal', 10, false),
      ('free', 20, true),
      ('premium', 40, true),
      ('pro', 30, true),
      ('sponsored_base', 25, false)
    )
    select 1 from (
      (select plan_code, tier_rank, is_public from public.subscription_plans where is_active
       except select plan_code, tier_rank, is_public from expected)
      union all
      (select plan_code, tier_rank, is_public from expected
       except select plan_code, tier_rank, is_public from public.subscription_plans where is_active)
    ) differences
  ) or (select count(*) from public.subscription_plans) <> 5 then
    raise exception 'Canonical plan keys or attributes differ from the approved seed';
  end if;

  if exists (
    with expected(plan_code, capability_code, capability_limit_json) as (values
      ('beta_personal', 'coach.use', '{}'::jsonb),
      ('beta_personal', 'contacts.import_google', '{}'::jsonb),
      ('beta_personal', 'contacts.manage', '{}'::jsonb),
      ('beta_personal', 'data.delete_account', '{}'::jsonb),
      ('beta_personal', 'interactions.import_google', '{}'::jsonb),
      ('free', 'coach.use', '{"automation_allowed": false}'::jsonb),
      ('free', 'contacts.manage', '{"max_contacts": 200}'::jsonb),
      ('premium', 'coach.automate', '{}'::jsonb),
      ('premium', 'coach.use', '{}'::jsonb),
      ('premium', 'contacts.import_google', '{}'::jsonb),
      ('premium', 'contacts.manage', '{}'::jsonb),
      ('premium', 'data.export', '{"minimum_paid_months": 6}'::jsonb),
      ('premium', 'interactions.import_google', '{}'::jsonb),
      ('pro', 'coach.automate', '{"allowed_rule_count": 3}'::jsonb),
      ('pro', 'coach.use', '{}'::jsonb),
      ('pro', 'contacts.import_google', '{}'::jsonb),
      ('pro', 'contacts.manage', '{}'::jsonb),
      ('pro', 'interactions.import_google', '{}'::jsonb),
      ('sponsored_base', 'coach.use', '{}'::jsonb),
      ('sponsored_base', 'contacts.import_google', '{}'::jsonb),
      ('sponsored_base', 'contacts.manage', '{}'::jsonb),
      ('sponsored_base', 'interactions.import_google', '{}'::jsonb)
    )
    select 1 from (
      (select plan_code, capability_code, capability_limit_json from public.subscription_plan_capabilities
       except select plan_code, capability_code, capability_limit_json from expected)
      union all
      (select plan_code, capability_code, capability_limit_json from expected
       except select plan_code, capability_code, capability_limit_json from public.subscription_plan_capabilities)
    ) differences
  ) then
    raise exception 'Canonical plan/capability mappings differ from the approved seed';
  end if;

  if (select count(*) from public.headhunter_companies) <> 62
    or (select count(*) from public.headhunter_companies where is_active) <> 62
    or coalesce((
      select md5(string_agg(
        company.normalized_name || '|' || company.display_name,
        E'\n' order by company.normalized_name collate "C"
      ))
      from public.headhunter_companies company
    ), '') <> '210449f2b721f15cb5e11700dbcf636e' then
    raise exception 'Canonical headhunter companies differ from the approved seed';
  end if;

  if (select count(*) from public.headhunter_company_domains) <> 64
    or (select count(*) from public.headhunter_company_domains where is_active) <> 64
    or exists (
      select 1
      from public.headhunter_company_domains domain
      join public.headhunter_companies company on company.id = domain.company_id
      where not company.is_active
        or domain.domain <> domain.normalized_domain
    )
    or coalesce((
      select md5(string_agg(
        domain.normalized_domain || '|' || company.normalized_name,
        E'\n' order by domain.normalized_domain collate "C"
      ))
      from public.headhunter_company_domains domain
      join public.headhunter_companies company on company.id = domain.company_id
    ), '') <> 'e3cf8a18da8d57194c7a2e0d64837cf0' then
    raise exception 'Canonical headhunter domains differ from the approved seed';
  end if;
end;
$$;
