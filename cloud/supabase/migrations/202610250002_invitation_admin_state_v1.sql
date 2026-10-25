-- INV-01 PR 2: narrow administrative read boundary.
-- This migration does not change rollout flags, roles, plans or invitation lifecycle.

begin;

do $guard$
begin
  if to_regclass('public.app_invitation_program_settings') is null
    or to_regclass('public.app_invitations') is null
    or to_regprocedure('public.current_user_has_capability(text)') is null
    or to_regprocedure('public.admin_update_invitation_program_v1(boolean,boolean,integer)') is null then
    raise exception 'INV-01 PR 1 is required before installing the administrative read RPC';
  end if;
  if not exists (
    select 1 from public.app_invitation_program_settings where singleton = true
  ) then
    raise exception 'INV-01 singleton program settings row is missing';
  end if;
end;
$guard$;

create or replace function public.admin_invitation_program_state_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_settings public.app_invitation_program_settings%rowtype;
  v_pending_reservations integer;
  v_registered_users integer;
begin
  if v_user_id is null
    or not public.current_user_has_capability('admin.manage_access') then
    raise exception 'admin_manage_access_required' using errcode = '42501';
  end if;

  select * into strict v_settings
  from public.app_invitation_program_settings
  where singleton = true;

  select
    count(*) filter (
      where invitation.invitation_status = 'pending'
        and invitation.expires_at > v_now
    )::integer,
    count(*) filter (
      where invitation.invitation_status = 'registered'
    )::integer
  into v_pending_reservations, v_registered_users
  from public.app_invitations invitation;

  return jsonb_build_object(
    'invitations_enabled', v_settings.invitations_enabled,
    'registrations_enabled', v_settings.registrations_enabled,
    'global_capacity', v_settings.global_capacity,
    'pending_reservations', v_pending_reservations,
    'registered_users', v_registered_users,
    'used_capacity', v_pending_reservations + v_registered_users,
    'available_capacity', greatest(
      0,
      v_settings.global_capacity - v_pending_reservations - v_registered_users
    ),
    'updated_at', v_settings.updated_at
  );
end;
$$;

alter function public.admin_invitation_program_state_v1() owner to postgres;

revoke all on function public.admin_invitation_program_state_v1()
from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.admin_invitation_program_state_v1() to authenticated;

comment on function public.admin_invitation_program_state_v1() is
  'Admin-only INV-01 settings and aggregate capacity counts. Returns no invitation, email or actor identifiers.';

commit;
