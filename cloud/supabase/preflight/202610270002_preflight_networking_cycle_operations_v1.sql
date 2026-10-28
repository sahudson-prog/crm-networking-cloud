-- OBJ-02 R2-B read-only gate. Run after R2-A and before migration 202610270002.
begin transaction read only;

with checks as (
  select
    to_regclass('public.networking_cycles') is not null
      and to_regclass('public.contact_networking_transitions') is not null
      and to_regprocedure('public.networking_cycle_for_event_v1(uuid,timestamptz)') is not null
      and to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is not null
      and to_regclass('public.uq_objectives_user_type_normalized_active') is not null
      as r2a_present,
    exists (select 1 from pg_catalog.pg_proc p
      where p.oid = to_regprocedure('public.app_access_status_for_user(uuid)')
        and p.prosecdef and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        and p.proconfig[1] in ('search_path=', 'search_path=""')
        and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(p.prosrc,
          pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)),
          pg_catalog.chr(13), pg_catalog.chr(10))) = '479b759f59c416d23e2b955cde3471b0')
      as access_contract_matches,
    to_regclass('public.networking_cycle_closed_contacts') is not null
      or to_regclass('public.networking_cycle_closed_assignments') is not null
      or to_regclass('public.r2b_rollout_gate') is not null
      or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'start_networking_cycle_r2b')
      or exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'networking_cycles' and column_name = 'started_at')
      as r2b_preexisting,
    exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'objectives' and column_name = 'cycle_id')
      as objective_cycle_present,
    (select count(*) from public.networking_cycles where status = 'closed') as closed_cycles,
    (select count(*) from public.networking_cycles where status = 'active') as active_cycles,
    (select count(*) from public.networking_cycles where origin = 'legacy' and started_on is null) as unknown_legacy_starts,
    (select count(*) from public.objectives where cycle_id is null) as unassigned_objectives,
    (select count(*) from public.objectives where cycle_id is not null and not exists
      (select 1 from public.networking_cycles cycle where cycle.id = objectives.cycle_id
        and cycle.user_id = objectives.user_id)) as mismatched_objectives
)
select jsonb_build_object(
  'installation_state', case when r2a_present and access_contract_matches and objective_cycle_present
    and not r2b_preexisting and closed_cycles = 0 and unassigned_objectives = 0
    and mismatched_objectives = 0 then 'clean_install' else 'incompatible' end,
  'r2a_present', r2a_present,
  'access_contract_matches', access_contract_matches,
  'r2b_preexisting', r2b_preexisting,
  'active_cycles', active_cycles,
  'closed_cycles', closed_cycles,
  'unknown_legacy_starts', unknown_legacy_starts,
  'unassigned_objectives', unassigned_objectives,
  'mismatched_objectives', mismatched_objectives
) as networking_cycle_operations_v1_preflight from checks;

rollback;
