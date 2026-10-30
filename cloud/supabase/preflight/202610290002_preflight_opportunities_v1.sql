-- OBJ-02 Opportunities V1: run in the target environment before migration.
begin transaction read only;
with expected(name) as (values
  ('opportunities'),('opportunity_contacts'),('opportunity_objectives'),
  ('opportunity_interactions'),('opportunity_events')),
objects as (select name, pg_catalog.to_regclass('public.' || name) is not null as present from expected),
functions as (select pg_catalog.jsonb_build_object(
  'save',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_opportunity_v1'),
  'void',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='void_opportunity_v1'),
  'link_guard',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='validate_opportunity_link_v1')) as existing),
wrapper as (select exists(select 1 from pg_catalog.pg_proc p
  where p.oid=pg_catalog.to_regprocedure('public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)')
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
    and p.prokind='f' and p.provolatile='v' and p.prorettype='jsonb'::regtype
    and p.proconfig in (array['search_path='],array['search_path=""'])
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(p.prosrc,chr(13)||chr(10),chr(10)),chr(13),chr(10)))='cd5399672fddc8c91dc7da18ff75347c'
    and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where (a.grantee<>p.proowner and a.grantee<>'authenticated'::regrole) or (a.grantee<>p.proowner and a.is_grantable))
    and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')) as compatible),
requirements as (select
  pg_catalog.to_regclass('public.networking_cycles') is not null as cycles,
  pg_catalog.to_regclass('public.objectives') is not null as objectives,
  pg_catalog.to_regprocedure('public.assert_networking_context_r2b(uuid,uuid,text)') is not null as context,
  pg_catalog.to_regprocedure('public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)') is not null as merge_wrapper,
  pg_catalog.to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is not null as reset_rpc,
  pg_catalog.to_regclass('public.networking_plan_interest') is not null as avisame_table),
summary as (select pg_catalog.jsonb_object_agg(name,present) as objects from objects),
stops as (select pg_catalog.array_remove(array[
  case when (select pg_catalog.count(*) from objects where present)>0 or
    (select pg_catalog.to_regclass('public.opportunity_events_id_seq') is not null) or
    (select existing <> '{"save": false, "void": false, "link_guard": false}'::jsonb from functions)
    then 'opportunity_object_already_present' end,
  case when not cycles or not objectives or not context or not merge_wrapper or not reset_rpc then 'r2b_dependency_missing' end,
  case when not avisame_table then 'avisame_dependency_missing' end,
  case when not (select compatible from wrapper) then 'r2b_merge_contract_incompatible' end
],null)::text[] as reasons from requirements)
select pg_catalog.jsonb_build_object('installation_state',case when pg_catalog.cardinality(stops.reasons)=0 then 'clean_install' else 'stop' end,
  'stop_reasons',stops.reasons,'existing_opportunity_objects',summary.objects,
  'existing_opportunity_functions',(select existing from functions),
  'dependencies',(select pg_catalog.to_jsonb(requirements) from requirements),
  'merge_wrapper_compatible',(select compatible from wrapper)) from stops,summary;
rollback;
