-- Structural and security verifier for INV-01 PR 1.

begin transaction read only;

do $$
declare
  v_table text;
  v_function regprocedure;
  v_role text;
  v_privilege text;
  v_settings record;
  v_internal regprocedure[] := array[
    'public.invitation_email_fingerprint_v1(text)'::regprocedure,
    'public.materialize_expired_invitations_v1(timestamptz)'::regprocedure,
    'public.invitation_program_state_for_user_v1(uuid,timestamptz)'::regprocedure,
    'public.is_email_authorized_for_invitation_registration_v1(text)'::regprocedure
  ];
  v_authenticated regprocedure[] := array[
    'public.current_user_invitation_state_v1()'::regprocedure,
    'public.authorize_current_user_invitation_v1(text)'::regprocedure,
    'public.bootstrap_current_user_invitation_v1()'::regprocedure,
    'public.admin_update_invitation_program_v1(boolean,boolean,integer)'::regprocedure,
    'public.admin_cancel_invitation_v1(uuid,text)'::regprocedure,
    'public.admin_lift_invitation_email_block_v1(text,text)'::regprocedure,
    'public.admin_purge_invitation_pii_v1()'::regprocedure
  ];
begin
  foreach v_table in array array[
    'app_invitation_program_settings', 'app_invitations', 'app_invitation_events'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'Missing INV-01 table public.%', v_table;
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      where relation.oid = format('public.%I', v_table)::regclass
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
        and relation.relrowsecurity
        and not relation.relforcerowsecurity
    ) then
      raise exception 'public.% must be postgres-owned with RLS enabled', v_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policies policy
      where policy.schemaname = 'public' and policy.tablename = v_table
    ) then
      raise exception 'public.% has no fail-closed RLS policy', v_table;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl
      where relation.oid = format('public.%I', v_table)::regclass
        and acl.grantee = 0
        and acl.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        )
    ) then
      raise exception 'PUBLIC has forbidden table privileges on public.%', v_table;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] loop
      foreach v_privilege in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] loop
        if pg_catalog.has_table_privilege(v_role, format('public.%I', v_table), v_privilege) then
          raise exception 'Role % has forbidden % on public.%', v_role, v_privilege, v_table;
        end if;
      end loop;
    end loop;
  end loop;

  select * into strict v_settings
  from public.app_invitation_program_settings
  where singleton = true;
  if v_settings.invitations_enabled or v_settings.registrations_enabled
    or v_settings.global_capacity <> 500 then
    raise exception 'INV-01 rollout controls are not closed at capacity 500';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'app_invitations_exact_expiry'
      and conrelid = 'public.app_invitations'::regclass
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'uq_app_invitations_active_email'
  ) or not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'uq_app_invitations_registered_user'
  ) then
    raise exception 'INV-01 lifecycle constraints or unique indexes are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_invitation_events'
      and column_name like '%email%'
  ) then
    raise exception 'Invitation audit events must not store email columns';
  end if;

  if not exists (
    select 1 from public.app_capabilities capability
    where capability.capability_code = 'invitations.authorize'
      and capability.is_active
  ) or not exists (
    select 1 from public.app_role_capabilities role_capability
    where role_capability.role_code = 'user'
      and role_capability.capability_code = 'invitations.authorize'
  ) or not exists (
    select 1 from public.app_role_capabilities role_capability
    where role_capability.role_code = 'beta_tester'
      and role_capability.capability_code = 'invitations.authorize'
  ) then
    raise exception 'Invitation capability grants are incomplete';
  end if;

  if not exists (
    select 1 from public.subscription_plan_capabilities plan_capability
    where plan_capability.plan_code = 'free'
      and plan_capability.capability_code = 'data.delete_account'
  ) then
    raise exception 'Free plan is missing the approved own-data reset capability';
  end if;

  if exists (
    select 1
    from public.app_role_capabilities role_capability
    where role_capability.role_code = 'user'
      and role_capability.capability_code in (
        'connectors.google.use', 'contacts.sync_external',
        'interactions.sync_email', 'interactions.sync_calendar'
      )
  ) or exists (
    select 1
    from public.subscription_plan_capabilities plan_capability
    where plan_capability.plan_code = 'free'
      and plan_capability.capability_code in (
        'connectors.google.use', 'contacts.sync_external',
        'interactions.sync_email', 'interactions.sync_calendar'
      )
  ) then
    raise exception 'INV-01 opened Google data capabilities to user/free';
  end if;

  foreach v_function in array v_internal loop
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) acl
      where procedure.oid = v_function
        and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in (
          'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
        ))
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'Internal INV-01 helper % is executable by a client/system role', v_function;
    end if;
  end loop;

  foreach v_function in array v_authenticated loop
    if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated cannot execute required INV-01 RPC %', v_function;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) acl
      where procedure.oid = v_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC can execute authenticated-only INV-01 RPC %', v_function;
    end if;
    foreach v_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'Role % can execute authenticated-only INV-01 RPC %', v_role, v_function;
      end if;
    end loop;
  end loop;

  foreach v_function in array v_internal || v_authenticated || array[
    'public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure,
    'public.app_access_status_for_user(uuid)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc procedure
      where procedure.oid = v_function
        and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        and (
          procedure.proname = 'invitation_email_fingerprint_v1'
          or procedure.prosecdef
        )
        and exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'INV-01 function % has unexpected owner/security/search_path', v_function;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'supabase_auth_admin', 'public.hook_enforce_app_access_allowlist(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'public.hook_enforce_app_access_allowlist(jsonb)', 'EXECUTE'
  ) then
    raise exception 'Auth Hook EXECUTE contract changed unexpectedly';
  end if;

  if position(
    'is_email_authorized_for_invitation_registration_v1'
    in pg_catalog.pg_get_functiondef('public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure)
  ) = 0 or position(
    'is_email_authorized_for_app_access'
    in pg_catalog.pg_get_functiondef('public.hook_enforce_app_access_allowlist(jsonb)'::regprocedure)
  ) = 0 then
    raise exception 'Auth Hook does not preserve both admission sources';
  end if;

  if position(
    'app_invitations'
    in pg_catalog.pg_get_functiondef('public.app_access_status_for_user(uuid)'::regprocedure)
  ) = 0 then
    raise exception 'App access resolver does not include registered invitations';
  end if;

  if position(
    'app_invitations'
    in pg_catalog.pg_get_functiondef('public.reset_current_user_app_data_v0_1(text)'::regprocedure)
  ) > 0 or position(
    'app_invitation_program_settings'
    in pg_catalog.pg_get_functiondef('public.reset_current_user_app_data_v0_1(text)'::regprocedure)
  ) > 0 then
    raise exception 'Own-data reset unexpectedly mutates invitation authority';
  end if;
end;
$$;

rollback;
