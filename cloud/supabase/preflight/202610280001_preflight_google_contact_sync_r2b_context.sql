-- Read-only admission for the forward-fix after R2-B is already installed.
begin transaction read only;

with contract as (
  select
    to_regclass('public.r2b_rollout_gate') is not null as gate_exists,
    to_regprocedure('public.assert_networking_context_r2b(uuid,uuid,text)') is not null as assertion_exists,
    to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)') is not null as legacy_exists,
    to_regprocedure('public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)') is not null as forward_exists
), details as (
  select contract.*,
    (select mode from public.r2b_rollout_gate where singleton) as gate_mode,
    (select test_user_id from public.r2b_rollout_gate where singleton) as test_user_id,
    coalesce(pg_catalog.has_function_privilege('authenticated',
      to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)'), 'EXECUTE'), false) as legacy_authenticated,
    not coalesce(pg_catalog.has_function_privilege('anon',
      to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)'), 'EXECUTE'), true)
      and not coalesce(pg_catalog.has_function_privilege('service_role',
        to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)'), 'EXECUTE'), true)
      and not coalesce(pg_catalog.has_function_privilege('supabase_auth_admin',
        to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)'), 'EXECUTE'), true)
      as legacy_other_roles_denied,
    (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)')) as legacy_body_md5,
    exists (select 1 from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.apply_google_contact_sync_change_v1(uuid,jsonb)')
        and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        and p.proconfig[1] in ('search_path=', 'search_path=""')
        and pg_catalog.strpos(p.prosrc, 'current_user_can_sync_connected_account_v1') > 0
        and pg_catalog.strpos(p.prosrc, 'merge_contacts_deep') > 0) as legacy_shape_valid
  from contract
)
select pg_catalog.jsonb_build_object(
  'installation_state', case when gate_exists and assertion_exists and legacy_exists
    and not forward_exists and gate_mode = 'paused' and test_user_id is null
    and legacy_other_roles_denied and legacy_shape_valid then 'ready' else 'stop' end,
  'gate_mode', gate_mode,
  'test_user_id_present', test_user_id is not null,
  'assertion_exists', assertion_exists,
  'legacy_exists', legacy_exists,
  'legacy_authenticated', legacy_authenticated,
  'legacy_other_roles_denied', legacy_other_roles_denied,
  'legacy_body_md5', legacy_body_md5,
  'legacy_shape_valid', legacy_shape_valid,
  'forward_exists', forward_exists
) as google_contact_sync_r2b_context_preflight
from details;

rollback;
