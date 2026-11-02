begin transaction read only;
do $verify$
declare v_oid oid; v_name text;
begin
  foreach v_name in array array[
    'public.assert_opportunity_participation_v1(uuid,uuid,uuid)',
    'public.check_opportunity_participation_v1()'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_name);
    if v_oid is null or not exists (select 1 from pg_catalog.pg_proc p where p.oid=v_oid
      and p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres')
      or pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
      or pg_catalog.has_function_privilege('supabase_auth_admin',v_oid,'EXECUTE') then
      raise exception 'opportunity_participation_function_invalid: %',v_name;
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger
    where tgname in ('check_opportunity_interaction_participation_v1',
      'check_opportunity_contact_participation_v1','check_interaction_participant_opportunity_v1')
      and not tgisinternal and tgenabled='O' and tgdeferrable and tginitdeferred) <> 3 then
    raise exception 'opportunity_participation_triggers_invalid';
  end if;
  if exists (select 1 from public.opportunity_interactions link where not exists (
    select 1 from public.opportunity_contacts contact
    join public.interaction_participants participant
      on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
    where contact.user_id=link.user_id and contact.opportunity_id=link.opportunity_id
      and participant.interaction_id=link.interaction_id)) then
    raise exception 'opportunity_participation_data_invalid';
  end if;
end; $verify$;
select 'PASS' as opportunity_participation_verifier;
rollback;
