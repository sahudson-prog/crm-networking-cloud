-- PROD CONTRACT CHANGE: 002 -> 003 -> 004. No data transformation or new soft-delete columns.
-- Run preflight first. Incompatible contracts STOP before DDL. Preserve data after COMMIT.
begin;
do $guard$
declare v_reasons text[];
begin
  select reasons into v_reasons from (with expected(signature,body_hash,volatility,result_type,definer,client_execute) as (values
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
select coalesce(array_agg(reason order by reason),array[]::text[]) as reasons from failures) checks;
  if pg_catalog.cardinality(v_reasons)>0 then raise exception 'opportunity_lifecycle_precondition: %',v_reasons; end if;
end; $guard$;

create function public.opportunity_interaction_active_v1(p_row jsonb)
returns boolean language sql immutable set search_path = '' as $$
  -- Match the existing Boolean(metadata.deleted || metadata.dismissed) lifecycle.
  select not (
    coalesce(p_row->'metadata'->'deleted','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
    or coalesce(p_row->'metadata'->'dismissed','null'::jsonb) not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
    or coalesce((p_row->>'is_deleted')::boolean,false)
  );
$$;

create function public.read_opportunity_interactions_v1(p_ids uuid[])
returns table(id uuid,subject text,interaction_type text,occurred_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode='42501';
  end if;
  if p_ids is null or pg_catalog.cardinality(p_ids)>100 then
    raise exception 'invalid_interaction_batch' using errcode='22023';
  end if;
  return query select i.id,i.subject,i.interaction_type,i.occurred_at
    from public.interactions i where i.user_id=auth.uid() and i.id=any(p_ids)
      and public.opportunity_interaction_active_v1(pg_catalog.to_jsonb(i))
    order by i.id;
end;
$$;

create or replace function public.save_opportunity_v1(
  p_expected_cycle_id uuid, p_expected_context text, p_opportunity_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_company text, p_application_url text, p_stage text, p_result text, p_result_note text,
  p_contact_ids uuid[], p_objective_ids uuid[], p_interaction_ids uuid[], p_creation_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_row public.opportunities%rowtype; v_before jsonb;
  v_contacts uuid[] := coalesce(p_contact_ids,array[]::uuid[]);
  v_objectives uuid[] := coalesce(p_objective_ids,array[]::uuid[]);
  v_interactions uuid[] := coalesce(p_interaction_ids,array[]::uuid[]);
  v_id uuid; v_kind text; v_requested jsonb;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode='42501'; end if;
  perform public.assert_networking_context_r2b(v_user,p_expected_cycle_id,p_expected_context);
  if not public.current_user_has_app_access() then raise exception 'app_access_denied' using errcode='42501'; end if;
  if p_expected_cycle_id is null or not exists (select 1 from public.networking_cycles c
    where c.id=p_expected_cycle_id and c.user_id=v_user and c.status='active' and c.objective_type='JOB_SEARCH' and c.started_at is not null) then
    raise exception 'active_job_cycle_required' using errcode='42501'; end if;
  if p_title is null or pg_catalog.length(pg_catalog.btrim(p_title)) not between 1 and 180
    or pg_catalog.length(coalesce(p_company,'')) > 120
    or (nullif(pg_catalog.btrim(coalesce(p_application_url,'')),'') is not null
      and (pg_catalog.length(p_application_url)>1000 or p_application_url !~ '^https?://[^[:space:]]+$'))
    or p_stage is null or p_stage not in ('identified','applied','in_process','offer_received','finished')
    or ((p_stage='finished') is distinct from (p_result is not null))
    or (p_result is not null and p_result not in ('offer_accepted','offer_declined','not_selected','withdrawn','no_progress','other'))
    or (p_result is distinct from 'other' and nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') is not null)
    or pg_catalog.length(coalesce(p_result_note,''))>500 then
    raise exception 'invalid_opportunity' using errcode='22023'; end if;
  v_requested := pg_catalog.jsonb_build_object('title',pg_catalog.btrim(p_title),
    'company',nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
    'application_url',nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),
    'stage',p_stage,'result',p_result,'result_note',nullif(pg_catalog.btrim(coalesce(p_result_note,'')),''),
    'contacts',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_contacts) x) s),
    'objectives',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_objectives) x) s),
    'interactions',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_interactions) x) s));
  if p_opportunity_id is null then
    if p_creation_request_id is null then raise exception 'opportunity_request_required' using errcode='22023'; end if;
    select * into v_row from public.opportunities where user_id=v_user and creation_request_id=p_creation_request_id;
    if found then
      if v_row.cycle_id is distinct from p_expected_cycle_id or not exists(select 1 from public.opportunity_events
        where opportunity_id=v_row.id and kind='created' and after_state=v_requested) then
        raise exception 'opportunity_request_conflict' using errcode='22023'; end if;
      return v_row.id;
    end if;
  end if;
  -- Serialize lifecycle edits with admission of selected interaction links.
  perform i.id from public.interactions i
    where i.user_id=v_user and i.id=any(v_interactions) order by i.id for share;
  if exists(select 1 from pg_catalog.unnest(v_contacts) x where x is null or not exists
    (select 1 from public.contacts c where c.id=x and c.user_id=v_user and (c.is_active or exists
      (select 1 from public.opportunity_contacts l where l.opportunity_id=p_opportunity_id and l.contact_id=c.id and l.user_id=v_user))))
    or exists(select 1 from pg_catalog.unnest(v_objectives) x where x is null or not exists
    (select 1 from public.objectives o where o.id=x and o.user_id=v_user and o.cycle_id=p_expected_cycle_id and (o.is_active or exists
      (select 1 from public.opportunity_objectives l where l.opportunity_id=p_opportunity_id and l.objective_id=o.id and l.user_id=v_user))))
    or exists(select 1 from pg_catalog.unnest(v_interactions) x where x is null or not exists
    (select 1 from public.interactions i where i.id=x and i.user_id=v_user and (public.opportunity_interaction_active_v1(pg_catalog.to_jsonb(i)) or exists
      (select 1 from public.opportunity_interactions l where l.opportunity_id=p_opportunity_id and l.interaction_id=i.id and l.user_id=v_user)))) then
    raise exception 'invalid_opportunity_relation' using errcode='42501'; end if;
  if p_opportunity_id is not null then
    select * into v_row from public.opportunities o where o.id=p_opportunity_id and o.user_id=v_user
      and o.cycle_id=p_expected_cycle_id and o.voided_at is null for update;
    if not found then raise exception 'opportunity_not_found' using errcode='42501'; end if;
    if v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'opportunity_stale' using errcode='40001'; end if;
    select pg_catalog.jsonb_build_object('title',v_row.title,'company',v_row.company,'application_url',v_row.application_url,
      'stage',v_row.stage,'result',v_row.result,'result_note',v_row.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_row.id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_row.id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_row.id)) into v_before;
    v_id := v_row.id;
    v_kind := case when v_row.stage='finished' and p_stage<>'finished' then 'reopened'
      when v_row.stage is distinct from p_stage then 'moved' else 'edited' end;
    update public.opportunities set title=pg_catalog.btrim(p_title),company=nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
      application_url=nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),stage=p_stage,result=p_result,
      result_note=case when p_result='other' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end,
      updated_at=greatest(pg_catalog.clock_timestamp(),v_row.updated_at+interval '1 microsecond') where id=v_id;
  else
    insert into public.opportunities(user_id,cycle_id,creation_request_id,title,company,application_url,stage,result,result_note)
      values(v_user,p_expected_cycle_id,p_creation_request_id,pg_catalog.btrim(p_title),nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
        nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),p_stage,p_result,
        case when p_result='other' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end) returning id into v_id;
    v_kind := 'created';
  end if;
  delete from public.opportunity_contacts where opportunity_id=v_id;
  insert into public.opportunity_contacts(user_id,opportunity_id,contact_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_contacts) x) ids;
  delete from public.opportunity_objectives where opportunity_id=v_id;
  insert into public.opportunity_objectives(user_id,opportunity_id,objective_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_objectives) x) ids;
  delete from public.opportunity_interactions where opportunity_id=v_id;
  insert into public.opportunity_interactions(user_id,opportunity_id,interaction_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_interactions) x) ids;
  insert into public.opportunity_events(user_id,opportunity_id,actor_id,kind,before_state,after_state)
    select v_user,v_id,v_user,v_kind,v_before,pg_catalog.jsonb_build_object('title',o.title,'company',o.company,
      'application_url',o.application_url,'stage',o.stage,'result',o.result,'result_note',o.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_id))
    from public.opportunities o where o.id=v_id;
  return v_id;
end; $$;

alter function public.opportunity_interaction_active_v1(jsonb) owner to postgres;
alter function public.read_opportunity_interactions_v1(uuid[]) owner to postgres;
revoke all on function public.opportunity_interaction_active_v1(jsonb),
  public.read_opportunity_interactions_v1(uuid[]) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.read_opportunity_interactions_v1(uuid[]) to authenticated;
do $guard$
declare v_reasons text[];
begin
  select reasons into v_reasons from (with expected(signature,body_hash,volatility,result_type,definer,client_execute) as (values
  ('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)','42be06a62e4d56acba2f12d169698a77','v','uuid',true,true),
  ('public.assert_opportunity_participation_v1(uuid,uuid,uuid)','37aa13a991254386a36e10776b774c8b','v','void',true,false),
  ('public.check_opportunity_participation_v1()','94dfe26a393a9e2fd4807d13bdfcc03e','v','trigger',true,false),
  ('public.opportunity_interaction_active_v1(jsonb)','02cd2b943a1f120ef3303192a953ab59','i','boolean',false,false),
  ('public.read_opportunity_interactions_v1(uuid[])','d7db85a9e40b0699039e76f4aa172023','s','record',true,true)),
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
)
select coalesce(array_agg(reason order by reason),array[]::text[]) as reasons from failures) checks;
  if pg_catalog.cardinality(v_reasons)>0 then raise exception 'opportunity_lifecycle_postcondition: %',v_reasons; end if;
end; $guard$;

commit;
