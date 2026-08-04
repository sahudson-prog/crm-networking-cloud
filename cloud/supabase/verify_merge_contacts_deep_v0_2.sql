-- CRM Networking cloud v0.2
-- Verifica que la funcion de fusion profunda quedo instalada.

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.provolatile as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'merge_contacts_deep'
order by p.oid desc;
