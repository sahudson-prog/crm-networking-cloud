do $$ begin
  if to_regprocedure('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)') is null
    or to_regprocedure('public.current_user_can_sync_connected_account_v1(uuid,text)') is null
    or to_regprocedure('public.current_user_has_capability(text)') is null
    or to_regclass('public.user_role_assignments') is null
    or to_regprocedure('public.current_user_can_use_calendar_admin_v1()') is not null
    or to_regprocedure('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)') is not null
    or to_regprocedure('public.current_user_can_sync_connected_account_base_v1(uuid,text)') is not null
    or (select prosecdef is not true or proowner <> 'postgres'::regrole from pg_proc where oid='public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)'::regprocedure)
    or (select prosecdef is not true or proowner <> 'postgres'::regrole from pg_proc where oid='public.current_user_can_sync_connected_account_v1(uuid,text)'::regprocedure)
  then raise exception 'STOP: incompatible Calendar admin-only baseline'; end if;
  raise notice 'PASS: Calendar admin-only baseline';
end $$;
