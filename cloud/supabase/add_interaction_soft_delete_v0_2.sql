-- Adds first-class soft-delete fields for interactions.
-- The current app can already archive via metadata; these columns make the model
-- explicit and easier to query for future sync, KPIs and Coach rules.

alter table public.interactions
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists delete_reason text,
  add column if not exists prevent_reimport boolean not null default false;

create index if not exists idx_interactions_user_active_occurred
  on public.interactions(user_id, is_deleted, occurred_at desc);

create index if not exists idx_interactions_user_prevent_reimport
  on public.interactions(user_id, prevent_reimport)
  where prevent_reimport = true;
