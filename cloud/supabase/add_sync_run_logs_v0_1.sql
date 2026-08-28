create table if not exists public.sync_run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid not null default gen_random_uuid(),
  provider text not null,
  resource_type text not null,
  operation text not null,
  scope_label text,
  step_order integer not null default 0,
  step text not null,
  status text not null default 'info'
    check (status in ('info', 'running', 'success', 'warning', 'error')),
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_run_logs_user_created
  on public.sync_run_logs(user_id, created_at desc);

create index if not exists idx_sync_run_logs_user_run
  on public.sync_run_logs(user_id, run_id, step_order);

alter table public.sync_run_logs enable row level security;

drop policy if exists "Sync run logs are owned by user" on public.sync_run_logs;
create policy "Sync run logs are owned by user"
on public.sync_run_logs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
