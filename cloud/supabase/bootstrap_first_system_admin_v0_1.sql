-- Bootstrap manual del primer administrador sistema.
-- Ejecutar solo despues de `add_account_access_model_v0_1.sql`.
-- Reemplazar el correo por el usuario que debe administrar la beta.

do $$
declare
  target_admin_email text := 'REEMPLAZAR_EMAIL_ADMIN';
  target_admin_user_id uuid;
  role_to_restore text;
  updated_role_rows integer;
begin
  if target_admin_email = 'REEMPLAZAR_EMAIL_ADMIN' then
    raise exception 'Reemplaza target_admin_email antes de ejecutar este bootstrap.';
  end if;

  select id
  into target_admin_user_id
  from public.profiles
  where lower(email) = lower(target_admin_email)
  limit 1;

  if target_admin_user_id is null then
    raise exception 'No existe profile para el email indicado: %', target_admin_email;
  end if;

  insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
  values (target_admin_user_id, 'beta_personal', 'active', 'approved')
  on conflict (user_id) do update
  set account_status = 'active',
      beta_access_status = 'approved',
      updated_at = now();

  foreach role_to_restore in array array['user', 'beta_tester', 'system_admin']
  loop
    update public.user_role_assignments role_assignment
    set is_active = true,
        starts_at = coalesce(role_assignment.starts_at, now()),
        expires_at = null,
        assignment_reason = 'Bootstrap manual del primer administrador sistema',
        updated_at = now()
    where role_assignment.user_id = target_admin_user_id
      and role_assignment.role_code = role_to_restore;

    get diagnostics updated_role_rows = row_count;

    if updated_role_rows = 0 then
      insert into public.user_role_assignments (user_id, role_code, assignment_reason, is_active)
      values (target_admin_user_id, role_to_restore, 'Bootstrap manual del primer administrador sistema', true);
    end if;
  end loop;
end $$;

select
  'bootstrap_system_admin' as verification_name,
  profile.email as admin_email,
  role_assignment.role_code as assigned_role,
  role_assignment.is_active as assigned_role_active
from public.profiles profile
join public.user_role_assignments role_assignment
  on role_assignment.user_id = profile.id
where role_assignment.assignment_reason = 'Bootstrap manual del primer administrador sistema'
order by role_assignment.role_code;
