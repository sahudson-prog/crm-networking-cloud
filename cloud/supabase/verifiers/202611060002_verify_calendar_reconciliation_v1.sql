begin read only;
do $$
declare r record; p pg_proc%rowtype; t oid:=to_regclass('public.calendar_participant_provenance_v1');
begin
  for r in select * from (values
    ('public.apply_calendar_discovery_v1(uuid,jsonb)','d7eb754e2d6afee5f8f333cb548c1af7'),
    ('public.prepare_calendar_reconciliation_v1(uuid,timestamptz,timestamptz,jsonb,boolean)','ecfd8c5a36cda965b0fceccab7aff02e'),
    ('public.reconcile_calendar_event_v1(uuid,uuid,timestamptz,timestamptz,jsonb,integer)','3de0a3fa967bb855e5a70029cfea4850'),
    ('public.finish_calendar_reconciliation_v1(uuid,timestamptz,timestamptz)','d62c4c9b64924f221f594f7175e5b4ad')
  ) x(signature,hash) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or not p.prosecdef or p.proowner<>'postgres'::regrole or p.proconfig is distinct from array['search_path=""']
      or p.prorettype<>'jsonb'::regtype or p.provolatile<>'v' or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or not has_function_privilege('authenticated',p.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,'authenticated'::regrole) or (a.grantee='authenticated'::regrole and a.is_grantable)) then
      raise exception 'STOP: reconciliation function drift: %',r.signature; end if;
  end loop;
  if t is null or not exists(select 1 from pg_class where oid=t and relrowsecurity and relowner='postgres'::regrole)
    or exists(select 1 from pg_policy where polrelid=t)
    or exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid=t and a.grantee<>'postgres'::regrole)
    or (select count(*) from pg_attribute where attrelid=t and attnum>0 and not attisdropped)<>3
    or (select count(*) from pg_attribute where attrelid=t and attnum>0 and not attisdropped and attnotnull
      and ((attname in ('participant_id','source_id') and atttypid='uuid'::regtype) or (attname='fingerprint' and atttypid='text'::regtype)))<>3
    or exists(select 1 from pg_attribute where attrelid=t and attacl is not null)
    or (select count(*) from pg_constraint where conrelid=t and convalidated)<>4
    or not exists(select 1 from pg_constraint where conrelid=t and contype='p' and conkey=array[1]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid=t and contype='f' and conkey=array[1]::smallint[]
      and confrelid='public.interaction_participants'::regclass and confdeltype='c')
    or not exists(select 1 from pg_constraint where conrelid=t and contype='f' and conkey=array[2]::smallint[]
      and confrelid='public.external_interaction_sources'::regclass and confdeltype='c')
    or not exists(select 1 from pg_constraint where conrelid=t and contype='c' and pg_get_constraintdef(oid) like '%fingerprint ~ %^[a-f0-9]{32}$%') then
    raise exception 'STOP: private provenance table drift'; end if;
end $$;
select 'PASS: reconciliation RPC, ownership, RLS, ACL and private provenance' as result;
commit;
