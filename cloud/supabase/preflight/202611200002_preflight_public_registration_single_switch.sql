-- Read-only forward-fix preflight. Requires the installed 202611190001 contract and switch OFF.
begin isolation level repeatable read read only;
do $verify$
declare r record; p pg_proc%rowtype; who text; v_multi_testers boolean; t oid;
begin
  -- Only complete, known R2-B variants are supported; never mix their bodies.
  select case md5(replace(prosrc,E'\r',''))
    when '867ff4ec5f934c919d7787342e74a70f' then false
    when '989795c48d4d86eea224b26e7752a874' then true
    else null end into v_multi_testers
    from pg_proc where oid=to_regprocedure('public.set_r2b_rollout_gate(text,uuid)');
  if v_multi_testers is null then raise exception 'STOP: unknown R2-B gate variant'; end if;
  if v_multi_testers then
    if not exists(select 1 from pg_attribute a join pg_attrdef d
        on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.r2b_rollout_gate'::regclass
        and a.attname='additional_test_user_ids' and not a.attisdropped
        and a.atttypid='uuid[]'::regtype and a.attnotnull
        and pg_get_expr(d.adbin,d.adrelid)='''{}''::uuid[]')
    then raise exception 'STOP: DEV multi-tester gate column drift'; end if;
  elsif exists(select 1 from pg_attribute where attrelid='public.r2b_rollout_gate'::regclass
    and attname='additional_test_user_ids' and not attisdropped) then
    raise exception 'STOP: standard R2-B gate has unexpected multi-tester column';
  end if;
  if not exists(select 1 from pg_class where oid='public.r2b_rollout_gate'::regclass
      and relowner='postgres'::regrole and relrowsecurity)
    or exists(select 1 from unnest(array['anon','authenticated','service_role','supabase_auth_admin']) role_name
      where has_table_privilege(role_name,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(role_name,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,REFERENCES'))
  then raise exception 'STOP: R2-B gate security drift'; end if;
  for r in select * from (values
    ('public.public_registration_status_v1()','7b36211225825dab7a5da216cf3d046e','anon,authenticated','s','jsonb','sql',true),
    ('public.admin_public_registration_state_v1()','16c8ba3aa7445fab16f7c51c62efc0a2','authenticated','s','jsonb','plpgsql',true),
    ('public.admin_set_public_registration_v1(boolean,bigint)','395c09b5b994e36a9d90abdc01bf58ed','authenticated','v','jsonb','plpgsql',true),
    ('public.public_registration_email_blocked_v1(text)','eead8d15a38d660653f96f82dd7dd0a4','','s','boolean','sql',true),
    ('public.capture_public_registration_candidate_v1()','ca4613e153466dadc9fe2bb41a25ae3c','','v','trigger','plpgsql',true),
    ('public.public_registration_admission_valid_v1(uuid)','89e2748631b0d4279b2d98a908f5e194','','s','boolean','sql',true),
    ('public.bootstrap_public_registration_v1()',case when v_multi_testers then '26cd9264451ccf34d3779815b3db992b' else 'b1a42ba06e8bcdd2e428ce81bcb8bd8d' end,'','v','TABLE(allowed boolean, reason text, access_source text)','plpgsql',true),
    ('public.hook_enforce_app_access_allowlist(jsonb)','b693deac88e9533212c0730eddc97a57','supabase_auth_admin','s','jsonb','plpgsql',true),
    ('public.bootstrap_current_user_invitation_v1()','6147f588d3f23e2d411ea8b45643d1c9','authenticated','v','TABLE(allowed boolean, reason text, access_source text)','plpgsql',true),
    ('public.app_access_status_for_user(uuid)',case when v_multi_testers then '17fd2247f0d585f2e3cfd84700bfe92f' else '89ca95c07a760b0cbb77f42bbff3cf1f' end,'','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.handle_new_auth_user_profile()','d88a092e24b5819670567e2e3751e3af','','v','trigger','plpgsql',true),
    ('public.ensure_invitation_user_role_v1(uuid,timestamptz)','2495514c010ab7fc3abbc5401e6ede0e','','v','void','plpgsql',true),
    ('public.invitation_email_fingerprint_v1(text)','79a1a3f6c7ca0e56d2ed8197258867c8','','i','bytea','sql',false),
    ('public.set_r2b_rollout_gate(text,uuid)',case when v_multi_testers then '989795c48d4d86eea224b26e7752a874' else '867ff4ec5f934c919d7787342e74a70f' end,'','v','void','plpgsql',true),
    ('public.current_user_app_access_status()','bafebceb676bb21f2d09a587881af7ea','authenticated','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.current_user_has_app_access()','a9ccc4c95d98fbbd14ed1ced0a94771e','authenticated','s','boolean','sql',true),
    ('public.current_user_has_capability(text)','b1384155ef3df1fde0b84ecc175a61af','authenticated','s','boolean','sql',true),
    ('public.is_email_authorized_for_app_access(text)','2e3776446dd7f5bcd930a2294f29c54b','','s','boolean','sql',true)
  ) x(signature,hash,clients,volatility,result,language,definer) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or p.prosecdef is distinct from r.definer or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility or pg_get_function_result(p.oid)<>r.result
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where (a.grantee<>'postgres'::regrole and not exists(
          select 1 from pg_roles x where x.oid=a.grantee and x.rolname=any(string_to_array(r.clients,','))))
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'REG-OPEN-01 function body/signature/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') is distinct from (who=any(string_to_array(r.clients,',')))
      then raise exception 'REG-OPEN-01 inherited EXECUTE drift: % / %',r.signature,who; end if;
    end loop;
  end loop;
  foreach t in array array[to_regclass('public.app_public_registration_settings'),to_regclass('public.app_public_registration_admissions')] loop
    if t is null or not exists(select 1 from pg_class where oid=t and relkind='r' and relrowsecurity and relowner='postgres'::regrole)
      or exists(select 1 from pg_policy where polrelid=t)
      or exists(select 1 from pg_trigger where tgrelid=t and not tgisinternal)
      or exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        where c.oid=t and a.grantee<>'postgres'::regrole)
      or exists(select 1 from pg_attribute where attrelid=t and attacl is not null)
      or exists(select 1 from pg_constraint where conrelid=t and not convalidated)
    then raise exception 'REG-OPEN-01 private table security drift'; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_table_privilege(who,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege(who,t,'SELECT,INSERT,UPDATE,REFERENCES')
      then raise exception 'REG-OPEN-01 inherited table privilege drift'; end if;
    end loop;
  end loop;
  if (select proargnames from pg_proc where oid='public.admin_set_public_registration_v1(boolean,bigint)'::regprocedure)
    is distinct from array['p_enabled','p_expected_revision']::text[]
    or exists(select 1 from pg_proc where oid in (
      'public.public_registration_status_v1()'::regprocedure,
      'public.admin_public_registration_state_v1()'::regprocedure,
      'public.admin_set_public_registration_v1(boolean,bigint)'::regprocedure)
      and (pronargdefaults<>0 or proretset))
  then raise exception 'REG-OPEN-01 frontend RPC argument/result drift'; end if;
  for r in select * from (values
    ('public.app_public_registration_settings','singleton:boolean:1,enabled:boolean:1,revision:bigint:1,updated_at:timestamp with time zone:1,updated_by_user_id:uuid:0',4),
    ('public.app_public_registration_admissions','user_id:uuid:1,email_fingerprint:bytea:1,captured_revision:bigint:1,captured_at:timestamp with time zone:1,admitted_at:timestamp with time zone:0,revoked_at:timestamp with time zone:0',7)
  ) x(name,columns,constraints) loop
    t:=to_regclass(r.name);
    if (select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::integer,',' order by attnum)
      from pg_attribute where attrelid=t and attnum>0 and not attisdropped) is distinct from r.columns
      or (select count(*) from pg_constraint where conrelid=t)<>r.constraints
    then raise exception 'REG-OPEN-01 column/constraint drift'; end if;
  end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.app_public_registration_settings'::regclass
      and contype='p' and conkey=array[1]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.app_public_registration_admissions'::regclass
      and contype='p' and conkey=array[1]::smallint[])
    or not exists(select 1 from pg_constraint where conrelid='public.app_public_registration_settings'::regclass
      and contype='f' and conkey=array[5]::smallint[] and confrelid='public.profiles'::regclass
      and confkey=array[1]::smallint[] and confdeltype='n')
    or not exists(select 1 from pg_constraint where conrelid='public.app_public_registration_admissions'::regclass
      and contype='f' and conkey=array[1]::smallint[] and confrelid='public.profiles'::regclass
      and confkey=array[1]::smallint[] and confdeltype='c')
  then raise exception 'REG-OPEN-01 key/FK drift'; end if;
  for r in select * from (values
    ('public.app_public_registration_settings','CHECK (singleton)'),
    ('public.app_public_registration_settings','CHECK ((revision >= 0))'),
    ('public.app_public_registration_admissions','CHECK ((octet_length(email_fingerprint) = 32))'),
    ('public.app_public_registration_admissions','CHECK ((captured_revision >= 0))'),
    ('public.app_public_registration_admissions','CHECK (isfinite(captured_at))'),
    ('public.app_public_registration_admissions','CHECK (((admitted_at IS NULL) OR (isfinite(admitted_at) AND (admitted_at >= captured_at))))'),
    ('public.app_public_registration_admissions','CHECK (((revoked_at IS NULL) OR (isfinite(revoked_at) AND (revoked_at >= captured_at))))')
  ) x(name,definition) loop
    if not exists(select 1 from pg_constraint where conrelid=to_regclass(r.name)
      and contype='c' and pg_get_constraintdef(oid)=r.definition)
    then raise exception 'REG-OPEN-01 CHECK drift: %',r.definition; end if;
  end loop;
  for r in select * from (values
    ('public.app_public_registration_settings','singleton','true'),
    ('public.app_public_registration_settings','enabled','false'),
    ('public.app_public_registration_settings','revision','0'),
    ('public.app_public_registration_settings','updated_at','clock_timestamp()'),
    ('public.app_public_registration_settings','updated_by_user_id',null),
    ('public.app_public_registration_admissions','user_id',null),
    ('public.app_public_registration_admissions','email_fingerprint',null),
    ('public.app_public_registration_admissions','captured_revision',null),
    ('public.app_public_registration_admissions','captured_at','clock_timestamp()'),
    ('public.app_public_registration_admissions','admitted_at',null),
    ('public.app_public_registration_admissions','revoked_at',null)
  ) x(name,column_name,default_expression) loop
    if (select pg_get_expr(d.adbin,d.adrelid) from pg_attribute a left join pg_attrdef d
      on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(r.name) and a.attname=r.column_name)
      is distinct from r.default_expression
    then raise exception 'REG-OPEN-01 default drift: %',r.column_name; end if;
  end loop;
  if (select count(*) from public.app_public_registration_settings)<>1
    or not exists(select 1 from public.app_public_registration_settings where singleton and revision>=0)
    or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='on_auth_user_created_profile' and tgfoid='public.handle_new_auth_user_profile()'::regprocedure
      and tgtype=5 and tgenabled='O' and tgqual is null and tgnargs=0)
    or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='zz_capture_public_registration_candidate_v1'
      and tgfoid='public.capture_public_registration_candidate_v1()'::regprocedure
      and tgtype=5 and tgenabled='O' and tgqual is null and tgnargs=0)
  then raise exception 'REG-OPEN-01 settings/trigger drift'; end if;
  if not has_schema_privilege('anon','public','USAGE') or has_schema_privilege('anon','public','CREATE')
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and oid<>'public.public_registration_status_v1()'::regprocedure and has_function_privilege('anon',oid,'EXECUTE'))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')
      and (has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege('anon',oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace
      and case when relkind='S' then has_sequence_privilege('anon',oid,'USAGE,SELECT,UPDATE') else false end)
  then raise exception 'REG-OPEN-01 anon exposure drift'; end if;
end $verify$;
do $off$ begin
  if not exists(select 1 from public.app_public_registration_settings where singleton and not enabled)
  then raise exception 'STOP: close public registration before installing the forward-fix'; end if;
end $off$;
do $anchors$
declare definition text; old_text text; new_text text; multi_testers boolean;
begin
  select md5(replace(prosrc,E'\r',''))='989795c48d4d86eea224b26e7752a874'
    into multi_testers from pg_proc where oid='public.set_r2b_rollout_gate(text,uuid)'::regprocedure;

  definition := replace(pg_get_functiondef('public.public_registration_status_v1()'::regprocedure),E'\r','');
  old_text := 's.enabled and g.mode = ''open''';
  new_text := 's.enabled and g.mode in (''open'', ''test_only'')';
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'STOP: public status anchor drift'; end if;

  definition := replace(pg_get_functiondef('public.bootstrap_public_registration_v1()'::regprocedure),E'\r','');
  old_text := case when multi_testers then
    $dev$if not found or v_gate.mode = 'paused'
    or (v_gate.mode = 'test_only' and v_gate.test_user_id is distinct from v_user_id
      and not coalesce(v_user_id = any(v_gate.additional_test_user_ids), false)) then$dev$
  else
    $standard$if not found or v_gate.mode = 'paused'
    or (v_gate.mode = 'test_only' and v_gate.test_user_id is distinct from v_user_id) then$standard$ end;
  -- SQL Editor/clipboard may transport this literal with CRLF. Body guards above
  -- still require the exact known normalized hash, metadata and ACL.
  old_text := replace(old_text,E'\r\n',E'\n');
  new_text := 'if not found or v_gate.mode not in (''open'', ''test_only'') then';
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'STOP: public bootstrap anchor drift'; end if;

  definition := replace(pg_get_functiondef('public.app_access_status_for_user(uuid)'::regprocedure),E'\r','');
  old_text := case when multi_testers then
    $dev$or (v_gate_mode = 'test_only'
      and p_user_id is distinct from v_test_user_id
      and not coalesce(p_user_id = any(v_additional_test_user_ids), false))$dev$
  else
    $standard$or (v_gate_mode = 'test_only' and p_user_id is distinct from v_test_user_id)$standard$ end;
  old_text := replace(old_text,E'\r\n',E'\n');
  new_text := left(old_text,length(old_text)-1)
    || E'\n    and not public.public_registration_admission_valid_v1(p_user_id))';
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'STOP: effective access anchor drift'; end if;
end $anchors$;
select 'PASS: REG-OPEN single-switch preflight' as result;
rollback;
