-- PROD CONTRACT CHANGE: forward-fix after 202610290002, already installed in DEV.
-- The previous runtime remains compatible; invalid new links now fail closed.
begin;

do $preflight$
begin
  if pg_catalog.to_regclass('public.opportunity_interactions') is null
    or pg_catalog.to_regclass('public.opportunity_contacts') is null
    or pg_catalog.to_regclass('public.interaction_participants') is null
    or pg_catalog.to_regprocedure('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)') is null
    or not exists (select 1 from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)')
        and p.prosecdef and p.proconfig in (array['search_path='],array['search_path=""'])
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
        and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'))
    or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('assert_opportunity_participation_v1','check_opportunity_participation_v1'))
    or exists (select 1 from pg_catalog.pg_trigger where tgname in
      ('check_opportunity_interaction_participation_v1','check_opportunity_contact_participation_v1',
       'check_interaction_participant_opportunity_v1') and not tgisinternal) then
    raise exception 'opportunity_participation_contract_incompatible';
  end if;
  if exists (
    select 1 from public.opportunity_interactions link
    where not exists (
      select 1 from public.opportunity_contacts contact
      join public.interaction_participants participant
        on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
      where contact.user_id=link.user_id and contact.opportunity_id=link.opportunity_id
        and participant.interaction_id=link.interaction_id
    )
  ) then
    raise exception 'existing_opportunity_participation_incompatible';
  end if;
end; $preflight$;

create function public.assert_opportunity_participation_v1(p_user_id uuid,p_opportunity_id uuid,p_interaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_participant uuid; v_locked integer;
begin
  select 1 into v_locked from public.opportunities
    where id=p_opportunity_id and user_id=p_user_id for update;
  if v_locked is null then
    raise exception 'opportunity_not_found' using errcode='42501';
  end if;
  select participant.id into v_participant
  from public.opportunity_contacts contact
  join public.interaction_participants participant
    on participant.user_id=contact.user_id and participant.contact_id=contact.contact_id
  where contact.user_id=p_user_id and contact.opportunity_id=p_opportunity_id
    and participant.interaction_id=p_interaction_id
  order by participant.id limit 1 for key share of participant;
  if v_participant is null then
    raise exception 'opportunity_interaction_requires_contact' using errcode='23514';
  end if;
end; $$;

create function public.check_opportunity_participation_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_link record;
begin
  if tg_table_name='opportunity_interactions' then
    if exists (select 1 from public.opportunity_interactions
      where opportunity_id=new.opportunity_id and interaction_id=new.interaction_id) then
      perform public.assert_opportunity_participation_v1(new.user_id,new.opportunity_id,new.interaction_id);
    end if;
  elsif tg_table_name='opportunity_contacts' then
    for v_link in select user_id,opportunity_id,interaction_id from public.opportunity_interactions
      where opportunity_id=old.opportunity_id order by interaction_id loop
      perform public.assert_opportunity_participation_v1(v_link.user_id,v_link.opportunity_id,v_link.interaction_id);
    end loop;
  elsif tg_table_name='interaction_participants' then
    for v_link in select user_id,opportunity_id,interaction_id from public.opportunity_interactions
      where user_id=old.user_id and interaction_id=old.interaction_id order by opportunity_id loop
      perform public.assert_opportunity_participation_v1(v_link.user_id,v_link.opportunity_id,v_link.interaction_id);
    end loop;
  else
    raise exception 'opportunity_participation_trigger_invalid' using errcode='42501';
  end if;
  return null;
end; $$;

create constraint trigger check_opportunity_interaction_participation_v1
  after insert or update on public.opportunity_interactions deferrable initially deferred
  for each row execute function public.check_opportunity_participation_v1();
create constraint trigger check_opportunity_contact_participation_v1
  after delete or update on public.opportunity_contacts deferrable initially deferred
  for each row execute function public.check_opportunity_participation_v1();
create constraint trigger check_interaction_participant_opportunity_v1
  after delete or update on public.interaction_participants deferrable initially deferred
  for each row execute function public.check_opportunity_participation_v1();

alter function public.assert_opportunity_participation_v1(uuid,uuid,uuid) owner to postgres;
alter function public.check_opportunity_participation_v1() owner to postgres;
revoke all on function public.assert_opportunity_participation_v1(uuid,uuid,uuid),
  public.check_opportunity_participation_v1() from public,anon,authenticated,service_role,supabase_auth_admin;
commit;
