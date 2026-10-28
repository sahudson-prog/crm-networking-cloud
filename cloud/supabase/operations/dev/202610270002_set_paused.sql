-- Re-close app access after a failed controlled smoke. Keep the R2-B schema.
begin;
select public.set_r2b_rollout_gate('paused', null);
commit;
