-- Focus-only Apply and legacy participant recovery behavior.
-- Run as postgres in a disposable database or dedicated DEV. Fixtures roll back.
begin;

create function pg_temp.ics_focus_item(
  p_uid text,
  p_change_id text,
  p_focus_contact_ids jsonb,
  p_attendee_email text default 'plain@example.invalid'
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'changeId', p_change_id,
    'category', 'new',
    'expected', null,
    'focusContactIds', p_focus_contact_ids,
    'event', pg_catalog.jsonb_build_object(
      'uid', p_uid,
      'start', '{"valueType":"date-time","localValue":"2026-10-12T13:00:00","timeZoneKind":"utc","timeZoneId":"UTC","instant":"2026-10-12T13:00:00.000Z","ambiguity":null}'::jsonb,
      'end', '{"valueType":"date-time","localValue":"2026-10-12T14:00:00","timeZoneKind":"utc","timeZoneId":"UTC","instant":"2026-10-12T14:00:00.000Z","ambiguity":null}'::jsonb,
      'summary', 'Focus fixture',
      'description', 'Fixture detail',
      'location', 'Fixture room',
      'organizer', pg_catalog.jsonb_build_object(
        'email', 'focus@example.invalid', 'commonName', null,
        'role', 'ORGANIZER', 'participationStatus', 'ACCEPTED'
      ),
      'attendees', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'email', p_attendee_email, 'commonName', null,
        'role', 'REQ-PARTICIPANT', 'participationStatus', 'ACCEPTED'
      )),
      'status', 'CONFIRMED',
      'method', 'PUBLISH',
      'recurrenceSignals', '{"rrule":false,"rdate":false,"exdate":false,"recurrenceId":false}'::jsonb
    )
  );
$$;

do $verify$
declare
  v_user uuid := pg_catalog.gen_random_uuid();
  v_focus_contact uuid := pg_catalog.gen_random_uuid();
  v_plain_contact uuid := pg_catalog.gen_random_uuid();
  v_ambiguous_contact uuid := pg_catalog.gen_random_uuid();
  v_result jsonb;
  v_interaction_id uuid;
  v_recovery_interaction uuid := pg_catalog.gen_random_uuid();
  v_google_interaction uuid := pg_catalog.gen_random_uuid();
  v_recovery_uid text := 'recovery-focus@example.invalid';
  v_recovery_external_id text;
begin
  insert into public.app_access_allowlist(email_normalized)
  values ('ics-focus-' || v_user::text || '@example.invalid');
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated', 'ics-focus-' || v_user::text || '@example.invalid', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()
  );
  update public.user_settings
  set setting_value = '2026-10-01'
  where user_id = v_user
    and setting_key = 'Fecha_Inicio_Networking';
  insert into public.contacts (id, user_id, display_name, networking_focus, is_active)
  values
    (v_focus_contact, v_user, 'Focus fixture', true, true),
    (v_plain_contact, v_user, 'Plain fixture', false, true),
    (v_ambiguous_contact, v_user, 'Ambiguous fixture', false, true);
  insert into public.contact_emails (user_id, contact_id, email, normalized_email)
  values
    (v_user, v_focus_contact, 'focus@example.invalid', 'focus@example.invalid'),
    (v_user, v_plain_contact, 'plain@example.invalid', 'plain@example.invalid');

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_focus_item(
      'focus-positive@example.invalid', 'ics-review:ics-0',
      pg_catalog.jsonb_build_array(v_focus_contact)
    )
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  if v_result->>'createdCount' is distinct from '1'
    or (select pg_catalog.count(*) from public.interaction_participants participant
        where participant.interaction_id = v_interaction_id and participant.contact_id = v_focus_contact) <> 1
    or (select pg_catalog.count(*) from public.interaction_participants participant
        where participant.interaction_id = v_interaction_id and participant.contact_id is null
          and participant.email_identity = 'plain@example.invalid') <> 1 then
    raise exception 'Focus Apply did not link Focus and preserve non-Focus participants';
  end if;

  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_focus_item(
      'focus-positive@example.invalid', 'ics-review:ics-1',
      pg_catalog.jsonb_build_array(v_focus_contact)
    )
  ));
  if v_result->>'unchangedCount' is distinct from '1'
    or (select pg_catalog.count(*) from public.interaction_participants participant
        where participant.interaction_id = v_interaction_id) <> 2 then
    raise exception 'Focus Apply exact reimport was not idempotent';
  end if;

  update public.contacts set networking_focus = false where id = v_focus_contact;
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_focus_item(
        'focus-stale@example.invalid', 'ics-review:ics-2',
        pg_catalog.jsonb_build_array(v_focus_contact)
      )
    ));
    raise exception 'Expected Focus eligibility conflict';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_STALE_FOCUS' then raise; end if;
  end;
  update public.contacts set networking_focus = true where id = v_focus_contact;

  insert into public.contact_emails (user_id, contact_id, email, normalized_email)
  values (v_user, v_ambiguous_contact, 'focus@example.invalid', 'focus@example.invalid');
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_focus_item(
        'focus-ambiguous@example.invalid', 'ics-review:ics-3',
        pg_catalog.jsonb_build_array(v_focus_contact)
      )
    ));
    raise exception 'Expected ambiguous Focus conflict';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_STALE_FOCUS' then raise; end if;
  end;
  delete from public.contact_emails where contact_id = v_ambiguous_contact;

  v_recovery_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_recovery_uid, 'UTF8'), 'sha256'), 'hex'
  );
  insert into public.interactions (
    id, user_id, provider, provider_event_id, interaction_type, direction,
    occurred_at, subject, source_detail, user_notes_raw, metadata
  ) values (
    v_recovery_interaction, v_user, 'icalendar', v_recovery_external_id, 'calendar', 'unknown',
    '2026-10-12T15:00:00Z', 'Recovery fixture', 'Preserved detail', 'Preserved note',
    pg_catalog.jsonb_build_object('ics_import', pg_catalog.jsonb_build_object('uid', v_recovery_uid))
  ), (
    v_google_interaction, v_user, 'google', 'google-fixture', 'calendar', 'unknown',
    '2026-10-12T15:00:00Z', 'Google fixture', '', '', '{}'::jsonb
  );
  insert into public.external_interaction_sources (
    user_id, interaction_id, provider, source_service, external_object_type,
    external_id, sync_status, prevent_reimport, is_active, metadata
  ) values (
    v_user, v_recovery_interaction, 'icalendar', 'ics_import', 'calendar_event',
    v_recovery_external_id, 'imported', false, true,
    pg_catalog.jsonb_build_object('ics_import', pg_catalog.jsonb_build_object('uid', v_recovery_uid))
  ), (
    v_user, v_google_interaction, 'google', 'calendar', 'calendar_event',
    'CALENDAR_google-fixture', 'synced', false, true, '{}'::jsonb
  );
  insert into public.interaction_participants (user_id, interaction_id, contact_id, email_identity, role)
  values
    (v_user, v_recovery_interaction, null, 'focus@example.invalid', 'ATTENDEE'),
    (v_user, v_google_interaction, null, 'focus@example.invalid', 'ATTENDEE');

  v_result := public.reconcile_ics_focus_participants_v1(false);
  if v_result->>'eligibleParticipants' is distinct from '1'
    or v_result->>'participantsLinked' is distinct from '0'
    or exists (select 1 from public.interaction_participants where interaction_id = v_recovery_interaction and contact_id is not null) then
    raise exception 'Focus recovery preview mutated data or returned incorrect counts';
  end if;
  v_result := public.reconcile_ics_focus_participants_v1(true);
  if v_result->>'participantsLinked' is distinct from '1'
    or not exists (select 1 from public.interaction_participants where interaction_id = v_recovery_interaction and contact_id = v_focus_contact)
    or exists (select 1 from public.interaction_participants where interaction_id = v_google_interaction and contact_id is not null)
    or (select user_notes_raw from public.interactions where id = v_recovery_interaction) is distinct from 'Preserved note'
    or (select source_detail from public.interactions where id = v_recovery_interaction) is distinct from 'Preserved detail' then
    raise exception 'Focus recovery changed provenance/content or failed to link the eligible .ics participant';
  end if;
  v_result := public.reconcile_ics_focus_participants_v1(true);
  if v_result->>'participantsLinked' is distinct from '0' then
    raise exception 'Focus recovery was not idempotent';
  end if;
end;
$verify$;

rollback;
