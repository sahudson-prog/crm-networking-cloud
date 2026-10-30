-- PROD CONTRACT CHANGE: install only after 002 -> 003 -> 004 and this preflight.
-- Pause opportunity writers during cutover. Old five-stage RPC fails closed after COMMIT.
-- No historical events are rewritten. Any legacy finished row requires owner resolution first.
begin;
lock table public.opportunities in access exclusive mode;

do $verify$
declare v_table text; v_function regprocedure; v_role text; v_priv text;
begin
  foreach v_table in array array['opportunities','opportunity_contacts','opportunity_objectives',
    'opportunity_interactions','opportunity_events'] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then raise exception 'Missing %',v_table; end if;
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=('public.' || v_table)::regclass
      and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner)='postgres') then
      raise exception 'Owner or RLS invalid for %',v_table; end if;
    if (select pg_catalog.count(*) from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename=v_table and p.cmd='SELECT'
      and p.roles=array['authenticated']::name[]
      and pg_catalog.regexp_replace(p.qual,'[[:space:]()]','','g')='user_id=auth.uidANDcurrent_user_has_app_access')<>1
      or (select pg_catalog.count(*) from pg_catalog.pg_policies p
        where p.schemaname='public' and p.tablename=v_table)<>1 then
      raise exception 'Read policy invalid for %',v_table; end if;
    if not pg_catalog.has_table_privilege('authenticated','public.' || v_table,'SELECT') then
      raise exception 'Missing own read on %',v_table; end if;
    if exists(select 1 from pg_catalog.pg_class c,
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      where c.oid=('public.' || v_table)::regclass and a.grantee<>c.relowner
        and (a.grantee<>'authenticated'::regrole or a.privilege_type<>'SELECT' or a.is_grantable)) then
      raise exception 'Unexpected table ACL on %',v_table; end if;
    foreach v_role in array array['anon','service_role','supabase_auth_admin'] loop
      if pg_catalog.has_table_privilege(v_role,'public.' || v_table,'SELECT') then
        raise exception 'Excess read on % for %',v_table,v_role; end if;
    end loop;
    foreach v_role in array array['authenticated','anon','service_role','supabase_auth_admin'] loop
      foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if pg_catalog.has_table_privilege(v_role,'public.' || v_table,v_priv) then
          raise exception 'Excess % on % for %',v_priv,v_table,v_role; end if;
      end loop;
    end loop;
  end loop;
  foreach v_function in array array[
    'public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)'::regprocedure,
    'public.void_opportunity_v1(uuid,text,uuid)'::regprocedure,
    'public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)'::regprocedure
  ] loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=v_function
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig in (array['search_path='],array['search_path=""']))
      or not pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'RPC contract invalid: %',v_function; end if;
    if exists(select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=v_function and a.grantee<>p.proowner
        and (a.grantee<>'authenticated'::regrole or a.is_grantable)) then
      raise exception 'Unexpected RPC ACL: %',v_function; end if;
    foreach v_role in array array['anon','service_role','supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role,v_function,'EXECUTE') then
        raise exception 'Excess RPC EXECUTE: % %',v_function,v_role; end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='opportunity_result_matches_stage'
      and conrelid='public.opportunities'::regclass and convalidated
      and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')=
        'CHECKstage=''finished''::text=resultISNOTNULL')
    or not exists(select 1 from pg_catalog.pg_constraint where conname='opportunity_cycle_identity'
      and conrelid='public.opportunities'::regclass and convalidated) then
    raise exception 'Opportunity invariants missing'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='opportunity_creation_request'
    and conrelid='public.opportunities'::regclass and convalidated and contype='u'
    and pg_catalog.pg_get_constraintdef(oid)='UNIQUE (user_id, creation_request_id)') then
    raise exception 'Creation idempotency invariant missing'; end if;
  if not exists(select 1 from pg_catalog.pg_indexes where schemaname='public'
    and tablename='opportunities' and indexname='opportunities_cycle_stage_idx') then
    raise exception 'Active-cycle index missing'; end if;
  foreach v_table in array array['opportunity_contacts','opportunity_objectives','opportunity_interactions'] loop
    if not exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=('public.' || v_table)::regclass and k.contype='p' and k.convalidated
        and pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (opportunity_id, ' ||
          case v_table when 'opportunity_contacts' then 'contact_id' when 'opportunity_objectives' then 'objective_id'
          else 'interaction_id' end || ')')
      or (select count(*) from pg_catalog.pg_constraint k where k.conrelid=('public.' || v_table)::regclass
        and k.contype='f' and k.convalidated and k.confdeltype='c' and k.confrelid in
          ('public.profiles'::regclass,'public.opportunities'::regclass,
            (case v_table when 'opportunity_contacts' then 'public.contacts'
              when 'opportunity_objectives' then 'public.objectives' else 'public.interactions' end)::regclass))<>3 then
      raise exception 'Link identity or lifecycle invalid: %',v_table; end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger t
    where t.tgname in ('validate_opportunity_contacts_v1','validate_opportunity_objectives_v1',
      'validate_opportunity_interactions_v1') and not t.tgisinternal and t.tgenabled='O'
      and t.tgfoid='public.validate_opportunity_link_v1()'::regprocedure and t.tgtype=23
      and t.tgname='validate_' || (select c.relname from pg_catalog.pg_class c where c.oid=t.tgrelid) || '_v1')<>3
    or not exists(select 1 from pg_catalog.pg_proc p
      where p.oid='public.validate_opportunity_link_v1()'::regprocedure
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig in (array['search_path='],array['search_path=""']))
      or pg_catalog.has_function_privilege('authenticated','public.validate_opportunity_link_v1()','EXECUTE')
      or pg_catalog.has_function_privilege('anon','public.validate_opportunity_link_v1()','EXECUTE')
      or pg_catalog.has_function_privilege('service_role','public.validate_opportunity_link_v1()','EXECUTE') then
    raise exception 'Link ownership guard invalid'; end if;
  if exists(select 1 from pg_catalog.pg_proc p,
    pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where p.oid='public.validate_opportunity_link_v1()'::regprocedure and a.grantee<>p.proowner)
    or exists(select 1 from pg_catalog.pg_class c,
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))) a
      where c.oid='public.opportunity_events_id_seq'::regclass and a.grantee<>c.relowner) then
    raise exception 'Internal guard or sequence exposed'; end if;
end; $verify$;

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
  if pg_catalog.cardinality(v_reasons)>0 then raise exception 'opportunity_lifecycle_verifier: %',v_reasons; end if;
end; $guard$;
do $verify$
declare v_oid oid; v_name text;
begin
  foreach v_name in array array[
    'public.assert_opportunity_participation_v1(uuid,uuid,uuid)',
    'public.check_opportunity_participation_v1()'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_name);
    if v_oid is null or not exists (select 1 from pg_catalog.pg_proc p where p.oid=v_oid
      and p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres')
      or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin',v_oid,'EXECUTE') then
      raise exception 'opportunity_participation_function_invalid: %',v_name;
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger
    where tgname in ('check_opportunity_interaction_participation_v1',
      'check_opportunity_contact_participation_v1','check_interaction_participant_opportunity_v1')
      and not tgisinternal and tgenabled='O' and tgdeferrable and tginitdeferred) <> 3 then
    raise exception 'opportunity_participation_triggers_invalid';
  end if;
  if exists (select 1 from public.opportunity_interactions link where not exists (
    select 1 from public.opportunity_contacts contact
    join public.interaction_participants participant
      on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
    where contact.user_id=link.user_id and contact.opportunity_id=link.opportunity_id
      and participant.interaction_id=link.interaction_id)) then
    raise exception 'opportunity_participation_data_invalid';
  end if;
end; $verify$;
do $constraint_contract$
begin
 if exists(select 1 from (values
 ('opportunities_stage_check',$expected$CHECKstage=ANYARRAY['identified'::text,'applied'::text,'in_process'::text,'offer_received'::text,'finished'::text]$expected$),
 ('opportunities_result_check',$expected$CHECKresult=ANYARRAY['offer_accepted'::text,'offer_declined'::text,'not_selected'::text,'withdrawn'::text,'no_progress'::text,'other'::text]$expected$),
 ('opportunities_check',$expected$CHECKresult_noteISNULLORNOTresultISDISTINCTFROM'other'::textANDlengthresult_note<=500$expected$)
 ) e(name,definition) where not exists(select 1 from pg_catalog.pg_constraint c
   where c.conrelid='public.opportunities'::regclass and c.conname=e.name and c.convalidated
   and c.contype='c' and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'[[:space:]()]','','g')=e.definition))
 then raise exception 'opportunity_legacy_constraint_drift'; end if;
 if not exists(select 1 from pg_catalog.pg_constraint c
   where c.conrelid='public.opportunity_events'::regclass and c.conname='opportunity_events_kind_check' and c.convalidated
   and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'[[:space:]()]','','g')=
   $expected$CHECKkind=ANYARRAY['created'::text,'edited'::text,'moved'::text,'reopened'::text,'voided'::text,'merge_contacts'::text]$expected$)
 then raise exception 'opportunity_event_constraint_drift'; end if;
end; $constraint_contract$;
do $absence$
begin
 if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.opportunities'::regclass
   and attname='situation' and not attisdropped)
 or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('save_opportunity_v2','opportunity_closure_valid_v1'))
 then raise exception 'opportunity_closure_objects_already_present'; end if;
end; $absence$;
do $legacy$
begin
 if exists(select 1 from public.opportunities where stage='finished') then
   raise exception 'legacy_finished_stage_requires_owner_resolution'; end if;
end; $legacy$;

create function public.opportunity_closure_valid_v1(p_stage text,p_situation text,p_result text)
returns boolean language sql immutable set search_path = '' as $$
 select coalesce(p_stage in ('identified','applied','in_process','offer_received') and
   ((p_situation='active' and p_result is null) or (p_situation='finalized' and case p_stage
     when 'identified' then p_result in ('discarded','application_deadline_expired','vacancy_cancelled','other')
     when 'applied' then p_result in ('not_selected','application_withdrawn','vacancy_cancelled','no_response','other')
     when 'in_process' then p_result in ('not_selected','process_withdrawn','vacancy_cancelled','no_response','other')
     when 'offer_received' then p_result in ('offer_accepted','offer_declined','offer_expired','other')
     else false end)),false);
$$;
alter function public.opportunity_closure_valid_v1(text,text,text) owner to postgres;
revoke all on function public.opportunity_closure_valid_v1(text,text,text) from public,anon,authenticated,service_role,supabase_auth_admin;
alter table public.opportunities
 drop constraint opportunities_stage_check,
 drop constraint opportunities_result_check,
 drop constraint opportunities_check,
 drop constraint opportunity_result_matches_stage;
alter table public.opportunities add column situation text generated always as
 (case when voided_at is not null then 'voided'::text when result is not null then 'finalized'::text else 'active'::text end) stored;
alter table public.opportunities
 add constraint opportunity_closure_valid check (
   public.opportunity_closure_valid_v1(stage,case when situation='voided' then
     case when result is null then 'active' else 'finalized' end else situation end,result)),
 add constraint opportunity_closure_note check (
   (result is not null or result_note is null) and (result_note is null or length(result_note)<=500));
alter table public.opportunity_events drop constraint opportunity_events_kind_check;
alter table public.opportunity_events add constraint opportunity_events_kind_check
 check (kind in ('created','edited','moved','finalized','reopened','voided','merge_contacts'));

create function public.save_opportunity_v2(
  p_expected_cycle_id uuid, p_expected_context text, p_opportunity_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_company text, p_application_url text, p_stage text, p_result text, p_result_note text,
  p_contact_ids uuid[], p_objective_ids uuid[], p_interaction_ids uuid[], p_situation text, p_creation_request_id uuid default null
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
    or not public.opportunity_closure_valid_v1(p_stage,p_situation,p_result)
    or (p_situation='active' and nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') is not null)
    or pg_catalog.length(coalesce(p_result_note,''))>500 then
    raise exception 'invalid_opportunity' using errcode='22023'; end if;
  v_requested := pg_catalog.jsonb_build_object('title',pg_catalog.btrim(p_title),
    'company',nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
    'application_url',nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),
    'situation',p_situation,'stage',p_stage,'result',p_result,'result_note',nullif(pg_catalog.btrim(coalesce(p_result_note,'')),''),
    'contacts',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_contacts) x) s),
    'objectives',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_objectives) x) s),
    'interactions',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_interactions) x) s));
  if p_opportunity_id is null then
    if p_creation_request_id is null then raise exception 'opportunity_request_required' using errcode='22023'; end if;
    select * into v_row from public.opportunities where user_id=v_user and creation_request_id=p_creation_request_id;
    if found then
      if v_row.cycle_id is distinct from p_expected_cycle_id or not exists(select 1 from public.opportunity_events
        where opportunity_id=v_row.id and kind='created'
          and after_state - 'situation' = v_requested - 'situation'
          and coalesce(after_state->>'situation','active')=p_situation) then
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
      'situation',v_row.situation,'stage',v_row.stage,'result',v_row.result,'result_note',v_row.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_row.id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_row.id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_row.id)) into v_before;
    v_id := v_row.id;
    if v_row.stage<>p_stage and (v_row.situation='finalized' or p_situation='finalized') then
      raise exception 'opportunity_reopen_same_stage_required' using errcode='22023'; end if;
    v_kind := case when v_row.situation='finalized' and p_situation='active' then 'reopened'
      when v_row.situation='active' and p_situation='finalized' then 'finalized'
      when v_row.stage is distinct from p_stage then 'moved' else 'edited' end;
    update public.opportunities set title=pg_catalog.btrim(p_title),company=nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
      application_url=nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),stage=p_stage,result=p_result,
      result_note=case when p_situation='finalized' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end,
      updated_at=greatest(pg_catalog.clock_timestamp(),v_row.updated_at+interval '1 microsecond') where id=v_id;
  else
    insert into public.opportunities(user_id,cycle_id,creation_request_id,title,company,application_url,stage,result,result_note)
      values(v_user,p_expected_cycle_id,p_creation_request_id,pg_catalog.btrim(p_title),nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
        nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),p_stage,p_result,
        case when p_situation='finalized' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end) returning id into v_id;
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
      'application_url',o.application_url,'situation',o.situation,'stage',o.stage,'result',o.result,'result_note',o.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_id))
    from public.opportunities o where o.id=v_id;
  return v_id;
end; $$;

create or replace function public.save_opportunity_v1(
  p_expected_cycle_id uuid, p_expected_context text, p_opportunity_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_company text, p_application_url text, p_stage text, p_result text, p_result_note text,
  p_contact_ids uuid[], p_objective_ids uuid[], p_interaction_ids uuid[], p_creation_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'opportunity_runtime_upgrade_required' using errcode='0A000';
end; $$;
alter function public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid) owner to postgres;
revoke all on function public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid) to authenticated;
-- Existing ownership/link/participation triggers, policies, reset and merge are preserved.
do $verify$
declare v_table text; v_function regprocedure; v_role text; v_priv text;
begin
  foreach v_table in array array['opportunities','opportunity_contacts','opportunity_objectives',
    'opportunity_interactions','opportunity_events'] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then raise exception 'Missing %',v_table; end if;
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=('public.' || v_table)::regclass
      and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner)='postgres') then
      raise exception 'Owner or RLS invalid for %',v_table; end if;
    if (select pg_catalog.count(*) from pg_catalog.pg_policies p
      where p.schemaname='public' and p.tablename=v_table and p.cmd='SELECT'
      and p.roles=array['authenticated']::name[]
      and pg_catalog.regexp_replace(p.qual,'[[:space:]()]','','g')='user_id=auth.uidANDcurrent_user_has_app_access')<>1
      or (select pg_catalog.count(*) from pg_catalog.pg_policies p
        where p.schemaname='public' and p.tablename=v_table)<>1 then
      raise exception 'Read policy invalid for %',v_table; end if;
    if not pg_catalog.has_table_privilege('authenticated','public.' || v_table,'SELECT') then
      raise exception 'Missing own read on %',v_table; end if;
    if exists(select 1 from pg_catalog.pg_class c,
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      where c.oid=('public.' || v_table)::regclass and a.grantee<>c.relowner
        and (a.grantee<>'authenticated'::regrole or a.privilege_type<>'SELECT' or a.is_grantable)) then
      raise exception 'Unexpected table ACL on %',v_table; end if;
    foreach v_role in array array['anon','service_role','supabase_auth_admin'] loop
      if pg_catalog.has_table_privilege(v_role,'public.' || v_table,'SELECT') then
        raise exception 'Excess read on % for %',v_table,v_role; end if;
    end loop;
    foreach v_role in array array['authenticated','anon','service_role','supabase_auth_admin'] loop
      foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if pg_catalog.has_table_privilege(v_role,'public.' || v_table,v_priv) then
          raise exception 'Excess % on % for %',v_priv,v_table,v_role; end if;
      end loop;
    end loop;
  end loop;
  foreach v_function in array array[
    'public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)'::regprocedure,
    'public.void_opportunity_v1(uuid,text,uuid)'::regprocedure,
    'public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)'::regprocedure
  ] loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=v_function
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig in (array['search_path='],array['search_path=""']))
      or not pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'RPC contract invalid: %',v_function; end if;
    if exists(select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=v_function and a.grantee<>p.proowner
        and (a.grantee<>'authenticated'::regrole or a.is_grantable)) then
      raise exception 'Unexpected RPC ACL: %',v_function; end if;
    foreach v_role in array array['anon','service_role','supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role,v_function,'EXECUTE') then
        raise exception 'Excess RPC EXECUTE: % %',v_function,v_role; end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='opportunity_cycle_identity'
    and conrelid='public.opportunities'::regclass and convalidated) then raise exception 'Cycle identity missing'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='opportunity_creation_request'
    and conrelid='public.opportunities'::regclass and convalidated and contype='u'
    and pg_catalog.pg_get_constraintdef(oid)='UNIQUE (user_id, creation_request_id)') then
    raise exception 'Creation idempotency invariant missing'; end if;
  if not exists(select 1 from pg_catalog.pg_indexes where schemaname='public'
    and tablename='opportunities' and indexname='opportunities_cycle_stage_idx') then
    raise exception 'Active-cycle index missing'; end if;
  foreach v_table in array array['opportunity_contacts','opportunity_objectives','opportunity_interactions'] loop
    if not exists(select 1 from pg_catalog.pg_constraint k
      where k.conrelid=('public.' || v_table)::regclass and k.contype='p' and k.convalidated
        and pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (opportunity_id, ' ||
          case v_table when 'opportunity_contacts' then 'contact_id' when 'opportunity_objectives' then 'objective_id'
          else 'interaction_id' end || ')')
      or (select count(*) from pg_catalog.pg_constraint k where k.conrelid=('public.' || v_table)::regclass
        and k.contype='f' and k.convalidated and k.confdeltype='c' and k.confrelid in
          ('public.profiles'::regclass,'public.opportunities'::regclass,
            (case v_table when 'opportunity_contacts' then 'public.contacts'
              when 'opportunity_objectives' then 'public.objectives' else 'public.interactions' end)::regclass))<>3 then
      raise exception 'Link identity or lifecycle invalid: %',v_table; end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger t
    where t.tgname in ('validate_opportunity_contacts_v1','validate_opportunity_objectives_v1',
      'validate_opportunity_interactions_v1') and not t.tgisinternal and t.tgenabled='O'
      and t.tgfoid='public.validate_opportunity_link_v1()'::regprocedure and t.tgtype=23
      and t.tgname='validate_' || (select c.relname from pg_catalog.pg_class c where c.oid=t.tgrelid) || '_v1')<>3
    or not exists(select 1 from pg_catalog.pg_proc p
      where p.oid='public.validate_opportunity_link_v1()'::regprocedure
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig in (array['search_path='],array['search_path=""']))
      or pg_catalog.has_function_privilege('authenticated','public.validate_opportunity_link_v1()','EXECUTE')
      or pg_catalog.has_function_privilege('anon','public.validate_opportunity_link_v1()','EXECUTE')
      or pg_catalog.has_function_privilege('service_role','public.validate_opportunity_link_v1()','EXECUTE') then
    raise exception 'Link ownership guard invalid'; end if;
  if exists(select 1 from pg_catalog.pg_proc p,
    pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where p.oid='public.validate_opportunity_link_v1()'::regprocedure and a.grantee<>p.proowner)
    or exists(select 1 from pg_catalog.pg_class c,
      pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))) a
      where c.oid='public.opportunity_events_id_seq'::regclass and a.grantee<>c.relowner) then
    raise exception 'Internal guard or sequence exposed'; end if;
end; $verify$;
do $guard$
declare v_reasons text[];
begin
  select reasons into v_reasons from (with expected(signature,body_hash,volatility,result_type,definer,client_execute) as (values
  ('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)','f12a2572fb54d3a35dfe5bf105ea3d29','v','uuid',true,true),
  ('public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid)','0ba0b6b28bf0b3664c171c4a386282a0','v','uuid',true,true),
  ('public.opportunity_closure_valid_v1(text,text,text)','4ebc3a593bcb5a53b928aa6a05cdbb41','i','boolean',false,false),
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
    and p.pronargdefaults=case when e.signature like '%save_opportunity_v%' then 1 else 0 end
    and coalesce(pg_catalog.pg_get_expr(p.proargdefaults,0),'')=case when e.signature like '%save_opportunity_v%' then 'NULL::uuid' else '' end
    and p.proargnames is not distinct from case
      when e.signature like '%save_opportunity_v2%' then array['p_expected_cycle_id','p_expected_context','p_opportunity_id','p_expected_updated_at','p_title','p_company','p_application_url','p_stage','p_result','p_result_note','p_contact_ids','p_objective_ids','p_interaction_ids','p_situation','p_creation_request_id']
      when e.signature like '%opportunity_closure_valid_v1%' then array['p_stage','p_situation','p_result']
      when e.signature like '%save_opportunity_v1%' then array['p_expected_cycle_id','p_expected_context','p_opportunity_id','p_expected_updated_at','p_title','p_company','p_application_url','p_stage','p_result','p_result_note','p_contact_ids','p_objective_ids','p_interaction_ids','p_creation_request_id']
      when e.signature like '%assert_opportunity_participation_v1%' then array['p_user_id','p_opportunity_id','p_interaction_id']
      when e.signature like '%opportunity_interaction_active_v1%' then array['p_row']
      when e.signature like '%read_opportunity_interactions_v1%' then array['p_ids','id','subject','interaction_type','occurred_at']
      else p.proargnames end
    and (select count(*) from pg_catalog.pg_proc overload where overload.pronamespace=p.pronamespace and overload.proname=p.proname)=1
    and p.prolang=(select oid from pg_catalog.pg_language where lanname=case when (e.signature like '%active_v1%' or e.signature like '%closure_valid_v1%') then 'sql' else 'plpgsql' end)
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
  if pg_catalog.cardinality(v_reasons)>0 then raise exception 'opportunity_lifecycle_verifier: %',v_reasons; end if;
end; $guard$;
do $verify$
declare v_oid oid; v_name text;
begin
  foreach v_name in array array[
    'public.assert_opportunity_participation_v1(uuid,uuid,uuid)',
    'public.check_opportunity_participation_v1()'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_name);
    if v_oid is null or not exists (select 1 from pg_catalog.pg_proc p where p.oid=v_oid
      and p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres')
      or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin',v_oid,'EXECUTE') then
      raise exception 'opportunity_participation_function_invalid: %',v_name;
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger
    where tgname in ('check_opportunity_interaction_participation_v1',
      'check_opportunity_contact_participation_v1','check_interaction_participant_opportunity_v1')
      and not tgisinternal and tgenabled='O' and tgdeferrable and tginitdeferred) <> 3 then
    raise exception 'opportunity_participation_triggers_invalid';
  end if;
  if exists (select 1 from public.opportunity_interactions link where not exists (
    select 1 from public.opportunity_contacts contact
    join public.interaction_participants participant
      on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
    where contact.user_id=link.user_id and contact.opportunity_id=link.opportunity_id
      and participant.interaction_id=link.interaction_id)) then
    raise exception 'opportunity_participation_data_invalid';
  end if;
end; $verify$;
do $closure$
begin
 if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
   on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='public.opportunities'::regclass and a.attname='situation'
     and a.atttypid='text'::regtype and a.attgenerated='s'
     and pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'[[:space:]()]','','g')=
     'CASEWHENvoided_atISNOTNULLTHEN''voided''::textWHENresultISNOTNULLTHEN''finalized''::textELSE''active''::textEND')
 then raise exception 'opportunity_situation_invalid'; end if;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.opportunities'::regclass
   and conname='opportunity_closure_valid' and convalidated
   and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')=
   'CHECKopportunity_closure_valid_v1stage,CASEWHENsituation=''voided''::textTHENCASEWHENresultISNULLTHEN''active''::textELSE''finalized''::textENDELSEsituationEND,result')
 then raise exception 'opportunity_closure_constraint_invalid'; end if;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.opportunities'::regclass
   and conname='opportunity_closure_note' and convalidated
   and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')=
   'CHECKresultISNOTNULLORresult_noteISNULLANDresult_noteISNULLORlengthresult_note<=500')
 then raise exception 'opportunity_closure_note_invalid'; end if;
 if exists(select 1 from public.opportunities where stage='finished') then raise exception 'legacy_finished_remaining'; end if;
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.opportunity_events'::regclass
   and conname='opportunity_events_kind_check' and convalidated
   and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')=
   $expected$CHECKkind=ANYARRAY['created'::text,'edited'::text,'moved'::text,'finalized'::text,'reopened'::text,'voided'::text,'merge_contacts'::text]$expected$)
 then raise exception 'opportunity_event_kind_invalid'; end if;
end; $closure$;
commit;

