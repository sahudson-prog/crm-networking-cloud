-- Diagnostico solo lectura en una sola tabla de salida.
-- Usar cuando Supabase exporta solo el ultimo resultado de queries multiples.

with candidate_contacts as (
  select
    c.*,
    translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') as normalized_name
  from public.contacts c
  where translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%ana%maria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%anamaria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%agueda%fica%'
),
emails as (
  select
    ce.contact_id,
    jsonb_agg(jsonb_build_object(
      'email', ce.email,
      'normalized_email', ce.normalized_email,
      'source', ce.source,
      'is_primary', ce.is_primary
    ) order by ce.email) as emails
  from public.contact_emails ce
  join candidate_contacts c on c.id = ce.contact_id
  group by ce.contact_id
),
phones as (
  select
    cp.contact_id,
    jsonb_agg(jsonb_build_object(
      'phone', cp.phone,
      'normalized_phone', cp.normalized_phone,
      'last8', cp.normalized_phone_last8,
      'source', cp.source,
      'is_primary', cp.is_primary
    ) order by cp.phone) as phones
  from public.contact_phones cp
  join candidate_contacts c on c.id = cp.contact_id
  group by cp.contact_id
),
external_ids as (
  select
    ei.contact_id,
    jsonb_agg(jsonb_build_object(
      'provider', ei.provider,
      'external_id', ei.external_id,
      'connected_account_id', ei.connected_account_id,
      'is_active', ei.is_active,
      'last_seen_at', ei.last_seen_at
    ) order by ei.provider, ei.external_id) as external_ids
  from public.external_contact_ids ei
  join candidate_contacts c on c.id = ei.contact_id
  group by ei.contact_id
),
contact_rows as (
  select
    '01_contacto' as section,
    c.updated_at as sort_at,
    c.id::text as object_id,
    c.display_name as title,
    jsonb_build_object(
      'contact_id', c.id,
      'display_name', c.display_name,
      'company', c.company,
      'role', c.role,
      'networking_status', c.networking_status,
      'networking_focus', c.networking_focus,
      'is_headhunter', c.is_headhunter,
      'is_active', c.is_active,
      'sync_status', c.sync_status,
      'legacy_app_contact_id', c.legacy_app_contact_id,
      'legacy_google_id', c.legacy_google_id,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'emails', coalesce(e.emails, '[]'::jsonb),
      'phones', coalesce(p.phones, '[]'::jsonb),
      'external_ids', coalesce(x.external_ids, '[]'::jsonb)
    ) as detail
  from candidate_contacts c
  left join emails e on e.contact_id = c.id
  left join phones p on p.contact_id = c.id
  left join external_ids x on x.contact_id = c.id
),
all_external_links_for_provider_ids as (
  select
    '02_link_externo_google' as section,
    ei.updated_at as sort_at,
    ei.external_id as object_id,
    coalesce(c.display_name, ei.external_id) as title,
    jsonb_build_object(
      'external_id', ei.external_id,
      'contact_id', ei.contact_id,
      'contact_name', c.display_name,
      'connected_account_id', ei.connected_account_id,
      'is_active', ei.is_active,
      'last_seen_at', ei.last_seen_at,
      'created_at', ei.created_at,
      'updated_at', ei.updated_at
    ) as detail
  from public.external_contact_ids ei
  left join public.contacts c on c.id = ei.contact_id
  where ei.provider = 'google'
    and (
      ei.external_id in ('people/c5065534748982421918', 'people/c3302384997492944395')
      or ei.contact_id in (select id from candidate_contacts)
    )
),
candidate_text as (
  select
    coalesce(array_agg(id::text), array[]::text[]) as contact_ids
  from candidate_contacts
),
action_rows as (
  select
    '03_accion' as section,
    coalesce(ai.executed_at, ai.created_at) as sort_at,
    ai.id::text as object_id,
    ai.action_name || ' / ' || ai.status as title,
    jsonb_build_object(
      'action_invocation_id', ai.id,
      'action_name', ai.action_name,
      'actor_type', ai.actor_type,
      'status', ai.status,
      'object_type', ai.object_type,
      'object_id', ai.object_id,
      'error_message', ai.error_message,
      'confirmed_at', ai.confirmed_at,
      'executed_at', ai.executed_at,
      'created_at', ai.created_at,
      'input_json', ai.input_json,
      'output_json', ai.output_json
    ) as detail
  from public.action_invocations ai
  cross join candidate_text ct
  where ai.action_name in ('contact.merge_deep', 'sync.contacts.apply_preview')
    and (
      ai.object_id::text = any(ct.contact_ids)
      or exists (
        select 1
        from unnest(ct.contact_ids) as cid(contact_id)
        where ai.input_json::text like '%' || cid.contact_id || '%'
           or ai.output_json::text like '%' || cid.contact_id || '%'
      )
      or ai.input_json::text like '%people/c5065534748982421918%'
      or ai.output_json::text like '%people/c5065534748982421918%'
      or ai.input_json::text like '%people/c3302384997492944395%'
      or ai.output_json::text like '%people/c3302384997492944395%'
      or translate(lower(coalesce(ai.input_json::text, '') || ' ' || coalesce(ai.output_json::text, '')), 'áéíóúüñ', 'aeiouun') like '%ana%maria%hudson%'
      or translate(lower(coalesce(ai.input_json::text, '') || ' ' || coalesce(ai.output_json::text, '')), 'áéíóúüñ', 'aeiouun') like '%agueda%fica%'
    )
),
audit_rows as (
  select
    '04_auditoria' as section,
    al.created_at as sort_at,
    al.id::text as object_id,
    al.action as title,
    jsonb_build_object(
      'audit_log_id', al.id,
      'actor', al.actor,
      'action', al.action,
      'object_type', al.object_type,
      'object_id', al.object_id,
      'created_at', al.created_at,
      'before_json', al.before_json,
      'after_json', al.after_json
    ) as detail
  from public.audit_log al
  cross join candidate_text ct
  where al.action in ('contact.merge_deep', 'sync.contacts.apply_preview')
    and (
      al.object_id::text = any(ct.contact_ids)
      or exists (
        select 1
        from unnest(ct.contact_ids) as cid(contact_id)
        where al.before_json::text like '%' || cid.contact_id || '%'
           or al.after_json::text like '%' || cid.contact_id || '%'
      )
    )
)
select section, sort_at, object_id, title, detail
from (
  select * from contact_rows
  union all
  select * from all_external_links_for_provider_ids
  union all
  select * from action_rows
  union all
  select * from audit_rows
) rows
order by section, sort_at desc nulls last, title;
