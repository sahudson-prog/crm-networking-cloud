-- Recuperacion manual de administrador sistema por email.
-- Uso esperado: ejecutar desde Supabase SQL Editor con privilegios de mantenimiento.
-- No borra datos. Solo reactiva perfil de acceso y roles base para el email indicado.

do $$
declare
  target_admin_email text := 'sergiohudson@gmail.com';
  target_admin_user_id uuid;
  role_to_restore text;
  updated_role_rows integer;
begin
  if target_admin_email = 'REEMPLAZAR_EMAIL_ADMIN' then
    raise exception 'Reemplaza target_admin_email antes de ejecutar esta recuperacion.';
  end if;

  select profile.id
  into target_admin_user_id
  from public.profiles profile
  where lower(profile.email) = lower(target_admin_email)
  limit 1;

  if target_admin_user_id is null then
    raise exception 'No existe profile para el email indicado: %', target_admin_email;
  end if;

  insert into public.user_access_profiles (
    user_id,
    plan_code,
    account_status,
    beta_access_status
  )
  values (
    target_admin_user_id,
    'beta_personal',
    'active',
    'approved'
  )
  on conflict (user_id) do update
  set plan_code = coalesce(public.user_access_profiles.plan_code, excluded.plan_code),
      account_status = 'active',
      beta_access_status = 'approved',
      updated_at = now();

  foreach role_to_restore in array array['user', 'beta_tester', 'system_admin']
  loop
    update public.user_role_assignments role_assignment
    set is_active = true,
        starts_at = coalesce(role_assignment.starts_at, now()),
        expires_at = null,
        assignment_reason = 'Recuperacion manual de administrador sistema por email',
        updated_at = now()
    where role_assignment.user_id = target_admin_user_id
      and role_assignment.role_code = role_to_restore;

    get diagnostics updated_role_rows = row_count;

    if updated_role_rows = 0 then
      insert into public.user_role_assignments (
        user_id,
        role_code,
        assignment_reason,
        is_active
      )
      values (
        target_admin_user_id,
        role_to_restore,
        'Recuperacion manual de administrador sistema por email',
        true
      );
    end if;
  end loop;
end $$;

select
  profile.email as admin_email,
  access_profile.plan_code,
  access_profile.account_status,
  access_profile.beta_access_status,
  role_assignment.role_code,
  role_assignment.is_active
from public.profiles profile
join public.user_access_profiles access_profile
  on access_profile.user_id = profile.id
join public.user_role_assignments role_assignment
  on role_assignment.user_id = profile.id
where lower(profile.email) = lower('sergiohudson@gmail.com')
  and role_assignment.role_code in ('user', 'beta_tester', 'system_admin')
order by role_assignment.role_code;
