-- Coffeecito PROD bootstrap: canonical global access catalogs.
-- Contains no users, role assignments, organizations or allowlist entries.

begin;

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

commit;
