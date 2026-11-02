-- Read-only, aggregate diagnostics. Missing is_deleted is supported, not repaired.
begin transaction read only;
with checks as (with expected(signature,body_hash,volatility,result_type,definer,client_execute) as (values
  ('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)','c54a485e9ed834f35c70150e314a03a5','v','uuid',true,true),
  ('public.assert_opportunity_participation_v1(uuid,uuid,uuid)','37aa13a991254386a36e10776b774c8b','v','void',true,false),
  ('public.check_opportunity_participation_v1()','94dfe26a393a9e2fd4807d13bdfcc03e','v','trigger',true,false)),
failures(reason) as (
  select 'function_contract_incompatible: ' || e.signature from expected e
  left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
  where p.oid is null or (
    pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prokind='f'
    and p.prosecdef=e.definer and p.provolatile::text=e.volatility
    and p.prorettype=pg_catalog.to_regtype(e.result_type)
    and not p.proleakproof and not p.proisstrict and p.proparallel='u'
    and p.proretset=(e.signature like '%read_opportunity_interactions_v1%')
    and p.pronargdefaults=case when e.signature like '%save_opportunity_v1%' then 1 else 0 end
    and coalesce(pg_catalog.pg_get_expr(p.proargdefaults,0),'')=case when e.signature like '%save_opportunity_v1%' then 'NULL::uuid' else '' end
    and p.proargnames is not distinct from case
      when e.signature like '%save_opportunity_v1%' then array['p_expected_cycle_id','p_expected_context','p_opportunity_id','p_expected_updated_at','p_title','p_company','p_application_url','p_stage','p_result','p_result_note','p_contact_ids','p_objective_ids','p_interaction_ids','p_creation_request_id']
      when e.signature like '%assert_opportunity_participation_v1%' then array['p_user_id','p_opportunity_id','p_interaction_id']
      when e.signature like '%opportunity_interaction_active_v1%' then array['p_row']
      when e.signature like '%read_opportunity_interactions_v1%' then array['p_ids','id','subject','interaction_type','occurred_at']
      else p.proargnames end
    and (select count(*) from pg_catalog.pg_proc overload where overload.pronamespace=p.pronamespace and overload.proname=p.proname)=1
    and p.prolang=(select oid from pg_catalog.pg_language where lanname=case when e.signature like '%active_v1%' then 'sql' else 'plpgsql' end)
    and p.proconfig in (array['search_path='],array['search_path=""'])
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(p.prosrc,chr(13)||chr(10),chr(10)),chr(13),chr(10)))=e.body_hash
    and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')=e.client_execute
    and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where a.grantee<>p.proowner and (not e.client_execute or a.grantee<>'authenticated'::regrole or a.is_grantable))
    and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')) is not true
  union all
  select 'interaction_columns_incompatible' where exists (
    select 1 from (values ('interactions','id','uuid'),('interactions','user_id','uuid'),
      ('interactions','metadata','jsonb'),('interactions','subject','text'),('interactions','interaction_type','text'),
      ('interactions','occurred_at','timestamptz'),('interaction_participants','id','uuid'),
      ('interaction_participants','interaction_id','uuid'),('interaction_participants','contact_id','uuid'),
      ('interaction_participants','user_id','uuid')) e(tbl,col,typ)
    where not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid=pg_catalog.to_regclass('public.'||e.tbl) and a.attname=e.col
        and not a.attisdropped and a.atttypid=pg_catalog.to_regtype(e.typ)))
  union all
  select 'optional_is_deleted_not_boolean' where exists(select 1 from pg_catalog.pg_attribute
    where attrelid=pg_catalog.to_regclass('public.interactions') and attname='is_deleted'
      and not attisdropped and atttypid<>'boolean'::regtype)
  union all
  select 'interaction_read_security_incompatible' where exists (
    select 1 from (values ('interactions'),('interaction_participants')) e(tbl)
    left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass('public.'||e.tbl)
    where c.oid is null or not c.relrowsecurity or pg_catalog.pg_get_userbyid(c.relowner)<>'postgres'
      or not pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'))
  union all
  select 'participant_trigger_contract_incompatible' where exists (
    select 1 from (values
      ('check_opportunity_interaction_participation_v1','opportunity_interactions',21),
      ('check_opportunity_contact_participation_v1','opportunity_contacts',25),
      ('check_interaction_participant_opportunity_v1','interaction_participants',25)) e(n,t,k)
    where not exists(select 1 from pg_catalog.pg_trigger g where g.tgname=e.n
      and g.tgrelid=pg_catalog.to_regclass('public.'||e.t) and g.tgtype=e.k
      and g.tgfoid=pg_catalog.to_regprocedure('public.check_opportunity_participation_v1()')
      and g.tgenabled='O' and not g.tgisinternal and g.tgdeferrable and g.tginitdeferred))
  union all
  select 'lifecycle_function_already_present' where exists(select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('opportunity_interaction_active_v1','read_opportunity_interactions_v1'))
)
select coalesce(array_agg(reason order by reason),array[]::text[]) as reasons from failures)
select pg_catalog.jsonb_build_object('installation_state',case when cardinality(reasons)=0 then 'ready' else 'stop' end,
  'stop_reasons',reasons,'optional_is_deleted_present',exists(select 1 from pg_catalog.pg_attribute
    where attrelid=pg_catalog.to_regclass('public.interactions') and attname='is_deleted' and not attisdropped))
from checks;
rollback;
