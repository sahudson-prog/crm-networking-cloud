with expected_tables(table_name) as (
  values
    ('app_capabilities'),
    ('app_roles'),
    ('app_role_capabilities'),
    ('subscription_plans'),
    ('subscription_plan_capabilities'),
    ('user_access_profiles'),
    ('user_role_assignments'),
    ('user_capability_overrides'),
    ('organizations'),
    ('organization_memberships'),
    ('user_plan_sponsorships')
),
table_status as (
  select
    'tabla' as check_area,
    expected_tables.table_name as checked_object,
    case when pg_class.oid is null then 'falta' else 'ok' end as observed_status,
    coalesce(pg_class.reltuples::bigint, 0) as observed_count
  from expected_tables
  left join pg_class
    on pg_class.relname = expected_tables.table_name
  left join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
    and pg_namespace.nspname = 'public'
),
rls_status as (
  select
    'rls' as check_area,
    expected_tables.table_name as checked_object,
    case when pg_class.relrowsecurity then 'ok' else 'falta' end as observed_status,
    0::bigint as observed_count
  from expected_tables
  left join pg_class
    on pg_class.relname = expected_tables.table_name
  left join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
    and pg_namespace.nspname = 'public'
),
seed_status as (
  select 'semilla' as check_area, 'app_capabilities' as checked_object, case when count(*) >= 10 then 'ok' else 'revisar' end as observed_status, count(*)::bigint as observed_count from public.app_capabilities
  union all
  select 'semilla', 'app_roles', case when count(*) >= 5 then 'ok' else 'revisar' end, count(*)::bigint from public.app_roles
  union all
  select 'semilla', 'subscription_plans', case when count(*) >= 5 then 'ok' else 'revisar' end, count(*)::bigint from public.subscription_plans
),
function_status as (
  select
    'funcion' as check_area,
    'current_user_has_capability' as checked_object,
    case when exists (
      select 1
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and pg_proc.proname = 'current_user_has_capability'
    ) then 'ok' else 'falta' end as observed_status,
    0::bigint as observed_count
),
auth_trigger_status as (
  select
    'trigger' as check_area,
    'on_auth_user_created_profile' as checked_object,
    case when exists (
      select 1
      from pg_trigger
      join pg_class on pg_class.oid = pg_trigger.tgrelid
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'auth'
        and pg_class.relname = 'users'
        and pg_trigger.tgname = 'on_auth_user_created_profile'
        and not pg_trigger.tgisinternal
    ) then 'ok' else 'falta' end as observed_status,
    0::bigint as observed_count
)
select *
from table_status
union all
select * from rls_status
union all
select * from seed_status
union all
select * from function_status
union all
select * from auth_trigger_status
order by check_area, checked_object;
