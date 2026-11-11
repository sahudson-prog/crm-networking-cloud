begin read only;
do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('apply_calendar_discovery_v1','prepare_calendar_reconciliation_v1','reconcile_calendar_event_v1','finish_calendar_reconciliation_v1'))
    or to_regclass('public.calendar_participant_provenance_v1') is not null then raise exception 'STOP: reconciliation objects already present'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)')
    and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""']
    and md5(replace(prosrc,E'\r',''))='b50f8d410fa7138ab3252f126984d9f8') then raise exception 'STOP: Calendar 001 writer drift'; end if;
  if to_regprocedure('public.apply_google_periodic_v1(uuid,jsonb)') is null
    or to_regprocedure('public.opportunity_interaction_active_v1(jsonb)') is null
    or to_regclass('public.opportunity_interactions') is null
    or exists(select 1 from pg_class where oid in ('public.external_interaction_sources'::regclass,'public.interactions'::regclass,
      'public.interaction_participants'::regclass) and (not relrowsecurity or relowner<>'postgres'::regrole)) then
    raise exception 'STOP: lifecycle/RLS/ownership dependency incompatible'; end if;
  if exists(select 1 from public.external_interaction_sources where metadata ? 'calendar_reconciliation_v1') then
    raise exception 'STOP: metadata key already in use'; end if;
  if exists(select 1 from public.external_interaction_sources s join public.external_interaction_sources other
    on other.interaction_id=s.interaction_id and other.id<>s.id and other.is_active
    where s.provider='google' and s.source_service='calendar' and s.is_active) then
    raise exception 'STOP: Calendar interaction shared by sources; owner review required'; end if;
end $$;
select 'PASS: reconciliation clean installation; no data changed' as result;
commit;
