-- DRAFT ONLY. Do not run without separate approval, target-project confirmation,
-- a current recoverable backup, and a runtime that no longer offers this modality.
-- To execute manually, set v_approved=true, exact modality and the count observed
-- in the read-only audience query; then replace the final ROLLBACK with COMMIT.
-- Never use this script to close both modalities at once.
begin;
do $close$
declare
  v_approved boolean := false;
  v_modality text := null;
  v_expected_count integer := null;
  v_actual_count integer;
  v_deleted integer;
begin
  if v_approved is distinct from true
    or (v_modality in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND')) is distinct from true
    or v_expected_count is null or v_expected_count < 0 then
    raise exception 'manual_mode_close_not_approved';
  end if;
  update public.networking_plan_notice_modes set is_open = false
    where objective_type = v_modality and is_open;
  if not found then raise exception 'mode_not_open_or_missing'; end if;
  select pg_catalog.count(*) into v_actual_count
    from public.networking_plan_interest where objective_type = v_modality;
  if v_actual_count <> v_expected_count then
    raise exception 'mode_close_count_changed: expected %, found %', v_expected_count, v_actual_count;
  end if;
  delete from public.networking_plan_interest where objective_type = v_modality;
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_expected_count
    or exists (select 1 from public.networking_plan_interest where objective_type = v_modality)
    or exists (select 1 from public.networking_plan_notice_modes where objective_type = v_modality and is_open) then
    raise exception 'mode_close_incomplete';
  end if;
  raise notice 'Closed one modality; deleted % active requests.', v_deleted;
end;
$close$;
rollback;
