-- Transactional behavior verifier for SEC-GOOGLE-01.
-- All synthetic users, grants, connections and synchronized rows are rolled back.

begin;

do $verify$
declare
  v_beta_user uuid := gen_random_uuid();
  v_regular_user uuid := gen_random_uuid();
  v_beta_account uuid := gen_random_uuid();
  v_regular_account uuid := gen_random_uuid();
  v_first_contact uuid;
  v_repeated_contact uuid;
  v_allowed_external_id text := 'people/sec-google-allowed-' || gen_random_uuid()::text;
  v_denied_external_id text := 'people/sec-google-denied-' || gen_random_uuid()::text;
  v_calendar_external_id text := 'CALENDAR_SEC_GOOGLE_' || gen_random_uuid()::text;
  v_denied_calendar_external_id text := 'CALENDAR_SEC_GOOGLE_DENIED_' || gen_random_uuid()::text;
  v_calendar_result jsonb;
  v_repeated_calendar_result jsonb;
begin
  insert into public.app_access_allowlist(email_normalized)
  values
    ('sec-google-beta-' || v_beta_user::text || '@example.invalid'),
    ('sec-google-user-' || v_regular_user::text || '@example.invalid');

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (
      v_beta_user, 'authenticated', 'authenticated',
      'sec-google-beta-' || v_beta_user::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    ),
    (
      v_regular_user, 'authenticated', 'authenticated',
      'sec-google-user-' || v_regular_user::text || '@example.invalid', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    );

  insert into public.user_role_assignments (user_id, role_code, assignment_reason)
  values (v_beta_user, 'beta_tester', 'SEC-GOOGLE-01 verifier')
  on conflict do nothing;

  insert into public.connected_accounts (
    id, user_id, provider, account_email, scopes, capabilities, status,
    effective_scopes_verified_at, effective_scopes_verification_method
  ) values
    (
      v_beta_account, v_beta_user, 'google',
      'sec-google-beta-' || v_beta_user::text || '@example.invalid',
      array[
        'https://www.googleapis.com/auth/contacts.readonly',
        'https://www.googleapis.com/auth/calendar.readonly'
      ],
      '{"contacts_read":true,"gmail_read":false,"calendar_read":true}'::jsonb,
      'active', now(), 'sec_google_verifier'
    ),
    (
      v_regular_account, v_regular_user, 'google',
      'sec-google-user-' || v_regular_user::text || '@example.invalid',
      array['https://www.googleapis.com/auth/contacts.readonly'],
      '{"contacts_read":true,"gmail_read":false,"calendar_read":false}'::jsonb,
      'active', now(), 'sec_google_verifier'
    );

  perform pg_catalog.set_config('request.jwt.claim.sub', v_regular_user::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_regular_user, 'role', 'authenticated')::text,
    true
  );

  insert into public.user_capability_overrides (
    user_id, capability_code, override_mode, override_reason
  ) values (
    v_regular_user, 'connectors.google.use', 'grant', 'SEC-GOOGLE-01 verifier'
  );

  if public.current_user_can_start_connected_oauth_v1('google') then
    raise exception 'Positive override unexpectedly enabled Google rollout';
  end if;
  if public.current_user_can_sync_connected_account_v1(v_regular_account, 'contacts') then
    raise exception 'Positive rollout override unexpectedly enabled connected sync';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_beta_user::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_beta_user, 'role', 'authenticated')::text,
    true
  );

  if not public.current_user_can_start_connected_oauth_v1('google') then
    raise exception 'Active beta_tester cannot start Google data OAuth';
  end if;
  if not public.current_user_can_sync_connected_account_v1(v_beta_account, 'contacts') then
    raise exception 'Eligible beta_tester cannot sync authorized contacts';
  end if;
  if public.current_user_can_sync_connected_account_v1(v_beta_account, 'email') then
    raise exception 'Missing Gmail provider scope did not block email sync';
  end if;
  if not public.current_user_can_sync_connected_account_v1(v_beta_account, 'calendar') then
    raise exception 'Eligible beta_tester cannot sync authorized calendar';
  end if;
  if public.current_user_can_sync_connected_account_v1(v_regular_account, 'contacts') then
    raise exception 'Cross-user connected account was accepted';
  end if;

  update public.app_capabilities
  set is_active = false
  where capability_code = 'connectors.google.use';
  if public.current_user_can_start_connected_oauth_v1('google')
     or public.current_user_can_sync_connected_account_v1(v_beta_account, 'contacts') then
    raise exception 'Inactive rollout capability did not fail closed';
  end if;
  update public.app_capabilities
  set is_active = true
  where capability_code = 'connectors.google.use';

  update public.app_capabilities
  set is_active = false
  where capability_code = 'contacts.sync_external';
  if public.current_user_can_sync_connected_account_v1(v_beta_account, 'contacts') then
    raise exception 'Inactive operational capability did not fail closed';
  end if;
  update public.app_capabilities
  set is_active = true
  where capability_code = 'contacts.sync_external';

  v_first_contact := public.apply_google_contact_sync_change_v1(
    v_beta_account,
    jsonb_build_object(
      'changeId', 'sec-google-first',
      'changeType', 'new',
      'contact', jsonb_build_object('displayName', 'SEC Google allowed'),
      'externalIds', jsonb_build_array(jsonb_build_object(
        'externalId', v_allowed_external_id,
        'metadata', '{}'::jsonb
      )),
      'emails', '[]'::jsonb,
      'phones', '[]'::jsonb,
      'snapshots', '[]'::jsonb,
      'mergeSourceContactIds', '[]'::jsonb
    )
  );
  if not exists (
    select 1 from public.contacts contact
    where contact.id = v_first_contact and contact.user_id = v_beta_user
  ) then
    raise exception 'Authorized Google contact write did not persist its owned contact';
  end if;

  v_repeated_contact := public.apply_google_contact_sync_change_v1(
    v_beta_account,
    jsonb_build_object(
      'changeId', 'sec-google-first-retry',
      'changeType', 'new',
      'contact', jsonb_build_object('displayName', 'SEC Google allowed'),
      'externalIds', jsonb_build_array(jsonb_build_object(
        'externalId', v_allowed_external_id,
        'metadata', '{}'::jsonb
      )),
      'emails', '[]'::jsonb,
      'phones', '[]'::jsonb,
      'snapshots', '[]'::jsonb,
      'mergeSourceContactIds', '[]'::jsonb
    )
  );
  if v_repeated_contact <> v_first_contact
     or (select count(*) from public.contacts contact
         where contact.user_id = v_beta_user
           and contact.display_name = 'SEC Google allowed') <> 1 then
    raise exception 'Repeated Google contact identity was not idempotent';
  end if;

  v_calendar_result := public.apply_google_interaction_sync_v1(
    v_beta_account,
    jsonb_build_object(
      'sourceService', 'calendar',
      'externalObjectType', 'calendar_event',
      'externalId', v_calendar_external_id,
      'interactionType', 'calendar',
      'direction', 'internal',
      'occurredAt', now(),
      'subject', 'SEC Google calendar allowed',
      'participants', jsonb_build_array(jsonb_build_object(
        'email', 'participant@example.invalid',
        'role', 'ATTENDEE'
      )),
      'metadata', '{}'::jsonb
    )
  );
  v_repeated_calendar_result := public.apply_google_interaction_sync_v1(
    v_beta_account,
    jsonb_build_object(
      'sourceService', 'calendar',
      'externalObjectType', 'calendar_event',
      'externalId', v_calendar_external_id,
      'interactionType', 'calendar',
      'direction', 'internal',
      'occurredAt', now(),
      'subject', 'SEC Google calendar allowed',
      'participants', jsonb_build_array(jsonb_build_object(
        'email', 'participant@example.invalid',
        'role', 'ATTENDEE'
      )),
      'metadata', '{}'::jsonb
    )
  );
  if v_calendar_result->>'interaction_id' is distinct from v_repeated_calendar_result->>'interaction_id'
     or (select count(*) from public.external_interaction_sources source
         where source.user_id = v_beta_user
           and source.provider = 'google'
           and source.source_service = 'calendar'
           and source.external_id = v_calendar_external_id
           and source.is_active = true) <> 1 then
    raise exception 'Repeated Google interaction identity was not idempotent';
  end if;

  insert into public.user_capability_overrides (
    user_id, capability_code, override_mode, override_reason
  ) values (
    v_beta_user, 'interactions.sync_calendar', 'deny', 'SEC-GOOGLE-01 verifier'
  );
  begin
    perform public.apply_google_interaction_sync_v1(
      v_beta_account,
      jsonb_build_object(
        'sourceService', 'calendar',
        'externalObjectType', 'calendar_event',
        'externalId', v_denied_calendar_external_id,
        'interactionType', 'calendar',
        'direction', 'internal',
        'occurredAt', now(),
        'subject', 'SEC Google calendar denied',
        'participants', '[]'::jsonb,
        'metadata', '{}'::jsonb
      )
    );
    raise exception 'Expected revoked Google calendar sync to fail';
  exception
    when sqlstate '42501' then null;
  end;
  if exists (
    select 1 from public.external_interaction_sources source
    where source.user_id = v_beta_user
      and source.provider = 'google'
      and source.source_service = 'calendar'
      and source.external_id = v_denied_calendar_external_id
  ) then
    raise exception 'Revoked Google interaction write persisted partial provenance';
  end if;

  insert into public.user_capability_overrides (
    user_id, capability_code, override_mode, override_reason
  ) values (
    v_beta_user, 'contacts.sync_external', 'deny', 'SEC-GOOGLE-01 verifier'
  );

  if public.current_user_can_sync_connected_account_v1(v_beta_account, 'contacts') then
    raise exception 'Active operational deny did not revoke contact sync';
  end if;
  begin
    perform public.apply_google_contact_sync_change_v1(
      v_beta_account,
      jsonb_build_object(
        'changeId', 'sec-google-denied',
        'changeType', 'new',
        'contact', jsonb_build_object('displayName', 'SEC Google denied'),
        'externalIds', jsonb_build_array(jsonb_build_object(
          'externalId', v_denied_external_id,
          'metadata', '{}'::jsonb
        )),
        'emails', '[]'::jsonb,
        'phones', '[]'::jsonb,
        'snapshots', '[]'::jsonb,
        'mergeSourceContactIds', '[]'::jsonb
      )
    );
    raise exception 'Expected revoked Google contact sync to fail';
  exception
    when sqlstate '42501' then null;
  end;
  if exists (
    select 1 from public.external_contact_ids external_id
    where external_id.user_id = v_beta_user
      and external_id.provider = 'google'
      and external_id.external_id = v_denied_external_id
  ) then
    raise exception 'Revoked Google write persisted partial provenance';
  end if;

  insert into public.user_capability_overrides (
    user_id, capability_code, override_mode, override_reason
  ) values (
    v_beta_user, 'connectors.google.use', 'deny', 'SEC-GOOGLE-01 verifier'
  );
  if public.current_user_can_start_connected_oauth_v1('google')
     or public.current_user_can_sync_connected_account_v1(v_beta_account, 'calendar') then
    raise exception 'Active rollout deny did not block OAuth and existing-account sync';
  end if;
end;
$verify$;

rollback;
