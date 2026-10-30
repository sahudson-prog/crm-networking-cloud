-- Structural and access verifier for the installed Opportunities V1 contract.
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
select pg_catalog.jsonb_build_object('verdict','pass','contract','opportunities_v1');
rollback;
