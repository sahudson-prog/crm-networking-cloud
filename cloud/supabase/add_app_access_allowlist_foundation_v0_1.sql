-- Coffeecito closed beta access foundation v0.1
-- Purpose:
-- - Create the email allowlist used before signup.
-- - Prepare the Supabase Before User Created Auth Hook function.
-- - Keep this phase non-enforcing for existing app RLS/capabilities.
--
-- Remote cutover order:
-- 1. Apply this foundation.
-- 2. Add the existing admin email to public.app_access_allowlist.
-- 3. Run verify_app_access_allowlist_foundation_v0_1.sql.
-- 4. Apply the enforcement migration separately.
--
-- This migration does not enable the remote Auth Hook by itself.

begin;

create or replace function public.normalize_app_access_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(p_email)), '');
$$;

create table if not exists public.app_access_allowlist (
  email_normalized text primary key,
  authorized_at timestamptz not null default now(),
  authorized_by_user_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete set null,
  note text,
  constraint app_access_allowlist_email_not_blank check (btrim(email_normalized) <> ''),
  constraint app_access_allowlist_email_normalized check (
    email_normalized = public.normalize_app_access_email(email_normalized)
  ),
  constraint app_access_allowlist_email_shape check (position('@' in email_normalized) > 1),
  constraint app_access_allowlist_revocation_actor_requires_time check (
    revoked_by_user_id is null or revoked_at is not null
  )
);

create index if not exists idx_app_access_allowlist_active
  on public.app_access_allowlist(email_normalized)
  where revoked_at is null;

alter table public.app_access_allowlist enable row level security;

drop policy if exists "App access allowlist is admin readable" on public.app_access_allowlist;
create policy "App access allowlist is admin readable"
on public.app_access_allowlist
for select
to authenticated
using (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "App access allowlist is admin writable" on public.app_access_allowlist;
create policy "App access allowlist is admin writable"
on public.app_access_allowlist
for all
to authenticated
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

create or replace function public.is_email_authorized_for_app_access(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_access_allowlist allowlist
    where allowlist.email_normalized = public.normalize_app_access_email(p_email)
      and allowlist.revoked_at is null
  );
$$;

create or replace function public.hook_enforce_app_access_allowlist(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := event->'user'->>'email';

  if public.is_email_authorized_for_app_access(v_email) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'Coffeecito esta disponible por invitacion.'
    )
  );
end;
$$;

revoke all on table public.app_access_allowlist from anon;
revoke all on table public.app_access_allowlist from public;
grant select, insert, update, delete on table public.app_access_allowlist to authenticated;

grant usage on schema public to supabase_auth_admin;

revoke execute on function public.normalize_app_access_email(text) from public;
grant execute on function public.normalize_app_access_email(text) to authenticated;
grant execute on function public.normalize_app_access_email(text) to supabase_auth_admin;

revoke execute on function public.is_email_authorized_for_app_access(text) from public;
revoke execute on function public.is_email_authorized_for_app_access(text) from anon;
revoke execute on function public.is_email_authorized_for_app_access(text) from authenticated;
grant execute on function public.is_email_authorized_for_app_access(text) to supabase_auth_admin;

revoke execute on function public.hook_enforce_app_access_allowlist(jsonb) from public;
revoke execute on function public.hook_enforce_app_access_allowlist(jsonb) from anon;
revoke execute on function public.hook_enforce_app_access_allowlist(jsonb) from authenticated;
grant execute on function public.hook_enforce_app_access_allowlist(jsonb) to supabase_auth_admin;

comment on table public.app_access_allowlist is 'Emails normalizados autorizados para registrarse y usar la beta cerrada de Coffeecito. No modela roles, planes ni perfiles.';
comment on column public.app_access_allowlist.email_normalized is 'Email normalizado en minusculas y sin espacios externos. Es la identidad de autorizacion previa al signup.';
comment on column public.app_access_allowlist.authorized_at is 'Fecha en que el email fue autorizado.';
comment on column public.app_access_allowlist.authorized_by_user_id is 'Admin que autorizo el email, si la operacion lo registra.';
comment on column public.app_access_allowlist.revoked_at is 'Fecha de revocacion. Si es NULL, el email esta autorizado.';
comment on column public.app_access_allowlist.revoked_by_user_id is 'Admin que revoco el email, si la operacion lo registra.';
comment on column public.app_access_allowlist.note is 'Nota administrativa opcional sin secretos.';
comment on function public.normalize_app_access_email(text) is 'Normaliza emails para decisiones deterministicas de allowlist.';
comment on function public.is_email_authorized_for_app_access(text) is 'Evalua si un email esta autorizado en allowlist sin exponer filas.';
comment on function public.hook_enforce_app_access_allowlist(jsonb) is 'Funcion preparada para Supabase Before User Created Auth Hook. Bloquea signup si el email no esta autorizado.';

commit;
