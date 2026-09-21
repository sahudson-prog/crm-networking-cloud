-- Coffeecito PROD bootstrap: access schema.
-- Contains no users, assignments, allowlist entries or DEV backfills.

begin;

create table if not exists public.app_capabilities (
  capability_code text primary key,
  display_name text not null,
  capability_area text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_capabilities_code_not_blank check (btrim(capability_code) <> ''),
  constraint app_capabilities_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.app_roles (
  role_code text primary key,
  display_name text not null,
  description text not null default '',
  is_system_role boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_roles_code_not_blank check (btrim(role_code) <> ''),
  constraint app_roles_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.app_role_capabilities (
  role_code text not null references public.app_roles(role_code) on delete cascade,
  capability_code text not null references public.app_capabilities(capability_code) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (role_code, capability_code)
);

create table if not exists public.subscription_plans (
  plan_code text primary key,
  display_name text not null,
  tier_rank integer not null default 0,
  description text not null default '',
  is_public boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code_not_blank check (btrim(plan_code) <> ''),
  constraint subscription_plans_display_name_not_blank check (btrim(display_name) <> '')
);

create table if not exists public.subscription_plan_capabilities (
  plan_code text not null references public.subscription_plans(plan_code) on delete cascade,
  capability_code text not null references public.app_capabilities(capability_code) on delete cascade,
  capability_limit_json jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  primary key (plan_code, capability_code)
);

create table if not exists public.user_access_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_code text references public.subscription_plans(plan_code) on delete set null,
  account_status text not null default 'active'
    check (account_status in ('active', 'paused', 'closed', 'beta_pending')),
  beta_access_status text not null default 'approved'
    check (beta_access_status in ('approved', 'pending', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null references public.app_roles(role_code) on delete restrict,
  granted_by_user_id uuid references public.profiles(id) on delete set null,
  assignment_reason text not null default '',
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_capability_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  capability_code text not null references public.app_capabilities(capability_code) on delete restrict,
  override_mode text not null check (override_mode in ('grant', 'deny', 'limit')),
  capability_limit_json jsonb not null default '{}'::jsonb,
  override_reason text not null default '',
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  organization_type text not null default 'sponsor'
    check (organization_type in ('sponsor', 'outplacement', 'employer', 'partner', 'internal')),
  billing_contact_email text not null default '',
  status text not null default 'active'
    check (status in ('active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_display_name_not_blank check (btrim(display_name) <> ''),
  constraint organizations_normalized_name_not_blank check (btrim(normalized_name) <> '')
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_role text not null default 'member'
    check (membership_role in ('member', 'sponsor_admin', 'viewer')),
  membership_status text not null default 'active'
    check (membership_status in ('active', 'invited', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, membership_role)
);

create table if not exists public.user_plan_sponsorships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sponsored_plan_code text not null references public.subscription_plans(plan_code) on delete restrict,
  sponsorship_status text not null default 'active'
    check (sponsorship_status in ('active', 'pending', 'paused', 'ended')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  sponsorship_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_role_assignments_user_active
  on public.user_role_assignments(user_id, is_active);
create unique index if not exists uq_user_role_assignments_active_role
  on public.user_role_assignments(user_id, role_code)
  where is_active = true;
create index if not exists idx_user_capability_overrides_user_active
  on public.user_capability_overrides(user_id, is_active);
create index if not exists idx_organization_memberships_user
  on public.organization_memberships(user_id, membership_status);
create index if not exists idx_user_plan_sponsorships_user
  on public.user_plan_sponsorships(user_id, sponsorship_status);

drop trigger if exists set_app_capabilities_updated_at on public.app_capabilities;
create trigger set_app_capabilities_updated_at
before update on public.app_capabilities
for each row execute function public.set_updated_at();

drop trigger if exists set_app_roles_updated_at on public.app_roles;
create trigger set_app_roles_updated_at
before update on public.app_roles
for each row execute function public.set_updated_at();

drop trigger if exists set_subscription_plans_updated_at on public.subscription_plans;
create trigger set_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_user_access_profiles_updated_at on public.user_access_profiles;
create trigger set_user_access_profiles_updated_at
before update on public.user_access_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_role_assignments_updated_at on public.user_role_assignments;
create trigger set_user_role_assignments_updated_at
before update on public.user_role_assignments
for each row execute function public.set_updated_at();

drop trigger if exists set_user_capability_overrides_updated_at on public.user_capability_overrides;
create trigger set_user_capability_overrides_updated_at
before update on public.user_capability_overrides
for each row execute function public.set_updated_at();

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists set_organization_memberships_updated_at on public.organization_memberships;
create trigger set_organization_memberships_updated_at
before update on public.organization_memberships
for each row execute function public.set_updated_at();

drop trigger if exists set_user_plan_sponsorships_updated_at on public.user_plan_sponsorships;
create trigger set_user_plan_sponsorships_updated_at
before update on public.user_plan_sponsorships
for each row execute function public.set_updated_at();

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

comment on table public.app_capabilities is 'Catalogo global de capacidades accionables de la app. No contiene datos personales.';
comment on table public.app_roles is 'Catalogo global de roles base usados para agrupar capacidades.';
comment on table public.app_role_capabilities is 'Relacion global entre roles y capacidades.';
comment on table public.subscription_plans is 'Catalogo global de planes o tiers comerciales.';
comment on table public.subscription_plan_capabilities is 'Capacidades incluidas por plan, con limites configurables por capacidad.';
comment on table public.user_access_profiles is 'Perfil de acceso por usuario: plan vigente y estado de beta/cuenta.';
comment on table public.user_role_assignments is 'Roles asignados a usuarios, con vigencia y auditoria basica.';
comment on table public.user_capability_overrides is 'Excepciones por usuario para otorgar, bloquear o limitar capacidades.';
comment on table public.organizations is 'Organizaciones sponsor, outplacement, partners o internas.';
comment on table public.organization_memberships is 'Vinculo entre usuarios y organizaciones, sin acceso automatico a datos privados.';
comment on table public.user_plan_sponsorships is 'Registro de planes financiados por organizaciones para usuarios.';
comment on table public.app_access_allowlist is 'Emails normalizados autorizados para registrarse y usar la beta cerrada de Coffeecito. No modela roles, planes ni perfiles.';
comment on column public.app_access_allowlist.email_normalized is 'Email normalizado en minusculas y sin espacios externos. Es la identidad de autorizacion previa al signup.';
comment on column public.app_access_allowlist.authorized_at is 'Fecha en que el email fue autorizado.';
comment on column public.app_access_allowlist.authorized_by_user_id is 'Admin que autorizo el email, si la operacion lo registra.';
comment on column public.app_access_allowlist.revoked_at is 'Fecha de revocacion. Si es NULL, el email esta autorizado.';
comment on column public.app_access_allowlist.revoked_by_user_id is 'Admin que revoco el email, si la operacion lo registra.';
comment on column public.app_access_allowlist.note is 'Nota administrativa opcional sin secretos.';
comment on function public.normalize_app_access_email(text) is 'Normaliza emails para decisiones deterministicas de allowlist.';

commit;
