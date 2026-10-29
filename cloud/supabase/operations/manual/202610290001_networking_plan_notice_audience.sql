-- Manual owner query for a future notice. Run only in the confirmed target project.
-- The result contains personal email addresses; export and handle outside Git.
-- It is not an email sender and does not change any request.
begin transaction read only;
select objective_type, email_at_request, requested_at,
  pg_catalog.count(*) over (partition by objective_type) as modality_active_count
from public.networking_plan_interest
where objective_type in ('BUSINESS_DEVELOPMENT', 'PERSONAL_BRAND')
order by objective_type, requested_at, email_at_request;
rollback;
