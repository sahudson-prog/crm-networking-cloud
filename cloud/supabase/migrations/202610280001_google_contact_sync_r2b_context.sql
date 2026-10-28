-- PROD CONTRACT CHANGE: forward-fix after 202610270002. The authenticated
-- Google contact writer now requires the tab's expected R2-B context.
-- Install while the R2-B gate is paused; deploy its client before reopening.
begin;

do $gate$
begin
  if coalesce((select mode from public.r2b_rollout_gate where singleton), 'missing') <> 'paused'
    or (select test_user_id from public.r2b_rollout_gate where singleton) is not null then
    raise exception 'r2b_rollout_must_be_paused' using errcode = '42501';
  end if;
end;
$gate$;

create function public.apply_google_contact_sync_change_r2b(
  p_connected_account_id uuid, p_change jsonb,
  p_expected_cycle_id uuid, p_expected_context text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_contact_id uuid;
begin
  if v_user is null or not public.current_user_has_app_access() then
    raise exception 'app_access_denied' using errcode = '42501';
  end if;
  -- The assertion takes the per-user transaction lock before any mutation.
  -- This also checks none:<last-closed-id> when no cycle is active.
  perform public.assert_networking_context_r2b(v_user, p_expected_cycle_id, p_expected_context);
  if pg_catalog.jsonb_typeof(coalesce(p_change->'mergeSourceContactIds', '[]'::jsonb)) = 'array'
    and pg_catalog.jsonb_array_length(coalesce(p_change->'mergeSourceContactIds', '[]'::jsonb)) > 0 then
    -- The existing deep merge moves historical associations. Its trigger
    -- permits that move only under a context-checked merge token.
    perform pg_catalog.set_config('app.networking_context', 'merge:' || p_expected_context, true);
  end if;
  -- Keep the existing connected-account ownership, capability, provider-scope
  -- and per-change atomicity checks in the established Google writer.
  v_contact_id := public.apply_google_contact_sync_change_v1(p_connected_account_id, p_change);
  perform pg_catalog.set_config('app.networking_context', p_expected_context, true);
  return v_contact_id;
end;
$$;

alter function public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text) owner to postgres;
revoke all on function public.apply_google_contact_sync_change_v1(uuid,jsonb)
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.apply_google_contact_sync_change_r2b(uuid,jsonb,uuid,text)
  to authenticated;

commit;
