-- Modelo de acceso v0.1 para beta multiusuario.
-- No ejecutar sin revisar primero con el usuario: crea tablas globales y de usuario
-- para roles, planes, capacidades, organizaciones y patrocinios.
-- Bootstrap requerido: despues de ejecutar esta migracion, el primer
-- administrador sistema debe asignarse una sola vez desde Supabase/service role.
-- No crear auto-promocion admin desde la app.

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

insert into public.profiles (id, email, full_name)
select
  auth_user.id,
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data->>'full_name', auth_user.raw_user_meta_data->>'name', '')
from auth.users auth_user
on conflict (id) do update
set email = excluded.email,
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

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

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

  insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
  values (new.id, 'beta_personal', 'active', 'approved')
  on conflict (user_id) do nothing;

  insert into public.user_role_assignments (user_id, role_code, assignment_reason)
  values (new.id, 'user', 'Asignacion automatica al crear cuenta')
  on conflict do nothing;

  return new;
end;
$$;

create or replace function public.current_user_has_capability(p_capability_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select auth.uid() as user_id
  ),
  active_user as (
    select user_id
    from current_profile
    where user_id is not null
  ),
  denied as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode = 'deny'
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  explicit_grant as (
    select 1
    from public.user_capability_overrides override
    join active_user on active_user.user_id = override.user_id
    where override.capability_code = p_capability_code
      and override.override_mode in ('grant', 'limit')
      and override.is_active = true
      and override.starts_at <= now()
      and (override.expires_at is null or override.expires_at > now())
    limit 1
  ),
  role_grant as (
    select 1
    from public.user_role_assignments assignment
    join public.app_role_capabilities role_capability
      on role_capability.role_code = assignment.role_code
    join public.app_roles role
      on role.role_code = assignment.role_code
    join active_user on active_user.user_id = assignment.user_id
    where role_capability.capability_code = p_capability_code
      and assignment.is_active = true
      and role.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
    limit 1
  ),
  plan_grant as (
    select 1
    from public.user_access_profiles access_profile
    join public.subscription_plans plan
      on plan.plan_code = access_profile.plan_code
    join public.subscription_plan_capabilities plan_capability
      on plan_capability.plan_code = access_profile.plan_code
    join active_user on active_user.user_id = access_profile.user_id
    where plan_capability.capability_code = p_capability_code
      and access_profile.account_status = 'active'
      and access_profile.beta_access_status = 'approved'
      and plan.is_active = true
    limit 1
  )
  select exists(select 1 from active_user)
    and not exists(select 1 from denied)
    and (
      exists(select 1 from explicit_grant)
      or exists(select 1 from role_grant)
      or exists(select 1 from plan_grant)
    );
$$;

alter table public.app_capabilities enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_role_capabilities enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_capabilities enable row level security;
alter table public.user_access_profiles enable row level security;
alter table public.user_role_assignments enable row level security;
alter table public.user_capability_overrides enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.user_plan_sponsorships enable row level security;

drop policy if exists "Capabilities are readable" on public.app_capabilities;
create policy "Capabilities are readable"
on public.app_capabilities
for select
using (is_active = true);

drop policy if exists "Capabilities are admin manageable" on public.app_capabilities;
create policy "Capabilities are admin manageable"
on public.app_capabilities
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Roles are readable" on public.app_roles;
create policy "Roles are readable"
on public.app_roles
for select
using (is_active = true);

drop policy if exists "Roles are admin manageable" on public.app_roles;
create policy "Roles are admin manageable"
on public.app_roles
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Role capabilities are readable" on public.app_role_capabilities;
create policy "Role capabilities are readable"
on public.app_role_capabilities
for select
using (true);

drop policy if exists "Role capabilities are admin manageable" on public.app_role_capabilities;
create policy "Role capabilities are admin manageable"
on public.app_role_capabilities
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Plans are readable" on public.subscription_plans;
create policy "Plans are readable"
on public.subscription_plans
for select
using (is_active = true);

drop policy if exists "Plans are admin manageable" on public.subscription_plans;
create policy "Plans are admin manageable"
on public.subscription_plans
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Plan capabilities are readable" on public.subscription_plan_capabilities;
create policy "Plan capabilities are readable"
on public.subscription_plan_capabilities
for select
using (true);

drop policy if exists "Plan capabilities are admin manageable" on public.subscription_plan_capabilities;
create policy "Plan capabilities are admin manageable"
on public.subscription_plan_capabilities
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User access profiles are visible to owner or admin" on public.user_access_profiles;
create policy "User access profiles are visible to owner or admin"
on public.user_access_profiles
for select
using (auth.uid() = user_id or public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User access profiles are admin manageable" on public.user_access_profiles;
create policy "User access profiles are admin manageable"
on public.user_access_profiles
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User roles are visible to owner or admin" on public.user_role_assignments;
create policy "User roles are visible to owner or admin"
on public.user_role_assignments
for select
using (auth.uid() = user_id or public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User roles are admin manageable" on public.user_role_assignments;
create policy "User roles are admin manageable"
on public.user_role_assignments
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User capability overrides are visible to owner or admin" on public.user_capability_overrides;
create policy "User capability overrides are visible to owner or admin"
on public.user_capability_overrides
for select
using (auth.uid() = user_id or public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User capability overrides are admin manageable" on public.user_capability_overrides;
create policy "User capability overrides are admin manageable"
on public.user_capability_overrides
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Organizations are visible to members or admin" on public.organizations;
create policy "Organizations are visible to members or admin"
on public.organizations
for select
using (
  public.current_user_has_capability('admin.manage_access')
  or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = organizations.id
      and membership.user_id = auth.uid()
      and membership.membership_status = 'active'
  )
);

drop policy if exists "Organizations are admin manageable" on public.organizations;
create policy "Organizations are admin manageable"
on public.organizations
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Organization memberships are visible to owner or admin" on public.organization_memberships;
create policy "Organization memberships are visible to owner or admin"
on public.organization_memberships
for select
using (auth.uid() = user_id or public.current_user_has_capability('admin.manage_access'));

drop policy if exists "Organization memberships are admin manageable" on public.organization_memberships;
create policy "Organization memberships are admin manageable"
on public.organization_memberships
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User plan sponsorships are visible to owner or admin" on public.user_plan_sponsorships;
create policy "User plan sponsorships are visible to owner or admin"
on public.user_plan_sponsorships
for select
using (auth.uid() = user_id or public.current_user_has_capability('admin.manage_access'));

drop policy if exists "User plan sponsorships are admin manageable" on public.user_plan_sponsorships;
create policy "User plan sponsorships are admin manageable"
on public.user_plan_sponsorships
for all
using (public.current_user_has_capability('admin.manage_access'))
with check (public.current_user_has_capability('admin.manage_access'));

insert into public.app_capabilities (capability_code, display_name, capability_area, description)
values
  ('admin.manage_access', 'Administrar accesos', 'admin', 'Gestionar roles, planes, usuarios, organizaciones y capacidades.'),
  ('admin.view_diagnostics', 'Ver diagnosticos', 'admin', 'Ver paneles de mantencion, logs y datos crudos controlados.'),
  ('admin.manage_global_masters', 'Administrar maestros globales', 'admin', 'Crear o modificar catalogos globales como empresas headhunter.'),
  ('contacts.import_google', 'Importar contactos Google', 'contacts', 'Revisar e importar contactos desde Google en modo lectura.'),
  ('contacts.manage', 'Gestionar contactos', 'contacts', 'Crear, editar, fusionar y desactivar contactos locales.'),
  ('interactions.import_google', 'Importar actividad Google', 'interactions', 'Revisar e importar correos y citas desde Google en modo lectura.'),
  ('coach.use', 'Usar Coach', 'coach', 'Ver sugerencias y ejecutar acciones permitidas.'),
  ('coach.automate', 'Automatizar Coach', 'coach', 'Permitir que ciertas reglas ejecuten acciones sin confirmacion manual.'),
  ('data.export', 'Exportar datos', 'data', 'Generar respaldo o exportacion de datos propios segun plan.'),
  ('data.delete_account', 'Eliminar cuenta', 'data', 'Solicitar cierre, borrado o anonimizado de cuenta segun politica vigente.')
on conflict (capability_code) do update
set display_name = excluded.display_name,
    capability_area = excluded.capability_area,
    description = excluded.description,
    is_active = true;

insert into public.app_roles (role_code, display_name, description, is_system_role)
values
  ('user', 'Usuario', 'Usuario final propietario de sus datos.', true),
  ('beta_tester', 'Beta tester', 'Usuario habilitado para probar funciones beta.', true),
  ('support_admin', 'Soporte admin', 'Administrador operativo con acceso limitado a diagnostico.', true),
  ('system_admin', 'Administrador sistema', 'Administrador con capacidad de gestionar accesos y maestros globales.', true),
  ('sponsor_admin', 'Administrador sponsor', 'Representante de empresa patrocinadora sin acceso automatico a datos privados.', true)
on conflict (role_code) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_system_role = excluded.is_system_role,
    is_active = true;

insert into public.app_role_capabilities (role_code, capability_code)
values
  ('user', 'contacts.manage'),
  ('user', 'contacts.import_google'),
  ('user', 'interactions.import_google'),
  ('user', 'coach.use'),
  ('beta_tester', 'contacts.manage'),
  ('beta_tester', 'contacts.import_google'),
  ('beta_tester', 'interactions.import_google'),
  ('beta_tester', 'coach.use'),
  ('support_admin', 'admin.view_diagnostics'),
  ('system_admin', 'admin.manage_access'),
  ('system_admin', 'admin.view_diagnostics'),
  ('system_admin', 'admin.manage_global_masters'),
  ('system_admin', 'data.delete_account'),
  ('sponsor_admin', 'admin.view_diagnostics')
on conflict (role_code, capability_code) do nothing;

insert into public.subscription_plans (plan_code, display_name, tier_rank, description, is_public)
values
  ('beta_personal', 'Beta personal', 10, 'Plan base de beta cerrada.', false),
  ('free', 'Gratis', 20, 'Plan gratuito futuro con limites acotados.', true),
  ('pro', 'Pro', 30, 'Plan individual con limites mayores y automatizaciones seleccionadas.', true),
  ('premium', 'Premium', 40, 'Plan superior con exportaciones y automatizaciones avanzadas.', true),
  ('sponsored_base', 'Patrocinado base', 25, 'Plan pagado por una organizacion sponsor.', false)
on conflict (plan_code) do update
set display_name = excluded.display_name,
    tier_rank = excluded.tier_rank,
    description = excluded.description,
    is_public = excluded.is_public,
    is_active = true;

insert into public.subscription_plan_capabilities (plan_code, capability_code, capability_limit_json)
values
  ('beta_personal', 'contacts.manage', '{}'::jsonb),
  ('beta_personal', 'contacts.import_google', '{}'::jsonb),
  ('beta_personal', 'interactions.import_google', '{}'::jsonb),
  ('beta_personal', 'coach.use', '{}'::jsonb),
  ('beta_personal', 'data.delete_account', '{}'::jsonb),
  ('free', 'contacts.manage', '{"max_contacts": 200}'::jsonb),
  ('free', 'coach.use', '{"automation_allowed": false}'::jsonb),
  ('pro', 'contacts.manage', '{}'::jsonb),
  ('pro', 'contacts.import_google', '{}'::jsonb),
  ('pro', 'interactions.import_google', '{}'::jsonb),
  ('pro', 'coach.use', '{}'::jsonb),
  ('pro', 'coach.automate', '{"allowed_rule_count": 3}'::jsonb),
  ('premium', 'contacts.manage', '{}'::jsonb),
  ('premium', 'contacts.import_google', '{}'::jsonb),
  ('premium', 'interactions.import_google', '{}'::jsonb),
  ('premium', 'coach.use', '{}'::jsonb),
  ('premium', 'coach.automate', '{}'::jsonb),
  ('premium', 'data.export', '{"minimum_paid_months": 6}'::jsonb),
  ('sponsored_base', 'contacts.manage', '{}'::jsonb),
  ('sponsored_base', 'contacts.import_google', '{}'::jsonb),
  ('sponsored_base', 'interactions.import_google', '{}'::jsonb),
  ('sponsored_base', 'coach.use', '{}'::jsonb)
on conflict (plan_code, capability_code) do update
set capability_limit_json = excluded.capability_limit_json;

insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
select id, 'beta_personal', 'active', 'approved'
from public.profiles
on conflict (user_id) do nothing;

insert into public.user_role_assignments (user_id, role_code, assignment_reason)
select id, 'user', 'Asignacion base al instalar modelo de acceso'
from public.profiles
where not exists (
  select 1
  from public.user_role_assignments assignment
  where assignment.user_id = profiles.id
    and assignment.role_code = 'user'
    and assignment.is_active = true
);

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();

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
