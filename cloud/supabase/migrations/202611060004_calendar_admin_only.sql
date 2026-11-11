begin;
do $$ begin
  if to_regprocedure('public.calendar_manual_sync_v2(uuid,uuid,text,jsonb)') is null
    or to_regprocedure('public.current_user_can_sync_connected_account_v1(uuid,text)') is null
    or to_regprocedure('public.current_user_can_use_calendar_admin_v1()') is not null
    or to_regprocedure('public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb)') is not null
    or to_regprocedure('public.current_user_can_sync_connected_account_base_v1(uuid,text)') is not null
  then raise exception 'STOP: incompatible Calendar admin-only baseline'; end if;
end $$;

create function public.current_user_can_use_calendar_admin_v1() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and coalesce(public.current_user_has_capability('admin.manage_access'),false)
    and coalesce(public.current_user_has_capability('interactions.sync_calendar'),false)
    and exists(select 1 from public.user_role_assignments a
      where a.user_id=auth.uid() and a.role_code='system_admin' and a.is_active
        and a.starts_at<=now() and (a.expires_at is null or a.expires_at>now()));
$$;
alter function public.current_user_can_use_calendar_admin_v1() owner to postgres;
revoke all on function public.current_user_can_use_calendar_admin_v1() from public,anon,authenticated,service_role;
grant execute on function public.current_user_can_use_calendar_admin_v1() to authenticated;

alter function public.current_user_can_sync_connected_account_v1(uuid,text) rename to current_user_can_sync_connected_account_base_v1;
revoke all on function public.current_user_can_sync_connected_account_base_v1(uuid,text) from public,anon,authenticated,service_role;
create function public.current_user_can_sync_connected_account_v1(p_connected_account_id uuid,p_operation text)
returns boolean language sql stable security definer set search_path='' as $$
  select (lower(btrim(coalesce(p_operation,'')))<>'calendar' or public.current_user_can_use_calendar_admin_v1())
    and public.current_user_can_sync_connected_account_base_v1(p_connected_account_id,p_operation);
$$;
alter function public.current_user_can_sync_connected_account_v1(uuid,text) owner to postgres;
revoke all on function public.current_user_can_sync_connected_account_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.current_user_can_sync_connected_account_v1(uuid,text) to authenticated;

alter function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) rename to calendar_manual_sync_internal_v2;
revoke all on function public.calendar_manual_sync_internal_v2(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.calendar_manual_sync_v2(p_account uuid,p_run uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(public.current_user_can_use_calendar_admin_v1(),false) then
    raise exception 'CALENDAR_ADMIN_REQUIRED' using errcode='42501';
  end if;
  return public.calendar_manual_sync_internal_v2(p_account,p_run,p_action,p_payload);
end $$;
alter function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.calendar_manual_sync_v2(uuid,uuid,text,jsonb) to authenticated;
commit;
