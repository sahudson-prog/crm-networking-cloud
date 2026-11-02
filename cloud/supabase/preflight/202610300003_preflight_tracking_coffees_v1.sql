-- Read-only diagnostics for the forward-only tracking coffee contract.
begin transaction read only;
with target as (
  select p.* from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.current_user_tracking_snapshot_v1()')
), problems as (
  select 'tracking_snapshot_missing' as reason where not exists(select 1 from target)
  union all select 'tracking_snapshot_body_drift' where exists(
    select 1 from target where pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
      prosrc,pg_catalog.chr(13)||pg_catalog.chr(10),pg_catalog.chr(10)),pg_catalog.chr(13),pg_catalog.chr(10)))
      <> 'd8d2748826cd7f5d51f6102c8640356b')
  union all select 'tracking_snapshot_security_drift' where exists(
    select 1 from target where prosecdef or provolatile <> 's'
      or prorettype <> 'jsonb'::pg_catalog.regtype
      or pg_catalog.pg_get_userbyid(proowner) <> 'postgres'
      or proconfig not in (array['search_path='],array['search_path=""']))
  union all select 'tracking_snapshot_acl_drift' where exists(
    select 1 from target p where not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where a.grantee <> p.proowner and (a.grantee <> 'authenticated'::pg_catalog.regrole
          or a.privilege_type <> 'EXECUTE' or a.is_grantable)))
  union all select 'tracking_snapshot_overload' where exists(
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='current_user_tracking_snapshot_v1'
      and p.oid <> pg_catalog.to_regprocedure('public.current_user_tracking_snapshot_v1()'))
  union all select 'contact_status_contract_missing' where not exists(
    select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('public.contacts')
      and a.attname='networking_status' and a.atttypid='text'::pg_catalog.regtype
      and a.attnum>0 and not a.attisdropped)
  union all select 'transition_contract_missing' where exists(
    select 1 from (values ('id','uuid'),('previous_status','text'),('next_status','text'),
      ('changed_at','timestamptz')) required(col,typ)
    where not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid=pg_catalog.to_regclass('public.contact_networking_transitions')
        and a.attname=required.col and a.atttypid=required.typ::pg_catalog.regtype
        and a.attnum>0 and not a.attisdropped))
  union all select 'read_source_contract_drift' where exists(
    select 1 from (values ('contacts'),('contact_networking_transitions'),('interactions'),
      ('interaction_participants')) required(name)
    where not exists(select 1 from pg_catalog.pg_class c
      where c.oid=pg_catalog.to_regclass('public.'||required.name) and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner)='postgres'
        and pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')))
)
select pg_catalog.jsonb_build_object(
  'installation_state',case when exists(select 1 from problems) then 'stop' else 'upgrade_ready' end,
  'stop_reasons',coalesce((select pg_catalog.jsonb_agg(reason order by reason) from problems),'[]'::jsonb),
  'project_confirmation','Confirm DEV or PROD manually; database name is not environment identity',
  'recovery','Failure before COMMIT rolls back; after COMMIT keep schema and use compatible previous runtime or a forward-fix');
rollback;
