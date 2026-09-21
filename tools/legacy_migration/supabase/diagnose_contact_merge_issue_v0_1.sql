-- Diagnostico solo lectura para investigar duplicados/fusiones de contactos.
-- Caso inicial: Ana Maria Hudson / Agueda Fica.

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
    jsonb_agg(
      jsonb_build_object(
        'email', ce.email,
        'normalized_email', ce.normalized_email,
        'source', ce.source,
        'is_primary', ce.is_primary
      )
      order by ce.email
    ) as emails
  from public.contact_emails ce
  join candidate_contacts c on c.id = ce.contact_id
  group by ce.contact_id
),
phones as (
  select
    cp.contact_id,
    jsonb_agg(
      jsonb_build_object(
        'phone', cp.phone,
        'normalized_phone', cp.normalized_phone,
        'last8', cp.normalized_phone_last8,
        'source', cp.source,
        'is_primary', cp.is_primary
      )
      order by cp.phone
    ) as phones
  from public.contact_phones cp
  join candidate_contacts c on c.id = cp.contact_id
  group by cp.contact_id
),
external_ids as (
  select
    ei.contact_id,
    jsonb_agg(
      jsonb_build_object(
        'provider', ei.provider,
        'external_id', ei.external_id,
        'is_active', ei.is_active,
        'last_seen_at', ei.last_seen_at
      )
      order by ei.provider, ei.external_id
    ) as external_ids
  from public.external_contact_ids ei
  join candidate_contacts c on c.id = ei.contact_id
  group by ei.contact_id
)
select
  '01_contactos_encontrados' as section,
  c.user_id::text,
  c.id::text as contact_id,
  c.display_name,
  c.company,
  c.role,
  c.networking_status,
  c.networking_focus,
  c.is_headhunter,
  c.is_active,
  c.sync_status,
  c.legacy_app_contact_id,
  c.legacy_google_id,
  c.created_at,
  c.updated_at,
  coalesce(e.emails, '[]'::jsonb) as emails,
  coalesce(p.phones, '[]'::jsonb) as phones,
  coalesce(x.external_ids, '[]'::jsonb) as external_ids
from candidate_contacts c
left join emails e on e.contact_id = c.id
left join phones p on p.contact_id = c.id
left join external_ids x on x.contact_id = c.id
order by c.display_name, c.is_active desc, c.updated_at desc;

with candidate_contacts as (
  select
    c.*,
    translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') as normalized_name
  from public.contacts c
  where translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%ana%maria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%anamaria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%agueda%fica%'
),
candidate_text as (
  select
    array_agg(id::text) as contact_ids,
    array_agg(display_name) as names
  from candidate_contacts
)
select
  '02_acciones_relacionadas' as section,
  ai.id::text as action_invocation_id,
  ai.action_name,
  ai.actor_type,
  ai.status,
  ai.object_type,
  ai.object_id::text,
  ai.error_message,
  ai.confirmed_at,
  ai.executed_at,
  ai.created_at,
  ai.input_json,
  ai.output_json
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
    or translate(lower(coalesce(ai.input_json::text, '') || ' ' || coalesce(ai.output_json::text, '')), 'áéíóúüñ', 'aeiouun') like '%ana%maria%hudson%'
    or translate(lower(coalesce(ai.input_json::text, '') || ' ' || coalesce(ai.output_json::text, '')), 'áéíóúüñ', 'aeiouun') like '%agueda%fica%'
  )
order by coalesce(ai.executed_at, ai.created_at) desc
limit 50;

with candidate_contacts as (
  select
    c.*,
    translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') as normalized_name
  from public.contacts c
  where translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%ana%maria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%anamaria%hudson%'
     or translate(lower(coalesce(c.display_name, '')), 'áéíóúüñ', 'aeiouun') like '%agueda%fica%'
),
candidate_text as (
  select
    array_agg(id::text) as contact_ids
  from candidate_contacts
)
select
  '03_auditoria_relacionada' as section,
  al.id::text as audit_log_id,
  al.actor,
  al.action,
  al.object_type,
  al.object_id::text,
  al.created_at,
  al.before_json,
  al.after_json
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
order by al.created_at desc
limit 50;
