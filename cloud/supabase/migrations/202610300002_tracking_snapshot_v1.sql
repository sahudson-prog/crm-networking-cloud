-- PROD CONTRACT CHANGE: additive, read-only, SECURITY INVOKER snapshot.
-- No data transformation. Install before runtime; preserve schema on runtime rollback.
begin;
do $guard$
declare t text;
begin
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='current_user_tracking_snapshot_v1') then
    raise exception 'tracking_object_already_present';
  end if;
  if pg_catalog.to_regprocedure('public.current_user_has_app_access()') is null
    or pg_catalog.to_regprocedure('public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid)') is null then
    raise exception 'tracking_dependencies_missing';
  end if;
  foreach t in array array['networking_cycles','contacts','contact_emails','contact_networking_transitions','interactions','interaction_participants','external_interaction_sources','objectives','contact_objective_assignments','opportunities','opportunity_contacts','opportunity_objectives','headhunter_companies','headhunter_company_domains'] loop
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relkind='r' and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
      or not pg_catalog.has_table_privilege('authenticated','public.'||t,'SELECT') then
      raise exception 'tracking_read_contract_incompatible: %',t;
    end if;
  end loop;
  if exists(select 1 from (values ('networking_cycles','id'),
      ('networking_cycles','user_id'),
      ('networking_cycles','status'),
      ('networking_cycles','started_at'),
      ('networking_cycles','timezone_name'),
      ('contacts','id'),
      ('contacts','user_id'),
      ('contacts','is_active'),
      ('contacts','company'),
      ('contacts','networking_focus'),
      ('contacts','is_headhunter'),
      ('contacts','headhunter_domains'),
      ('contact_emails','contact_id'),
      ('contact_emails','domain'),
      ('contact_emails','normalized_email'),
      ('contact_networking_transitions','user_id'),
      ('contact_networking_transitions','cycle_id'),
      ('contact_networking_transitions','contact_id'),
      ('contact_networking_transitions','next_status'),
      ('contact_networking_transitions','changed_at'),
      ('contact_networking_transitions','changed_fields'),
      ('interactions','id'),
      ('interactions','user_id'),
      ('interactions','interaction_type'),
      ('interactions','occurred_at'),
      ('interactions','metadata'),
      ('interaction_participants','interaction_id'),
      ('interaction_participants','contact_id'),
      ('external_interaction_sources','user_id'),
      ('external_interaction_sources','interaction_id'),
      ('external_interaction_sources','provider'),
      ('external_interaction_sources','source_service'),
      ('external_interaction_sources','sync_status'),
      ('external_interaction_sources','is_active'),
      ('objectives','id'),
      ('objectives','user_id'),
      ('objectives','cycle_id'),
      ('objectives','is_active'),
      ('objectives','objective_name'),
      ('objectives','objective_type'),
      ('objectives','priority_level'),
      ('contact_objective_assignments','contact_id'),
      ('contact_objective_assignments','objective_id'),
      ('opportunities','id'),
      ('opportunities','user_id'),
      ('opportunities','cycle_id'),
      ('opportunities','stage'),
      ('opportunities','situation'),
      ('opportunities','result'),
      ('opportunities','voided_at'),
      ('opportunity_contacts','user_id'),
      ('opportunity_contacts','opportunity_id'),
      ('opportunity_contacts','contact_id'),
      ('opportunity_objectives','user_id'),
      ('opportunity_objectives','opportunity_id'),
      ('opportunity_objectives','objective_id'),
      ('headhunter_companies','id'),
      ('headhunter_companies','display_name'),
      ('headhunter_companies','normalized_name'),
      ('headhunter_companies','is_active'),
      ('headhunter_company_domains','company_id'),
      ('headhunter_company_domains','normalized_domain'),
      ('headhunter_company_domains','is_active')) required(tbl,col)
    where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('public.'||required.tbl)
      and a.attname=required.col and a.attnum>0 and not a.attisdropped)) then
    raise exception 'tracking_columns_missing';
  end if;
  if exists(select 1 from (values ('contacts','networking_focus','bool'),('contacts','is_headhunter','bool'),('contacts','is_active','bool'),('interactions','metadata','jsonb'),('interactions','occurred_at','timestamptz'),('networking_cycles','started_at','timestamptz'),('networking_cycles','timezone_name','text'),('contact_networking_transitions','changed_at','timestamptz'),('contact_networking_transitions','changed_fields','_text'),('opportunities','stage','text'),('opportunities','situation','text'),('opportunities','result','text')) required(tbl,col,typ)
    where not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
      join pg_catalog.pg_namespace n on n.oid=t.typnamespace
      where a.attrelid=pg_catalog.to_regclass('public.'||required.tbl) and a.attname=required.col
        and not a.attisdropped and n.nspname='pg_catalog' and t.typname=required.typ)) then
    raise exception 'tracking_column_type_incompatible';
  end if;
end;
$guard$;

create function public.current_user_tracking_snapshot_v1()
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
    select c.id,c.company,c.networking_focus,c.is_headhunter,c.headhunter_domains
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
    'transitions',coalesce((select jsonb_agg(jsonb_build_object('contact_id',t.contact_id,
      'next_status',t.next_status,'changed_at',t.changed_at)) from public.contact_networking_transitions t
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
alter function public.current_user_tracking_snapshot_v1() owner to postgres;
revoke all on function public.current_user_tracking_snapshot_v1() from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.current_user_tracking_snapshot_v1() to authenticated;
commit;
