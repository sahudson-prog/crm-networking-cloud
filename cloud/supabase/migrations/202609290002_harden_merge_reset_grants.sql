-- Restores the canonical table and reset RPC grants for merge/reset surfaces.

begin;

do $$
declare
  missing_tables text[];
begin
  select array_agg(table_name order by table_name)
  into missing_tables
  from unnest(array[
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
  ]::text[]) target(table_name)
  where to_regclass(format('public.%I', table_name)) is null;

  if missing_tables is not null then
    raise exception 'Cannot harden merge/reset grants; missing tables: %',
      array_to_string(missing_tables, ', ');
  end if;

  if to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is null then
    raise exception 'Cannot harden merge/reset grants; reset RPC is missing';
  end if;
end;
$$;

revoke all privileges on table
  public.action_invocations,
  public.audit_log,
  public.connected_accounts,
  public.contact_emails,
  public.contact_objective_assignments,
  public.contact_phones,
  public.contacts,
  public.data_exports,
  public.external_contact_ids,
  public.external_contact_snapshots,
  public.external_interaction_read_diagnostics,
  public.external_interaction_sources,
  public.import_batches,
  public.interaction_participants,
  public.interactions,
  public.metric_snapshots,
  public.object_review_state,
  public.objectives,
  public.referrals,
  public.sync_change_suppressions,
  public.sync_cursors,
  public.sync_run_logs,
  public.todo_configs,
  public.todos,
  public.usage_events,
  public.usage_limits,
  public.user_settings
from public, anon, authenticated, service_role, supabase_auth_admin;

grant select on table
  public.action_invocations,
  public.audit_log,
  public.connected_accounts,
  public.contact_emails,
  public.contact_objective_assignments,
  public.contact_phones,
  public.contacts,
  public.data_exports,
  public.external_contact_ids,
  public.external_contact_snapshots,
  public.external_interaction_read_diagnostics,
  public.external_interaction_sources,
  public.import_batches,
  public.interaction_participants,
  public.interactions,
  public.metric_snapshots,
  public.object_review_state,
  public.objectives,
  public.referrals,
  public.sync_change_suppressions,
  public.sync_cursors,
  public.sync_run_logs,
  public.todo_configs,
  public.todos,
  public.usage_events,
  public.usage_limits,
  public.user_settings
to authenticated;

grant insert on table
  public.action_invocations,
  public.audit_log,
  public.contact_emails,
  public.contact_objective_assignments,
  public.contact_phones,
  public.contacts,
  public.external_contact_ids,
  public.external_contact_snapshots,
  public.external_interaction_read_diagnostics,
  public.external_interaction_sources,
  public.interaction_participants,
  public.interactions,
  public.object_review_state,
  public.objectives,
  public.referrals,
  public.sync_cursors,
  public.sync_run_logs,
  public.todo_configs,
  public.todos,
  public.user_settings
to authenticated;

grant update on table
  public.action_invocations,
  public.contact_emails,
  public.contact_phones,
  public.contacts,
  public.external_contact_ids,
  public.external_contact_snapshots,
  public.external_interaction_read_diagnostics,
  public.external_interaction_sources,
  public.interactions,
  public.object_review_state,
  public.objectives,
  public.referrals,
  public.sync_cursors,
  public.todo_configs,
  public.todos,
  public.user_settings
to authenticated;

grant delete on table
  public.contact_emails,
  public.contact_objective_assignments,
  public.contact_phones,
  public.objectives
to authenticated;

alter function public.reset_current_user_app_data_v0_1(text) owner to postgres;
alter function public.reset_current_user_app_data_v0_1(text) security definer;
alter function public.reset_current_user_app_data_v0_1(text) set search_path = '';

revoke all on function public.reset_current_user_app_data_v0_1(text)
from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.reset_current_user_app_data_v0_1(text)
to authenticated;

commit;
