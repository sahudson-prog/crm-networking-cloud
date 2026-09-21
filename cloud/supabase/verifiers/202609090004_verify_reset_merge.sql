-- Executable, transactional verification for reset and merge contracts.
-- All synthetic rows and temporary test objects are rolled back on success or failure.

begin;

create or replace function pg_temp.force_bootstrap_merge_rollback()
returns trigger
language plpgsql
as $$
begin
  raise exception 'bootstrap verifier forced rollback';
end;
$$;

do $verify$
declare
  reset_function regprocedure := 'public.reset_current_user_app_data_v0_1(text)'::regprocedure;
  merge_function regprocedure := 'public.merge_contacts_deep(uuid,uuid[],jsonb,text)'::regprocedure;
  function_definition text;
  preserved_table text;
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  user_without_capability uuid := gen_random_uuid();
  reset_user uuid := gen_random_uuid();
  target_contact uuid := gen_random_uuid();
  source_contact_1 uuid := gen_random_uuid();
  source_contact_2 uuid := gen_random_uuid();
  cross_user_contact uuid := gen_random_uuid();
  no_capability_target uuid := gen_random_uuid();
  no_capability_source uuid := gen_random_uuid();
  rollback_target uuid := gen_random_uuid();
  rollback_source uuid := gen_random_uuid();
  reset_contact uuid := gen_random_uuid();
  objective_1 uuid := gen_random_uuid();
  objective_2 uuid := gen_random_uuid();
  rollback_objective uuid := gen_random_uuid();
  connected_account uuid := gen_random_uuid();
  merge_result jsonb;
begin
  if not has_function_privilege('authenticated', reset_function, 'EXECUTE')
    or has_function_privilege('anon', reset_function, 'EXECUTE')
    or has_function_privilege('service_role', reset_function, 'EXECUTE') then
    raise exception 'Reset RPC grants are incorrect';
  end if;
  if not has_function_privilege('authenticated', merge_function, 'EXECUTE')
    or has_function_privilege('anon', merge_function, 'EXECUTE')
    or has_function_privilege('service_role', merge_function, 'EXECUTE') then
    raise exception 'Merge RPC grants are incorrect';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
    where procedure.oid in (reset_function, merge_function)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute reset or merge';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid in (reset_function, merge_function)
      and (
        not procedure.prosecdef
        or pg_get_userbyid(procedure.proowner) <> 'postgres'
        or not exists (
          select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
      )
  ) then
    raise exception 'Reset and merge must be postgres-owned SECURITY DEFINER functions with empty search_path';
  end if;

  if has_table_privilege('authenticated', 'public.interaction_participants', 'UPDATE, DELETE')
    or has_table_privilege('authenticated', 'public.object_review_state', 'DELETE') then
    raise exception 'Merge-only direct table privileges leaked to authenticated';
  end if;

  select pg_get_functiondef(reset_function) into function_definition;
  if position('data.delete_account' in function_definition) = 0
    or position('BORRAR MIS DATOS' in function_definition) = 0
    or position('connected_accounts' in function_definition) = 0
    or position('sync_change_suppressions' in function_definition) = 0
    or position('where user_id = $1' in lower(function_definition)) = 0 then
    raise exception 'Reset RPC is missing an approved guard or deletion target';
  end if;

  foreach preserved_table in array array[
    'profiles', 'app_capabilities', 'app_roles', 'app_role_capabilities',
    'subscription_plans', 'subscription_plan_capabilities',
    'user_access_profiles', 'user_role_assignments', 'user_capability_overrides',
    'organizations', 'organization_memberships', 'user_plan_sponsorships',
    'headhunter_companies', 'headhunter_company_domains', 'app_access_allowlist'
  ] loop
    if position(quote_literal(preserved_table) in function_definition) > 0 then
      raise exception 'Reset RPC unexpectedly includes preserved table %', preserved_table;
    end if;
  end loop;

  select pg_get_functiondef(merge_function) into function_definition;
  if position('contacts.manage' in function_definition) = 0
    or position('ranked_review_states' in function_definition) = 0
    or position('ranked_assignments' in function_definition) = 0 then
    raise exception 'Merge RPC is missing an approved guard or deduplication step';
  end if;

  insert into public.app_access_allowlist(email_normalized)
  values
    ('bootstrap-a-' || user_a::text || '@example.invalid'),
    ('bootstrap-b-' || user_b::text || '@example.invalid'),
    ('bootstrap-no-cap-' || user_without_capability::text || '@example.invalid'),
    ('bootstrap-reset-' || reset_user::text || '@example.invalid');

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (user_a, 'authenticated', 'authenticated', 'bootstrap-a-' || user_a::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (user_b, 'authenticated', 'authenticated', 'bootstrap-b-' || user_b::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (user_without_capability, 'authenticated', 'authenticated',
      'bootstrap-no-cap-' || user_without_capability::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (reset_user, 'authenticated', 'authenticated', 'bootstrap-reset-' || reset_user::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  if (select count(*) from public.user_access_profiles access_profile
      where access_profile.user_id in (user_a, user_b, user_without_capability, reset_user)
        and access_profile.account_status = 'active'
        and access_profile.beta_access_status = 'approved') <> 4 then
    raise exception 'Auth profile trigger did not provision allowed synthetic users';
  end if;

  insert into public.user_capability_overrides (
    user_id, capability_code, override_mode, override_reason
  ) values (
    user_without_capability, 'contacts.manage', 'deny', 'bootstrap verifier'
  );

  insert into public.contacts(id, user_id, display_name)
  values
    (target_contact, user_a, 'Target'),
    (source_contact_1, user_a, 'Source one'),
    (source_contact_2, user_a, 'Source two'),
    (cross_user_contact, user_b, 'Other owner'),
    (no_capability_target, user_without_capability, 'No capability target'),
    (no_capability_source, user_without_capability, 'No capability source'),
    (rollback_target, user_a, 'Rollback target'),
    (rollback_source, user_a, 'Rollback source'),
    (reset_contact, reset_user, 'Reset contact');

  perform set_config('request.jwt.claim.sub', user_without_capability::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_without_capability, 'role', 'authenticated')::text, true);
  begin
    perform public.merge_contacts_deep(
      no_capability_target,
      array[no_capability_source],
      '{"name":"Denied","emails":[],"phones":[]}'::jsonb,
      'bootstrap_verifier'
    );
    raise exception 'Expected merge without contacts.manage to fail';
  exception when others then
    if sqlerrm = 'Expected merge without contacts.manage to fail'
      or position('permiso para fusionar' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  if not exists (select 1 from public.contacts where id = no_capability_source and is_active) then
    raise exception 'Denied merge modified its source contact';
  end if;

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.merge_contacts_deep(
      target_contact,
      array[cross_user_contact],
      '{"name":"Cross user","emails":[],"phones":[]}'::jsonb,
      'bootstrap_verifier'
    );
    raise exception 'Expected cross-user merge to fail';
  exception when others then
    if sqlerrm = 'Expected cross-user merge to fail'
      or position('no pertenecen al usuario' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  if not exists (select 1 from public.contacts where id = cross_user_contact and user_id = user_b and is_active) then
    raise exception 'Cross-user merge modified the other owner contact';
  end if;

  insert into public.object_review_state(user_id, processor_id, processor_type, object_type, object_id)
  values
    (user_a, 'common', 'RULE', 'contact', target_contact),
    (user_a, 'common', 'RULE', 'contact', source_contact_1),
    (user_a, 'common', 'RULE', 'contact', source_contact_2),
    (user_a, 'source-only', 'RULE', 'contact', source_contact_1),
    (user_a, 'source-only', 'RULE', 'contact', source_contact_2);

  insert into public.objectives(id, user_id, objective_name, objective_name_normalized, objective_type)
  values
    (objective_1, user_a, 'Objective one', 'objective one', 'COMPANY'),
    (objective_2, user_a, 'Objective two', 'objective two', 'INDUSTRY'),
    (rollback_objective, user_a, 'Rollback objective', 'rollback objective', 'ROLE');

  insert into public.contact_objective_assignments(user_id, contact_id, objective_id)
  values
    (user_a, target_contact, objective_1),
    (user_a, source_contact_1, objective_1),
    (user_a, source_contact_2, objective_1),
    (user_a, source_contact_1, objective_2),
    (user_a, source_contact_2, objective_2),
    (user_a, rollback_source, rollback_objective);

  merge_result := public.merge_contacts_deep(
    target_contact,
    array[source_contact_1, source_contact_2],
    '{"name":"Merged contact","company":"","role":"","networkingStatus":"Pendiente","focus":true,"headhunter":false,"emails":[],"phones":[]}'::jsonb,
    'bootstrap_verifier'
  );

  if merge_result->>'targetContactId' <> target_contact::text
    or jsonb_array_length(merge_result->'sourceContactIds') <> 2 then
    raise exception 'Merge public return contract changed';
  end if;
  if (select count(*) from public.object_review_state
      where user_id = user_a and object_type = 'contact' and object_id = target_contact) <> 2
    or exists (
      select 1 from public.object_review_state
      where user_id = user_a and object_type = 'contact'
        and object_id in (source_contact_1, source_contact_2)
    ) then
    raise exception 'Merge did not deduplicate object_review_state across target and all sources';
  end if;
  if (select count(*) from public.contact_objective_assignments
      where user_id = user_a and contact_id = target_contact) <> 2
    or exists (
      select 1 from public.contact_objective_assignments
      where user_id = user_a and contact_id in (source_contact_1, source_contact_2)
    ) then
    raise exception 'Merge did not deduplicate objective assignments across target and all sources';
  end if;
  if exists (
    select 1 from public.contacts
    where user_id = user_a and id in (source_contact_1, source_contact_2) and is_active
  ) then
    raise exception 'Valid merge did not deactivate every owned source';
  end if;

  execute 'create trigger bootstrap_force_merge_rollback before insert on public.audit_log '
    || 'for each row execute function pg_temp.force_bootstrap_merge_rollback()';
  begin
    perform public.merge_contacts_deep(
      rollback_target,
      array[rollback_source],
      '{"name":"Should roll back","emails":[],"phones":[]}'::jsonb,
      'bootstrap_verifier'
    );
    raise exception 'Expected forced late merge failure';
  exception when others then
    if sqlerrm = 'Expected forced late merge failure'
      or position('bootstrap verifier forced rollback' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  execute 'drop trigger bootstrap_force_merge_rollback on public.audit_log';

  if not exists (
    select 1 from public.contacts
    where id = rollback_target and display_name = 'Rollback target' and is_active
  ) or not exists (
    select 1 from public.contacts where id = rollback_source and is_active
  ) or not exists (
    select 1 from public.contact_objective_assignments
    where contact_id = rollback_source and objective_id = rollback_objective
  ) then
    raise exception 'Late merge failure did not roll back atomically';
  end if;

  insert into public.connected_accounts(id, user_id, provider, account_email)
  values (connected_account, reset_user, 'google', 'bootstrap-reset-' || reset_user::text || '@example.invalid');
  insert into public.sync_change_suppressions(
    user_id, provider, resource_type, object_type, object_id, change_type
  ) values (
    reset_user, 'google', 'contacts', 'contact', reset_contact::text, 'update'
  );
  insert into public.user_settings(user_id, setting_key, setting_value)
  values (reset_user, 'bootstrap-verifier', 'true');

  perform set_config('request.jwt.claim.sub', reset_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', reset_user, 'role', 'authenticated')::text, true);
  perform * from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');

  if exists (select 1 from public.connected_accounts where user_id = reset_user)
    or exists (select 1 from public.sync_change_suppressions where user_id = reset_user)
    or exists (select 1 from public.contacts where user_id = reset_user)
    or exists (select 1 from public.user_settings where user_id = reset_user) then
    raise exception 'Reset did not delete every approved user-owned test row';
  end if;
  if not exists (select 1 from auth.users where id = reset_user)
    or not exists (select 1 from public.profiles where id = reset_user)
    or not exists (select 1 from public.user_access_profiles where user_id = reset_user)
    or not exists (select 1 from public.user_role_assignments where user_id = reset_user)
    or not exists (
      select 1 from public.app_access_allowlist
      where email_normalized = 'bootstrap-reset-' || reset_user::text || '@example.invalid'
    ) then
    raise exception 'Reset deleted identity or access data that must be preserved';
  end if;
end;
$verify$;

rollback;
