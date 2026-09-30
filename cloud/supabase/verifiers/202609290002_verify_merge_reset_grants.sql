-- Verifies the effective merge/reset grant matrix and RPC security metadata.

begin;

do $verify$
declare
  table_name text;
  app_role text;
  privilege_name text;
  actual_grant boolean;
  expected_grant boolean;
  reset_function regprocedure := to_regprocedure('public.reset_current_user_app_data_v0_1(text)');
  merge_function regprocedure := to_regprocedure('public.merge_contacts_deep(uuid,uuid[],jsonb,text)');
  target_tables text[] := array[
    'action_invocations', 'audit_log', 'connected_accounts',
    'contact_emails', 'contact_objective_assignments', 'contact_phones',
    'contacts', 'data_exports', 'external_contact_ids',
    'external_contact_snapshots', 'external_interaction_read_diagnostics',
    'external_interaction_sources', 'import_batches',
    'interaction_participants', 'interactions', 'metric_snapshots',
    'object_review_state', 'objectives', 'referrals',
    'sync_change_suppressions', 'sync_cursors', 'sync_run_logs',
    'todo_configs', 'todos', 'usage_events', 'usage_limits',
    'user_settings'
  ];
  insert_tables text[] := array[
    'action_invocations', 'audit_log', 'contact_emails',
    'contact_objective_assignments', 'contact_phones', 'contacts',
    'external_contact_ids', 'external_contact_snapshots',
    'external_interaction_read_diagnostics', 'external_interaction_sources',
    'interaction_participants', 'interactions', 'object_review_state',
    'objectives', 'referrals', 'sync_cursors', 'sync_run_logs',
    'todo_configs', 'todos', 'user_settings'
  ];
  update_tables text[] := array[
    'action_invocations', 'contact_emails', 'contact_phones', 'contacts',
    'external_contact_ids', 'external_contact_snapshots',
    'external_interaction_read_diagnostics', 'external_interaction_sources',
    'interactions', 'object_review_state', 'objectives', 'referrals',
    'sync_cursors', 'todo_configs', 'todos', 'user_settings'
  ];
  delete_tables text[] := array[
    'contact_emails', 'contact_objective_assignments',
    'contact_phones', 'objectives'
  ];
begin
  foreach table_name in array target_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Grant contract table public.% is missing', table_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.interaction_participants', 'UPDATE') then
    raise exception 'authenticated must not UPDATE public.interaction_participants directly';
  end if;
  if has_table_privilege('authenticated', 'public.interaction_participants', 'DELETE') then
    raise exception 'authenticated must not DELETE from public.interaction_participants directly';
  end if;
  if has_table_privilege('authenticated', 'public.object_review_state', 'DELETE') then
    raise exception 'authenticated must not DELETE from public.object_review_state directly';
  end if;
  if has_table_privilege('authenticated', 'public.contact_objective_assignments', 'UPDATE') then
    raise exception 'authenticated must not UPDATE public.contact_objective_assignments directly';
  end if;

  foreach table_name in array target_tables loop
    foreach app_role in array array[
      'PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] loop
      foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if app_role = 'PUBLIC' then
          select exists (
            select 1
            from pg_catalog.pg_class relation
            cross join lateral pg_catalog.aclexplode(
              coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
            ) acl
            where relation.oid = format('public.%I', table_name)::regclass
              and acl.grantee = 0
              and acl.privilege_type = privilege_name
          ) into actual_grant;
        else
          actual_grant := has_table_privilege(
            app_role,
            format('public.%I', table_name),
            privilege_name
          );
        end if;

        expected_grant := app_role = 'authenticated'
          and case privilege_name
            when 'SELECT' then true
            when 'INSERT' then table_name = any(insert_tables)
            when 'UPDATE' then table_name = any(update_tables)
            when 'DELETE' then table_name = any(delete_tables)
            else false
          end;

        if actual_grant is distinct from expected_grant then
          raise exception 'Grant drift on public.%: role % privilege % is %, expected %',
            table_name, app_role, privilege_name, actual_grant, expected_grant;
        end if;
      end loop;
    end loop;
  end loop;

  if reset_function is null then
    raise exception 'Reset RPC public.reset_current_user_app_data_v0_1(text) is missing';
  end if;
  if merge_function is null then
    raise exception 'Merge RPC public.merge_contacts_deep(uuid,uuid[],jsonb,text) is missing';
  end if;

  if not (select procedure.prosecdef from pg_catalog.pg_proc procedure where procedure.oid = reset_function) then
    raise exception 'Reset RPC must be SECURITY DEFINER';
  end if;
  if (select pg_get_userbyid(procedure.proowner) from pg_catalog.pg_proc procedure where procedure.oid = reset_function) <> 'postgres' then
    raise exception 'Reset RPC owner must be postgres';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral unnest(coalesce(procedure.proconfig, array[]::text[])) config
    where procedure.oid = reset_function
      and config in ('search_path=', 'search_path=""')
  ) then
    raise exception 'Reset RPC search_path must be empty';
  end if;

  if not (select procedure.prosecdef from pg_catalog.pg_proc procedure where procedure.oid = merge_function) then
    raise exception 'Merge RPC must be SECURITY DEFINER';
  end if;
  if (select pg_get_userbyid(procedure.proowner) from pg_catalog.pg_proc procedure where procedure.oid = merge_function) <> 'postgres' then
    raise exception 'Merge RPC owner must be postgres';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral unnest(coalesce(procedure.proconfig, array[]::text[])) config
    where procedure.oid = merge_function
      and config in ('search_path=', 'search_path=""')
  ) then
    raise exception 'Merge RPC search_path must be empty';
  end if;

  foreach app_role in array array['anon', 'service_role', 'supabase_auth_admin'] loop
    if has_function_privilege(app_role, reset_function, 'EXECUTE') then
      raise exception 'Role % must not execute reset RPC', app_role;
    end if;
    if has_function_privilege(app_role, merge_function, 'EXECUTE') then
      raise exception 'Role % must not execute merge RPC', app_role;
    end if;
  end loop;

  if not has_function_privilege('authenticated', reset_function, 'EXECUTE') then
    raise exception 'authenticated must execute reset RPC';
  end if;
  if not has_function_privilege('authenticated', merge_function, 'EXECUTE') then
    raise exception 'authenticated must execute merge RPC';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) acl
    where procedure.oid in (reset_function, merge_function)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC must not execute reset or merge RPC';
  end if;
end;
$verify$;

rollback;
