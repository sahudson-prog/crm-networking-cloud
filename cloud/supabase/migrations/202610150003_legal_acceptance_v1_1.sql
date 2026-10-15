-- Advances the current legal contract to V1.1 without changing V1.0 history.

begin;

create or replace function public.current_user_legal_acceptance_status_v1()
returns table (
  accepted boolean,
  terms_version text,
  privacy_version text,
  terms_sha256 text,
  privacy_sha256 text,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_accepted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'LEGAL_ACCEPTANCE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'LEGAL_ACCEPTANCE_APP_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  select acceptance.accepted_at
  into v_accepted_at
  from public.legal_acceptances acceptance
  where acceptance.user_id = v_user_id
    and acceptance.terms_version = '1.1'
    and acceptance.privacy_version = '1.1'
    and acceptance.terms_sha256 = '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43'
    and acceptance.privacy_sha256 = '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f'
    and acceptance.acceptance_method = 'explicit_web'
  order by acceptance.accepted_at desc
  limit 1;

  return query select
    v_accepted_at is not null,
    '1.1'::text,
    '1.1'::text,
    '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43'::text,
    '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f'::text,
    v_accepted_at;
end;
$$;

create or replace function public.record_current_user_legal_acceptance_v1()
returns table (
  accepted boolean,
  terms_version text,
  privacy_version text,
  terms_sha256 text,
  privacy_sha256 text,
  accepted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_accepted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'LEGAL_ACCEPTANCE_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_has_app_access(), false) then
    raise exception 'LEGAL_ACCEPTANCE_APP_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  insert into public.legal_acceptances (
    user_id,
    terms_version,
    privacy_version,
    terms_sha256,
    privacy_sha256,
    acceptance_method
  ) values (
    v_user_id,
    '1.1',
    '1.1',
    '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43',
    '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f',
    'explicit_web'
  )
  on conflict on constraint uq_legal_acceptances_user_contract do nothing;

  select acceptance.accepted_at
  into strict v_accepted_at
  from public.legal_acceptances acceptance
  where acceptance.user_id = v_user_id
    and acceptance.terms_version = '1.1'
    and acceptance.privacy_version = '1.1'
    and acceptance.terms_sha256 = '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43'
    and acceptance.privacy_sha256 = '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f'
    and acceptance.acceptance_method = 'explicit_web';

  return query select
    true,
    '1.1'::text,
    '1.1'::text,
    '73c2b6927eeeda18c550b25c2fb66cd56191dc0e075192492f68aa5b83459c43'::text,
    '653fc1460b2a227e71a570da90486db213bc0a0adc7d9136896b28a4e5270f0f'::text,
    v_accepted_at;
end;
$$;

alter function public.current_user_legal_acceptance_status_v1() owner to postgres;
alter function public.record_current_user_legal_acceptance_v1() owner to postgres;

revoke execute on function public.current_user_legal_acceptance_status_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;
revoke execute on function public.record_current_user_legal_acceptance_v1()
  from public, anon, authenticated, service_role, supabase_auth_admin;

grant execute on function public.current_user_legal_acceptance_status_v1() to authenticated;
grant execute on function public.record_current_user_legal_acceptance_v1() to authenticated;

comment on function public.current_user_legal_acceptance_status_v1() is 'Returns whether auth.uid() accepted the exact current V1.1 legal contract.';
comment on function public.record_current_user_legal_acceptance_v1() is 'Idempotently records explicit_web acceptance for auth.uid() and the exact current V1.1 versions/hashes.';

commit;
