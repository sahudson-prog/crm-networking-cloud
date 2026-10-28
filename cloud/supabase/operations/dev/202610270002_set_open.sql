-- Only after controlled candidate smoke and deployment verification.
begin;
select public.set_r2b_rollout_gate('open', null);
commit;
