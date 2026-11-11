-- Read-only diagnostic. No identifiers or user payloads are returned.
begin read only;
do $contract$
declare r record; p pg_proc%rowtype; t oid; who text;
begin
  if to_regprocedure('public.apply_google_interaction_sync_internal_v2(uuid,jsonb)') is not null then raise exception 'STOP: 005 already present'; end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole=current_user::regrole and d.defaclobjtype='f'
      and d.defaclnamespace in (0,'public'::regnamespace)
      and a.grantee not in (0,'postgres'::regrole,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole,'supabase_auth_admin'::regrole))
  then raise exception 'STOP: Calendar 005 unexpected function default ACL'; end if;
  for r in select * from (values
    ('public.apply_google_interaction_sync_v1(uuid,jsonb)','b50f8d410fa7138ab3252f126984d9f8',false,'v','jsonb','plpgsql'),
    ('public.apply_calendar_discovery_v1(uuid,jsonb)','d7eb754e2d6afee5f8f333cb548c1af7',false,'v','jsonb','plpgsql'),
    ('public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)','3de0a3fa967bb855e5a70029cfea4850',false,'v','jsonb','plpgsql'),
    ('public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean)','ecfd8c5a36cda965b0fceccab7aff02e',false,'v','jsonb','plpgsql'),
    ('public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz)','d62c4c9b64924f221f594f7175e5b4ad',false,'v','jsonb','plpgsql'),
    ('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)','be197960fddd2fc53b18e6bfcf00c1dd',false,'v','jsonb','plpgsql'),
    ('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','a803c67d432b24eb74d8c242d26631e4',true,'v','jsonb','plpgsql'),
    ('public.calendar_local_hash_v2(uuid,jsonb)','665792a8a46221111a7b9121670cbe65',false,'s','text','sql'),
    ('public.current_user_can_sync_connected_account_base_v1(uuid,text)','87b109e1eb93bbcd347255f55af637e1',false,'s','boolean','sql'),
    ('public.current_user_can_sync_connected_account_v1(uuid,text)','3080b157198b77d076185c513ce0cb74',true,'s','boolean','sql'),
    ('public.current_user_can_use_calendar_admin_v1()','27bd7b911459f42a2478456fee0015b9',true,'s','boolean','sql'),
    ('public.apply_google_periodic_v1(uuid,jsonb)','fa6bf40bd8d9f446ecbd1c7cde30bd24',true,'v','jsonb','sql'),
    ('public.apply_google_history_v1(uuid,jsonb,jsonb)','ff0702a42eea49431e4355aae352f75f',true,'v','jsonb','plpgsql'),
    ('public.assert_history_context_v1(jsonb)','8b0781f2e28899b57d11c31a16b0553f',false,'v','timestamp with time zone','plpgsql'),
    ('public.user_has_provider_rollout_for_user_v1(uuid,text)','80d831fcd4a29397287059032f1afa99',false,'s','boolean','sql')) x(signature,hash,client,volatility,result,language) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or not p.prosecdef or p.proowner<>'postgres'::regrole
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility or p.proretset or p.prorettype<>r.result::regtype
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from r.client
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,case when r.client then 'authenticated'::regrole else 'postgres'::regrole end)
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: Calendar 005 body/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') then
        raise exception 'STOP: Calendar 005 inherited EXECUTE drift: %',r.signature; end if;
    end loop;
  end loop;
  foreach t in array array[to_regclass('public.calendar_sync_state_v2'),to_regclass('public.calendar_sync_runs_v2'),to_regclass('public.calendar_sync_batches_v2'),to_regclass('public.calendar_sync_stamps_v2')] loop
    if t is null or not exists(select 1 from pg_class where oid=t and relrowsecurity and relowner='postgres'::regrole)
      or exists(select 1 from pg_policy where polrelid=t)
      or exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=t and a.grantee<>'postgres'::regrole)
      or exists(select 1 from pg_attribute where attrelid=t and attacl is not null)
      or exists(select 1 from pg_constraint where conrelid=t and not convalidated)
      or not exists(select 1 from pg_constraint where conrelid=t and contype='p')
      or not exists(select 1 from pg_constraint where conrelid=t and contype='f' and confdeltype='c') then
      raise exception 'STOP: Calendar v2 private table drift'; end if;
  end loop;
  for r in select * from (values
    ('public.calendar_sync_state_v2','user_id:uuid:1,account_id:uuid:1,calendar_id:text:1,flow_version:integer:1,sync_token:text:0,last_success:timestamp with time zone:0,last_result:jsonb:0,active_run:uuid:0,lease_until:timestamp with time zone:0',5),
    ('public.calendar_sync_runs_v2','user_id:uuid:1,account_id:uuid:1,run_id:uuid:1,time_min:timestamp with time zone:1,time_max:timestamp with time zone:1,created_at:timestamp with time zone:1,status:text:1,created_count:integer:1,updated_count:integer:1,skipped_count:integer:1,result:jsonb:0',7),
    ('public.calendar_sync_batches_v2','user_id:uuid:1,account_id:uuid:1,run_id:uuid:1,batch_no:integer:1,payload_hash:text:1,result:jsonb:1',3),
    ('public.calendar_sync_stamps_v2','source_id:uuid:1,event_hash:text:1,provider_updated:timestamp with time zone:0,local_hash:text:1',2)) x(name,columns,checks) loop
    t:=to_regclass(r.name);
    if (select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::integer,',' order by attnum) from pg_attribute where attrelid=t and attnum>0 and not attisdropped) is distinct from r.columns
      or (select count(*) from pg_constraint where conrelid=t)<>r.checks then raise exception 'STOP: Calendar v2 column/constraint drift'; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_state_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((flow_version = 2))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_state_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((calendar_id = ''primary''::text))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_runs_v2'::regclass and pg_get_constraintdef(oid)='CHECK ((isfinite(time_min) AND isfinite(time_max) AND (time_min < time_max)))')
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_runs_v2'::regclass and contype='f' and confrelid='public.calendar_sync_state_v2'::regclass and conkey=array[1,2]::smallint[] and confkey=array[1,2]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_batches_v2'::regclass and contype='f' and confrelid='public.calendar_sync_runs_v2'::regclass and conkey=array[1,2,3]::smallint[] and confkey=array[1,2,3]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.calendar_sync_stamps_v2'::regclass and contype='f' and confrelid='public.external_interaction_sources'::regclass)
    then raise exception 'STOP: Calendar v2 scope/temporal/FK drift'; end if;
end $contract$;

do $data$
begin
  if exists(select 1 from public.external_interaction_sources s
    left join public.interactions i on i.id=s.interaction_id
    left join public.connected_accounts a on a.id=s.connected_account_id
    where lower(btrim(s.provider))='google' and lower(btrim(s.source_service)) in ('gmail','calendar') and (
      s.provider<>'google' or s.source_service<>lower(btrim(s.source_service))
      or btrim(s.external_id)='' or s.external_id<>btrim(s.external_id)
      or i.id is null or i.user_id is distinct from s.user_id or i.provider is distinct from 'google'
      or i.provider_event_id is distinct from s.external_id
      or i.interaction_type is distinct from case s.source_service when 'gmail' then 'email' else 'calendar' end
      or coalesce(nullif(s.external_object_type,''),case s.source_service when 'gmail' then 'email_message' else 'calendar_event' end)
        <>case s.source_service when 'gmail' then 'email_message' else 'calendar_event' end
      or (i.metadata->>'external_source_service' is not null and i.metadata->>'external_source_service'<>s.source_service)
      or a.user_id is distinct from s.user_id or a.provider is distinct from 'google'
      or (s.source_service='gmail' and left(lower(s.external_id),9)='calendar_')))
    or exists(select 1 from public.external_interaction_sources s join public.external_interaction_sources x
      on x.interaction_id=s.interaction_id and x.id<>s.id
      where s.provider='google' and s.source_service in ('gmail','calendar'))
    or exists(select 1 from public.external_interaction_sources s where s.provider='google'
      group by s.user_id,lower(s.external_id) having count(*)>1)
    or exists(select 1 from public.interactions i where i.provider='google' and i.provider_event_id is not null
      group by i.user_id,lower(i.provider_event_id) having count(*)>1)
    or exists(select 1 from public.interactions i join public.external_interaction_sources s
      on s.user_id=i.user_id and s.provider='google' and lower(s.external_id)=lower(i.provider_event_id)
      where i.provider='google' and (s.interaction_id<>i.id or s.external_id<>i.provider_event_id))
  then raise exception 'STOP: Google cross-resource identity/source ambiguity; owner review required'; end if;
end $data$;

select 'PASS: Calendar 005 baseline 001-004, ACL and resource identities' as result;
commit;
