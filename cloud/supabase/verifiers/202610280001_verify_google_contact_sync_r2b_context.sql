-- Read-only verifier for the forward-fix. Behavioral assertions run locally.
begin transaction read only;

do $verify$
declare v_new regprocedure := to_regprocedure('public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)');
  v_old regprocedure := to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)');
  v_role text;
begin
  if v_new is null or v_old is null then
    raise exception 'Google contact sync R2-B functions missing'; end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_new
    and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.proconfig[1] in ('search_path=', 'search_path=""')
    and pg_catalog.strpos(p.prosrc, 'assert_networking_context_r2b') > 0
    and pg_catalog.strpos(p.prosrc, 'merge:') > 0
    and pg_catalog.strpos(p.prosrc, 'apply_google_contact_sync_change_v1') > 0) then
    raise exception 'Google contact sync R2-B wrapper contract invalid'; end if;
  if not pg_catalog.has_function_privilege('authenticated', v_new, 'EXECUTE') then
    raise exception 'Authenticated user cannot execute scoped Google writer'; end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
    if pg_catalog.has_function_privilege(v_role, v_old, 'EXECUTE') then
      raise exception 'Legacy Google writer remains executable by %', v_role; end if;
    if v_role <> 'authenticated' and pg_catalog.has_function_privilege(v_role, v_new, 'EXECUTE') then
      raise exception 'Scoped Google writer executable by %', v_role; end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_old
    and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and p.proconfig[1] in ('search_path=', 'search_path=""')) then
    raise exception 'Internal legacy Google writer changed unexpectedly'; end if;
end;
$verify$;

select pg_catalog.jsonb_build_object(
  'verdict', 'pass',
  'rollout_mode', (select mode from public.r2b_rollout_gate where singleton),
  'legacy_authenticated_execute', pg_catalog.has_function_privilege('authenticated',
    'public.apply_google_contact_sync_change_v1(uuid,jsonb)', 'EXECUTE'),
  'scoped_authenticated_execute', pg_catalog.has_function_privilege('authenticated',
    'public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)', 'EXECUTE')
) as google_contact_sync_r2b_context_verifier;

rollback;
