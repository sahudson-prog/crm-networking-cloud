-- UX-DATE-01: versioned historical operations; periodic Google remains separate.
begin;
-- The operator pauses/drains first. This lock prevents concurrent reopening
-- through the gate RPC (or direct UPDATE) until the entire cutover commits.
lock table public.r2b_rollout_gate in share mode;
do $preflight$
declare v_source text;
begin
  if (select count(*) from public.r2b_rollout_gate) <> 1
    or not exists(select 1 from public.r2b_rollout_gate
      where singleton and mode = 'paused' and test_user_id is null) then
    raise exception 'history_cutover_requires_paused_gate' using errcode = '55000';
  end if;
  if to_regprocedure('public.current_user_history_window_v1()') is null then
    raise exception 'history_policy_required'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('assert_history_context_v1','apply_ics_import_v2','apply_google_history_v1','apply_google_periodic_v1')) then
    raise exception 'history_import_objects_present'; end if;
  select replace(prosrc, E'\r\n', E'\n') into v_source from pg_proc where oid=to_regprocedure('public.apply_ics_import_v1(jsonb)');
  if v_source is null or md5(v_source)<>'387dbd63a867f15a3844e222c052bb17' then raise exception 'ics_contract_drift'; end if;
  select replace(prosrc, E'\r\n', E'\n') into v_source from pg_proc where oid=to_regprocedure('public.apply_google_interaction_sync_v1(uuid,jsonb)');
  if v_source is null or md5(v_source)<>'bcc3ca6580e45ee31a307269bb1764dd' then raise exception 'google_writer_drift'; end if;
  if exists(select 1 from pg_proc where oid in ('public.apply_ics_import_v1(jsonb)'::regprocedure,
    'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure)
    and (not prosecdef or proowner<>'postgres'::regrole or not coalesce(proconfig @> array['search_path=""'],false))) then
    raise exception 'history_writer_security_drift'; end if;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in ('public.apply_ics_import_v1(jsonb)'::regprocedure,'public.apply_google_interaction_sync_v1(uuid,jsonb)'::regprocedure)
      and acl.grantee not in ('postgres'::regrole,'authenticated'::regrole)) then
    raise exception 'history_writer_acl_drift'; end if;
end;
$preflight$;

-- Reuse the complete ICS writer. Its obsolete civil-UTC gate is replaced by
-- exact instant/context validation in the only client-executable wrapper below.
do $adapt$
declare v_definition text; v_start integer; v_end integer;
begin
  v_definition:=replace(pg_get_functiondef('public.apply_ics_import_v1(jsonb)'::regprocedure),E'\r\n',E'\n');
  v_start:=strpos(v_definition,'  select setting.setting_value');
  v_end:=strpos(v_definition,'  if p_items is null');
  if v_start=0 or v_end<=v_start then raise exception 'ics_gate_shape_drift'; end if;
  v_definition:=substr(v_definition,1,v_start-1)||E'  v_minimum_start_date := ''-infinity''::date;\n'||substr(v_definition,v_end);
  execute v_definition;
end;
$adapt$;
revoke all on function public.apply_ics_import_v1(jsonb), public.apply_google_interaction_sync_v1(uuid,jsonb)
  from public, anon, authenticated, service_role, supabase_auth_admin;

create function public.assert_history_context_v1(p_context jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_current jsonb;
begin
  if auth.uid() is null or not coalesce(public.current_user_has_app_access(),false) then
    raise exception 'app_access_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('networking-cycle'),pg_catalog.hashtext(auth.uid()::text));
  perform 1 from public.networking_history_policy where singleton for share;
  v_current:=public.current_user_history_window_v1();
  if p_context is distinct from v_current then raise exception 'history_context_stale' using errcode='40001'; end if;
  return (v_current->>'effective_start')::timestamptz;
end;
$$;

create function public.apply_ics_import_v2(p_items jsonb,p_context jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_min timestamptz; v_item jsonb; v_at timestamptz;
begin
  v_min:=public.assert_history_context_v1(p_context);
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'ICS_IMPORT_INVALID_PAYLOAD'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_at:=(v_item#>>'{event,start,instant}')::timestamptz;
    if v_at is null or not isfinite(v_at) or v_at<v_min then raise exception 'ICS_IMPORT_BEFORE_NETWORKING_START'; end if;
  end loop;
  return public.apply_ics_import_v1(p_items);
end;
$$;

create function public.apply_google_history_v1(p_connected_account_id uuid,p_item jsonb,p_context jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_min timestamptz; v_at timestamptz;
begin
  v_min:=public.assert_history_context_v1(p_context);
  v_at:=(p_item->>'occurredAt')::timestamptz;
  if v_at is null or not isfinite(v_at) or v_at<v_min then raise exception 'history_item_before_window' using errcode='22023'; end if;
  return public.apply_google_interaction_sync_v1(p_connected_account_id,p_item);
end;
$$;

-- This is an explicit periodic operation, not proof of provider provenance.
-- Its existing capability, account, ownership and scope checks stay in the writer.
create function public.apply_google_periodic_v1(p_connected_account_id uuid,p_item jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.apply_google_interaction_sync_v1(p_connected_account_id,p_item);
$$;

alter function public.assert_history_context_v1(jsonb) owner to postgres;
alter function public.apply_ics_import_v2(jsonb,jsonb) owner to postgres;
alter function public.apply_google_history_v1(uuid,jsonb,jsonb) owner to postgres;
alter function public.apply_google_periodic_v1(uuid,jsonb) owner to postgres;
revoke all on function public.assert_history_context_v1(jsonb), public.apply_ics_import_v2(jsonb,jsonb),
  public.apply_google_history_v1(uuid,jsonb,jsonb),public.apply_google_periodic_v1(uuid,jsonb)
  from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function public.apply_ics_import_v2(jsonb,jsonb), public.apply_google_history_v1(uuid,jsonb,jsonb),
  public.apply_google_periodic_v1(uuid,jsonb) to authenticated;
commit;
