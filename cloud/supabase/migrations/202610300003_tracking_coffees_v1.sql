-- PROD CONTRACT CHANGE: forward-only, read-only snapshot extension.
-- Existing runtime can ignore the added JSON keys. Install before the new runtime.
begin;
do $guard$
declare f pg_catalog.regprocedure := pg_catalog.to_regprocedure('public.current_user_tracking_snapshot_v1()');
begin
  if f is null or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='current_user_tracking_snapshot_v1' and p.oid<>f) then
    raise exception 'tracking_snapshot_missing_or_overloaded';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
      p.prosrc,pg_catalog.chr(13)||pg_catalog.chr(10),pg_catalog.chr(10)),pg_catalog.chr(13),pg_catalog.chr(10)))
      ='d8d2748826cd7f5d51f6102c8640356b'
    and not p.prosecdef and p.provolatile='s' and p.prorettype='jsonb'::pg_catalog.regtype
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig in (array['search_path='],array['search_path=""'])) then
    raise exception 'tracking_snapshot_contract_drift';
  end if;
  if not pg_catalog.has_function_privilege('authenticated',f,'EXECUTE')
    or exists(select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=f and a.grantee<>p.proowner and (a.grantee<>'authenticated'::pg_catalog.regrole
        or a.privilege_type<>'EXECUTE' or a.is_grantable)) then
    raise exception 'tracking_snapshot_acl_drift';
  end if;
  if not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='public.contacts'::pg_catalog.regclass
    and a.attname='networking_status' and a.atttypid='text'::pg_catalog.regtype
    and a.attnum>0 and not a.attisdropped)
    or exists(select 1 from (values ('id','uuid'),('previous_status','text'),('next_status','text'),
      ('changed_at','timestamptz')) required(col,typ)
      where not exists(select 1 from pg_catalog.pg_attribute a
        where a.attrelid='public.contact_networking_transitions'::pg_catalog.regclass
          and a.attname=required.col and a.atttypid=required.typ::pg_catalog.regtype
          and a.attnum>0 and not a.attisdropped)) then
    raise exception 'tracking_status_columns_missing';
  end if;
  if exists(select 1 from (values ('contacts'),('contact_networking_transitions'),('interactions'),
      ('interaction_participants')) required(name)
    where not exists(select 1 from pg_catalog.pg_class c
      where c.oid=pg_catalog.to_regclass('public.'||required.name) and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner)='postgres'
        and pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'))) then
    raise exception 'tracking_read_source_drift';
  end if;
end;
$guard$;

create or replace function public.current_user_tracking_snapshot_v1()
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'tracking_access_denied' using errcode='42501';
  end if;
  -- A STABLE function shares the calling statement's MVCC snapshot across all sources.
  with cycle as (
    select id,started_at,timezone_name from public.networking_cycles
    where user_id=v_user and status='active'
  ), people as (
    select c.id,c.company,c.networking_status,c.networking_focus,c.is_headhunter,c.headhunter_domains
    from public.contacts c where c.user_id=v_user and c.is_active
  ), events as (
    select i.id,i.interaction_type,i.occurred_at,
      jsonb_build_object('deleted',i.metadata->'deleted','dismissed',i.metadata->'dismissed',
        'ics_import',case when i.metadata ? 'ics_import' then jsonb_build_object(
          'version',i.metadata#>'{ics_import,version}','status',i.metadata#>'{ics_import,status}',
          'method',i.metadata#>'{ics_import,method}') else null end) as metadata,
      to_jsonb(i)->'is_deleted' as is_deleted
    from public.interactions i where i.user_id=v_user and i.interaction_type in ('calendar','call')
      and i.occurred_at >= (select started_at from cycle)
  ), priorities as (
    select o.id,o.objective_name,o.objective_type,o.priority_level
    from public.objectives o where o.user_id=v_user and o.cycle_id=(select id from cycle) and o.is_active
  ), opportunities as (
    select o.id,o.stage,o.situation,o.result from public.opportunities o
    where o.user_id=v_user and o.cycle_id=(select id from cycle)
      and o.voided_at is null and o.situation<>'voided'
  )
  select jsonb_build_object('version',1,'as_of',statement_timestamp(),
    'cycle',(select to_jsonb(c) from cycle c),
    'contacts',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('contact_emails',
      coalesce((select jsonb_agg(jsonb_build_object('domain',coalesce(nullif(btrim(e.domain),''),
        split_part(e.normalized_email,'@',2)))) from public.contact_emails e
        where e.contact_id=c.id),'[]'::jsonb))) from people c),'[]'::jsonb),
    'transitions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'contact_id',t.contact_id,
      'previous_status',t.previous_status,'next_status',t.next_status,'changed_at',t.changed_at))
      from public.contact_networking_transitions t
      where t.user_id=v_user and t.cycle_id=(select id from cycle)
        and 'networking_status'=any(t.changed_fields)
        and t.changed_at >= (select started_at from cycle) and t.changed_at<=statement_timestamp()),'[]'::jsonb),
    'interactions',coalesce((select jsonb_agg(to_jsonb(i)) from events i),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('interaction_id',p.interaction_id,'contact_id',p.contact_id))
      from public.interaction_participants p join events e on e.id=p.interaction_id
      join people c on c.id=p.contact_id),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('interaction_id',s.interaction_id,
      'provider',s.provider,'source_service',s.source_service,'sync_status',s.sync_status,'is_active',s.is_active))
      from public.external_interaction_sources s join events e on e.id=s.interaction_id
      where s.user_id=v_user),'[]'::jsonb),
    'priorities',coalesce((select jsonb_agg(to_jsonb(p)) from priorities p),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('contact_id',a.contact_id,'objective_id',a.objective_id))
      from public.contact_objective_assignments a join priorities p on p.id=a.objective_id
      join people c on c.id=a.contact_id),'[]'::jsonb),
    'opportunities',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object(
      'contact_ids',coalesce((select jsonb_agg(c.contact_id) from public.opportunity_contacts c
        where c.opportunity_id=o.id and c.user_id=v_user),'[]'::jsonb),
      'objective_ids',coalesce((select jsonb_agg(p.objective_id) from public.opportunity_objectives p
        where p.opportunity_id=o.id and p.user_id=v_user),'[]'::jsonb))) from opportunities o),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'displayName',h.display_name,
      'normalizedName',h.normalized_name,'domains',coalesce((select jsonb_agg(d.normalized_domain)
      from public.headhunter_company_domains d where d.company_id=h.id and d.is_active),'[]'::jsonb)))
      from public.headhunter_companies h where h.is_active),'[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;

do $assert$
declare f pg_catalog.regprocedure := 'public.current_user_tracking_snapshot_v1()'::pg_catalog.regprocedure;
begin
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
      p.prosrc,pg_catalog.chr(13)||pg_catalog.chr(10),pg_catalog.chr(10)),pg_catalog.chr(13),pg_catalog.chr(10)))
      ='d626092644173bd309046760bb0c3436' and not p.prosecdef
    and p.provolatile='s' and p.prorettype='jsonb'::pg_catalog.regtype
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig in (array['search_path='],array['search_path=""']))
    or not pg_catalog.has_function_privilege('authenticated',f,'EXECUTE')
    or exists(select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=f and a.grantee<>p.proowner and (a.grantee<>'authenticated'::pg_catalog.regrole
        or a.privilege_type<>'EXECUTE' or a.is_grantable)) then
    raise exception 'tracking_snapshot_postcondition_failed';
  end if;
end;
$assert$;
commit;
