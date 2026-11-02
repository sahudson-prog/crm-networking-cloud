-- Composed post-closure verifier; replaces 002/004 checks for this phase without weakening link/RLS controls.
begin transaction read only;
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

select 'PASS' as opportunity_closure_verifier;
rollback;

