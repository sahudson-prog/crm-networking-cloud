-- Guarda metadata cruda por ID externo sin reflejarla aun en el contacto local.
-- Primer uso: cumpleanos leidos desde Google Contacts.

alter table public.external_contact_ids
add column if not exists metadata jsonb not null default '{}'::jsonb;
