-- CRM Networking cloud multiuser readiness verification v0.1
-- Safe/read-only: checks schema metadata only. Does not read or modify user records.

with expected_user_scoped_tables(table_name, ownership_column, scope_rule) as (
  values
    ('profiles', 'id', 'profile id is auth user id'),
    ('user_settings', 'user_id', 'user-owned settings'),
    ('connected_accounts', 'user_id', 'user-owned external accounts'),
    ('contacts', 'user_id', 'user-owned contacts'),
    ('external_contact_ids', 'user_id', 'user-owned provider contact links'),
    ('external_contact_snapshots', 'user_id', 'user-owned provider contact snapshots'),
    ('contact_emails', 'user_id', 'user-owned contact emails'),
    ('contact_phones', 'user_id', 'user-owned contact phones'),
    ('interactions', 'user_id', 'user-owned app interactions'),
    ('interaction_participants', 'user_id', 'user-owned interaction participants'),
    ('external_interaction_sources', 'user_id', 'user-owned provider interaction links'),
    ('external_interaction_read_diagnostics', 'user_id', 'user-owned provider read diagnostics'),
    ('referrals', 'user_id', 'user-owned referrals'),
    ('todos', 'user_id', 'user-owned Coach suggestions'),
    ('todo_configs', 'user_id', 'user-owned Coach settings'),
    ('objectives', 'user_id', 'user-owned objectives'),
    ('contact_objective_assignments', 'user_id', 'user-owned contact-objective links'),
    ('action_invocations', 'user_id', 'user-owned action audit trail'),
    ('audit_log', 'user_id', 'user-owned business audit log'),
    ('sync_cursors', 'user_id', 'user-owned sync cursors'),
    ('sync_run_logs', 'user_id', 'user-owned sync run logs'),
    ('import_batches', 'user_id', 'user-owned import batches'),
    ('data_exports', 'user_id', 'user-owned export records'),
    ('usage_limits', 'user_id', 'user-owned usage limits'),
    ('usage_events', 'user_id', 'user-owned usage events'),
    ('metric_snapshots', 'user_id', 'user-owned metric snapshots'),
    ('object_review_state', 'user_id', 'user-owned review pointers'),
    ('user_access_profiles', 'user_id', 'user-owned access profile'),
    ('user_role_assignments', 'user_id', 'user-owned role assignments'),
    ('user_capability_overrides', 'user_id', 'user-owned capability overrides'),
    ('organization_memberships', 'user_id', 'user-owned organization memberships'),
    ('user_plan_sponsorships', 'user_id', 'user-owned plan sponsorships')
),
expected_global_tables(table_name, scope_rule) as (
  values
    ('service_connectors', 'global connector catalog'),
    ('headhunter_companies', 'global headhunter company master'),
    ('headhunter_company_domains', 'global headhunter domain master'),
    ('app_capabilities', 'global capability catalog'),
    ('app_roles', 'global role catalog'),
    ('app_role_capabilities', 'global role-capability matrix'),
    ('subscription_plans', 'global subscription plan catalog'),
    ('subscription_plan_capabilities', 'global plan-capability matrix'),
    ('organizations', 'global organization catalog')
),
public_tables as (
  select
    pg_class.oid,
    pg_class.relname as table_name,
    pg_class.relrowsecurity as rls_enabled
  from pg_class
  join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
  where pg_namespace.nspname = 'public'
    and pg_class.relkind in ('r', 'p')
),
table_columns as (
  select
    table_name,
    column_name
  from information_schema.columns
  where table_schema = 'public'
),
policy_counts as (
  select
    schemaname,
    tablename as table_name,
    count(*)::int as policy_count
  from pg_policies
  where schemaname = 'public'
  group by schemaname, tablename
),
user_table_checks as (
  select
    'tabla privada' as validation_area,
    expected_user_scoped_tables.table_name as validated_object,
    expected_user_scoped_tables.scope_rule as expected_condition,
    case
      when public_tables.table_name is null then 'tabla ausente'
      when owner_column.column_name is null then 'falta columna ' || expected_user_scoped_tables.ownership_column
      when public_tables.rls_enabled is not true then 'RLS apagado'
      when coalesce(policy_counts.policy_count, 0) = 0 then 'sin policies'
      else 'lista para prueba multiusuario'
    end as observed_value,
    case
      when public_tables.table_name is not null
       and owner_column.column_name is not null
       and public_tables.rls_enabled is true
       and coalesce(policy_counts.policy_count, 0) > 0
      then 'ok'
      else 'revisar'
    end as validation_status
  from expected_user_scoped_tables
  left join public_tables
    on public_tables.table_name = expected_user_scoped_tables.table_name
  left join table_columns owner_column
    on owner_column.table_name = expected_user_scoped_tables.table_name
   and owner_column.column_name = expected_user_scoped_tables.ownership_column
  left join policy_counts
    on policy_counts.table_name = expected_user_scoped_tables.table_name
),
global_table_checks as (
  select
    'tabla global' as validation_area,
    expected_global_tables.table_name as validated_object,
    expected_global_tables.scope_rule as expected_condition,
    case
      when public_tables.table_name is null then 'tabla ausente'
      when user_id_column.column_name is not null then 'contiene user_id; revisar si debe ser global'
      else 'catalogo global separado de datos privados'
    end as observed_value,
    case
      when public_tables.table_name is not null
       and user_id_column.column_name is null
      then 'ok'
      else 'revisar'
    end as validation_status
  from expected_global_tables
  left join public_tables
    on public_tables.table_name = expected_global_tables.table_name
  left join table_columns user_id_column
    on user_id_column.table_name = expected_global_tables.table_name
   and user_id_column.column_name = 'user_id'
),
capability_function_check as (
  select
    'funcion permiso' as validation_area,
    'current_user_has_capability' as validated_object,
    'resolvedor central para UI, acciones y policies' as expected_condition,
    case
      when exists (
        select 1
        from pg_proc
        join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'public'
          and pg_proc.proname = 'current_user_has_capability'
      )
      then 'funcion disponible'
      else 'funcion ausente'
    end as observed_value,
    case
      when exists (
        select 1
        from pg_proc
        join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'public'
          and pg_proc.proname = 'current_user_has_capability'
      )
      then 'ok'
      else 'revisar'
    end as validation_status
),
auth_trigger_check as (
  select
    'alta usuario' as validation_area,
    'on_auth_user_created_profile' as validated_object,
    'nuevo usuario recibe perfil y acceso base sin rol admin' as expected_condition,
    case
      when exists (
        select 1
        from pg_trigger
        join pg_class on pg_class.oid = pg_trigger.tgrelid
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'auth'
          and pg_class.relname = 'users'
          and pg_trigger.tgname = 'on_auth_user_created_profile'
          and not pg_trigger.tgisinternal
      )
      then 'trigger disponible'
      else 'trigger ausente'
    end as observed_value,
    case
      when exists (
        select 1
        from pg_trigger
        join pg_class on pg_class.oid = pg_trigger.tgrelid
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'auth'
          and pg_class.relname = 'users'
          and pg_trigger.tgname = 'on_auth_user_created_profile'
          and not pg_trigger.tgisinternal
      )
      then 'ok'
      else 'revisar'
    end as validation_status
)
select *
from user_table_checks
union all
select * from global_table_checks
union all
select * from capability_function_check
union all
select * from auth_trigger_check
order by validation_status desc, validation_area, validated_object;
