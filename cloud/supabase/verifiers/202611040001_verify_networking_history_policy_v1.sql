begin;
do $$
declare signature text; fn oid; expected record;
begin
  if not exists(select 1 from pg_class where oid='public.networking_history_policy'::regclass
    and relkind='r' and relpersistence='p' and relrowsecurity and not relforcerowsecurity
    and relowner='postgres'::regrole)
    or exists(select 1 from pg_policy where polrelid='public.networking_history_policy'::regclass)
    or exists(select 1 from pg_attribute where attrelid='public.networking_history_policy'::regclass
      and attnum>0 and not attisdropped and attacl is not null) then
    raise exception 'history_policy_table_contract'; end if;
  if (select count(*) from pg_attribute where attrelid='public.networking_history_policy'::regclass
    and attnum>0 and not attisdropped)<>5 then raise exception 'history_policy_columns'; end if;
  for expected in select * from (values
    ('singleton','boolean',true,'true'),
    ('max_history_months','integer',true,'6'),
    ('revision','bigint',true,'1'),
    ('updated_at','timestamp with time zone',true,'statement_timestamp()'),
    ('updated_by','uuid',false,null)
  ) as columns(name,type_name,required,default_expr) loop
    if not exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.networking_history_policy'::regclass and a.attname=expected.name
        and not a.attisdropped and format_type(a.atttypid,a.atttypmod)=expected.type_name
        and a.attnotnull=expected.required and a.attidentity='' and a.attgenerated=''
        and pg_get_expr(d.adbin,d.adrelid) is not distinct from expected.default_expr) then
      raise exception 'history_policy_columns'; end if;
  end loop;
  if (select count(*) from pg_constraint where conrelid='public.networking_history_policy'::regclass)<>5 then
    raise exception 'history_policy_constraints'; end if;
  for expected in select * from (values
    ('networking_history_policy_pkey','PRIMARY KEY (singleton)'),
    ('networking_history_policy_singleton_check','CHECK (singleton)'),
    ('networking_history_policy_max_history_months_check','CHECK (((max_history_months >= 1) AND (max_history_months <= 12)))'),
    ('networking_history_policy_revision_check','CHECK ((revision > 0))'),
    ('networking_history_policy_updated_by_fkey','FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL')
  ) as constraints(name,definition) loop
    if not exists(select 1 from pg_constraint where conrelid='public.networking_history_policy'::regclass
      and conname=expected.name and convalidated and not condeferrable and not condeferred
      and pg_get_constraintdef(oid)=expected.definition
      and (contype<>'f' or confrelid='public.profiles'::regclass)) then
      raise exception 'history_policy_constraints'; end if;
  end loop;
  if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where c.oid='public.networking_history_policy'::regclass and
      (acl.grantee<>'postgres'::regrole or acl.grantor<>'postgres'::regrole)) then
    raise exception 'history_policy_table_acl'; end if;
  for expected in select * from (values
    ('public.networking_history_floor_v1(text,integer,timestamp with time zone)','timestamp with time zone',false,'s',false),
    ('public.current_user_networking_history_policy_v1(text)','jsonb',true,'s',true),
    ('public.admin_set_networking_history_policy_v1(integer,bigint)','jsonb',true,'v',true),
    ('public.current_user_history_window_v1()','jsonb',true,'s',true),
    ('public.enforce_cycle_start_policy_v1()','trigger',true,'v',false)
  ) as functions(signature,result_type,definer,volatility,client) loop
    fn:=to_regprocedure(expected.signature);
    if fn is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=fn
      and p.proowner='postgres'::regrole and p.prosecdef=expected.definer and p.provolatile::text=expected.volatility
      and l.lanname='plpgsql' and format_type(p.prorettype,null)=expected.result_type
      and not p.proretset and not p.proisstrict and not p.proleakproof and p.proparallel='u'
      and p.pronargdefaults=0 and p.proconfig is not distinct from array['search_path=""'])
      then raise exception 'history_policy_security_properties'; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=fn and (acl.grantor<>'postgres'::regrole or acl.privilege_type<>'EXECUTE'
        or (acl.grantee<>'postgres'::regrole and not(expected.client and acl.grantee='authenticated'::regrole and not acl.is_grantable)))) then
      raise exception 'history_policy_exact_acl'; end if;
  end loop;
  for expected in select * from (values
    ('networking_history_floor_v1','0b9b21570d5f433a586e70ba1890245a'),
    ('current_user_networking_history_policy_v1','b07d8a8496a09705cebf6863a36dbb9b'),
    ('admin_set_networking_history_policy_v1','d8e27463dc92e493aa8f2506cdb7b7f5'),
    ('current_user_history_window_v1','84ef14bf59078c840b7ce8359c52ea4b'),
    ('enforce_cycle_start_policy_v1','1b8681c95e697fc01c70d461308ccef8')) as bodies(name,hash) loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=expected.name)<>1
      or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=expected.name and md5(replace(p.prosrc,E'\r\n',E'\n'))=expected.hash) then
      raise exception 'history_policy_body_drift'; end if;
  end loop;
  if not exists(select 1 from public.networking_history_policy where singleton and max_history_months between 1 and 12 and revision>0)
    or (select count(*) from public.networking_history_policy)<>1 then raise exception 'history_policy_invalid_state'; end if;
  if not exists(select 1 from pg_class where oid='public.networking_history_policy'::regclass and relrowsecurity
      and relowner='postgres'::regrole) then raise exception 'history_policy_rls_or_owner'; end if;
  if has_table_privilege('authenticated','public.networking_history_policy','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','public.networking_history_policy','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role','public.networking_history_policy','SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'history_policy_direct_access'; end if;
  foreach signature in array array['public.current_user_networking_history_policy_v1(text)',
    'public.admin_set_networking_history_policy_v1(integer,bigint)','public.current_user_history_window_v1()'] loop
    fn:=to_regprocedure(signature);
    if fn is null or not exists(select 1 from pg_proc where oid=fn and prosecdef and proowner='postgres'::regrole
      and proconfig @> array['search_path=""']) then raise exception 'history_policy_function_contract'; end if;
    if not has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('anon',fn,'EXECUTE')
      or has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'history_policy_function_acl'; end if;
  end loop;
  foreach signature in array array['public.networking_history_floor_v1(text,integer,timestamp with time zone)',
    'public.enforce_cycle_start_policy_v1()'] loop
    fn:=to_regprocedure(signature);
    if fn is null or has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('anon',fn,'EXECUTE')
      or has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'history_policy_internal_acl'; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.networking_cycles'::regclass
      and tgname='enforce_cycle_start_policy_v1' and tgfoid='public.enforce_cycle_start_policy_v1()'::regprocedure
      and tgenabled='O' and tgtype=23) then raise exception 'history_policy_trigger_contract'; end if;
end;
$$;
select 'PASS: foundation only; not a historical import/runtime cutover certification' as result;
rollback;
