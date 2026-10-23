-- DEV-only SEC-DEV-01 grant reconciliation.
-- This file is intentionally outside migrations and must never run in PROD.
-- Capture and retain the recovery snapshot before executing this transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table sec_dev_01_approved_tables (
  table_name text primary key
) on commit drop;

insert into sec_dev_01_approved_tables (table_name) values
  ('app_capabilities'),
  ('app_role_capabilities'),
  ('app_roles'),
  ('headhunter_companies'),
  ('headhunter_company_domains'),
  ('organization_memberships'),
  ('organizations'),
  ('profiles'),
  ('service_connectors'),
  ('subscription_plan_capabilities'),
  ('subscription_plans'),
  ('user_access_profiles'),
  ('user_capability_overrides'),
  ('user_plan_sponsorships'),
  ('user_role_assignments');

create temporary table sec_dev_01_expected_tables (
  table_name text primary key
) on commit drop;

insert into sec_dev_01_expected_tables (table_name) values
  ('profiles'), ('user_settings'), ('service_connectors'), ('connected_accounts'),
  ('contacts'), ('external_contact_ids'), ('external_contact_snapshots'),
  ('contact_emails'), ('contact_phones'), ('headhunter_companies'),
  ('headhunter_company_domains'), ('interactions'), ('interaction_participants'),
  ('external_interaction_sources'), ('external_interaction_read_diagnostics'),
  ('referrals'), ('todo_configs'), ('todos'), ('action_invocations'),
  ('object_review_state'), ('sync_cursors'), ('import_batches'), ('data_exports'),
  ('usage_limits'), ('usage_events'), ('sync_run_logs'), ('audit_log'),
  ('metric_snapshots'), ('objectives'), ('contact_objective_assignments'),
  ('sync_change_suppressions'), ('app_capabilities'), ('app_roles'),
  ('app_role_capabilities'), ('subscription_plans'),
  ('subscription_plan_capabilities'), ('user_access_profiles'),
  ('user_role_assignments'), ('user_capability_overrides'), ('organizations'),
  ('organization_memberships'), ('user_plan_sponsorships'),
  ('app_access_allowlist'), ('contact_requests'), ('legal_acceptances');

create temporary table sec_dev_01_authenticated_expected (
  table_name text not null,
  privilege_name text not null,
  allowed boolean not null,
  primary key (table_name, privilege_name)
) on commit drop;

insert into sec_dev_01_authenticated_expected (table_name, privilege_name, allowed)
select
  expected.table_name,
  privilege.privilege_name,
  case privilege.privilege_name
    when 'SELECT' then expected.table_name = any(array[
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
    ])
    when 'INSERT' then expected.table_name = any(array[
      'user_settings', 'contacts', 'external_contact_ids',
      'external_contact_snapshots', 'contact_emails', 'contact_phones',
      'headhunter_companies', 'headhunter_company_domains', 'interactions',
      'interaction_participants', 'external_interaction_sources',
      'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
      'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
      'sync_run_logs', 'audit_log', 'objectives',
      'contact_objective_assignments', 'user_access_profiles',
      'user_role_assignments'
    ])
    when 'UPDATE' then expected.table_name = any(array[
      'user_settings', 'contacts', 'external_contact_ids',
      'external_contact_snapshots', 'contact_emails', 'contact_phones',
      'interactions', 'external_interaction_sources',
      'external_interaction_read_diagnostics', 'referrals', 'todo_configs',
      'todos', 'action_invocations', 'object_review_state', 'sync_cursors',
      'objectives', 'user_access_profiles', 'user_role_assignments'
    ])
    when 'DELETE' then expected.table_name = any(array[
      'contact_emails', 'contact_phones', 'objectives',
      'contact_objective_assignments'
    ])
    else false
  end
from sec_dev_01_expected_tables expected
cross join (values
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
) privilege(privilege_name);

do $$
declare
  v_table text;
  v_missing_tables text[];
begin
  if current_user <> 'postgres' then
    raise exception 'SEC_DEV_01_WRONG_ROLE: expected postgres, got %', current_user;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception 'SEC_DEV_01_PRECONDITION: service_role must exist with BYPASSRLS';
  end if;

  if (select count(*) from pg_temp.sec_dev_01_approved_tables) <> 15 then
    raise exception 'SEC_DEV_01_APPROVED_TARGETS_INVALID: expected exact 15-table manifest';
  end if;

  select array_agg(expected.table_name order by expected.table_name)
  into v_missing_tables
  from pg_temp.sec_dev_01_expected_tables expected
  where to_regclass(format('public.%I', expected.table_name)) is null;

  if coalesce(cardinality(v_missing_tables), 0) > 0 then
    raise exception 'SEC_DEV_01_PRECONDITION: missing canonical tables %', v_missing_tables;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname in (select expected.table_name from pg_temp.sec_dev_01_expected_tables expected)
      and (
        acl.grantee = 0
        or pg_get_userbyid(acl.grantee) = 'supabase_auth_admin'
      )
      and acl.privilege_type in (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      )
  ) then
    raise exception 'SEC_DEV_01_UNSUPPORTED_TABLE_DRIFT: PUBLIC or supabase_auth_admin';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname not in (
        select expected.table_name from pg_temp.sec_dev_01_expected_tables expected
      )
  ) then
    raise exception 'SEC_DEV_01_PRECONDITION: unclassified public table exists';
  end if;

  if exists (
    select 1
    from pg_temp.sec_dev_01_approved_tables approved
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ) privilege(privilege_name)
    cross join (values ('anon'), ('authenticated'), ('service_role')) grantee(role_name)
    where not pg_catalog.has_table_privilege(
      grantee.role_name,
      format('public.%I', approved.table_name),
      privilege.privilege_name
    )
  ) then
    raise exception 'SEC_DEV_01_TARGET_MISMATCH: approved tables do not have the demonstrated three-role eight-privilege drift';
  end if;

  if exists (
    select 1
    from pg_temp.sec_dev_01_authenticated_expected expected
    where expected.table_name not in (
        select approved.table_name from pg_temp.sec_dev_01_approved_tables approved
      )
      and pg_catalog.has_table_privilege(
        'authenticated',
        format('public.%I', expected.table_name),
        expected.privilege_name
      ) is distinct from expected.allowed
  ) then
    raise exception 'SEC_DEV_01_PRECONDITION: authenticated drift exists outside approved manifest';
  end if;

  if exists (
    select 1
    from pg_temp.sec_dev_01_expected_tables expected
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ) privilege(privilege_name)
    cross join (values ('anon'), ('service_role'), ('supabase_auth_admin')) grantee(role_name)
    where expected.table_name not in (
        select approved.table_name from pg_temp.sec_dev_01_approved_tables approved
      )
      and pg_catalog.has_table_privilege(
        grantee.role_name,
        format('public.%I', expected.table_name),
        privilege.privilege_name
      )
  ) then
    raise exception 'SEC_DEV_01_PRECONDITION: non-authenticated table drift exists outside approved manifest';
  end if;

  for v_table in
    select approved.table_name
    from pg_temp.sec_dev_01_approved_tables approved
    order by approved.table_name
  loop
    execute format(
      'revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.%I from anon, authenticated, service_role',
      v_table
    );
  end loop;
end;
$$;

grant select on table
  public.app_capabilities,
  public.app_role_capabilities,
  public.app_roles,
  public.headhunter_companies,
  public.headhunter_company_domains,
  public.organization_memberships,
  public.organizations,
  public.profiles,
  public.service_connectors,
  public.subscription_plan_capabilities,
  public.subscription_plans,
  public.user_access_profiles,
  public.user_capability_overrides,
  public.user_plan_sponsorships,
  public.user_role_assignments
to authenticated;

grant insert on table
  public.headhunter_companies,
  public.headhunter_company_domains,
  public.user_access_profiles,
  public.user_role_assignments
to authenticated;

grant update on table
  public.user_access_profiles,
  public.user_role_assignments
to authenticated;

revoke all on schema public from public, anon;
revoke create on schema public from authenticated, service_role, supabase_auth_admin;
grant usage on schema public to authenticated, service_role, supabase_auth_admin;

-- PostgreSQL applies global defaults before per-schema defaults. Both layers must
-- be closed so a schema-level REVOKE cannot inherit global client privileges.
alter default privileges for role postgres
  revoke all on tables from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres
  revoke all on sequences from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role, supabase_auth_admin;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role, supabase_auth_admin;

do $$
declare
  v_function regprocedure;
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
  v_internal_functions constant regprocedure[] := array[
    'public.set_updated_at()'::regprocedure,
    'public.normalize_app_access_email(text)'::regprocedure,
    'public.is_email_authorized_for_app_access(text)'::regprocedure,
    'public.app_access_status_for_user(uuid)'::regprocedure,
    'public.user_has_capability_for_user(uuid,text)'::regprocedure,
    'public.handle_new_auth_user_profile()'::regprocedure,
    'public.validate_headhunter_company_master_v0_1()'::regprocedure,
    'public.user_has_provider_rollout_for_user_v1(uuid,text)'::regprocedure
  ];
  v_managed_functions regprocedure[];
  v_unmanaged_functions text[];
begin
  v_managed_functions := v_authenticated_functions
    || v_service_role_functions
    || v_auth_admin_functions
    || v_internal_functions;

  select array_agg(procedure.oid::regprocedure::text order by procedure.oid::regprocedure::text)
  into v_unmanaged_functions
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and not (procedure.oid::regprocedure = any(v_managed_functions));

  if coalesce(cardinality(v_unmanaged_functions), 0) > 0 then
    raise exception 'SEC_DEV_01_UNCLASSIFIED_FUNCTIONS: %', v_unmanaged_functions;
  end if;

  foreach v_function in array v_managed_functions loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role, supabase_auth_admin',
      v_function
    );
  end loop;

  foreach v_function in array v_authenticated_functions loop
    execute format('grant execute on function %s to authenticated', v_function);
  end loop;
  foreach v_function in array v_service_role_functions loop
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
  foreach v_function in array v_auth_admin_functions loop
    execute format('grant execute on function %s to supabase_auth_admin', v_function);
  end loop;
end;
$$;

do $$
declare
  v_mismatch record;
begin
  for v_mismatch in
    select
      expected.table_name,
      expected.privilege_name,
      expected.allowed as expected_allowed,
      pg_catalog.has_table_privilege(
        'authenticated',
        format('public.%I', expected.table_name),
        expected.privilege_name
      ) as actual_allowed
    from pg_temp.sec_dev_01_authenticated_expected expected
    where pg_catalog.has_table_privilege(
      'authenticated',
      format('public.%I', expected.table_name),
      expected.privilege_name
    ) is distinct from expected.allowed
  loop
    raise exception 'SEC_DEV_01_AUTHENTICATED_MATRIX_MISMATCH: %.% expected %, got %',
      v_mismatch.table_name,
      v_mismatch.privilege_name,
      v_mismatch.expected_allowed,
      v_mismatch.actual_allowed;
  end loop;

  if exists (
    select 1
    from pg_temp.sec_dev_01_expected_tables expected
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ) privilege(privilege_name)
    cross join (values ('anon'), ('service_role'), ('supabase_auth_admin')) grantee(role_name)
    where pg_catalog.has_table_privilege(
      grantee.role_name,
      format('public.%I', expected.table_name),
      privilege.privilege_name
    )
  ) then
    raise exception 'SEC_DEV_01_POSTCONDITION: forbidden non-authenticated table privilege remains';
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
      and relation.relname in (
        select expected.table_name from pg_temp.sec_dev_01_expected_tables expected
      )
      and acl.grantee = 0
      and acl.privilege_type in (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      )
  ) then
    raise exception 'SEC_DEV_01_POSTCONDITION: PUBLIC table privilege remains';
  end if;

  if pg_catalog.has_schema_privilege('anon', 'public', 'USAGE, CREATE')
    or pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    or pg_catalog.has_schema_privilege('supabase_auth_admin', 'public', 'CREATE') then
    raise exception 'SEC_DEV_01_POSTCONDITION: forbidden public schema privilege remains';
  end if;

  if not pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE')
    or not pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE')
    or not pg_catalog.has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') then
    raise exception 'SEC_DEV_01_POSTCONDITION: required public schema USAGE is missing';
  end if;

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
    raise exception 'SEC_DEV_01_POSTCONDITION: forbidden postgres default ACL remains';
  end if;
end;
$$;

commit;
