-- Coffeecito canonical Google Connected Account v0.1
-- Purpose:
-- - Deduplicate non-revoked Google connected accounts by user and normalized email.
-- - Reset historical requested scopes/capabilities that were not server-verified.
-- - Close direct client writes to connected_accounts.
-- - Add narrow RPCs for verified server finalization and user self-disconnect.

begin;

do $$
declare
  unexpected_fk_count integer;
begin
  select count(*)
  into unexpected_fk_count
  from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = 'public.connected_accounts'::regclass
    and constraint_row.conrelid not in (
      'public.external_contact_ids'::regclass,
      'public.external_contact_snapshots'::regclass,
      'public.external_interaction_sources'::regclass,
      'public.sync_cursors'::regclass
    );

  if unexpected_fk_count > 0 then
    raise exception 'Unexpected foreign key reference to public.connected_accounts detected';
  end if;
end;
$$;

alter table public.connected_accounts
  add column if not exists effective_scopes_verified_at timestamptz,
  add column if not exists effective_scopes_verification_method text;

with google_accounts as (
  select
    account.id,
    account.user_id,
    lower(btrim(account.account_email)) as normalized_email,
    account.connected_at
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and account.account_email is not null
    and btrim(account.account_email) <> ''
),
reference_counts as (
  select
    google_accounts.id,
    (
      select count(*) from public.external_contact_ids item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_contact_snapshots item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_interaction_sources item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.sync_cursors item where item.connected_account_id = google_accounts.id
    ) as reference_count
  from google_accounts
),
ranked_accounts as (
  select
    google_accounts.id,
    first_value(google_accounts.id) over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as canonical_id,
    row_number() over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as row_number
  from google_accounts
  join reference_counts on reference_counts.id = google_accounts.id
),
duplicate_map as (
  select id as duplicate_id, canonical_id
  from ranked_accounts
  where row_number > 1
)
update public.external_contact_ids target
set connected_account_id = duplicate_map.canonical_id
from duplicate_map
where target.connected_account_id = duplicate_map.duplicate_id;

with google_accounts as (
  select
    account.id,
    account.user_id,
    lower(btrim(account.account_email)) as normalized_email,
    account.connected_at
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and account.account_email is not null
    and btrim(account.account_email) <> ''
),
reference_counts as (
  select
    google_accounts.id,
    (
      select count(*) from public.external_contact_ids item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_contact_snapshots item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_interaction_sources item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.sync_cursors item where item.connected_account_id = google_accounts.id
    ) as reference_count
  from google_accounts
),
ranked_accounts as (
  select
    google_accounts.id,
    first_value(google_accounts.id) over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as canonical_id,
    row_number() over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as row_number
  from google_accounts
  join reference_counts on reference_counts.id = google_accounts.id
),
duplicate_map as (
  select id as duplicate_id, canonical_id
  from ranked_accounts
  where row_number > 1
)
update public.external_contact_snapshots target
set connected_account_id = duplicate_map.canonical_id
from duplicate_map
where target.connected_account_id = duplicate_map.duplicate_id;

with google_accounts as (
  select
    account.id,
    account.user_id,
    lower(btrim(account.account_email)) as normalized_email,
    account.connected_at
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and account.account_email is not null
    and btrim(account.account_email) <> ''
),
reference_counts as (
  select
    google_accounts.id,
    (
      select count(*) from public.external_contact_ids item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_contact_snapshots item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_interaction_sources item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.sync_cursors item where item.connected_account_id = google_accounts.id
    ) as reference_count
  from google_accounts
),
ranked_accounts as (
  select
    google_accounts.id,
    first_value(google_accounts.id) over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as canonical_id,
    row_number() over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as row_number
  from google_accounts
  join reference_counts on reference_counts.id = google_accounts.id
),
duplicate_map as (
  select id as duplicate_id, canonical_id
  from ranked_accounts
  where row_number > 1
)
update public.external_interaction_sources target
set connected_account_id = duplicate_map.canonical_id
from duplicate_map
where target.connected_account_id = duplicate_map.duplicate_id;

with google_accounts as (
  select
    account.id,
    account.user_id,
    lower(btrim(account.account_email)) as normalized_email,
    account.connected_at
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and account.account_email is not null
    and btrim(account.account_email) <> ''
),
reference_counts as (
  select
    google_accounts.id,
    (
      select count(*) from public.external_contact_ids item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_contact_snapshots item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_interaction_sources item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.sync_cursors item where item.connected_account_id = google_accounts.id
    ) as reference_count
  from google_accounts
),
ranked_accounts as (
  select
    google_accounts.id,
    first_value(google_accounts.id) over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as canonical_id,
    row_number() over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as row_number
  from google_accounts
  join reference_counts on reference_counts.id = google_accounts.id
),
duplicate_map as (
  select id as duplicate_id, canonical_id
  from ranked_accounts
  where row_number > 1
)
update public.sync_cursors target
set connected_account_id = duplicate_map.canonical_id
from duplicate_map
where target.connected_account_id = duplicate_map.duplicate_id;

with google_accounts as (
  select
    account.id,
    account.user_id,
    lower(btrim(account.account_email)) as normalized_email,
    account.connected_at
  from public.connected_accounts account
  where account.provider = 'google'
    and account.revoked_at is null
    and account.status <> 'revoked'
    and account.account_email is not null
    and btrim(account.account_email) <> ''
),
reference_counts as (
  select
    google_accounts.id,
    (
      select count(*) from public.external_contact_ids item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_contact_snapshots item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.external_interaction_sources item where item.connected_account_id = google_accounts.id
    ) + (
      select count(*) from public.sync_cursors item where item.connected_account_id = google_accounts.id
    ) as reference_count
  from google_accounts
),
ranked_accounts as (
  select
    google_accounts.id,
    first_value(google_accounts.id) over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as canonical_id,
    row_number() over (
      partition by google_accounts.user_id, google_accounts.normalized_email
      order by reference_counts.reference_count desc, google_accounts.connected_at asc, google_accounts.id::text asc
    ) as row_number
  from google_accounts
  join reference_counts on reference_counts.id = google_accounts.id
),
duplicate_map as (
  select id as duplicate_id
  from ranked_accounts
  where row_number > 1
)
update public.connected_accounts account
set
  status = 'revoked',
  revoked_at = coalesce(account.revoked_at, now())
from duplicate_map
where account.id = duplicate_map.duplicate_id;

update public.connected_accounts
set
  scopes = array[]::text[],
  capabilities = '{}'::jsonb,
  effective_scopes_verified_at = null,
  effective_scopes_verification_method = null
where provider = 'google'
  and revoked_at is null
  and status <> 'revoked';

create unique index if not exists uq_connected_accounts_google_user_email_nonrevoked
on public.connected_accounts(user_id, provider, lower(btrim(account_email)))
where provider = 'google'
  and revoked_at is null
  and status <> 'revoked'
  and account_email is not null
  and btrim(account_email) <> '';

alter table public.connected_accounts enable row level security;

revoke all on table public.connected_accounts from PUBLIC;
revoke all on table public.connected_accounts from anon;
revoke insert, update, delete on table public.connected_accounts from authenticated;
grant select on table public.connected_accounts to authenticated;

create or replace function public.finalize_google_connected_account_verified(
  p_user_id uuid,
  p_account_email text,
  p_effective_scopes text[]
)
returns table (
  id uuid,
  provider text,
  account_email text,
  scopes text[],
  capabilities jsonb,
  status text,
  connected_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.connected_accounts%rowtype;
  v_capabilities jsonb;
  v_effective_scopes text[];
  v_normalized_email text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_normalized_email := lower(btrim(coalesce(p_account_email, '')));
  if v_normalized_email = '' then
    raise exception 'account_email is required';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = p_user_id) then
    raise exception 'profile not found';
  end if;

  select coalesce(array_agg(distinct scope_value order by scope_value), array[]::text[])
  into v_effective_scopes
  from unnest(coalesce(p_effective_scopes, array[]::text[])) as scope_value
  where scope_value in (
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly'
  );

  if cardinality(v_effective_scopes) = 0 then
    raise exception 'at least one verified Google data scope is required';
  end if;

  v_capabilities := jsonb_build_object(
    'contacts_read', 'https://www.googleapis.com/auth/contacts.readonly' = any(v_effective_scopes),
    'gmail_read', 'https://www.googleapis.com/auth/gmail.readonly' = any(v_effective_scopes),
    'calendar_read', 'https://www.googleapis.com/auth/calendar.readonly' = any(v_effective_scopes)
  );

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext('google:' || v_normalized_email));

  select *
  into v_account
  from public.connected_accounts account
  where account.user_id = p_user_id
    and account.provider = 'google'
    and lower(btrim(account.account_email)) = v_normalized_email
    and account.revoked_at is null
    and account.status <> 'revoked'
  order by account.connected_at asc, account.id::text asc
  limit 1
  for update;

  if found then
    update public.connected_accounts account
    set
      account_email = v_normalized_email,
      scopes = v_effective_scopes,
      capabilities = v_capabilities,
      status = 'active',
      revoked_at = null,
      effective_scopes_verified_at = now(),
      effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    where account.id = v_account.id
    returning * into v_account;
  else
    insert into public.connected_accounts (
      user_id,
      provider,
      account_email,
      scopes,
      capabilities,
      status,
      effective_scopes_verified_at,
      effective_scopes_verification_method
    )
    values (
      p_user_id,
      'google',
      v_normalized_email,
      v_effective_scopes,
      v_capabilities,
      'active',
      now(),
      'google_tokeninfo_userinfo_v0_1'
    )
    returning * into v_account;
  end if;

  return query
  select
    v_account.id,
    v_account.provider,
    v_account.account_email,
    v_account.scopes,
    v_account.capabilities,
    v_account.status,
    v_account.connected_at,
    v_account.revoked_at,
    v_account.updated_at;
end;
$$;

revoke all on function public.finalize_google_connected_account_verified(uuid, text, text[]) from PUBLIC;
revoke all on function public.finalize_google_connected_account_verified(uuid, text, text[]) from anon;
revoke all on function public.finalize_google_connected_account_verified(uuid, text, text[]) from authenticated;
grant execute on function public.finalize_google_connected_account_verified(uuid, text, text[]) to service_role;

create or replace function public.disconnect_current_user_google_connected_account(p_account_id uuid)
returns table (
  id uuid,
  status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_revoked_at timestamptz;
  v_status text;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'authenticated user is required';
  end if;

  if not public.current_user_has_app_access() then
    raise exception 'app access denied';
  end if;

  update public.connected_accounts account
  set
    status = 'revoked',
    revoked_at = now()
  where account.id = p_account_id
    and account.user_id = v_user_id
    and account.provider = 'google'
    and account.status <> 'revoked'
  returning account.id, account.status, account.revoked_at
  into v_account_id, v_status, v_revoked_at;

  if v_account_id is null then
    raise exception 'google connected account not found';
  end if;

  return query select v_account_id, v_status, v_revoked_at;
end;
$$;

revoke all on function public.disconnect_current_user_google_connected_account(uuid) from PUBLIC;
revoke all on function public.disconnect_current_user_google_connected_account(uuid) from anon;
grant execute on function public.disconnect_current_user_google_connected_account(uuid) to authenticated;

commit;
