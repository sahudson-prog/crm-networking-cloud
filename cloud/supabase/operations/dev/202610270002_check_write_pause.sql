-- Read-only drain check after disabling the DEV Data API and pausing direct writers.
-- PASS requires zero active authenticator transactions and no unclassified direct writers.
begin transaction read only;

select jsonb_build_object(
  'authenticator_active_transactions', count(*) filter (where usename = 'authenticator'),
  'other_active_client_transactions', count(*) filter (where usename <> 'authenticator'),
  'oldest_active_seconds', coalesce(max(extract(epoch from pg_catalog.clock_timestamp() - xact_start)), 0)
) as r2b_write_pause_drain
from pg_catalog.pg_stat_activity
where datname = pg_catalog.current_database()
  and pid <> pg_catalog.pg_backend_pid()
  and backend_type = 'client backend'
  and xact_start is not null and state <> 'idle';

rollback;
