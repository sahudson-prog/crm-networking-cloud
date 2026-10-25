-- Read-only preflight for SEC-GOOGLE-01. Run in each target environment before migration.
-- It intentionally does not choose or mutate the beta_tester backfill population.
-- Results are aggregate-only: no email, token, account id or user id is returned.

begin transaction read only;

with access_state as (
  select
    access_profile.user_id,
    access_profile.account_status,
    access_profile.beta_access_status,
    status.allowed,
    status.reason
  from public.user_access_profiles access_profile
  cross join lateral public.app_access_status_for_user(access_profile.user_id) status
),
active_google_users as (
  select
    account.user_id,
    bool_or(
      account.effective_scopes_verified_at is not null
      and account.effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    ) as has_expected_scope_verification
  from public.connected_accounts account
  where account.provider = 'google'
    and account.status = 'active'
    and account.revoked_at is null
  group by account.user_id
),
active_beta_users as (
  select distinct assignment.user_id
  from public.user_role_assignments assignment
  join public.app_roles role
    on role.role_code = assignment.role_code
   and role.is_active = true
  where assignment.role_code = 'beta_tester'
    and assignment.is_active = true
    and assignment.starts_at <= now()
    and (assignment.expires_at is null or assignment.expires_at > now())
),
population_summary as (
  select jsonb_build_object(
    'access_profiles', (select count(*) from public.user_access_profiles),
    'users_with_effective_app_access', (select count(*) from access_state where allowed),
    'active_google_accounts', (
      select count(*)
      from public.connected_accounts
      where provider = 'google' and status = 'active' and revoked_at is null
    ),
    'users_with_active_google_account', (select count(*) from active_google_users),
    'active_beta_testers', (select count(*) from active_beta_users),
    'eligible_active_beta_testers', (
      select count(*)
      from active_beta_users beta_user
      join access_state on access_state.user_id = beta_user.user_id
      where access_state.allowed
    ),
    'active_google_users_with_effective_access_without_beta_tester', (
      select count(*)
      from active_google_users google_user
      join access_state on access_state.user_id = google_user.user_id
      left join active_beta_users beta_user on beta_user.user_id = google_user.user_id
      where access_state.allowed
        and access_state.account_status = 'active'
        and access_state.beta_access_status = 'approved'
        and beta_user.user_id is null
    ),
    'confirmed_beta_legacy_users', (
      select count(*)
      from active_beta_users beta_user
      join access_state on access_state.user_id = beta_user.user_id
      where access_state.allowed
        and access_state.account_status = 'active'
        and access_state.beta_access_status = 'approved'
    ),
    'users_requiring_independent_beta_legacy_evidence', (
      select count(*)
      from access_state
      left join active_beta_users beta_user on beta_user.user_id = access_state.user_id
      where access_state.allowed
        and access_state.account_status = 'active'
        and access_state.beta_access_status = 'approved'
        and beta_user.user_id is null
    ),
    'eligible_active_google_users_without_expected_scope_verification', (
      select count(*)
      from active_google_users google_user
      join access_state on access_state.user_id = google_user.user_id
      where access_state.allowed
        and not google_user.has_expected_scope_verification
    ),
    'excluded_active_google_users', (
      select count(*)
      from active_google_users google_user
      join access_state on access_state.user_id = google_user.user_id
      where not access_state.allowed
    )
  ) as payload
),
access_exceptions as (
  select
    status.reason as access_exception,
    count(*) as affected_users
  from active_google_users google_user
  cross join lateral public.app_access_status_for_user(google_user.user_id) status
  where not status.allowed
  group by status.reason
),
connection_states as (
  select
    account.status,
    (account.revoked_at is not null) as has_revocation_marker,
    (
      account.effective_scopes_verified_at is not null
      and account.effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    ) as has_expected_scope_verification,
    count(*) as account_count,
    count(distinct account.user_id) as user_count
  from public.connected_accounts account
  where account.provider = 'google'
  group by
    account.status,
    (account.revoked_at is not null),
    (
      account.effective_scopes_verified_at is not null
      and account.effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    )
),
google_users as (
  select
    account.user_id,
    true as has_any_google_account,
    bool_or(account.status = 'active' and account.revoked_at is null) as has_active_google_account,
    bool_or(
      account.status = 'active'
      and account.revoked_at is null
      and account.effective_scopes_verified_at is not null
      and account.effective_scopes_verification_method = 'google_tokeninfo_userinfo_v0_1'
    ) as has_expected_scope_verification
  from public.connected_accounts account
  where account.provider = 'google'
  group by account.user_id
),
cohort_matrix as (
  select
    access_profile.plan_code,
    access_profile.account_status,
    access_profile.beta_access_status,
    status.allowed as has_effective_app_access,
    status.reason as app_access_reason,
    coalesce(google_user.has_any_google_account, false) as has_any_google_account,
    coalesce(google_user.has_active_google_account, false) as has_active_google_account,
    coalesce(google_user.has_expected_scope_verification, false) as has_expected_scope_verification,
    role_state.active_roles,
    cardinality(role_state.active_roles) > 0 as has_active_roles,
    'beta_tester' = any(role_state.active_roles) as has_active_beta_tester_role,
    case
      when 'beta_tester' = any(role_state.active_roles)
        then 'confirmed_active_beta_tester_role'
      else 'independent_evidence_required'
    end as beta_legacy_evidence,
    public.user_has_capability_for_user(
      access_profile.user_id,
      'contacts.import_google'
    ) as has_legacy_contacts_capability,
    public.user_has_capability_for_user(
      access_profile.user_id,
      'interactions.import_google'
    ) as has_legacy_interactions_capability
  from public.user_access_profiles access_profile
  left join google_users google_user
    on google_user.user_id = access_profile.user_id
  cross join lateral public.app_access_status_for_user(access_profile.user_id) status
  cross join lateral (
    select coalesce(
      array_agg(assignment.role_code order by assignment.role_code)
        filter (where assignment.role_code is not null),
      array[]::text[]
    ) as active_roles
    from public.user_role_assignments assignment
    join public.app_roles role
      on role.role_code = assignment.role_code
     and role.is_active = true
    where assignment.user_id = access_profile.user_id
      and assignment.is_active = true
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
  ) role_state
),
cohort_matrix_counts as (
  select
    plan_code,
    account_status,
    beta_access_status,
    has_effective_app_access,
    app_access_reason,
    has_any_google_account,
    has_active_google_account,
    has_expected_scope_verification,
    active_roles,
    has_active_roles,
    has_active_beta_tester_role,
    beta_legacy_evidence,
    has_legacy_contacts_capability,
    has_legacy_interactions_capability,
    count(*) as user_count
  from cohort_matrix
  group by
    plan_code,
    account_status,
    beta_access_status,
    has_effective_app_access,
    app_access_reason,
    has_any_google_account,
    has_active_google_account,
    has_expected_scope_verification,
    active_roles,
    has_active_roles,
    has_active_beta_tester_role,
    beta_legacy_evidence,
    has_legacy_contacts_capability,
    has_legacy_interactions_capability
),
cohort_population_reconciliation as (
  select
    (select count(*) from public.user_access_profiles) as access_profile_users,
    coalesce((select sum(user_count) from cohort_matrix_counts), 0) as cohort_matrix_users
),
active_overrides as (
  select
    override.capability_code,
    override.override_mode,
    count(*) as override_count,
    count(distinct override.user_id) as affected_users
  from public.user_capability_overrides override
  where override.capability_code in (
      'connectors.google.use',
      'contacts.import_google',
      'interactions.import_google',
      'contacts.sync_external',
      'interactions.sync_email',
      'interactions.sync_calendar'
    )
    and override.is_active = true
    and override.starts_at <= now()
    and (override.expires_at is null or override.expires_at > now())
  group by override.capability_code, override.override_mode
),
beta_tester_capabilities as (
  select
    role_capability.capability_code,
    capability.capability_area,
    capability.is_active
  from public.app_role_capabilities role_capability
  join public.app_capabilities capability
    on capability.capability_code = role_capability.capability_code
  where role_capability.role_code = 'beta_tester'
),
planned_delta as (
  select
    planned.capability_code,
    (capability.capability_code is not null) as current_capability_exists,
    coalesce(capability.is_active, false) as current_capability_active,
    (role_capability.capability_code is not null) as current_role_grant,
    true as role_grant_after_expand
  from (values
    ('connectors.google.use'),
    ('contacts.sync_external'),
    ('interactions.sync_email'),
    ('interactions.sync_calendar')
  ) planned(capability_code)
  left join public.app_capabilities capability
    on capability.capability_code = planned.capability_code
  left join public.app_role_capabilities role_capability
    on role_capability.role_code = 'beta_tester'
   and role_capability.capability_code = planned.capability_code
)
select
  diagnostic.block_order,
  diagnostic.diagnostic_block,
  diagnostic.payload
from (
  values
    (
      1,
      'population_summary',
      (select payload from population_summary)
        || jsonb_build_object(
          'cohort_population_reconciliation',
          (
            select jsonb_build_object(
              'access_profile_users', access_profile_users,
              'cohort_matrix_users', cohort_matrix_users,
              'omitted_from_cohort_matrix', greatest(access_profile_users - cohort_matrix_users, 0),
              'unexpected_extra_matrix_users', greatest(cohort_matrix_users - access_profile_users, 0),
              'is_reconciled', access_profile_users = cohort_matrix_users
            )
            from cohort_population_reconciliation
          )
        )
    ),
    (
      2,
      'access_exceptions',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'access_exception', access_exception,
            'affected_users', affected_users
          )
          order by access_exception
        )
        from access_exceptions
      ), '[]'::jsonb)
    ),
    (
      3,
      'connection_states',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', status,
            'has_revocation_marker', has_revocation_marker,
            'has_expected_scope_verification', has_expected_scope_verification,
            'account_count', account_count,
            'user_count', user_count
          )
          order by status, has_revocation_marker, has_expected_scope_verification
        )
        from connection_states
      ), '[]'::jsonb)
    ),
    (
      4,
      'cohort_matrix',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'plan_code', plan_code,
            'account_status', account_status,
            'beta_access_status', beta_access_status,
            'has_effective_app_access', has_effective_app_access,
            'app_access_reason', app_access_reason,
            'has_any_google_account', has_any_google_account,
            'has_active_google_account', has_active_google_account,
            'has_expected_scope_verification', has_expected_scope_verification,
            'active_roles', active_roles,
            'has_active_roles', has_active_roles,
            'has_active_beta_tester_role', has_active_beta_tester_role,
            'beta_legacy_evidence', beta_legacy_evidence,
            'has_legacy_contacts_capability', has_legacy_contacts_capability,
            'has_legacy_interactions_capability', has_legacy_interactions_capability,
            'user_count', user_count
          )
          order by
            has_effective_app_access desc,
            has_active_google_account desc,
            has_active_beta_tester_role,
            plan_code nulls last,
            app_access_reason
        )
        from cohort_matrix_counts
      ), '[]'::jsonb)
    ),
    (
      5,
      'active_overrides',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'capability_code', capability_code,
            'override_mode', override_mode,
            'override_count', override_count,
            'affected_users', affected_users
          )
          order by capability_code, override_mode
        )
        from active_overrides
      ), '[]'::jsonb)
    ),
    (
      6,
      'beta_tester_capabilities',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'capability_code', capability_code,
            'capability_area', capability_area,
            'is_active', is_active
          )
          order by capability_code
        )
        from beta_tester_capabilities
      ), '[]'::jsonb)
    ),
    (
      7,
      'planned_delta',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'capability_code', capability_code,
            'current_capability_exists', current_capability_exists,
            'current_capability_active', current_capability_active,
            'current_role_grant', current_role_grant,
            'role_grant_after_expand', role_grant_after_expand
          )
          order by capability_code
        )
        from planned_delta
      ), '[]'::jsonb)
    )
) as diagnostic(block_order, diagnostic_block, payload)
order by diagnostic.block_order;

rollback;
