-- REG-OPEN-01 read-only preflight. Drift/collision means STOP, never repair.
begin read only;
do $reg_contract$
declare r record; p pg_proc%rowtype; who text; v_multi_testers boolean;
begin
  if current_user <> 'postgres' then raise exception 'STOP: postgres required'; end if;
  -- Granting anon schema USAGE must not uncover unrelated effective privileges.
  if has_schema_privilege('anon', 'public', 'CREATE')
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and has_function_privilege('anon', oid, 'EXECUTE'))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p','v','m','f')
      and (has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege('anon', oid, 'SELECT,INSERT,UPDATE,REFERENCES')))
    or exists(select 1 from pg_class where relnamespace='public'::regnamespace
      and case when relkind='S' then has_sequence_privilege('anon', oid, 'USAGE,SELECT,UPDATE') else false end)
  then raise exception 'STOP: anon schema exposure would uncover existing privileges'; end if;
  if exists (select 1 from pg_class where relnamespace='public'::regnamespace and relname in
    ('app_public_registration_settings','app_public_registration_admissions'))
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in
    ('public_registration_status_v1','admin_public_registration_state_v1','admin_set_public_registration_v1',
     'public_registration_email_blocked_v1','capture_public_registration_candidate_v1',
     'public_registration_admission_valid_v1','bootstrap_public_registration_v1'))
    or exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='zz_capture_public_registration_candidate_v1')
  then raise exception 'STOP: REG-OPEN-01 already present or name collision'; end if;
  if exists(select 1 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclnamespace in (0,'public'::regnamespace)
      and a.grantee not in (0,'postgres'::regrole,'anon'::regrole,'authenticated'::regrole,
        'service_role'::regrole,'supabase_auth_admin'::regrole))
  then raise exception 'STOP: unexpected default ACL'; end if;
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
    ('public.hook_enforce_app_access_allowlist(jsonb)','416a5f23aacafa271e1eb34b8e711525','supabase_auth_admin','s','jsonb','plpgsql',true),
    ('public.bootstrap_current_user_invitation_v1()','419776a9ba534250312083c491d02172','authenticated','v','TABLE(allowed boolean, reason text, access_source text)','plpgsql',true),
    ('public.app_access_status_for_user(uuid)',case when v_multi_testers then '8fa17c0cb4f35de3c773b3568da93d30' else 'f58a4c86cc02c5efade201f1644dbfaf' end,'','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.handle_new_auth_user_profile()','d88a092e24b5819670567e2e3751e3af','','v','trigger','plpgsql',true),
    ('public.ensure_invitation_user_role_v1(uuid,timestamptz)','2495514c010ab7fc3abbc5401e6ede0e','','v','void','plpgsql',true),
    ('public.invitation_email_fingerprint_v1(text)','79a1a3f6c7ca0e56d2ed8197258867c8','','i','bytea','sql',false),
    ('public.set_r2b_rollout_gate(text,uuid)',case when v_multi_testers then '989795c48d4d86eea224b26e7752a874' else '867ff4ec5f934c919d7787342e74a70f' end,'','v','void','plpgsql',true),
    ('public.current_user_app_access_status()','bafebceb676bb21f2d09a587881af7ea','authenticated','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.current_user_has_app_access()','a9ccc4c95d98fbbd14ed1ced0a94771e','authenticated','s','boolean','sql',true),
    ('public.current_user_has_capability(text)','b1384155ef3df1fde0b84ecc175a61af','authenticated','s','boolean','sql',true),
    ('public.is_email_authorized_for_app_access(text)','2e3776446dd7f5bcd930a2294f29c54b','','s','boolean','sql',true)
  ) x(signature,hash,client,volatility,result,language,definer) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or p.prosecdef is distinct from r.definer or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility
      or pg_get_function_result(p.oid)<>r.result
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in ('postgres'::regrole,coalesce(nullif(r.client,'')::regrole,'postgres'::regrole))
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: REG-OPEN-01 body/signature/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') is distinct from (who=r.client)
      then raise exception 'STOP: inherited EXECUTE drift: % / %',r.signature,who; end if;
    end loop;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
    and tgname='on_auth_user_created_profile' and tgfoid='public.handle_new_auth_user_profile()'::regprocedure
    and tgtype=5 and tgenabled='O' and tgqual is null and tgnargs=0)
  then raise exception 'STOP: Auth profile trigger drift'; end if;
  if not exists(select 1 from pg_attribute where attrelid='auth.users'::regclass
    and attname='email_confirmed_at' and atttypid='timestamptz'::regtype and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='auth.users'::regclass
    and attname='banned_until' and atttypid='timestamptz'::regtype and not attisdropped)
  then raise exception 'STOP: Auth verification/ban columns missing'; end if;
  if (select count(*) from public.r2b_rollout_gate)<>1
    or not exists(select 1 from public.r2b_rollout_gate where singleton and mode in ('paused','test_only','open'))
    or (select count(*) from public.app_invitation_program_settings)<>1
  then raise exception 'STOP: existing singleton missing'; end if;
end $reg_contract$;
select 'PASS: REG-OPEN-01 preflight' as result;
rollback;
