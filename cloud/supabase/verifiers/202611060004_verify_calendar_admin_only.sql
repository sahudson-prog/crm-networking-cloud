do $$ begin
  if to_regprocedure('public.current_user_can_use_calendar_admin_v1()') is null
    or to_regprocedure('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)') is null
    or to_regprocedure('public.current_user_can_sync_connected_account_base_v1(uuid,text)') is null
    or exists(select 1 from pg_proc p where p.oid in (
      'public.current_user_can_use_calendar_admin_v1()'::regprocedure,
      'public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)'::regprocedure,
      'public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure)
      and (not p.prosecdef or p.proowner<>'postgres'::regrole or p.proconfig is distinct from array['search_path=""']))
    or not has_function_privilege('authenticated','public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.current_user_can_use_calendar_admin_v1()','EXECUTE')
    or has_function_privilege('authenticated','public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.current_user_can_sync_connected_account_base_v1(uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception 'STOP: Calendar admin-only contract drift'; end if;
  raise notice 'PASS: Calendar admin-only contract';
end $$;
