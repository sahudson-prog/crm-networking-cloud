-- Restores the RPC-only table grant contract for the closed-beta allowlist.

begin;

revoke select, insert, update, delete,
  truncate, references, trigger, maintain
on table public.app_access_allowlist
from authenticated, service_role;

commit;
