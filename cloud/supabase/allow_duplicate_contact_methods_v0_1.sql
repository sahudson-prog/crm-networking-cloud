-- Permite importar contactos distintos desde una fuente conectada aunque compartan correo o telefono.
-- La revision/fusion de duplicados queda como etapa posterior a la importacion.
-- Despues de ejecutar este cambio, volver a ejecutar `merge_contacts_deep_v0_2.sql`
-- para que la funcion de fusion use los nuevos indices por contacto.

drop index if exists public.uq_contact_emails_user_normalized;
drop index if exists public.uq_contact_phones_user_normalized;

create unique index if not exists uq_contact_emails_contact_normalized
  on public.contact_emails(user_id, contact_id, normalized_email);

create unique index if not exists uq_contact_phones_contact_normalized
  on public.contact_phones(user_id, contact_id, normalized_phone);
