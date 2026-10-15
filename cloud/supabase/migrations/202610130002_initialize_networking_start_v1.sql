-- Ensure every Coffeecito profile has a persisted networking start date.

begin;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_authorized boolean;
begin
  v_is_authorized := public.is_email_authorized_for_app_access(new.email);

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);

  insert into public.user_settings (user_id, setting_key, setting_value)
  values (
    new.id,
    'Fecha_Inicio_Networking',
    pg_catalog.to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD')
  )
  on conflict (user_id, setting_key) do nothing;

  if v_is_authorized then
    insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
    values (new.id, 'beta_personal', 'active', 'approved')
    on conflict (user_id) do update
    set account_status = 'active',
        beta_access_status = 'approved',
        plan_code = coalesce(public.user_access_profiles.plan_code, excluded.plan_code);

    insert into public.user_role_assignments (user_id, role_code, assignment_reason)
    values (new.id, 'user', 'Asignacion automatica al crear cuenta autorizada')
    on conflict do nothing;
  else
    insert into public.user_access_profiles (user_id, plan_code, account_status, beta_access_status)
    values (new.id, 'beta_personal', 'beta_pending', 'pending')
    on conflict (user_id) do update
    set account_status = case
          when public.user_access_profiles.account_status = 'closed' then 'closed'
          else 'beta_pending'
        end,
        beta_access_status = case
          when public.user_access_profiles.beta_access_status = 'blocked' then 'blocked'
          else 'pending'
        end;
  end if;

  return new;
end;
$$;

alter function public.handle_new_auth_user_profile() owner to postgres;

comment on function public.handle_new_auth_user_profile() is
  'Crea perfil y fecha inicial de networking al alta Auth. Falla cerrado: usuarios no allowlisted quedan pendientes y sin rol base automatico.';

insert into public.user_settings (user_id, setting_key, setting_value)
select
  auth_user.id,
  'Fecha_Inicio_Networking',
  pg_catalog.to_char(auth_user.created_at at time zone 'UTC', 'YYYY-MM-DD')
from auth.users auth_user
join public.profiles profile on profile.id = auth_user.id
on conflict (user_id, setting_key) do update
set setting_value = excluded.setting_value
where public.user_settings.setting_value is null
   or pg_catalog.btrim(public.user_settings.setting_value) = '';

commit;
