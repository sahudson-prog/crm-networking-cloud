begin read only;
do $$ declare r record; p pg_proc%rowtype; t oid; begin
  for r in select * from (values
    ('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','be197960fddd2fc53b18e6bfcf00c1dd',true),
    ('public.calendar_local_hash_v2(uuid,jsonb)','665792a8a46221111a7b9121670cbe65',false)) x(signature,hash,client) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or not p.prosecdef or p.proowner<>'postgres'::regrole or p.proconfig is distinct from array['search_path=""']
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or has_function_privilege('authenticated',p.oid,'EXECUTE') is distinct from r.client
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where
        a.grantee not in ('postgres'::regrole,case when r.client then 'authenticated'::regrole else 'postgres'::regrole end) or a.is_grantable and a.grantee<>'postgres'::regrole) then
      raise exception 'STOP: Calendar v2 function/ACL drift'; end if;
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
  if has_function_privilege('authenticated','public.apply_calendar_discovery_v1(uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz)','EXECUTE') then
    raise exception 'STOP: old reconciler still executable'; end if;
end $$;
select 'PASS: Calendar 003 code, private state, ownership, RLS, ACL and old-runtime fencing' as result;
commit;
