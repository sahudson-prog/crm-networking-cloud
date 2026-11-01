-- Read-only verification of the forward-only Seguimiento coffee snapshot contract.
begin transaction read only;
do $verify$
declare f pg_catalog.regprocedure := pg_catalog.to_regprocedure('public.current_user_tracking_snapshot_v1()');
begin
  if f is null then raise exception 'tracking_snapshot_missing'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
      p.prosrc,pg_catalog.chr(13)||pg_catalog.chr(10),pg_catalog.chr(10)),pg_catalog.chr(13),pg_catalog.chr(10)))
      ='d626092644173bd309046760bb0c3436') then
    raise exception 'tracking_coffees_body_drift';
  end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=f and not p.prosecdef
    and p.provolatile='s' and p.prorettype='jsonb'::pg_catalog.regtype
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig in (array['search_path='],array['search_path=""'])) then
    raise exception 'tracking_coffees_security_drift';
  end if;
  if not pg_catalog.has_function_privilege('authenticated',f,'EXECUTE')
    or exists(select 1 from pg_catalog.pg_proc p,
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=f and a.grantee<>p.proowner and (a.grantee<>'authenticated'::pg_catalog.regrole
        or a.privilege_type<>'EXECUTE' or a.is_grantable)) then
    raise exception 'tracking_coffees_acl_drift';
  end if;
  if exists(select 1 from (values ('anon'),('service_role'),('supabase_auth_admin')) role_name(name)
    where pg_catalog.has_function_privilege(role_name.name,f,'EXECUTE')) then
    raise exception 'tracking_coffees_excess_execute';
  end if;
  if exists(select 1 from (values ('contacts'),('contact_networking_transitions'),('interactions'),
      ('interaction_participants')) required(name)
    where not exists(select 1 from pg_catalog.pg_class c
      where c.oid=pg_catalog.to_regclass('public.'||required.name) and c.relrowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner)='postgres'
        and pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'))) then
    raise exception 'tracking_coffees_source_drift';
  end if;
end;
$verify$;
select 'PASS: current-state coffees, invoker RLS, owner and ACL preserved' as result;
rollback;
