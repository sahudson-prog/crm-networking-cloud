-- Read-only inventory for the additive Avísame contract. No personal data returned.
begin transaction read only;

with reasons as (
  select pg_catalog.array_remove(array[
    case when pg_catalog.to_regclass('auth.users') is null then 'auth_users_missing' end,
    case when pg_catalog.to_regclass('public.profiles') is null then 'profiles_missing' end,
    case when pg_catalog.to_regclass('public.networking_cycles') is null then 'cycles_missing' end,
    case when pg_catalog.to_regprocedure('public.current_user_has_app_access()') is null then 'access_resolver_missing' end,
    case when pg_catalog.to_regprocedure('public.normalize_app_access_email(text)') is null then 'email_normalizer_missing' end,
    case when pg_catalog.to_regclass('public.networking_plan_interest') is not null then 'interest_table_already_exists' end,
    case when pg_catalog.to_regclass('public.networking_plan_notice_modes') is not null then 'modes_table_already_exists' end,
    case when pg_catalog.to_regprocedure('public.request_networking_plan_notice_v1(text)') is not null
      then 'request_rpc_already_exists' end,
    case when pg_catalog.to_regprocedure('public.withdraw_networking_plan_notice_v1(text)') is not null
      then 'withdraw_rpc_already_exists' end
  ]::text[], null) as stop_reasons
)
select pg_catalog.jsonb_build_object(
  'installation_state', case when pg_catalog.cardinality(stop_reasons) = 0 then 'clean_install' else 'stop' end,
  'stop_reasons', pg_catalog.to_jsonb(stop_reasons),
  'target_objects', pg_catalog.jsonb_build_object('tables', 2, 'rpcs', 2)
) from reasons;

rollback;
