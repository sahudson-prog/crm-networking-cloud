-- Runtime behavior for the A3.5 networking-start boundary.
-- Run as postgres in a disposable database or dedicated DEV. Fixtures roll back.
begin;

create function pg_temp.ics_networking_start_item(
  p_uid text,
  p_change_id text,
  p_event_date date,
  p_focus_contact_id uuid,
  p_local_value text default null,
  p_instant text default null,
  p_time_zone_kind text default 'utc',
  p_time_zone_id text default 'UTC'
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'changeId', p_change_id,
    'category', 'new',
    'expected', null,
    'focusContactIds', pg_catalog.jsonb_build_array(p_focus_contact_id),
    'event', pg_catalog.jsonb_build_object(
      'uid', p_uid,
      'start', pg_catalog.jsonb_build_object(
        'valueType', 'date-time',
        'localValue', coalesce(p_local_value, pg_catalog.to_char(p_event_date, 'YYYY-MM-DD') || 'T13:00:00'),
        'timeZoneKind', p_time_zone_kind,
        'timeZoneId', p_time_zone_id,
        'instant', coalesce(p_instant, pg_catalog.to_char(p_event_date, 'YYYY-MM-DD') || 'T13:00:00.000Z'),
        'ambiguity', null
      ),
      'end', pg_catalog.jsonb_build_object(
        'valueType', 'date-time',
        'localValue', pg_catalog.to_char(p_event_date, 'YYYY-MM-DD') || 'T14:00:00',
        'timeZoneKind', 'utc',
        'timeZoneId', 'UTC',
        'instant', pg_catalog.to_char(p_event_date, 'YYYY-MM-DD') || 'T14:00:00.000Z',
        'ambiguity', null
      ),
      'summary', 'Networking start fixture',
      'description', 'Fixture detail',
      'location', 'Fixture room',
      'organizer', pg_catalog.jsonb_build_object(
        'email', 'focus@example.invalid',
        'commonName', null,
        'role', 'ORGANIZER',
        'participationStatus', 'ACCEPTED'
      ),
      'attendees', '[]'::jsonb,
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
  v_utc_today date := (pg_catalog.clock_timestamp() at time zone 'UTC')::date;
  v_minimum_date date := ((pg_catalog.clock_timestamp() at time zone 'UTC')::date - interval '12 months')::date;
  v_result jsonb;
  v_interaction_id uuid;
  v_before_rejection_counts bigint[];
begin
  if ('2024-02-29'::date - interval '12 months')::date is distinct from '2023-02-28'::date
    or ('2026-03-31'::date - interval '12 months')::date is distinct from '2025-03-31'::date
    or ('2026-01-01'::date - interval '12 months')::date is distinct from '2025-01-01'::date then
    raise exception 'Calendar-month networking boundary changed';
  end if;

  insert into public.app_access_allowlist(email_normalized)
  values ('ics-networking-start-' || v_user::text || '@example.invalid');
  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_user, 'authenticated', 'authenticated',
    'ics-networking-start-' || v_user::text || '@example.invalid', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    pg_catalog.now(), pg_catalog.now()
  );
  insert into public.contacts (id, user_id, display_name, networking_focus, is_active)
  values (v_focus_contact, v_user, 'Networking start Focus fixture', true, true);
  insert into public.contact_emails (user_id, contact_id, email, normalized_email, is_primary)
  values (v_user, v_focus_contact, 'focus@example.invalid', 'focus@example.invalid', true);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_networking_start_item(
        'missing-setting@example.invalid', 'ics-review:ics-0', v_utc_today, v_focus_contact
      )
    ));
    raise exception 'Expected missing networking start rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_NETWORKING_START_REQUIRED' then raise; end if;
  end;

  insert into public.user_settings (user_id, setting_key, setting_value)
  values (
    v_user, 'Fecha_Inicio_Networking',
    pg_catalog.to_char(v_utc_today + 1, 'YYYY-MM-DD')
  );
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_networking_start_item(
        'future-setting@example.invalid', 'ics-review:ics-1', v_utc_today, v_focus_contact
      )
    ));
    raise exception 'Expected future networking start rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_NETWORKING_START_REQUIRED' then raise; end if;
  end;

  update public.user_settings
  set setting_value = pg_catalog.to_char(v_minimum_date - 1, 'YYYY-MM-DD')
  where user_id = v_user and setting_key = 'Fecha_Inicio_Networking';
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_networking_start_item(
        'old-setting@example.invalid', 'ics-review:ics-2', v_utc_today, v_focus_contact
      )
    ));
    raise exception 'Expected old networking start rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_NETWORKING_START_REQUIRED' then raise; end if;
  end;

  update public.user_settings
  set setting_value = pg_catalog.to_char(v_minimum_date, 'DD/MM/YYYY')
  where user_id = v_user and setting_key = 'Fecha_Inicio_Networking';
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_networking_start_item(
      'inclusive-boundary@example.invalid', 'ics-review:ics-3', v_minimum_date, v_focus_contact
    )
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  if v_result->>'createdCount' is distinct from '1'
    or not exists (
      select 1 from public.interactions interaction
      where interaction.id = v_interaction_id and interaction.user_id = v_user
    ) then
    raise exception 'Inclusive networking start did not import';
  end if;

  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_networking_start_item(
      'utc-civil-offset@example.invalid',
      'ics-review:ics-4',
      v_minimum_date,
      v_focus_contact,
      pg_catalog.to_char(v_minimum_date - 1, 'YYYY-MM-DD') || 'T21:30:00',
      pg_catalog.to_char(v_minimum_date - 1, 'YYYY-MM-DD') || 'T21:30:00-03:00',
      'tzid',
      'America/Santiago'
    )
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  if v_result->>'createdCount' is distinct from '1'
    or not exists (
      select 1 from public.interactions interaction
      where interaction.id = v_interaction_id
        and interaction.user_id = v_user
        and interaction.occurred_at = (
          pg_catalog.to_char(v_minimum_date - 1, 'YYYY-MM-DD') || 'T21:30:00-03:00'
        )::timestamptz
    ) then
    raise exception 'UTC civil boundary rejected a valid offset instant';
  end if;

  v_before_rejection_counts := array[
    (select pg_catalog.count(*) from public.interactions interaction where interaction.user_id = v_user),
    (select pg_catalog.count(*) from public.external_interaction_sources source where source.user_id = v_user),
    (select pg_catalog.count(*) from public.interaction_participants participant where participant.user_id = v_user),
    (select pg_catalog.count(*) from public.action_invocations invocation where invocation.user_id = v_user),
    (select pg_catalog.count(*) from public.audit_log audit where audit.user_id = v_user)
  ];

  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_networking_start_item(
        'before-boundary@example.invalid', 'ics-review:ics-5', v_minimum_date - 1, v_focus_contact
      )
    ));
    raise exception 'Expected event-before-networking-start rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BEFORE_NETWORKING_START' then raise; end if;
  end;

  if v_before_rejection_counts is distinct from array[
    (select pg_catalog.count(*) from public.interactions interaction where interaction.user_id = v_user),
    (select pg_catalog.count(*) from public.external_interaction_sources source where source.user_id = v_user),
    (select pg_catalog.count(*) from public.interaction_participants participant where participant.user_id = v_user),
    (select pg_catalog.count(*) from public.action_invocations invocation where invocation.user_id = v_user),
    (select pg_catalog.count(*) from public.audit_log audit where audit.user_id = v_user)
  ] then
    raise exception 'Rejected networking-start fixture persisted data';
  end if;

  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_networking_start_item(
        'contradictory-local-date@example.invalid',
        'ics-review:ics-6',
        v_minimum_date,
        v_focus_contact,
        pg_catalog.to_char(v_minimum_date, 'YYYY-MM-DD') || 'T00:30:00',
        pg_catalog.to_char(v_minimum_date - 1, 'YYYY-MM-DD') || 'T23:30:00.000Z'
      )
    ));
    raise exception 'Expected UTC instant before networking-start rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BEFORE_NETWORKING_START' then raise; end if;
  end;

  if v_before_rejection_counts is distinct from array[
    (select pg_catalog.count(*) from public.interactions interaction where interaction.user_id = v_user),
    (select pg_catalog.count(*) from public.external_interaction_sources source where source.user_id = v_user),
    (select pg_catalog.count(*) from public.interaction_participants participant where participant.user_id = v_user),
    (select pg_catalog.count(*) from public.action_invocations invocation where invocation.user_id = v_user),
    (select pg_catalog.count(*) from public.audit_log audit where audit.user_id = v_user)
  ] then
    raise exception 'Contradictory networking-start fixture persisted data';
  end if;
end;
$verify$;

rollback;
