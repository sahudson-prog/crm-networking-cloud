-- Read-only, no user data returned. A non-clean result requires diagnosis.
with checks(reason, blocked) as (values
  ('cycle_start_nonfinite_existing', exists(select 1 from public.networking_cycles
    where (started_at is not null and not isfinite(started_at))
       or (started_on is not null and not isfinite(started_on)))),
  ('history_policy_objects_present', to_regclass('public.networking_history_policy') is not null
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('networking_history_floor_v1','current_user_networking_history_policy_v1',
        'admin_set_networking_history_policy_v1','current_user_history_window_v1','enforce_cycle_start_policy_v1'))),
  ('cycle_contract_missing', to_regprocedure('public.start_networking_cycle_r2b(uuid,text,timestamp with time zone,text,uuid,text,boolean,boolean)') is null
    or to_regprocedure('public.configure_legacy_networking_cycle_r2b(uuid,uuid,text,text,timestamp with time zone,text)') is null
    or to_regprocedure('public.current_networking_context_r2b(uuid)') is null),
  ('access_contract_missing', to_regprocedure('public.current_user_has_app_access()') is null
    or to_regprocedure('public.current_user_has_capability(text)') is null),
  ('cycle_trigger_missing', not exists (select 1 from pg_trigger t where t.tgrelid=to_regclass('public.networking_cycles')
    and t.tgname='validate_networking_cycle_v1' and not t.tgisinternal and t.tgenabled='O')),
  ('cycle_trigger_conflict', exists (select 1 from pg_trigger t where t.tgrelid=to_regclass('public.networking_cycles')
    and t.tgname='enforce_cycle_start_policy_v1'))
)
select jsonb_build_object('installation_state',case when bool_or(blocked) then 'stop' else 'clean_install' end,
  'stop_reasons',coalesce(jsonb_agg(reason) filter (where blocked),'[]'::jsonb),
  'runtime_cutover_ready',false,
  'note','Policy foundation only: install and verify 202611040002 before the new runtime. Do not resume imports between phases.')
from checks;
