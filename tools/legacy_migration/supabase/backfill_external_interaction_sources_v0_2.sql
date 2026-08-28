-- Backfills external interaction sources from already imported interactions.
-- Safe to rerun: existing active source rows are skipped by the unique index.

insert into public.external_interaction_sources (
  user_id,
  interaction_id,
  connected_account_id,
  provider,
  source_service,
  external_object_type,
  external_id,
  external_thread_id,
  external_url,
  source_subject,
  source_detail,
  content_hash,
  sync_status,
  prevent_reimport,
  is_active,
  last_seen_at,
  last_synced_at,
  metadata
)
select
  i.user_id,
  i.id as interaction_id,
  null::uuid as connected_account_id,
  coalesce(nullif(i.provider, ''), 'google') as provider,
  case
    when upper(coalesce(i.provider_event_id, '')) like 'GMAIL%' then 'gmail'
    when upper(coalesce(i.provider_event_id, '')) like 'CALENDAR%' then 'calendar'
    when i.interaction_type = 'email' then 'gmail'
    when i.interaction_type = 'calendar' then 'calendar'
    else 'unknown'
  end as source_service,
  case
    when i.interaction_type = 'calendar' then 'calendar_event'
    when i.interaction_type = 'email' then 'email'
    else i.interaction_type
  end as external_object_type,
  i.provider_event_id as external_id,
  nullif(i.provider_thread_id, '') as external_thread_id,
  null::text as external_url,
  nullif(i.subject, '') as source_subject,
  i.source_detail,
  case
    when coalesce(i.subject, '') <> '' or coalesce(i.source_detail, '') <> ''
    then encode(extensions.digest(coalesce(i.subject, '') || E'\n' || coalesce(i.source_detail, ''), 'sha256'), 'hex')
    else null
  end as content_hash,
  'imported' as sync_status,
  coalesce((i.metadata->>'prevent_reimport')::boolean, false) as prevent_reimport,
  true as is_active,
  i.occurred_at as last_seen_at,
  null::timestamptz as last_synced_at,
  jsonb_build_object(
    'legacy_entry_id', i.legacy_entry_id,
    'legacy_contact_label', i.metadata->>'legacy_contact_label',
    'legacy_google_id', i.metadata->>'legacy_google_id',
    'backfill', 'external_interaction_sources_v0_2'
  ) as metadata
from public.interactions i
where i.provider_event_id is not null
  and i.provider_event_id <> ''
  and (
    upper(i.provider_event_id) like 'GMAIL%'
    or upper(i.provider_event_id) like 'CALENDAR%'
  )
on conflict do nothing;
