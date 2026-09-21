-- Habilita la capacidad para reiniciar datos personales desde Cuenta.
-- No borra datos. Solo agrega la capacidad `data.delete_account` al rol admin
-- y al plan beta personal para que la RPC de reinicio pueda ejecutarse.

insert into public.app_capabilities (
  capability_code,
  display_name,
  capability_area,
  description
)
values (
  'data.delete_account',
  'Reiniciar datos personales',
  'data',
  'Borrar datos operativos propios y partir desde cero sin eliminar login, plan, roles ni maestros globales.'
)
on conflict (capability_code) do update
set display_name = excluded.display_name,
    capability_area = excluded.capability_area,
    description = excluded.description,
    is_active = true,
    updated_at = now();

insert into public.app_role_capabilities (role_code, capability_code)
values ('system_admin', 'data.delete_account')
on conflict (role_code, capability_code) do nothing;

insert into public.subscription_plan_capabilities (
  plan_code,
  capability_code,
  capability_limit_json
)
values ('beta_personal', 'data.delete_account', '{}'::jsonb)
on conflict (plan_code, capability_code) do update
set capability_limit_json = excluded.capability_limit_json;

select
  'capacidad_reinicio_datos' as verification_name,
  exists (
    select 1
    from public.app_role_capabilities
    where role_code = 'system_admin'
      and capability_code = 'data.delete_account'
  ) as system_admin_has_capability,
  exists (
    select 1
    from public.subscription_plan_capabilities
    where plan_code = 'beta_personal'
      and capability_code = 'data.delete_account'
  ) as beta_personal_has_capability;
