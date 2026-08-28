-- CRM Networking reset current user app data v0.1
-- Purpose: allow an authenticated user to delete their own app data and start fresh.
-- Destructive: deletes contacts, interactions, objectives, sync state, connected accounts and logs for auth.uid().
-- It does not delete auth.users, public.profiles, roles, plans, sponsorships or global masters.
-- Review before production and make sure the user has capability data.delete_account.

create or replace function public.reset_current_user_app_data_v0_1(p_confirmation text)
returns table (
  deleted_table_name text,
  deleted_row_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target_user_id uuid := auth.uid();
  table_to_delete text;
  deleted_count integer;
  tables_in_delete_order text[] := array[
    'metric_snapshots',
    'usage_events',
    'usage_limits',
    'data_exports',
    'import_batches',
    'sync_run_logs',
    'sync_cursors',
    'external_interaction_read_diagnostics',
    'object_review_state',
    'action_invocations',
    'todos',
    'todo_configs',
    'referrals',
    'contact_objective_assignments',
    'objectives',
    'external_interaction_sources',
    'interaction_participants',
    'interactions',
    'contact_emails',
    'contact_phones',
    'external_contact_snapshots',
    'external_contact_ids',
    'contacts',
    'connected_accounts',
    'user_settings',
    'audit_log'
  ];
begin
  if target_user_id is null then
    raise exception 'No authenticated user.';
  end if;

  if p_confirmation <> 'BORRAR MIS DATOS' then
    raise exception 'Invalid confirmation phrase.';
  end if;

  if not public.current_user_has_capability('data.delete_account') then
    raise exception 'Current user does not have permission to reset app data.';
  end if;

  foreach table_to_delete in array tables_in_delete_order loop
    if to_regclass(format('public.%I', table_to_delete)) is null then
      deleted_table_name := table_to_delete;
      deleted_row_count := 0;
      return next;
    else
      if not exists (
        select 1
        from information_schema.columns column_definition
        where column_definition.table_schema = 'public'
          and column_definition.table_name = table_to_delete
          and column_definition.column_name = 'user_id'
      ) then
        raise exception 'Reset table % exists but does not have user_id column.', table_to_delete;
      end if;

      execute format('delete from public.%I where user_id = $1', table_to_delete)
      using target_user_id;
      get diagnostics deleted_count = row_count;
      deleted_table_name := table_to_delete;
      deleted_row_count := deleted_count;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.reset_current_user_app_data_v0_1(text) to authenticated;
