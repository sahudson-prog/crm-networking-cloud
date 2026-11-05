-- Read-only. Run after the policy foundation, before the import cutover.
with checks(reason,blocked) as (values
  ('history_cutover_requires_paused_gate', (select count(*) from public.r2b_rollout_gate) <> 1
    or not exists(select 1 from public.r2b_rollout_gate
      where singleton and mode='paused' and test_user_id is null)),
  ('history_policy_missing',to_regprocedure('public.current_user_history_window_v1()') is null),
  ('history_import_objects_present',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('assert_history_context_v1','apply_ics_import_v2','apply_google_history_v1','apply_google_periodic_v1'))),
  ('ics_contract_drift',coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.apply_ics_import_v1(jsonb)')),'')<>'387dbd63a867f15a3844e222c052bb17'),
  ('google_writer_drift',coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)')),'')<>'bcc3ca6580e45ee31a307269bb1764dd'),
  ('history_writer_acl_drift',exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in (to_regprocedure('public.apply_ics_import_v1(jsonb)'),to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)'))
      and acl.grantee not in ('postgres'::regrole,'authenticated'::regrole))),
  ('history_writer_security_drift',exists(select 1 from pg_proc where oid in
    (to_regprocedure('public.apply_ics_import_v1(jsonb)'),to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)'))
    and (not prosecdef or proowner<>'postgres'::regrole or not coalesce(proconfig @> array['search_path=""'],false))))
)
select jsonb_build_object('installation_state',case when bool_or(blocked) then 'stop' else 'ready' end,
 'stop_reasons',coalesce(jsonb_agg(reason) filter(where blocked),'[]'::jsonb),
 'runtime_previous_google_and_ics_writes_compatible',false) from checks;
