-- Post-forward-fix DEV context. Run after the 202611200002 structural verifier.
-- Historical 202611200001 remains unchanged; public verified admissions may have base access,
-- but no non-tester may gain protected Google/Calendar capabilities in this DEV rollout.
-- REG-OPEN DEV ONLY: read-only R2-B + Calendar finalize exception.
-- Select DEV wwlbxrdnrojqkhdxkzdx manually; SQL database name is not project identity.
-- Run after the REG-OPEN composed verifier. This does not replace Calendar 005.
-- No writer RPCs, grants, gate changes or identity output. Unknown drift = STOP.
begin transaction isolation level repeatable read read only;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $dev_contract$
declare
  r record; p pg_proc%rowtype; who text; v_multi_testers boolean;
  v_gate jsonb; v_testers uuid[]; v_additional uuid[];
begin
  if current_user<>'postgres' then raise exception 'STOP: postgres required'; end if;
  select case md5(replace(prosrc,E'\r',''))
    when '867ff4ec5f934c919d7787342e74a70f' then false
    when '989795c48d4d86eea224b26e7752a874' then true
    else null end into v_multi_testers
    from pg_proc where oid=to_regprocedure('public.set_r2b_rollout_gate(text,uuid)');
  if v_multi_testers is null then raise exception 'STOP: unknown R2-B variant'; end if;
  if (select count(*) from public.r2b_rollout_gate)<>1 then
    raise exception 'STOP: DEV gate singleton drift'; end if;
  select to_jsonb(g) into v_gate from public.r2b_rollout_gate g where singleton;
  if v_gate is null or v_gate->>'mode' is distinct from 'test_only'
    or v_gate->>'test_user_id' is null then
    raise exception 'STOP: this verifier requires DEV test_only and a primary tester'; end if;
  if v_multi_testers then
    if not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.r2b_rollout_gate'::regclass and a.attname='additional_test_user_ids'
        and not a.attisdropped and a.attnotnull and a.atttypid='uuid[]'::regtype
        and pg_get_expr(d.adbin,d.adrelid)='''{}''::uuid[]')
      or jsonb_typeof(v_gate->'additional_test_user_ids') is distinct from 'array'
    then raise exception 'STOP: DEV tester column drift'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_additional
      from jsonb_array_elements_text(v_gate->'additional_test_user_ids');
  else
    if v_gate ? 'additional_test_user_ids' then raise exception 'STOP: mixed R2-B gate variants'; end if;
    v_additional:='{}'::uuid[];
  end if;
  v_testers:=array[v_gate->>'test_user_id']::uuid[] || v_additional;
  if cardinality(v_additional)>2 or array_position(v_testers,null) is not null
    or cardinality(v_testers)<>(select count(distinct v.user_id) from unnest(v_testers) v(user_id))
    or exists(select 1 from unnest(v_testers) v(user_id) where not exists(select 1 from auth.users u where u.id=v.user_id)
      or not exists(select 1 from public.profiles profile where profile.id=v.user_id))
  then raise exception 'STOP: invalid DEV tester membership'; end if;
  if not exists(select 1 from pg_class where oid='public.r2b_rollout_gate'::regclass
    and relowner='postgres'::regrole and relrowsecurity) then raise exception 'STOP: gate RLS/owner drift'; end if;
  foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
    if has_table_privilege(who,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(who,'public.r2b_rollout_gate','SELECT,INSERT,UPDATE,REFERENCES')
    then raise exception 'STOP: gate client privileges'; end if;
  end loop;

  -- Validate exact definitions before evaluating read-only access helpers.
  for r in select * from (values
    ('public.finalize_google_connected_account_verified(uuid,text,text[])','4705a448d879fcfa35155d9deb3fc654','service_role','v','TABLE(id uuid, provider text, account_email text, scopes text[], capabilities jsonb, status text, connected_at timestamp with time zone, revoked_at timestamp with time zone, updated_at timestamp with time zone)','plpgsql'),
    ('public.submit_contact_request_v1(text,text,text,text,text,uuid)','ee13e27bf0fbb93dff33a4086afb6798','','v','uuid','plpgsql'),
    ('public.user_has_provider_rollout_for_user_v1(uuid,text)','80d831fcd4a29397287059032f1afa99','','s','boolean','sql'),
    ('public.user_has_capability_for_user(uuid,text)','8ffde19406b07c1e6ffb6ca6c8fc003a','','s','boolean','sql'),
    ('public.current_user_can_start_connected_oauth_v1(text)','2416f700a17267a27830605ba30b49f9','authenticated','s','boolean','sql'),
    ('public.current_user_has_capability(text)','b1384155ef3df1fde0b84ecc175a61af','authenticated','s','boolean','sql'),
    ('public.current_user_app_access_status()','bafebceb676bb21f2d09a587881af7ea','authenticated','s','TABLE(allowed boolean, reason text)','plpgsql'),
    ('public.current_user_can_use_calendar_admin_v1()','27bd7b911459f42a2478456fee0015b9','authenticated','s','boolean','sql'),
    ('public.current_user_can_sync_connected_account_v1(uuid,text)','3080b157198b77d076185c513ce0cb74','authenticated','s','boolean','sql'),
    ('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','a803c67d432b24eb74d8c242d26631e4','authenticated','v','jsonb','plpgsql'),
    ('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)','8c73989d12bd0fc2b7967461fdfd8781','','v','jsonb','plpgsql'),
    ('public.public_registration_status_v1()','ac37f78205acbf7c82cba7fe890a1e82','anon,authenticated','s','jsonb','sql'),
    ('public.app_access_status_for_user(uuid)',case when v_multi_testers then '219b74bb269443949c69751f9e1b0f02' else '2497e941b8198f8c0388967d3b550d51' end,'','s','TABLE(allowed boolean, reason text)','plpgsql'),
    ('public.set_r2b_rollout_gate(text,uuid)',case when v_multi_testers then '989795c48d4d86eea224b26e7752a874' else '867ff4ec5f934c919d7787342e74a70f' end,'','v','void','plpgsql')
  ) x(signature,hash,clients,volatility,result,language) loop
    select * into p from pg_proc where oid=to_regprocedure(r.signature);
    if not found or p.prokind<>'f' or not p.prosecdef or p.proowner<>'postgres'::regrole
      or p.proconfig is distinct from array['search_path=""']
      or p.provolatile::text<>r.volatility or pg_get_function_result(p.oid)<>r.result
      or p.prolang<>(select oid from pg_language where lanname=r.language)
      or (select count(*) from pg_proc x where x.pronamespace=p.pronamespace and x.proname=p.proname)<>1
      or md5(replace(p.prosrc,E'\r',''))<>r.hash
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where (a.grantee<>'postgres'::regrole and not exists(
          select 1 from pg_roles x where x.oid=a.grantee and x.rolname=any(string_to_array(r.clients,','))))
          or (a.is_grantable and a.grantee<>'postgres'::regrole))
    then raise exception 'STOP: DEV Calendar body/signature/security/ACL drift: %',r.signature; end if;
    foreach who in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
      if has_function_privilege(who,p.oid,'EXECUTE') is distinct from (who=any(string_to_array(r.clients,',')))
      then raise exception 'STOP: DEV Calendar effective EXECUTE drift: % / %',r.signature,who; end if;
    end loop;
  end loop;
  if public.public_registration_status_v1() is distinct from (
      select jsonb_build_object('enabled',enabled) from public.app_public_registration_settings where singleton) then
    raise exception 'STOP: public signup differs from persisted switch in test_only'; end if;
  if exists(select 1 from auth.users u where not (u.id=any(v_testers))
    and ((not public.public_registration_admission_valid_v1(u.id)
        and exists(select 1 from public.app_access_status_for_user(u.id) a where a.allowed))
      or public.user_has_provider_rollout_for_user_v1(u.id,'google')
      or public.user_has_capability_for_user(u.id,'interactions.sync_calendar'))) then
    raise exception 'STOP: unadmitted access or protected Google capability outside DEV testers'; end if;
  -- Membership is not a grant: central access and deny precedence still apply.
  if exists(select 1 from unnest(v_testers) v(user_id)
    where not exists(select 1 from public.app_access_status_for_user(v.user_id) a where a.allowed)
      and (public.user_has_provider_rollout_for_user_v1(v.user_id,'google')
        or public.user_has_capability_for_user(v.user_id,'interactions.sync_calendar'))) then
    raise exception 'STOP: inactive tester has Google capability'; end if;
  if not exists(select 1 from unnest(v_testers) v(user_id)
    where public.user_has_provider_rollout_for_user_v1(v.user_id,'google')
      and public.user_has_capability_for_user(v.user_id,'admin.manage_access')
      and public.user_has_capability_for_user(v.user_id,'interactions.sync_calendar')
      and exists(select 1 from public.user_role_assignments a where a.user_id=v.user_id
        and a.role_code='system_admin' and a.is_active and a.starts_at<=now()
        and (a.expires_at is null or a.expires_at>now()))) then
    raise exception 'STOP: no effective Calendar admin in DEV tester membership'; end if;
end $dev_contract$;

-- Remaining R2-B invariants copied verbatim from the historical verifier.
-- Only its obsolete shared service-writer condition is replaced above.
do $verify$
declare v_table text; v_function regprocedure; v_trigger text;
begin
  foreach v_table in array array['networking_cycle_closed_contacts', 'networking_cycle_closed_assignments'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'R2-B table % missing', v_table; end if;
    if not exists (select 1 from pg_catalog.pg_class c
      where c.oid = ('public.' || v_table)::regclass and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres') then
      raise exception 'R2-B table % owner/RLS invalid', v_table; end if;
    if (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = v_table) <> 1
      or not pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      or pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
      or pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'R2-B table % access invalid', v_table; end if;
  end loop;

  foreach v_function in array array[
    'public.start_networking_cycle_r2b(uuid,text,timestamptz,text,uuid,text,boolean,boolean)'::regprocedure,
    'public.configure_legacy_networking_cycle_r2b(uuid,uuid,text,text,timestamptz,text)'::regprocedure,
    'public.close_networking_cycle_r2b(uuid,uuid,text,timestamptz,text)'::regprocedure,
    'public.save_objective_r2b(uuid,text,uuid,text,text,text,text,text,boolean)'::regprocedure,
    'public.archive_objective_r2b(uuid,text,uuid)'::regprocedure,
    'public.replace_contact_objectives_r2b(uuid,text,uuid,uuid[],text)'::regprocedure,
    'public.replace_objective_contacts_r2b(uuid,text,uuid,uuid[])'::regprocedure,
    'public.add_objectives_to_contacts_r2b(uuid,text,uuid[],uuid[],text)'::regprocedure,
    'public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)'::regprocedure
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_function
      and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig[1] in ('search_path=', 'search_path=""'))
      or not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'R2-B RPC % security invalid', v_function; end if;
  end loop;
  if pg_catalog.has_function_privilege('authenticated',
    'public.merge_contacts_deep(uuid,uuid[],jsonb,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
    'public.assert_networking_context_r2b(uuid,uuid,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
    'public.current_networking_context_r2b(uuid)', 'EXECUTE') then
    raise exception 'Unscoped merge or internal context remains executable'; end if;

  foreach v_trigger in array array['guard_objective_write_r2b', 'guard_assignment_write_r2b',
    'guard_contact_networking_write_r2b'] loop
    if not exists (select 1 from pg_catalog.pg_trigger t where t.tgname = v_trigger and not t.tgisinternal) then
      raise exception 'R2-B trigger % missing', v_trigger; end if;
  end loop;
  if to_regclass('public.uq_objectives_cycle_type_name_active') is null
    or to_regclass('public.uq_objectives_user_type_normalized_active') is not null
    or to_regclass('public.uq_networking_cycle_start_request') is null
    or to_regclass('public.uq_networking_cycle_close_request') is null then
    raise exception 'R2-B uniqueness indexes invalid'; end if;
  if exists (select 1 from public.networking_cycles c where c.status = 'closed'
    and (c.closed_at is null or c.closed_result is null or c.closed_recorded_at is null))
    or exists (select 1 from public.networking_cycles c where c.origin = 'user' and c.started_at is null)
    or exists (select 1 from public.objectives o join public.networking_cycles c on c.id = o.cycle_id
      where c.user_id <> o.user_id) then
    raise exception 'R2-B data invariant invalid'; end if;
end;
$verify$;


select jsonb_build_object('verdict','pass','scope','REG-OPEN DEV / R2-B / Calendar finalize',
  'gate','test_only','contact_request_service_execute',false,'finalize_service_execute',true,
  'route_admin_boundary','Must be verified in the deployed runtime; SQL cannot certify route code')
  as reg_open_dev_calendar_verifier;
rollback;
