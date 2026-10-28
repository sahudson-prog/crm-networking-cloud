-- After migration/verifier: replace the zero UUID with the DEV tester's Auth user ID.
-- Fails safely if the placeholder remains or the ID is not in auth.users.
begin;
select public.set_r2b_rollout_gate('test_only', '00000000-0000-0000-0000-000000000000'::uuid);
commit;
