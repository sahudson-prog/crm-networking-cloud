begin transaction read only;
with state as (
  select
    pg_catalog.to_regclass('public.opportunity_interactions') is not null as links_present,
    pg_catalog.to_regclass('public.interaction_participants') is not null as participants_present,
    exists (select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)')
        and p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
        and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')) as save_present,
    pg_catalog.to_regprocedure('public.assert_opportunity_participation_v1(uuid,uuid,uuid)') is not null as fix_present
), orphans as (
  select pg_catalog.count(*) as total from public.opportunity_interactions link
  where not exists (select 1 from public.opportunity_contacts contact
    join public.interaction_participants participant
      on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
    where contact.user_id=link.user_id and contact.opportunity_id=link.opportunity_id
      and participant.interaction_id=link.interaction_id)
)
select pg_catalog.jsonb_build_object(
  'installation_state', case when not state.links_present or not state.participants_present
    or not state.save_present or state.fix_present or orphans.total<>0 then 'stop' else 'ready' end,
  'unmatched_interaction_links', orphans.total,
  'stop_reasons', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
    case when not state.links_present or not state.participants_present then 'dependency_missing' end,
    case when not state.save_present then 'save_rpc_missing' end,
    case when state.fix_present then 'forward_fix_already_present' end,
    case when orphans.total<>0 then 'existing_links_without_participating_contact' end
  ],null))
) from state cross join orphans;
rollback;
