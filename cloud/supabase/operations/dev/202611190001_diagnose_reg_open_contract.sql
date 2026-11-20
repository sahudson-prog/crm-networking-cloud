-- REG-OPEN-01 catalog diagnostic. NOT an installation preflight or repair.
-- Run the whole file in DEV SQL Editor only after separate authorization.
-- Does not invoke application functions, inspect user rows or expose gate identities.
-- Function definitions are operational evidence: review privately before sharing.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local search_path = pg_catalog;

with variant as (
  select md5(replace(prosrc,E'\r','')) as setter_md5
  from pg_proc where oid=to_regprocedure('public.set_r2b_rollout_gate(text,uuid)')
), expected(signature, body_md5, client, volatility, result, language, definer) as (
  values
    ('public.hook_enforce_app_access_allowlist(jsonb)','416a5f23aacafa271e1eb34b8e711525','supabase_auth_admin','s','jsonb','plpgsql',true),
    ('public.bootstrap_current_user_invitation_v1()','419776a9ba534250312083c491d02172','authenticated','v','TABLE(allowed boolean, reason text, access_source text)','plpgsql',true),
    ('public.app_access_status_for_user(uuid)',case when (select setter_md5 from variant)='989795c48d4d86eea224b26e7752a874' then '8fa17c0cb4f35de3c773b3568da93d30' else 'f58a4c86cc02c5efade201f1644dbfaf' end,'','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.handle_new_auth_user_profile()','d88a092e24b5819670567e2e3751e3af','','v','trigger','plpgsql',true),
    ('public.ensure_invitation_user_role_v1(uuid,timestamptz)','2495514c010ab7fc3abbc5401e6ede0e','','v','void','plpgsql',true),
    ('public.invitation_email_fingerprint_v1(text)','79a1a3f6c7ca0e56d2ed8197258867c8','','i','bytea','sql',false),
    ('public.set_r2b_rollout_gate(text,uuid)',case when (select setter_md5 from variant)='989795c48d4d86eea224b26e7752a874' then '989795c48d4d86eea224b26e7752a874' else '867ff4ec5f934c919d7787342e74a70f' end,'','v','void','plpgsql',true),
    ('public.current_user_app_access_status()','bafebceb676bb21f2d09a587881af7ea','authenticated','s','TABLE(allowed boolean, reason text)','plpgsql',true),
    ('public.current_user_has_app_access()','a9ccc4c95d98fbbd14ed1ced0a94771e','authenticated','s','boolean','sql',true),
    ('public.current_user_has_capability(text)','b1384155ef3df1fde0b84ecc175a61af','authenticated','s','boolean','sql',true),
    ('public.is_email_authorized_for_app_access(text)','2e3776446dd7f5bcd930a2294f29c54b','','s','boolean','sql',true)
), roles as (
  select v.name, r.oid, r.rolsuper, r.rolinherit, r.rolbypassrls
  from (values ('postgres'),('anon'),('authenticated'),('service_role'),('supabase_auth_admin')) v(name)
  left join pg_roles r on r.rolname=v.name
), functions as (
  select e.*, p.oid, p.proname, p.proowner, p.prosecdef, p.proconfig, p.provolatile,
    p.proacl, p.prosrc, p.prokind, p.proisstrict, p.proleakproof, p.proparallel,
    l.lanname, pg_get_userbyid(p.proowner) as owner,
    pg_get_function_result(p.oid) as actual_result,
    (select count(*) from pg_proc q where q.pronamespace=p.pronamespace and q.proname=p.proname) as overload_count,
    md5(replace(p.prosrc,E'\r','')) as actual_md5
  from expected e
  left join pg_proc p on p.oid=to_regprocedure(e.signature)
  left join pg_language l on l.oid=p.prolang
), effective as (
  select f.signature, r.name as role, r.oid is not null as role_exists,
    case when f.oid is not null and r.oid is not null then has_function_privilege(r.oid,f.oid,'EXECUTE') end as actual,
    (r.name='postgres' or r.name=f.client) as expected
  from functions f cross join roles r
), issues as (
  select signature, 'presence_signature' as cause from functions where oid is null
  union all select signature, 'overloads' from functions where overload_count<>1 and oid is not null
  union all select signature, 'body_text' from functions where oid is not null and actual_md5 is distinct from body_md5
  union all select signature, 'signature_language_volatility' from functions where oid is not null and
    (actual_result is distinct from result or lanname is distinct from language or provolatile::text is distinct from volatility or prokind<>'f')
  union all select signature, 'owner_security_search_path' from functions where oid is not null and
    (owner is distinct from 'postgres' or prosecdef is distinct from definer or proconfig is distinct from array['search_path=""'])
  union all select f.signature, 'explicit_acl' from functions f where exists (
    select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    left join pg_roles r on r.oid=a.grantee
    where (coalesce(r.rolname,'PUBLIC') not in ('postgres',f.client))
       or (a.is_grantable and coalesce(r.rolname,'PUBLIC')<>'postgres'))
  union all select signature, 'effective_execute_or_missing_role' from effective where not role_exists or actual is distinct from expected
), inventory as (
  -- Include every overload and the two direct internal helpers, without executing them.
  select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname in (
    select split_part(split_part(signature,'.',2),'(',1) from expected)
    or p.proname in ('normalize_app_access_email','user_has_capability_for_user'))
)
select jsonb_build_object(
  'diagnostic','REG-OPEN-01 catalog evidence; does not authorize installation',
  'known_r2b_variant',(select case setter_md5
    when '867ff4ec5f934c919d7787342e74a70f' then 'standard'
    when '989795c48d4d86eea224b26e7752a874' then 'dev_multi_tester'
    else 'unknown' end from variant),
  'context',jsonb_build_object('database',current_database(),'current_role',current_user,
    'session_role',session_user,'server_version',current_setting('server_version'),
    'read_only',current_setting('transaction_read_only'),
    'environment_identity','Confirm project ref wwlbxrdnrojqkhdxkzdx in dashboard; database name does not identify tenant',
    'requires_postgres',current_user='postgres'),
  'findings_by_cause',coalesce((select jsonb_object_agg(cause,items) from (
    select cause,jsonb_agg(distinct signature order by signature) as items from issues group by cause
  ) grouped),'{}'::jsonb),
  'expected_vs_actual',coalesce((select jsonb_agg(jsonb_build_object(
    'signature',signature,'present',oid is not null,'expected_md5',body_md5,'actual_md5',actual_md5,
    'expected_owner','postgres','actual_owner',owner,'expected_definer',definer,'actual_definer',prosecdef,
    'expected_config',array['search_path=""'],'actual_config',proconfig,
    'expected_result',result,'actual_result',actual_result,'expected_language',language,'actual_language',lanname,
    'expected_volatility',volatility,'actual_volatility',provolatile,'overload_count',overload_count,
    'expected_client_execute',client,'raw_acl',proacl::text,
    'strict',proisstrict,'leakproof',proleakproof,'parallel',proparallel
  ) order by signature) from functions),'[]'::jsonb),
  'effective_execute',coalesce((select jsonb_agg(to_jsonb(e) order by signature,role) from effective e),'[]'::jsonb),
  'definitions_and_explicit_acl',coalesce((select jsonb_agg(jsonb_build_object(
    'identity',p.oid::regprocedure::text,'oid',p.oid,'owner',pg_get_userbyid(p.proowner),
    'arguments',pg_get_function_arguments(p.oid),'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'body',p.prosrc,'definition',case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) end,
    'config',p.proconfig,'acl_is_null',p.proacl is null,
    'acl', (select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
      'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'privilege',a.privilege_type,'grantable',a.is_grantable))
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
  ) order by p.oid::regprocedure::text) from inventory p),'[]'::jsonb),
  'roles', (select jsonb_agg(to_jsonb(r) order by name) from roles r),
  'role_memberships',coalesce((select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),
    'member',pg_get_userbyid(m.member),'admin_option',m.admin_option)) from pg_auth_members m),'[]'::jsonb),
  'public_schema_acl',(select jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) from pg_namespace where nspname='public'),
  'schema_privileges',(select jsonb_agg(jsonb_build_object('role',name,
    'usage',case when oid is not null then has_schema_privilege(oid,'public','USAGE') end,
    'create',case when oid is not null then has_schema_privilege(oid,'public','CREATE') end)) from roles),
  'default_acl',coalesce((select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),
    'schema',coalesce(n.nspname,'GLOBAL'),'object_type',d.defaclobjtype,'acl',d.defaclacl::text))
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    where d.defaclrole=(select oid from pg_roles where rolname='postgres') and (d.defaclnamespace=0 or n.nspname='public')),'[]'::jsonb),
  'auth_triggers',coalesce((select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
    'type',t.tgtype,'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid)))
    from pg_trigger t where t.tgrelid=to_regclass('auth.users') and not t.tgisinternal),'[]'::jsonb),
  'auth_required_columns',coalesce((select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod)))
    from pg_attribute where attrelid=to_regclass('auth.users') and not attisdropped
      and attname in ('email_confirmed_at','banned_until')),'[]'::jsonb),
  'reg_open_existing_objects',jsonb_build_object(
    'tables',(select jsonb_agg(relname) from pg_class where relnamespace=to_regnamespace('public') and relname in ('app_public_registration_settings','app_public_registration_admissions')),
    'functions',(select jsonb_agg(oid::regprocedure::text) from pg_proc where pronamespace=to_regnamespace('public') and proname in
      ('public_registration_status_v1','admin_public_registration_state_v1','admin_set_public_registration_v1','public_registration_email_blocked_v1',
       'capture_public_registration_candidate_v1','public_registration_admission_valid_v1','bootstrap_public_registration_v1'))),
  'limits','Body mismatch is not proof of semantic drift. No user rows, gate values, hosted Auth configuration or secrets queried. Preserve installation STOP until reviewed.'
) as reg_open_diagnostic;
rollback;
