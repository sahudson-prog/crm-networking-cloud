begin;
do $$
declare signature text; fn oid; expected record;
begin
  for expected in select * from (values
    ('public.assert_history_context_v1(jsonb)','timestamp with time zone','plpgsql',false),
    ('public.apply_ics_import_v1(jsonb)','jsonb','plpgsql',false),
    ('public.apply_google_interaction_sync_v1(uuid,jsonb)','jsonb','plpgsql',false),
    ('public.apply_ics_import_v2(jsonb,jsonb)','jsonb','plpgsql',true),
    ('public.apply_google_history_v1(uuid,jsonb,jsonb)','jsonb','plpgsql',true),
    ('public.apply_google_periodic_v1(uuid,jsonb)','jsonb','sql',true)
  ) as functions(signature,result_type,language,client) loop
    fn:=to_regprocedure(expected.signature);
    if fn is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=fn
      and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v'
      and l.lanname=expected.language and format_type(p.prorettype,null)=expected.result_type
      and not p.proretset and not p.proisstrict and not p.proleakproof and p.proparallel='u'
      and p.pronargdefaults=0 and p.proconfig is not distinct from array['search_path=""'])
      then raise exception 'history_import_security_properties'; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=fn and (acl.grantor<>'postgres'::regrole or acl.privilege_type<>'EXECUTE'
        or (acl.grantee<>'postgres'::regrole and not(expected.client and acl.grantee='authenticated'::regrole and not acl.is_grantable)))) then
      raise exception 'history_import_exact_acl'; end if;
  end loop;
  for expected in select * from (values
    ('assert_history_context_v1','8b0781f2e28899b57d11c31a16b0553f'),
    ('apply_ics_import_v2','e80eb80c80bab8edf627c4e303ad6daf'),
    ('apply_google_history_v1','ff0702a42eea49431e4355aae352f75f'),
    ('apply_google_periodic_v1','fa6bf40bd8d9f446ecbd1c7cde30bd24')) as bodies(name,hash) loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=expected.name)<>1
      or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=expected.name and md5(replace(p.prosrc,E'\r\n',E'\n'))=expected.hash) then
      raise exception 'history_import_body_drift'; end if;
  end loop;
  foreach signature in array array['public.apply_ics_import_v1(jsonb)','public.apply_google_interaction_sync_v1(uuid,jsonb)',
    'public.assert_history_context_v1(jsonb)'] loop
    fn:=to_regprocedure(signature);
    if fn is null or has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('anon',fn,'EXECUTE')
      or has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'history_internal_writer_exposed'; end if;
  end loop;
  foreach signature in array array['public.apply_ics_import_v2(jsonb,jsonb)','public.apply_google_history_v1(uuid,jsonb,jsonb)',
    'public.apply_google_periodic_v1(uuid,jsonb)'] loop
    fn:=to_regprocedure(signature);
    if fn is null or not exists(select 1 from pg_proc where oid=fn and prosecdef and proowner='postgres'::regrole
      and proconfig @> array['search_path=""']) then raise exception 'history_entrypoint_security'; end if;
    if not has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('anon',fn,'EXECUTE')
      or has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'history_entrypoint_acl'; end if;
  end loop;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure)
    <>'bcc3ca6580e45ee31a307269bb1764dd' then raise exception 'google_core_changed'; end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.apply_ics_import_v1(jsonb)'::regprocedure)
    <>'297fef81a27d942f222383a0045a58fc' then raise exception 'ics_internal_body_drift'; end if;
end;
$$;
select 'PASS: historical wrappers and periodic writer ACL' as result;
rollback;
