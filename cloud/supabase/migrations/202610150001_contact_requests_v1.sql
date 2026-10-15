-- Adds the public contact intake boundary and its least-privilege admin surface.

begin;

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  requester_name text,
  requester_email text not null,
  reason text not null,
  privacy_subreason text,
  message text not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'received',
  identity_verification_status text not null default 'not_required',
  constraint contact_requests_name_length check (
    requester_name is null or char_length(requester_name) between 1 and 120
  ),
  constraint contact_requests_email_canonical check (
    requester_email = lower(btrim(requester_email))
    and char_length(requester_email) between 3 and 254
    and requester_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint contact_requests_reason check (
    reason in ('support', 'privacy', 'problem', 'other')
  ),
  constraint contact_requests_privacy_subreason check (
    (reason = 'privacy' and (
      privacy_subreason is null
      or privacy_subreason in ('access', 'rectification', 'erasure', 'objection', 'portability', 'blocking', 'other')
    ))
    or (reason <> 'privacy' and privacy_subreason is null)
  ),
  constraint contact_requests_message_length check (
    char_length(btrim(message)) between 1 and 5000
  ),
  constraint contact_requests_status check (
    status in ('received', 'in_review', 'waiting_user', 'resolved', 'closed')
  ),
  constraint contact_requests_identity_verification check (
    (reason = 'privacy' and identity_verification_status in ('pending', 'verified', 'rejected'))
    or (reason <> 'privacy' and identity_verification_status = 'not_required')
  )
);

create index if not exists idx_contact_requests_status_created
  on public.contact_requests(status, created_at desc);
create index if not exists idx_contact_requests_user_created
  on public.contact_requests(user_id, created_at desc)
  where user_id is not null;

drop trigger if exists set_contact_requests_updated_at on public.contact_requests;
create trigger set_contact_requests_updated_at
before update on public.contact_requests
for each row execute function public.set_updated_at();

insert into public.app_capabilities (capability_code, display_name, capability_area, description)
values (
  'admin.manage_contact_requests',
  'Gestionar solicitudes de contacto',
  'admin',
  'Revisar solicitudes de contacto y actualizar su estado operativo o de verificacion de identidad.'
)
on conflict (capability_code) do update
set display_name = excluded.display_name,
    capability_area = excluded.capability_area,
    description = excluded.description,
    is_active = true;

insert into public.app_role_capabilities (role_code, capability_code)
select 'system_admin', 'admin.manage_contact_requests'
where exists (
  select 1 from public.app_roles role where role.role_code = 'system_admin'
)
on conflict (role_code, capability_code) do nothing;

create or replace function public.submit_contact_request_v1(
  p_name text,
  p_email text,
  p_reason text,
  p_privacy_subreason text,
  p_message text,
  p_user_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_privacy_subreason text := nullif(pg_catalog.btrim(coalesce(p_privacy_subreason, '')), '');
  v_message text := pg_catalog.btrim(coalesce(p_message, ''));
begin
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'CONTACT_REQUEST_INVALID_NAME' using errcode = '22023';
  end if;
  if char_length(v_email) > 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'CONTACT_REQUEST_INVALID_EMAIL' using errcode = '22023';
  end if;
  if v_reason not in ('support', 'privacy', 'problem', 'other') then
    raise exception 'CONTACT_REQUEST_INVALID_REASON' using errcode = '22023';
  end if;
  if v_reason = 'privacy' then
    if v_privacy_subreason is not null
      and v_privacy_subreason not in ('access', 'rectification', 'erasure', 'objection', 'portability', 'blocking', 'other') then
      raise exception 'CONTACT_REQUEST_INVALID_PRIVACY_SUBREASON' using errcode = '22023';
    end if;
  elsif v_privacy_subreason is not null then
    raise exception 'CONTACT_REQUEST_UNEXPECTED_PRIVACY_SUBREASON' using errcode = '22023';
  end if;
  if char_length(v_message) < 1 or char_length(v_message) > 5000 then
    raise exception 'CONTACT_REQUEST_INVALID_MESSAGE' using errcode = '22023';
  end if;
  if p_user_id is not null and not exists (
    select 1 from auth.users auth_user where auth_user.id = p_user_id
  ) then
    raise exception 'CONTACT_REQUEST_INVALID_USER' using errcode = '22023';
  end if;

  insert into public.contact_requests (
    requester_name,
    requester_email,
    reason,
    privacy_subreason,
    message,
    user_id,
    status,
    identity_verification_status
  ) values (
    v_name,
    v_email,
    v_reason,
    v_privacy_subreason,
    v_message,
    p_user_id,
    'received',
    case when v_reason = 'privacy' then 'pending' else 'not_required' end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.admin_list_contact_requests_v1(p_limit integer default 100)
returns setof public.contact_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_has_capability('admin.manage_contact_requests') then
    raise exception 'admin.manage_contact_requests required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'CONTACT_REQUEST_INVALID_LIMIT' using errcode = '22023';
  end if;

  return query
  select request.*
  from public.contact_requests request
  order by request.created_at desc
  limit p_limit;
end;
$$;

create or replace function public.admin_update_contact_request_v1(
  p_request_id uuid,
  p_status text,
  p_identity_verification_status text
)
returns setof public.contact_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_before public.contact_requests%rowtype;
  v_after public.contact_requests%rowtype;
  v_status text := pg_catalog.btrim(coalesce(p_status, ''));
  v_identity_status text := pg_catalog.btrim(coalesce(p_identity_verification_status, ''));
begin
  if v_actor_user_id is null or not public.current_user_has_capability('admin.manage_contact_requests') then
    raise exception 'admin.manage_contact_requests required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'CONTACT_REQUEST_ID_REQUIRED' using errcode = '22023';
  end if;
  if v_status not in ('received', 'in_review', 'waiting_user', 'resolved', 'closed') then
    raise exception 'CONTACT_REQUEST_INVALID_STATUS' using errcode = '22023';
  end if;

  select request.*
  into v_before
  from public.contact_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception 'CONTACT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_before.reason = 'privacy' then
    if v_identity_status not in ('pending', 'verified', 'rejected') then
      raise exception 'CONTACT_REQUEST_INVALID_IDENTITY_STATUS' using errcode = '22023';
    end if;
  elsif v_identity_status <> 'not_required' then
    raise exception 'CONTACT_REQUEST_IDENTITY_STATUS_NOT_APPLICABLE' using errcode = '22023';
  end if;

  update public.contact_requests request
  set status = v_status,
      identity_verification_status = v_identity_status
  where request.id = p_request_id
  returning request.* into v_after;

  insert into public.audit_log (
    user_id, actor, action, object_type, object_id, before_json, after_json
  ) values (
    v_actor_user_id,
    'admin',
    'contact_request.update',
    'contact_request',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'status', v_before.status,
      'identityVerificationStatus', v_before.identity_verification_status
    ),
    pg_catalog.jsonb_build_object(
      'status', v_after.status,
      'identityVerificationStatus', v_after.identity_verification_status
    )
  );

  return next v_after;
end;
$$;

alter table public.contact_requests owner to postgres;
alter function public.submit_contact_request_v1(text, text, text, text, text, uuid) owner to postgres;
alter function public.admin_list_contact_requests_v1(integer) owner to postgres;
alter function public.admin_update_contact_request_v1(uuid, text, text) owner to postgres;

alter table public.contact_requests enable row level security;
alter table public.contact_requests no force row level security;

drop policy if exists "Contact requests are admin readable" on public.contact_requests;
create policy "Contact requests are admin readable"
on public.contact_requests
for select
to authenticated
using (public.current_user_has_capability('admin.manage_contact_requests'));

revoke all on table public.contact_requests from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.submit_contact_request_v1(text, text, text, text, text, uuid)
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.admin_list_contact_requests_v1(integer)
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.admin_update_contact_request_v1(uuid, text, text)
  from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function public.submit_contact_request_v1(text, text, text, text, text, uuid)
  to service_role;
grant execute on function public.admin_list_contact_requests_v1(integer)
  to authenticated;
grant execute on function public.admin_update_contact_request_v1(uuid, text, text)
  to authenticated;

comment on table public.contact_requests is 'Solicitudes publicas de contacto, soporte y privacidad recibidas por la frontera server-side validada.';
comment on column public.contact_requests.user_id is 'Usuario Auth validado server-side al enviar, si existe una sesion valida; nunca se acepta desde el formulario.';
comment on function public.submit_contact_request_v1(text, text, text, text, text, uuid) is 'Frontera interna service-role para persistir una solicitud ya validada por Turnstile y por el servidor.';
comment on function public.admin_list_contact_requests_v1(integer) is 'Lista solicitudes solo para usuarios con admin.manage_contact_requests.';
comment on function public.admin_update_contact_request_v1(uuid, text, text) is 'Actualiza estados operativos acotados y registra auditoria sin copiar el mensaje.';

commit;
