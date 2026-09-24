-- Transactional verification for the sync_run_logs authorization contract.
-- Synthetic users and rows are rolled back on success or failure.

begin;

do $verify_structure$
declare
  policy_count integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'sync_run_logs'
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.sync_run_logs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'sync_run_logs'
      and policy.policyname = 'Sync run logs are owned by user'
  ) then
    raise exception 'Legacy sync_run_logs ownership policy still exists';
  end if;

  select count(*)
  into policy_count
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'sync_run_logs';

  if policy_count <> 2 then
    raise exception 'public.sync_run_logs must have exactly two RLS policies, found %', policy_count;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'sync_run_logs'
      and policy.policyname = 'Sync run logs are readable by diagnostics admins'
      and policy.cmd = 'SELECT'
      and cardinality(policy.roles) = 1
      and policy.roles[1] = 'authenticated'
      and coalesce(policy.qual, '') like '%current_user_has_capability%'
      and coalesce(policy.qual, '') like '%admin.view_diagnostics%'
      and policy.with_check is null
  ) then
    raise exception 'sync_run_logs SELECT policy does not enforce admin.view_diagnostics';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'sync_run_logs'
      and policy.policyname = 'Sync run logs are insertable by owner'
      and policy.cmd = 'INSERT'
      and cardinality(policy.roles) = 1
      and policy.roles[1] = 'authenticated'
      and policy.qual is null
      and coalesce(policy.with_check, '') like '%auth.uid()%'
      and coalesce(policy.with_check, '') like '%user_id%'
      and coalesce(policy.with_check, '') like '%current_user_has_app_access()%'
  ) then
    raise exception 'sync_run_logs INSERT policy does not enforce ownership and effective app access';
  end if;

  if not has_table_privilege('authenticated', 'public.sync_run_logs', 'SELECT')
    or not has_table_privilege('authenticated', 'public.sync_run_logs', 'INSERT')
    or has_table_privilege('authenticated', 'public.sync_run_logs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.sync_run_logs', 'DELETE') then
    raise exception 'authenticated sync_run_logs grants are not SELECT + INSERT only';
  end if;

  if has_table_privilege('anon', 'public.sync_run_logs', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'anon has direct sync_run_logs privileges';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
    where relation.oid = 'public.sync_run_logs'::regclass
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'PUBLIC has direct sync_run_logs privileges';
  end if;
end;
$verify_structure$;

select set_config('coffeecito.verify_base_user', gen_random_uuid()::text, true);
select set_config('coffeecito.verify_other_user', gen_random_uuid()::text, true);
select set_config('coffeecito.verify_diagnostics_user', gen_random_uuid()::text, true);
select set_config('coffeecito.verify_reset_user', gen_random_uuid()::text, true);

insert into public.app_access_allowlist(email_normalized)
values
  ('sync-log-base-' || current_setting('coffeecito.verify_base_user') || '@example.invalid'),
  ('sync-log-other-' || current_setting('coffeecito.verify_other_user') || '@example.invalid'),
  ('sync-log-diagnostics-' || current_setting('coffeecito.verify_diagnostics_user') || '@example.invalid'),
  ('sync-log-reset-' || current_setting('coffeecito.verify_reset_user') || '@example.invalid');

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    current_setting('coffeecito.verify_base_user')::uuid,
    'authenticated', 'authenticated',
    'sync-log-base-' || current_setting('coffeecito.verify_base_user') || '@example.invalid',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    current_setting('coffeecito.verify_other_user')::uuid,
    'authenticated', 'authenticated',
    'sync-log-other-' || current_setting('coffeecito.verify_other_user') || '@example.invalid',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    current_setting('coffeecito.verify_diagnostics_user')::uuid,
    'authenticated', 'authenticated',
    'sync-log-diagnostics-' || current_setting('coffeecito.verify_diagnostics_user') || '@example.invalid',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    current_setting('coffeecito.verify_reset_user')::uuid,
    'authenticated', 'authenticated',
    'sync-log-reset-' || current_setting('coffeecito.verify_reset_user') || '@example.invalid',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.user_role_assignments(user_id, role_code, assignment_reason)
values (
  current_setting('coffeecito.verify_diagnostics_user')::uuid,
  'support_admin',
  'sync_run_logs verifier'
);

insert into public.sync_run_logs(
  user_id, provider, resource_type, operation, step_order, step, status
)
values (
  current_setting('coffeecito.verify_other_user')::uuid,
  'verifier', 'contacts', 'read', 1, 'Other user fixture', 'success'
);

select set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_base_user'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('coffeecito.verify_base_user'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

insert into public.sync_run_logs(
  user_id, provider, resource_type, operation, step_order, step, status
)
values (
  current_setting('coffeecito.verify_base_user')::uuid,
  'verifier', 'contacts', 'write', 1, 'Owned insert fixture', 'success'
);

do $verify_base_user$
begin
  if (select count(*) from public.sync_run_logs) <> 0 then
    raise exception 'Base user can read sync_run_logs';
  end if;

  begin
    insert into public.sync_run_logs(
      user_id, provider, resource_type, operation, step_order, step, status
    ) values (
      current_setting('coffeecito.verify_other_user')::uuid,
      'verifier', 'contacts', 'cross_user_write', 2, 'Forbidden insert fixture', 'error'
    );
    raise exception 'Expected cross-user sync_run_logs insert to fail';
  exception when others then
    if sqlerrm = 'Expected cross-user sync_run_logs insert to fail'
      or sqlstate <> '42501' then
      raise;
    end if;
  end;
end;
$verify_base_user$;

reset role;

do $verify_owned_insert$
begin
  if not exists (
    select 1
    from public.sync_run_logs
    where user_id = current_setting('coffeecito.verify_base_user')::uuid
      and step = 'Owned insert fixture'
  ) then
    raise exception 'Base user could not insert an owned sync_run_logs row';
  end if;
end;
$verify_owned_insert$;

select set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_diagnostics_user'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('coffeecito.verify_diagnostics_user'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $verify_diagnostics_user$
begin
  if (
    select count(distinct user_id)
    from public.sync_run_logs
    where user_id in (
      current_setting('coffeecito.verify_base_user')::uuid,
      current_setting('coffeecito.verify_other_user')::uuid
    )
  ) <> 2 then
    raise exception 'admin.view_diagnostics cannot read sync_run_logs across users';
  end if;
end;
$verify_diagnostics_user$;

reset role;

insert into public.user_capability_overrides(
  user_id, capability_code, override_mode, override_reason
)
values (
  current_setting('coffeecito.verify_diagnostics_user')::uuid,
  'admin.view_diagnostics',
  'deny',
  'sync_run_logs verifier'
);

set local role authenticated;

do $verify_deny$
begin
  if (select count(*) from public.sync_run_logs) <> 0 then
    raise exception 'Effective deny did not block sync_run_logs reads';
  end if;
end;
$verify_deny$;

reset role;

insert into public.sync_run_logs(
  user_id, provider, resource_type, operation, step_order, step, status
)
values (
  current_setting('coffeecito.verify_reset_user')::uuid,
  'verifier', 'contacts', 'reset', 1, 'Reset fixture', 'success'
);

select set_config('request.jwt.claim.sub', current_setting('coffeecito.verify_reset_user'), true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('coffeecito.verify_reset_user'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $verify_reset$
begin
  perform * from public.reset_current_user_app_data_v0_1('BORRAR MIS DATOS');
end;
$verify_reset$;

reset role;

do $verify_reset_result$
begin
  if exists (
    select 1
    from public.sync_run_logs
    where user_id = current_setting('coffeecito.verify_reset_user')::uuid
  ) then
    raise exception 'Reset did not delete owned sync_run_logs';
  end if;
end;
$verify_reset_result$;

rollback;
