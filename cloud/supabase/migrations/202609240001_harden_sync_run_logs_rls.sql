-- Restrict sync log reads to effective diagnostics capability while preserving owned inserts.

begin;

alter table public.sync_run_logs enable row level security;

drop policy if exists "Sync run logs are owned by user" on public.sync_run_logs;
drop policy if exists "Sync run logs are readable by diagnostics admins" on public.sync_run_logs;
drop policy if exists "Sync run logs are insertable by owner" on public.sync_run_logs;

create policy "Sync run logs are readable by diagnostics admins"
on public.sync_run_logs
for select
to authenticated
using (public.current_user_has_capability('admin.view_diagnostics'));

create policy "Sync run logs are insertable by owner"
on public.sync_run_logs
for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.current_user_has_app_access()
);

commit;
