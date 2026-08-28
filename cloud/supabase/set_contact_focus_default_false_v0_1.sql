-- CRM Networking cloud migration: contact import focus default v0.1
-- New contacts should not enter active networking focus unless a user/action marks them.

alter table public.contacts
  alter column networking_focus set default false;
