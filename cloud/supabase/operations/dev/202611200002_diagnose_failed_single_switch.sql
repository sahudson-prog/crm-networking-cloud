-- READ ONLY. Run as one complete query in DEV after the failed migration.
-- No user identifiers, emails, secrets or function bodies are returned.
begin isolation level repeatable read read only;

with expected(signature, before_standard, before_dev, after_standard, after_dev) as (values
  ('public.public_registration_status_v1()', '7b36211225825dab7a5da216cf3d046e', '7b36211225825dab7a5da216cf3d046e', 'ac37f78205acbf7c82cba7fe890a1e82', 'ac37f78205acbf7c82cba7fe890a1e82'),
  ('public.bootstrap_public_registration_v1()', 'b1a42ba06e8bcdd2e428ce81bcb8bd8d', '26cd9264451ccf34d3779815b3db992b', '3def3a58283becce171951e87de60cb9', '3def3a58283becce171951e87de60cb9'),
  ('public.app_access_status_for_user(uuid)', '89ca95c07a760b0cbb77f42bbff3cf1f', '17fd2247f0d585f2e3cfd84700bfe92f', '2497e941b8198f8c0388967d3b550d51', '219b74bb269443949c69751f9e1b0f02')
), variant as (
  select case md5(replace(prosrc,chr(13),''))
    when '989795c48d4d86eea224b26e7752a874' then 'dev_multi_tester'
    when '867ff4ec5f934c919d7787342e74a70f' then 'standard'
    else 'unknown_STOP' end as name
  from pg_proc where oid=to_regprocedure('public.set_r2b_rollout_gate(text,uuid)')
), states as (
  select e.signature, md5(replace(p.prosrc,chr(13),'')) as normalized_hash,
    case when md5(replace(p.prosrc,chr(13),'')) = case when v.name='dev_multi_tester' then e.before_dev else e.before_standard end then 'before'
      when md5(replace(p.prosrc,chr(13),'')) = case when v.name='dev_multi_tester' then e.after_dev else e.after_standard end then 'after'
      else 'unknown_or_missing_STOP' end as state
  from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
    left join variant v on true
), inventory(signature) as (
  select signature from expected union all select unnest(array[
    'public.set_r2b_rollout_gate(text,uuid)',
    'public.hook_enforce_app_access_allowlist(jsonb)',
    'public.bootstrap_current_user_invitation_v1()',
    'public.capture_public_registration_candidate_v1()',
    'public.public_registration_admission_valid_v1(uuid)',
    'public.admin_set_public_registration_v1(boolean,bigint)',
    'public.finalize_google_connected_account_verified(uuid,text,text[])',
    'public.submit_contact_request_v1(text,text,text,text,text,uuid)'])
), anchors as (
  select E'if not found or v_gate.mode = ''paused''\n' ||
    E'    or (v_gate.mode = ''test_only'' and v_gate.test_user_id is distinct from v_user_id\n' ||
    '      and not coalesce(v_user_id = any(v_gate.additional_test_user_ids), false)) then' as dev,
    E'if not found or v_gate.mode = ''paused''\n' ||
    '    or (v_gate.mode = ''test_only'' and v_gate.test_user_id is distinct from v_user_id) then' as standard
), bootstrap as (
  select replace(pg_get_functiondef(p.oid),chr(13),'') as definition,
    length(p.prosrc)-length(replace(p.prosrc,chr(13),'')) as carriage_returns
  from pg_proc p where p.oid=to_regprocedure('public.bootstrap_public_registration_v1()')
)
select jsonb_build_object(
  'known_variant',coalesce((select name from variant),'missing_STOP'),
  'installation_state',case
    when not exists(select 1 from variant where name in ('standard','dev_multi_tester')) then 'unknown_variant_STOP'
    when (select bool_and(state='before') from states) then 'previous_contract_present'
    when (select bool_and(state='after') from states) then 'new_contract_present_DO_NOT_REAPPLY'
    else 'mixed_or_unknown_STOP' end,
  'changed_functions',(select jsonb_agg(to_jsonb(s) order by signature) from states s),
  'bootstrap_anchor_checks',(select jsonb_build_object(
    'stored_carriage_returns',b.carriage_returns,
    'normalized_definition_matches_LF_anchor',strpos(b.definition,case when v.name='dev_multi_tester' then a.dev else a.standard end)>0,
    'normalized_definition_matches_CRLF_anchor',strpos(b.definition,replace(case when v.name='dev_multi_tester' then a.dev else a.standard end,chr(10),chr(13)||chr(10)))>0)
    from bootstrap b cross join anchors a cross join variant v),
  'settings',(select jsonb_build_object('enabled',enabled,'revision',revision) from public.app_public_registration_settings where singleton),
  'gate',(select jsonb_build_object('mode',mode,'primary_tester_present',test_user_id is not null,
    'additional_tester_count',coalesce(jsonb_array_length(to_jsonb(g)->'additional_test_user_ids'),0)) from public.r2b_rollout_gate g where singleton),
  'function_metadata',(select jsonb_agg(jsonb_build_object(
    'signature',i.signature,'present',p.oid is not null,
    'normalized_hash',md5(replace(p.prosrc,chr(13),'')),
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
    'search_path_and_settings',p.proconfig,'volatility',p.provolatile,
    'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'acl',p.proacl::text,
    'execute',(select jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE'))
      from unnest(array['anon','authenticated','service_role','supabase_auth_admin']) r)) order by i.signature)
    from inventory i left join pg_proc p on p.oid=to_regprocedure(i.signature))
) as reg_open_failed_migration_diagnostic;

rollback;
