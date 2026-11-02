-- Read-only, aggregate diagnostics only. Never run the migration if stop_reasons is nonempty.
begin transaction read only;
with required(name) as (values ('networking_cycles'),('contacts'),('contact_emails'),('contact_networking_transitions'),('interactions'),('interaction_participants'),('external_interaction_sources'),('objectives'),('contact_objective_assignments'),('opportunities'),('opportunity_contacts'),('opportunity_objectives'),('headhunter_companies'),('headhunter_company_domains')),
problems as (
  select 'missing_or_incompatible_read_table:'||r.name as reason
  from required r left join pg_catalog.pg_class c
    on c.oid=pg_catalog.to_regclass('public.'||r.name)
  where c.oid is null or not c.relrowsecurity or c.relkind<>'r'
    or pg_catalog.pg_get_userbyid(c.relowner)<>'postgres'
    or not pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT')
  union all select 'tracking_object_already_present' where exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='current_user_tracking_snapshot_v1')
  union all select 'opportunity_closure_required' where pg_catalog.to_regprocedure(
    'public.save_opportunity_v2(uuid,text,uuid,timestamptz,text,text,text,text,text,text,uuid[],uuid[],uuid[],text,uuid)') is null
  union all select 'app_access_required' where pg_catalog.to_regprocedure('public.current_user_has_app_access()') is null
  union all select 'tracking_columns_missing' where exists(select 1 from (values ('networking_cycles','id'),
      ('networking_cycles','user_id'),
      ('networking_cycles','status'),
      ('networking_cycles','started_at'),
      ('networking_cycles','timezone_name'),
      ('contacts','id'),
      ('contacts','user_id'),
      ('contacts','is_active'),
      ('contacts','company'),
      ('contacts','networking_focus'),
      ('contacts','is_headhunter'),
      ('contacts','headhunter_domains'),
      ('contact_emails','contact_id'),
      ('contact_emails','domain'),
      ('contact_emails','normalized_email'),
      ('contact_networking_transitions','user_id'),
      ('contact_networking_transitions','cycle_id'),
      ('contact_networking_transitions','contact_id'),
      ('contact_networking_transitions','next_status'),
      ('contact_networking_transitions','changed_at'),
      ('contact_networking_transitions','changed_fields'),
      ('interactions','id'),
      ('interactions','user_id'),
      ('interactions','interaction_type'),
      ('interactions','occurred_at'),
      ('interactions','metadata'),
      ('interaction_participants','interaction_id'),
      ('interaction_participants','contact_id'),
      ('external_interaction_sources','user_id'),
      ('external_interaction_sources','interaction_id'),
      ('external_interaction_sources','provider'),
      ('external_interaction_sources','source_service'),
      ('external_interaction_sources','sync_status'),
      ('external_interaction_sources','is_active'),
      ('objectives','id'),
      ('objectives','user_id'),
      ('objectives','cycle_id'),
      ('objectives','is_active'),
      ('objectives','objective_name'),
      ('objectives','objective_type'),
      ('objectives','priority_level'),
      ('contact_objective_assignments','contact_id'),
      ('contact_objective_assignments','objective_id'),
      ('opportunities','id'),
      ('opportunities','user_id'),
      ('opportunities','cycle_id'),
      ('opportunities','stage'),
      ('opportunities','situation'),
      ('opportunities','result'),
      ('opportunities','voided_at'),
      ('opportunity_contacts','user_id'),
      ('opportunity_contacts','opportunity_id'),
      ('opportunity_contacts','contact_id'),
      ('opportunity_objectives','user_id'),
      ('opportunity_objectives','opportunity_id'),
      ('opportunity_objectives','objective_id'),
      ('headhunter_companies','id'),
      ('headhunter_companies','display_name'),
      ('headhunter_companies','normalized_name'),
      ('headhunter_companies','is_active'),
      ('headhunter_company_domains','company_id'),
      ('headhunter_company_domains','normalized_domain'),
      ('headhunter_company_domains','is_active')) required(tbl,col)
    where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('public.'||required.tbl)
      and a.attname=required.col and a.attnum>0 and not a.attisdropped))
  union all select 'tracking_column_type_incompatible' where exists(select 1 from (values ('contacts','networking_focus','bool'),('contacts','is_headhunter','bool'),('contacts','is_active','bool'),('interactions','metadata','jsonb'),('interactions','occurred_at','timestamptz'),('networking_cycles','started_at','timestamptz'),('networking_cycles','timezone_name','text'),('contact_networking_transitions','changed_at','timestamptz'),('contact_networking_transitions','changed_fields','_text'),('opportunities','stage','text'),('opportunities','situation','text'),('opportunities','result','text')) required(tbl,col,typ)
    where not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
      join pg_catalog.pg_namespace n on n.oid=t.typnamespace
      where a.attrelid=pg_catalog.to_regclass('public.'||required.tbl) and a.attname=required.col
        and not a.attisdropped and n.nspname='pg_catalog' and t.typname=required.typ))
)
select jsonb_build_object('installation_state',case when exists(select 1 from problems) then 'stop' else 'clean_install' end,
  'stop_reasons',coalesce((select jsonb_agg(reason order by reason) from problems),'[]'::jsonb),
  'project_confirmation','Manually confirm the intended project; current_database is not environment identity',
  'recovery','Transactional rollback on install failure; preserve the additive RPC on runtime rollback');
rollback;
