begin transaction read only;
do $verify$
declare f regprocedure := pg_catalog.to_regprocedure('public.current_user_tracking_snapshot_v1()'); r text;
begin
  if f is null then raise exception 'tracking_snapshot_missing'; end if;
  if not exists(select 1 from pg_catalog.pg_proc where oid=f
    and md5(replace(replace(prosrc,chr(13)||chr(10),chr(10)),chr(13),chr(10)))='d8d2748826cd7f5d51f6102c8640356b') then
    raise exception 'tracking_body_drift'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f and not p.prosecdef and p.provolatile='s'
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prorettype='jsonb'::regtype
    and p.proconfig in (array['search_path='],array['search_path=""'])) then
    raise exception 'tracking_function_contract_invalid'; end if;
  if not pg_catalog.has_function_privilege('authenticated',f,'EXECUTE') then raise exception 'tracking_execute_missing'; end if;
  if exists(select 1 from pg_catalog.pg_proc p,
    pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where p.oid=f
    and a.grantee<>p.proowner and (a.grantee<>'authenticated'::regrole or a.is_grantable or a.privilege_type<>'EXECUTE')) then
    raise exception 'tracking_acl_invalid'; end if;
  foreach r in array array['networking_cycles','contacts','contact_emails','contact_networking_transitions','interactions','interaction_participants','external_interaction_sources','objectives','contact_objective_assignments','opportunities','opportunity_contacts','opportunity_objectives','headhunter_companies','headhunter_company_domains'] loop
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.'||r)
      and c.relrowsecurity and pg_catalog.pg_get_userbyid(c.relowner)='postgres')
      or not pg_catalog.has_table_privilege('authenticated','public.'||r,'SELECT') then
      raise exception 'tracking_source_read_contract_invalid: %',r;
    end if;
  end loop;
  foreach r in array array['anon','service_role','supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(r,f,'EXECUTE') then raise exception 'tracking_excess_execute: %',r; end if;
  end loop;
end;
$verify$;
select 'PASS: read-only tracking snapshot, invoker RLS, authenticated-only EXECUTE' as result;
rollback;
