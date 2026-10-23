-- LOCAL DISPOSABLE DATABASE ONLY. Never run this fixture in DEV or PROD.
-- The caller must first set coffeecito.sec_dev_01_local_fixture = 'on' in the
-- same PostgreSQL session.

begin;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'SEC_DEV_01_FIXTURE_WRONG_ROLE';
  end if;

  if current_setting('coffeecito.sec_dev_01_local_fixture', true) is distinct from 'on' then
    raise exception 'SEC_DEV_01_FIXTURE_LOCAL_OPT_IN_REQUIRED';
  end if;
end;
$$;

do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'app_capabilities',
    'app_role_capabilities',
    'app_roles',
    'headhunter_companies',
    'headhunter_company_domains',
    'organization_memberships',
    'organizations',
    'profiles',
    'service_connectors',
    'subscription_plan_capabilities',
    'subscription_plans',
    'user_access_profiles',
    'user_capability_overrides',
    'user_plan_sponsorships',
    'user_role_assignments'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'SEC_DEV_01_FIXTURE_MISSING_TABLE: %', v_table;
    end if;

    execute format(
      'grant select, insert, update, delete, truncate, references, trigger, maintain on table public.%I to anon, authenticated, service_role',
      v_table
    );
  end loop;
end;
$$;

grant all on schema public to public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on all functions in schema public to public, anon, authenticated, service_role, supabase_auth_admin;

alter default privileges for role postgres
  grant all on tables to public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres
  grant all on sequences to public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres
  grant execute on functions to public, anon, authenticated, service_role, supabase_auth_admin;

alter default privileges for role postgres in schema public
  grant all on tables to public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres in schema public
  grant all on sequences to public, anon, authenticated, service_role, supabase_auth_admin;
alter default privileges for role postgres in schema public
  grant execute on functions to public, anon, authenticated, service_role, supabase_auth_admin;

commit;
