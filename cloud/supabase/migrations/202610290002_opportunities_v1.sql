-- PROD CONTRACT CHANGE: additive OBJ-02 Opportunities V1. Install and verify before its runtime.
-- Previous runtime does not read these objects. No backfill or cycle reassignment.
begin;

-- Check the only replaced contract before any DDL. An existing installation or
-- drift requires diagnosis, never a silent overwrite or a partial repair.
do $preconditions$
declare v_wrapper oid := pg_catalog.to_regprocedure('public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text)');
begin
  if exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('opportunities','opportunity_contacts','opportunity_objectives',
      'opportunity_interactions','opportunity_events','opportunity_events_id_seq'))
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('save_opportunity_v1','void_opportunity_v1','validate_opportunity_link_v1')) then
    raise exception 'opportunity_object_already_present'; end if;
  if pg_catalog.to_regclass('public.networking_plan_interest') is null
    or pg_catalog.to_regprocedure('public.assert_networking_context_r2b(uuid,uuid,text)') is null
    or pg_catalog.to_regprocedure('public.reset_current_user_app_data_v0_1(text)') is null then
    raise exception 'opportunity_dependency_missing'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=v_wrapper
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
    and p.prokind='f' and p.provolatile='v' and p.prorettype='jsonb'::regtype
    and p.proconfig in (array['search_path='],array['search_path=""'])
    and pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(p.prosrc,chr(13)||chr(10),chr(10)),chr(13),chr(10)))='cd5399672fddc8c91dc7da18ff75347c'
    and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where (a.grantee<>p.proowner and a.grantee<>'authenticated'::regrole) or (a.grantee<>p.proowner and a.is_grantable))
    and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')) then
    raise exception 'r2b_merge_contract_incompatible'; end if;
end; $preconditions$;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid not null references public.networking_cycles(id) on delete cascade,
  creation_request_id uuid not null,
  title text not null check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 180),
  company text check (company is null or pg_catalog.length(company) <= 120),
  application_url text check (application_url is null or (pg_catalog.length(application_url) <= 1000 and application_url ~ '^https?://[^[:space:]]+$')),
  stage text not null check (stage in ('identified','applied','in_process','offer_received','finished')),
  result text check (result in ('offer_accepted','offer_declined','not_selected','withdrawn','no_progress','other')),
  result_note text check (result_note is null or (result is not distinct from 'other' and pg_catalog.length(result_note)<=500)),
  voided_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint opportunity_result_matches_stage check ((stage = 'finished') = (result is not null)),
  constraint opportunity_cycle_identity unique (id,user_id,cycle_id),
  constraint opportunity_creation_request unique (user_id,creation_request_id)
);
create index opportunities_cycle_stage_idx on public.opportunities(user_id,cycle_id,stage) where voided_at is null;

create table public.opportunity_contacts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  primary key (opportunity_id,contact_id)
);
create index opportunity_contacts_contact_idx on public.opportunity_contacts(user_id,contact_id);
create table public.opportunity_objectives (
  user_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  primary key (opportunity_id,objective_id)
);
create index opportunity_objectives_objective_idx on public.opportunity_objectives(user_id,objective_id);
create table public.opportunity_interactions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  primary key (opportunity_id,interaction_id)
);
create index opportunity_interactions_interaction_idx on public.opportunity_interactions(user_id,interaction_id);
create table public.opportunity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  actor_id uuid not null,
  kind text not null check (kind in ('created','edited','moved','reopened','voided','merge_contacts')),
  before_state jsonb,
  after_state jsonb not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index opportunity_events_history_idx on public.opportunity_events(user_id,opportunity_id,recorded_at,id);
alter table public.opportunities owner to postgres;
alter table public.opportunity_contacts owner to postgres;
alter table public.opportunity_objectives owner to postgres;
alter table public.opportunity_interactions owner to postgres;
alter table public.opportunity_events owner to postgres;

create function public.validate_opportunity_link_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cycle uuid;
begin
  select cycle_id into v_cycle from public.opportunities
    where id=new.opportunity_id and user_id=new.user_id;
  if v_cycle is null then raise exception 'opportunity_link_owner_mismatch' using errcode='42501'; end if;
  if tg_table_name='opportunity_contacts' then
    if not exists(select 1 from public.contacts where id=new.contact_id and user_id=new.user_id) then
      raise exception 'opportunity_link_target_mismatch' using errcode='42501'; end if;
  elsif tg_table_name='opportunity_objectives' then
    if not exists(select 1 from public.objectives where id=new.objective_id and user_id=new.user_id and cycle_id=v_cycle) then
      raise exception 'opportunity_link_target_mismatch' using errcode='42501'; end if;
  elsif tg_table_name='opportunity_interactions' then
    if not exists(select 1 from public.interactions where id=new.interaction_id and user_id=new.user_id) then
      raise exception 'opportunity_link_target_mismatch' using errcode='42501'; end if;
  else
    raise exception 'opportunity_link_table_invalid' using errcode='42501';
  end if;
  return new;
end; $$;
create trigger validate_opportunity_contacts_v1 before insert or update on public.opportunity_contacts
  for each row execute function public.validate_opportunity_link_v1();
create trigger validate_opportunity_objectives_v1 before insert or update on public.opportunity_objectives
  for each row execute function public.validate_opportunity_link_v1();
create trigger validate_opportunity_interactions_v1 before insert or update on public.opportunity_interactions
  for each row execute function public.validate_opportunity_link_v1();
alter function public.validate_opportunity_link_v1() owner to postgres;
revoke all on function public.validate_opportunity_link_v1() from public,anon,authenticated,service_role,supabase_auth_admin;

alter table public.opportunities enable row level security;
alter table public.opportunity_contacts enable row level security;
alter table public.opportunity_objectives enable row level security;
alter table public.opportunity_interactions enable row level security;
alter table public.opportunity_events enable row level security;
revoke all on public.opportunities, public.opportunity_contacts, public.opportunity_objectives,
  public.opportunity_interactions, public.opportunity_events from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on sequence public.opportunity_events_id_seq from public, anon, authenticated, service_role, supabase_auth_admin;
grant select on public.opportunities, public.opportunity_contacts, public.opportunity_objectives,
  public.opportunity_interactions, public.opportunity_events to authenticated;
create policy opportunities_own_read on public.opportunities for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());
create policy opportunity_contacts_own_read on public.opportunity_contacts for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());
create policy opportunity_objectives_own_read on public.opportunity_objectives for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());
create policy opportunity_interactions_own_read on public.opportunity_interactions for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());
create policy opportunity_events_own_read on public.opportunity_events for select to authenticated
  using (user_id = auth.uid() and public.current_user_has_app_access());

create function public.save_opportunity_v1(
  p_expected_cycle_id uuid, p_expected_context text, p_opportunity_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_company text, p_application_url text, p_stage text, p_result text, p_result_note text,
  p_contact_ids uuid[], p_objective_ids uuid[], p_interaction_ids uuid[], p_creation_request_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_row public.opportunities%rowtype; v_before jsonb;
  v_contacts uuid[] := coalesce(p_contact_ids,array[]::uuid[]);
  v_objectives uuid[] := coalesce(p_objective_ids,array[]::uuid[]);
  v_interactions uuid[] := coalesce(p_interaction_ids,array[]::uuid[]);
  v_id uuid; v_kind text; v_requested jsonb;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode='42501'; end if;
  perform public.assert_networking_context_r2b(v_user,p_expected_cycle_id,p_expected_context);
  if not public.current_user_has_app_access() then raise exception 'app_access_denied' using errcode='42501'; end if;
  if p_expected_cycle_id is null or not exists (select 1 from public.networking_cycles c
    where c.id=p_expected_cycle_id and c.user_id=v_user and c.status='active' and c.objective_type='JOB_SEARCH' and c.started_at is not null) then
    raise exception 'active_job_cycle_required' using errcode='42501'; end if;
  if p_title is null or pg_catalog.length(pg_catalog.btrim(p_title)) not between 1 and 180
    or pg_catalog.length(coalesce(p_company,'')) > 120
    or (nullif(pg_catalog.btrim(coalesce(p_application_url,'')),'') is not null
      and (pg_catalog.length(p_application_url)>1000 or p_application_url !~ '^https?://[^[:space:]]+$'))
    or p_stage is null or p_stage not in ('identified','applied','in_process','offer_received','finished')
    or ((p_stage='finished') is distinct from (p_result is not null))
    or (p_result is not null and p_result not in ('offer_accepted','offer_declined','not_selected','withdrawn','no_progress','other'))
    or (p_result is distinct from 'other' and nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') is not null)
    or pg_catalog.length(coalesce(p_result_note,''))>500 then
    raise exception 'invalid_opportunity' using errcode='22023'; end if;
  v_requested := pg_catalog.jsonb_build_object('title',pg_catalog.btrim(p_title),
    'company',nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
    'application_url',nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),
    'stage',p_stage,'result',p_result,'result_note',nullif(pg_catalog.btrim(coalesce(p_result_note,'')),''),
    'contacts',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_contacts) x) s),
    'objectives',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_objectives) x) s),
    'interactions',(select coalesce(jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from unnest(v_interactions) x) s));
  if p_opportunity_id is null then
    if p_creation_request_id is null then raise exception 'opportunity_request_required' using errcode='22023'; end if;
    select * into v_row from public.opportunities where user_id=v_user and creation_request_id=p_creation_request_id;
    if found then
      if v_row.cycle_id is distinct from p_expected_cycle_id or not exists(select 1 from public.opportunity_events
        where opportunity_id=v_row.id and kind='created' and after_state=v_requested) then
        raise exception 'opportunity_request_conflict' using errcode='22023'; end if;
      return v_row.id;
    end if;
  end if;
  if exists(select 1 from pg_catalog.unnest(v_contacts) x where x is null or not exists
    (select 1 from public.contacts c where c.id=x and c.user_id=v_user and (c.is_active or exists
      (select 1 from public.opportunity_contacts l where l.opportunity_id=p_opportunity_id and l.contact_id=c.id and l.user_id=v_user))))
    or exists(select 1 from pg_catalog.unnest(v_objectives) x where x is null or not exists
    (select 1 from public.objectives o where o.id=x and o.user_id=v_user and o.cycle_id=p_expected_cycle_id and (o.is_active or exists
      (select 1 from public.opportunity_objectives l where l.opportunity_id=p_opportunity_id and l.objective_id=o.id and l.user_id=v_user))))
    or exists(select 1 from pg_catalog.unnest(v_interactions) x where x is null or not exists
    (select 1 from public.interactions i where i.id=x and i.user_id=v_user and (not i.is_deleted or exists
      (select 1 from public.opportunity_interactions l where l.opportunity_id=p_opportunity_id and l.interaction_id=i.id and l.user_id=v_user)))) then
    raise exception 'invalid_opportunity_relation' using errcode='42501'; end if;
  if p_opportunity_id is not null then
    select * into v_row from public.opportunities o where o.id=p_opportunity_id and o.user_id=v_user
      and o.cycle_id=p_expected_cycle_id and o.voided_at is null for update;
    if not found then raise exception 'opportunity_not_found' using errcode='42501'; end if;
    if v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'opportunity_stale' using errcode='40001'; end if;
    select pg_catalog.jsonb_build_object('title',v_row.title,'company',v_row.company,'application_url',v_row.application_url,
      'stage',v_row.stage,'result',v_row.result,'result_note',v_row.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_row.id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_row.id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_row.id)) into v_before;
    v_id := v_row.id;
    v_kind := case when v_row.stage='finished' and p_stage<>'finished' then 'reopened'
      when v_row.stage is distinct from p_stage then 'moved' else 'edited' end;
    update public.opportunities set title=pg_catalog.btrim(p_title),company=nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
      application_url=nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),stage=p_stage,result=p_result,
      result_note=case when p_result='other' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end,
      updated_at=greatest(pg_catalog.clock_timestamp(),v_row.updated_at+interval '1 microsecond') where id=v_id;
  else
    insert into public.opportunities(user_id,cycle_id,creation_request_id,title,company,application_url,stage,result,result_note)
      values(v_user,p_expected_cycle_id,p_creation_request_id,pg_catalog.btrim(p_title),nullif(pg_catalog.btrim(coalesce(p_company,'')),''),
        nullif(pg_catalog.btrim(coalesce(p_application_url,'')),''),p_stage,p_result,
        case when p_result='other' then nullif(pg_catalog.btrim(coalesce(p_result_note,'')),'') else null end) returning id into v_id;
    v_kind := 'created';
  end if;
  delete from public.opportunity_contacts where opportunity_id=v_id;
  insert into public.opportunity_contacts(user_id,opportunity_id,contact_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_contacts) x) ids;
  delete from public.opportunity_objectives where opportunity_id=v_id;
  insert into public.opportunity_objectives(user_id,opportunity_id,objective_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_objectives) x) ids;
  delete from public.opportunity_interactions where opportunity_id=v_id;
  insert into public.opportunity_interactions(user_id,opportunity_id,interaction_id)
    select v_user,v_id,x from (select distinct x from pg_catalog.unnest(v_interactions) x) ids;
  insert into public.opportunity_events(user_id,opportunity_id,actor_id,kind,before_state,after_state)
    select v_user,v_id,v_user,v_kind,v_before,pg_catalog.jsonb_build_object('title',o.title,'company',o.company,
      'application_url',o.application_url,'stage',o.stage,'result',o.result,'result_note',o.result_note,
      'contacts',(select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) from public.opportunity_contacts where opportunity_id=v_id),
      'objectives',(select coalesce(pg_catalog.jsonb_agg(objective_id order by objective_id),'[]'::jsonb) from public.opportunity_objectives where opportunity_id=v_id),
      'interactions',(select coalesce(pg_catalog.jsonb_agg(interaction_id order by interaction_id),'[]'::jsonb) from public.opportunity_interactions where opportunity_id=v_id))
    from public.opportunities o where o.id=v_id;
  return v_id;
end; $$;

create function public.void_opportunity_v1(p_expected_cycle_id uuid,p_expected_context text,p_opportunity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_row public.opportunities%rowtype;
begin
  if v_user is null or not public.current_user_has_app_access() then raise exception 'app_access_denied' using errcode='42501'; end if;
  perform public.assert_networking_context_r2b(v_user,p_expected_cycle_id,p_expected_context);
  if not public.current_user_has_app_access() then raise exception 'app_access_denied' using errcode='42501'; end if;
  select * into v_row from public.opportunities where id=p_opportunity_id and user_id=v_user
    and cycle_id=p_expected_cycle_id for update;
  if not found then raise exception 'opportunity_not_found' using errcode='42501'; end if;
  if v_row.voided_at is not null then return; end if;
  update public.opportunities set voided_at=pg_catalog.clock_timestamp(),
    updated_at=greatest(pg_catalog.clock_timestamp(),v_row.updated_at+interval '1 microsecond') where id=v_row.id;
  insert into public.opportunity_events(user_id,opportunity_id,actor_id,kind,before_state,after_state)
    values(v_user,v_row.id,v_user,'voided',pg_catalog.jsonb_build_object('stage',v_row.stage,'result',v_row.result),
      pg_catalog.jsonb_build_object('stage',v_row.stage,'result',v_row.result,'voided',true));
end; $$;

-- The existing R2-B wrapper is the only client merge entry point. Transfer links
-- inside that same transaction before the canonical deep merge deactivates sources.
create or replace function public.merge_contacts_deep_r2b(
  p_expected_cycle_id uuid, p_expected_context text, p_target_contact_id uuid, p_source_contact_ids uuid[],
  p_result jsonb, p_source text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_opp uuid; v_before jsonb; v_after jsonb; v_sources uuid[];
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501'; end if;
  perform public.assert_networking_context_r2b(v_user,p_expected_cycle_id,p_expected_context);
  if not public.current_user_has_app_access() then raise exception 'app_access_denied' using errcode='42501'; end if;
  if not public.current_user_has_capability('contacts.manage') then raise exception 'contacts_manage_denied' using errcode='42501'; end if;
  select coalesce(pg_catalog.array_agg(distinct x),array[]::uuid[]) into v_sources
    from pg_catalog.unnest(coalesce(p_source_contact_ids,array[]::uuid[])) x where x is not null;
  if pg_catalog.cardinality(v_sources) not between 1 and 2 or p_target_contact_id is null
    or p_target_contact_id=any(v_sources) or
    (select pg_catalog.count(*) from public.contacts where user_id=v_user and id=any(v_sources || p_target_contact_id))
      <> pg_catalog.cardinality(v_sources)+1 then
    raise exception 'invalid_contact_merge' using errcode='42501'; end if;
  for v_opp in select distinct oc.opportunity_id from public.opportunity_contacts oc
    where oc.user_id=v_user and oc.contact_id=any(v_sources) order by oc.opportunity_id loop
    -- Invalidate editors opened before the merge, including historical cycles.
    update public.opportunities set updated_at=greatest(pg_catalog.clock_timestamp(),updated_at+interval '1 microsecond')
      where id=v_opp and user_id=v_user;
    select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) into v_before
      from public.opportunity_contacts where opportunity_id=v_opp;
    insert into public.opportunity_contacts(user_id,opportunity_id,contact_id)
      values(v_user,v_opp,p_target_contact_id) on conflict do nothing;
    delete from public.opportunity_contacts where opportunity_id=v_opp and contact_id=any(v_sources);
    select coalesce(pg_catalog.jsonb_agg(contact_id order by contact_id),'[]'::jsonb) into v_after
      from public.opportunity_contacts where opportunity_id=v_opp;
    insert into public.opportunity_events(user_id,opportunity_id,actor_id,kind,before_state,after_state)
      values(v_user,v_opp,v_user,'merge_contacts',pg_catalog.jsonb_build_object('contacts',v_before),
        pg_catalog.jsonb_build_object('contacts',v_after));
  end loop;
  perform pg_catalog.set_config('app.networking_context','merge:' || p_expected_context,true);
  return public.merge_contacts_deep(p_target_contact_id,p_source_contact_ids,p_result,p_source);
end; $$;

alter function public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid) owner to postgres;
alter function public.void_opportunity_v1(uuid,text,uuid) owner to postgres;
alter function public.merge_contacts_deep_r2b(uuid,text,uuid,uuid[],jsonb,text) owner to postgres;
revoke all on function public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)
  from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on function public.void_opportunity_v1(uuid,text,uuid) from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid) to authenticated;
grant execute on function public.void_opportunity_v1(uuid,text,uuid) to authenticated;
commit;
