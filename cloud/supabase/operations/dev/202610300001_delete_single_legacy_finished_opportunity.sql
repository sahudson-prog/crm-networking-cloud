-- DEV ONLY. Before running the entire file in Supabase SQL Editor, verify that
-- the selected project is wwlbxrdnrojqkhdxkzdx. PostgreSQL's database name
-- does not identify a Supabase project. Never run this file in PROD.
-- Deletes one approved test opportunity and its four dependent row sets.
-- Any error aborts the transaction; do not execute fragments or retry blindly.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $cleanup$
declare
  v_table text;
  v_key text;
  v_count bigint;
  v_hash text;
  v_before jsonb := '{}'::jsonb;
  v_globals_before jsonb;
  v_total bigint;
  v_target_count bigint;
  v_other_count bigint;
  v_target uuid;
  v_deleted bigint;
  v_orphan boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'STOP: expected SQL Editor postgres role';
  end if;
  if exists (
    select 1 from (values ('opportunities'),('opportunity_contacts'),
      ('opportunity_objectives'),('opportunity_interactions'),('opportunity_events')) t(name)
    where pg_catalog.to_regclass('public.' || t.name) is null
  ) or pg_catalog.to_regclass('public.contacts') is null
    or pg_catalog.to_regclass('public.objectives') is null
    or pg_catalog.to_regclass('public.interactions') is null then
    raise exception 'STOP: expected opportunity or referenced table missing';
  end if;
  if pg_catalog.to_regprocedure('public.save_opportunity_v1(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],uuid)') is null
    or pg_catalog.to_regprocedure('public.assert_opportunity_participation_v1(uuid,uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.read_opportunity_interactions_v1(uuid[])') is null
    or pg_catalog.to_regprocedure('public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid)') is not null
    or exists (select 1 from pg_catalog.pg_attribute
      where attrelid='public.opportunities'::regclass and attname='situation' and not attisdropped) then
    raise exception 'STOP: expected pre-closure 002/003/004 contract missing or closure already installed';
  end if;

  -- This short exclusive lock makes both the population check and deletion
  -- stable against writers, including RPCs and cascading child writes.
  lock table public.opportunities, public.opportunity_contacts,
    public.opportunity_objectives, public.opportunity_interactions,
    public.opportunity_events in access exclusive mode;

  if exists (
    select 1 from (values ('opportunities'),('opportunity_contacts'),
      ('opportunity_objectives'),('opportunity_interactions'),('opportunity_events')) t(name)
    join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass('public.' || t.name)
    where c.relkind <> 'r' or not c.relrowsecurity
      or pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres'
  ) then raise exception 'STOP: table owner, kind or RLS drift'; end if;

  -- Exactly four validated cascading FKs may point at opportunities, each
  -- from the expected child opportunity_id to opportunities.id. No child may
  -- have an additional inbound FK that would extend the cascade.
  if (select count(*) from pg_catalog.pg_constraint
      where contype='f' and confrelid='public.opportunities'::regclass) <> 4
    or exists (
      select 1 from pg_catalog.pg_constraint c
      where c.contype='f' and c.confrelid='public.opportunities'::regclass
        and (c.conrelid not in ('public.opportunity_contacts'::regclass,
          'public.opportunity_objectives'::regclass,'public.opportunity_interactions'::regclass,
          'public.opportunity_events'::regclass)
          or c.confdeltype <> 'c' or not c.convalidated
          or c.conkey <> array[(select a.attnum from pg_catalog.pg_attribute a
            where a.attrelid=c.conrelid and a.attname='opportunity_id')]::smallint[]
          or c.confkey <> array[(select a.attnum from pg_catalog.pg_attribute a
            where a.attrelid=c.confrelid and a.attname='id')]::smallint[])
    ) or exists (
      select 1 from (values ('opportunity_contacts'),('opportunity_objectives'),
        ('opportunity_interactions'),('opportunity_events')) t(name)
      where (select count(*) from pg_catalog.pg_constraint c
        where c.contype='f' and c.conrelid=pg_catalog.to_regclass('public.' || t.name)
          and c.confrelid='public.opportunities'::regclass) <> 1
    ) or exists (
      select 1 from pg_catalog.pg_constraint c
      where c.contype='f' and c.confrelid in ('public.opportunity_contacts'::regclass,
        'public.opportunity_objectives'::regclass,'public.opportunity_interactions'::regclass,
        'public.opportunity_events'::regclass)
    ) then raise exception 'STOP: cascade dependency drift'; end if;

  if (select count(*) from pg_catalog.pg_trigger g
      where not g.tgisinternal and g.tgrelid in ('public.opportunities'::regclass,
        'public.opportunity_contacts'::regclass,'public.opportunity_objectives'::regclass,
        'public.opportunity_interactions'::regclass,'public.opportunity_events'::regclass)) <> 5
    or exists (
      select 1 from (values
        ('opportunity_contacts','validate_opportunity_contacts_v1','public.validate_opportunity_link_v1()'),
        ('opportunity_objectives','validate_opportunity_objectives_v1','public.validate_opportunity_link_v1()'),
        ('opportunity_interactions','validate_opportunity_interactions_v1','public.validate_opportunity_link_v1()'),
        ('opportunity_contacts','check_opportunity_contact_participation_v1','public.check_opportunity_participation_v1()'),
        ('opportunity_interactions','check_opportunity_interaction_participation_v1','public.check_opportunity_participation_v1()')) t(tab,trigger_name,function_name)
      where not exists (select 1 from pg_catalog.pg_trigger g
        where g.tgrelid=pg_catalog.to_regclass('public.' || t.tab)
          and g.tgname=t.trigger_name and not g.tgisinternal and g.tgenabled='O'
          and g.tgfoid=pg_catalog.to_regprocedure(t.function_name))
    ) then raise exception 'STOP: opportunity trigger drift'; end if;

  select count(*), count(*) filter (where stage='finished' and result='not_selected'),
    count(*) filter (where stage='applied' and result is null)
    into v_total,v_target_count,v_other_count from public.opportunities;
  if v_total <> 5 or v_target_count <> 1 or v_other_count <> 4 then
    raise exception 'STOP: expected exactly five rows: one finished/not_selected and four applied/null';
  end if;
  select id into strict v_target from public.opportunities
    where stage='finished' and result='not_selected';

  -- Fingerprints stay transaction-local. No user, contact or opportunity ID
  -- is printed by this script.
  for v_table,v_key in select * from (values
    ('opportunities','id'),('opportunity_contacts','opportunity_id'),
    ('opportunity_objectives','opportunity_id'),
    ('opportunity_interactions','opportunity_id'),
    ('opportunity_events','opportunity_id')) t(tab,key_name) loop
    execute pg_catalog.format(
      'select count(*), pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t where t.%I <> $1',
      v_table,v_key) into v_count,v_hash using v_target;
    v_before := v_before || pg_catalog.jsonb_build_object(v_table,
      pg_catalog.jsonb_build_object('count',v_count,'hash',v_hash));
  end loop;
  select pg_catalog.jsonb_build_array(
    (select count(*) from public.contacts),
    (select count(*) from public.objectives),
    (select count(*) from public.interactions)) into v_globals_before;

  delete from public.opportunities where id=v_target;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 or (select count(*) from public.opportunities) <> 4
    or exists (select 1 from public.opportunities where stage='finished') then
    raise exception 'STOP: unexpected opportunity deletion result';
  end if;

  for v_table,v_key in select * from (values
    ('opportunities','id'),('opportunity_contacts','opportunity_id'),
    ('opportunity_objectives','opportunity_id'),
    ('opportunity_interactions','opportunity_id'),
    ('opportunity_events','opportunity_id')) t(tab,key_name) loop
    execute pg_catalog.format(
      'select count(*), pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t where t.%I <> $1',
      v_table,v_key) into v_count,v_hash using v_target;
    if v_before->v_table is distinct from pg_catalog.jsonb_build_object('count',v_count,'hash',v_hash) then
      raise exception 'STOP: retained % changed',v_table;
    end if;
    if v_table <> 'opportunities' then
      execute pg_catalog.format('select count(*) from public.%I where opportunity_id=$1',v_table)
        into v_count using v_target;
      if v_count <> 0 then raise exception 'STOP: dependent % remain',v_table; end if;
      execute pg_catalog.format('select exists (select 1 from public.%I d where not exists (select 1 from public.opportunities o where o.id=d.opportunity_id))',v_table)
        into v_orphan;
      if v_orphan then raise exception 'STOP: orphan reference in %',v_table; end if;
    end if;
  end loop;
  if v_globals_before is distinct from pg_catalog.jsonb_build_array(
    (select count(*) from public.contacts),
    (select count(*) from public.objectives),
    (select count(*) from public.interactions)) then
    raise exception 'STOP: global contacts, objectives or interactions changed';
  end if;
  raise notice 'DEV cleanup checks passed before COMMIT: one row removed, four retained';
end;
$cleanup$;
commit;
