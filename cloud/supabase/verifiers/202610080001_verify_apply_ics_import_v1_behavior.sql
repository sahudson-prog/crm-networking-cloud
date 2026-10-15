-- Functional security and atomicity checks for apply_ics_import_v1.
-- Run the entire script in a disposable database or dedicated DEV as postgres.
-- All fixtures, temporary functions, trigger DDL and session claims are rolled back.
-- This is a single-session behavior check, not a concurrency or role-ACL test.

begin;

create function pg_temp.ics_apply_item(
  p_uid text,
  p_change_id text,
  p_category text default 'new',
  p_expected jsonb default 'null'::jsonb,
  p_summary text default 'Fixture meeting',
  p_description text default 'Fixture source detail',
  p_start jsonb default '{"valueType":"date-time","localValue":"2026-10-08T13:00:00","timeZoneKind":"utc","timeZoneId":"UTC","instant":"2026-10-08T13:00:00.000Z","ambiguity":null}'::jsonb,
  p_end jsonb default '{"valueType":"date-time","localValue":"2026-10-08T14:00:00","timeZoneKind":"utc","timeZoneId":"UTC","instant":"2026-10-08T14:00:00.000Z","ambiguity":null}'::jsonb
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'changeId', p_change_id,
    'category', p_category,
    'expected', p_expected,
    'focusContactIds', coalesce((
      select pg_catalog.jsonb_agg(resolved.contact_id order by resolved.contact_id)
      from (
        select distinct matched_email.contact_id
        from (
        select (pg_catalog.array_agg(contact.id order by contact.id))[1] as contact_id
        from public.contact_emails email
        join public.contacts contact
          on contact.id = email.contact_id
         and contact.user_id = auth.uid()
         and contact.is_active
        where email.user_id = auth.uid()
          and pg_catalog.lower(pg_catalog.btrim(email.normalized_email)) in (
            'organizer@example.invalid', 'attendee@example.invalid'
          )
        group by pg_catalog.lower(pg_catalog.btrim(email.normalized_email))
        having pg_catalog.count(distinct contact.id) = 1
          and pg_catalog.bool_and(contact.networking_focus)
        ) matched_email
      ) resolved
    ), '[]'::jsonb),
    'event', pg_catalog.jsonb_build_object(
      'uid', p_uid,
      'start', p_start,
      'end', p_end,
      'summary', p_summary,
      'description', p_description,
      'location', 'Fixture room',
      'organizer', pg_catalog.jsonb_build_object(
        'email', 'organizer@example.invalid',
        'commonName', 'Fixture organizer',
        'role', 'organizer',
        'participationStatus', 'ACCEPTED'
      ),
      'attendees', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'email', 'attendee@example.invalid',
        'commonName', 'Fixture attendee',
        'role', 'REQ-PARTICIPANT',
        'participationStatus', 'ACCEPTED'
      )),
      'status', 'CONFIRMED',
      'method', 'PUBLISH',
      'recurrenceSignals', pg_catalog.jsonb_build_object(
        'rrule', false,
        'rdate', false,
        'exdate', false,
        'recurrenceId', false
      )
    )
  );
$$;

create function pg_temp.force_ics_apply_rollback()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'interaction.import_ics.apply' and new.user_id = auth.uid() then
    raise exception 'ics apply verifier forced rollback';
  end if;
  return new;
end;
$$;

do $verify$
declare
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_user_no_access uuid := pg_catalog.gen_random_uuid();
  v_contact_a uuid := pg_catalog.gen_random_uuid();
  v_contact_b uuid := pg_catalog.gen_random_uuid();
  v_contact_no_access uuid := pg_catalog.gen_random_uuid();
  v_interaction_id uuid;
  v_source_id uuid;
  v_source_hash text;
  v_interaction_updated_at timestamptz;
  v_source_updated_at timestamptz;
  v_result jsonb;
  v_expected jsonb;
  v_item jsonb;
  v_external_id text;
  v_google_interaction uuid := pg_catalog.gen_random_uuid();
  v_dismissal_flag text;
  v_before_rollback_counts bigint[];
begin
  insert into public.app_access_allowlist(email_normalized)
  values
    ('ics-apply-a-' || v_user_a::text || '@example.invalid'),
    ('ics-apply-b-' || v_user_b::text || '@example.invalid'),
    ('ics-apply-no-access-' || v_user_no_access::text || '@example.invalid');

  insert into auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_user_a, 'authenticated', 'authenticated', 'ics-apply-a-' || v_user_a::text || '@example.invalid', pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()),
    (v_user_b, 'authenticated', 'authenticated', 'ics-apply-b-' || v_user_b::text || '@example.invalid', pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now()),
    (v_user_no_access, 'authenticated', 'authenticated', 'ics-apply-no-access-' || v_user_no_access::text || '@example.invalid', pg_catalog.now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.now(), pg_catalog.now());

  update public.user_settings
  set setting_value = '2026-10-01'
  where user_id in (v_user_a, v_user_b, v_user_no_access)
    and setting_key = 'Fecha_Inicio_Networking';

  insert into public.contacts (id, user_id, display_name, networking_focus, is_active)
  values
    (v_contact_a, v_user_a, 'Fixture Focus A', true, true),
    (v_contact_b, v_user_b, 'Fixture Focus B', true, true),
    (v_contact_no_access, v_user_no_access, 'Fixture Focus denied', true, true);
  insert into public.contact_emails (user_id, contact_id, email, normalized_email, is_primary)
  values
    (v_user_a, v_contact_a, 'organizer@example.invalid', 'organizer@example.invalid', true),
    (v_user_a, v_contact_a, 'attendee@example.invalid', 'attendee@example.invalid', false),
    (v_user_b, v_contact_b, 'organizer@example.invalid', 'organizer@example.invalid', true),
    (v_user_b, v_contact_b, 'attendee@example.invalid', 'attendee@example.invalid', false),
    (v_user_no_access, v_contact_no_access, 'organizer@example.invalid', 'organizer@example.invalid', true),
    (v_user_no_access, v_contact_no_access, 'attendee@example.invalid', 'attendee@example.invalid', false);

  update public.user_access_profiles as access_profile
  set account_status = 'paused'
  where access_profile.user_id = v_user_no_access;
  if not found then
    raise exception 'Missing access profile for paused fixture user';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('anon@example.invalid', 'ics-review:ics-0')
    ));
    raise exception 'Expected unauthenticated Apply failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_NOT_AUTHENTICATED' then
      raise;
    end if;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_no_access::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_no_access, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('denied@example.invalid', 'ics-review:ics-0')
    ));
    raise exception 'Expected access-denied Apply failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_ACCESS_DENIED' then
      raise;
    end if;
  end;

  -- The same exact UID belongs independently to each authenticated owner.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_b, 'role', 'authenticated')::text,
    true
  );
  perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('shared-case@example.invalid', 'ics-review:ics-0')
  ));

  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_a, 'role', 'authenticated')::text,
    true
  );
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('shared-case@example.invalid', 'ics-review:ics-0')
  ));
  v_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('shared-case@example.invalid', 'UTF8'), 'sha256'), 'hex'
  );
  if v_result->>'createdCount' is distinct from '1'
    or (select pg_catalog.count(distinct source.user_id) from public.external_interaction_sources source
        where source.provider = 'icalendar'
          and source.source_service = 'ics_import'
          and source.external_id = v_external_id
          and source.is_active) <> 2 then
    raise exception 'Apply did not isolate identical UIDs by owner';
  end if;

  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  if not exists (
    select 1 from public.interactions interaction
    where interaction.id = v_interaction_id
      and interaction.user_id = v_user_a
      and interaction.user_notes_raw = ''
      and interaction.source_detail = 'Fixture source detail'
  ) or (select pg_catalog.count(*) from public.interaction_participants participant
        where participant.user_id = v_user_a
          and participant.interaction_id = v_interaction_id
          and participant.contact_id = v_contact_a) <> 2 then
    raise exception 'Apply did not create the interaction and Focus participant links correctly';
  end if;

  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('shared-case@example.invalid', 'ics-review:ics-0')
  ));
  if v_result->>'unchangedCount' is distinct from '1'
    or (select pg_catalog.count(*) from public.interactions interaction
        where interaction.user_id = v_user_a and interaction.provider_event_id like 'ics_uid_sha256_%') <> 1 then
    raise exception 'Exact reimport was not idempotent';
  end if;

  -- Case-sensitive UIDs must remain independent.
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('Shared-Case@example.invalid', 'ics-review:ics-1')
  ));
  if v_result->>'createdCount' is distinct from '1' then
    raise exception 'UID casing was not preserved';
  end if;

  select source.id, source.content_hash, source.updated_at, interaction.updated_at
  into strict v_source_id, v_source_hash, v_source_updated_at, v_interaction_updated_at
  from public.external_interaction_sources source
  join public.interactions interaction on interaction.id = source.interaction_id
  where source.user_id = v_user_a and source.interaction_id = v_interaction_id and source.is_active;

  update public.interactions as interaction
  set user_notes_raw = 'Private fixture note'
  where interaction.id = v_interaction_id;
  select interaction.updated_at into strict v_interaction_updated_at
  from public.interactions interaction where interaction.id = v_interaction_id;
  v_expected := pg_catalog.jsonb_build_object(
    'interactionId', v_interaction_id,
    'interactionUpdatedAt', v_interaction_updated_at,
    'sourceContentHash', v_source_hash,
    'sourceUpdatedAt', v_source_updated_at
  );
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item(
      'shared-case@example.invalid', 'ics-review:ics-0', 'modified', v_expected,
      'Updated fixture meeting', 'Updated source detail'
    )
  ));
  if v_result->>'updatedCount' is distinct from '1'
    or not exists (
      select 1 from public.interactions interaction
      where interaction.id = v_interaction_id
        and interaction.subject = 'Updated fixture meeting'
        and interaction.source_detail = 'Updated source detail'
        and interaction.user_notes_raw = 'Private fixture note'
    ) then
    raise exception 'Modified Apply did not preserve user notes';
  end if;

  -- A stale token must fail before overwriting current content.
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item(
        'shared-case@example.invalid', 'ics-review:ics-0', 'modified', v_expected,
        'Stale overwrite', 'Stale source detail'
      )
    ));
    raise exception 'Expected stale Apply failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_STALE_REVIEW' then
      raise;
    end if;
  end;

  -- A heuristic duplicate selected explicitly creates an independent ICS interaction.
  insert into public.interactions (
    id, user_id, provider, provider_event_id, interaction_type, direction,
    occurred_at, subject, source_detail, user_notes_raw
  ) values (
    v_google_interaction, v_user_a, 'google', 'google-event-fixture', 'calendar', 'unknown',
    '2026-10-08T13:00:00Z', 'Fixture meeting', 'Google detail', 'Google note'
  );
  insert into public.external_interaction_sources (
    user_id, interaction_id, provider, source_service, external_object_type,
    external_id, sync_status, is_active
  ) values (
    v_user_a, v_google_interaction, 'google', 'calendar', 'calendar_event',
    'CALENDAR_google-event-fixture', 'synced', true
  );
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('heuristic-duplicate@example.invalid', 'ics-review:ics-2', 'possible_duplicate')
  ));
  if v_result->>'createdCount' is distinct from '1'
    or not exists (
      select 1 from public.interactions interaction
      where interaction.id = v_google_interaction
        and interaction.provider = 'google'
        and interaction.user_notes_raw = 'Google note'
    ) then
    raise exception 'Potential duplicate Apply modified a Google interaction';
  end if;

  -- V1 rejects all-day events even when a client bypasses parser/review eligibility.
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item(
        'all-day@example.invalid', 'ics-review:ics-3', 'new', 'null'::jsonb,
        'All day fixture', '',
        '{"valueType":"date","localValue":"2026-10-08","timeZoneKind":"date","timeZoneId":null,"instant":null,"ambiguity":null}'::jsonb,
        '{"valueType":"date","localValue":"2026-10-09","timeZoneKind":"date","timeZoneId":null,"instant":null,"ambiguity":null}'::jsonb
      )
    ));
    raise exception 'Expected all-day rejection';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_INVALID_PAYLOAD: all-day event is not supported' then
      raise;
    end if;
  end;
  if exists (
    select 1 from public.external_interaction_sources source
    where source.user_id = v_user_a
      and source.provider = 'icalendar'
      and source.source_service = 'ics_import'
      and source.metadata->'ics_import'->>'uid' = 'all-day@example.invalid'
  ) then
    raise exception 'Rejected all-day fixture persisted data';
  end if;

  -- Inactive identities stay blocked instead of being silently reactivated.
  v_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('inactive@example.invalid', 'UTF8'), 'sha256'), 'hex'
  );
  insert into public.interactions (
    user_id, provider, provider_event_id, interaction_type, direction, occurred_at, user_notes_raw
  ) values (
    v_user_a, 'icalendar', v_external_id, 'calendar', 'unknown', '2026-10-08T13:00:00Z', ''
  ) returning id into v_interaction_id;
  insert into public.external_interaction_sources (
    user_id, interaction_id, provider, source_service, external_object_type,
    external_id, sync_status, is_active, metadata
  ) values (
    v_user_a, v_interaction_id, 'icalendar', 'ics_import', 'calendar_event',
    v_external_id, 'ignored', false,
    pg_catalog.jsonb_build_object('ics_import', pg_catalog.jsonb_build_object('uid', 'inactive@example.invalid'))
  );
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('inactive@example.invalid', 'ics-review:ics-4')
    ));
    raise exception 'Expected inactive identity failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BLOCKED_IDENTITY' then
      raise;
    end if;
  end;

  -- Operational interaction dismissal lives in metadata on legacy schemas.
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('dismissed-metadata@example.invalid', 'ics-review:ics-5')
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  foreach v_dismissal_flag in array array['deleted', 'dismissed']::text[]
  loop
    update public.interactions as interaction
    set metadata = COALESCE(interaction.metadata, '{}'::jsonb)
      || '{"deleted":false,"dismissed":false}'::jsonb
      || pg_catalog.jsonb_build_object(v_dismissal_flag, true)
    where interaction.id = v_interaction_id and interaction.user_id = v_user_a;
    if not found then
      raise exception 'Missing dismissed interaction fixture';
    end if;
    begin
      perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
        pg_temp.ics_apply_item('dismissed-metadata@example.invalid', 'ics-review:ics-5')
      ));
      raise exception 'Expected dismissed interaction failure';
    exception when raise_exception then
      if sqlerrm <> 'ICS_IMPORT_BLOCKED_IDENTITY' then
        raise;
      end if;
    end;
  end loop;

  -- Interaction-level prevent_reimport is also persisted in metadata.
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('interaction-prevent@example.invalid', 'ics-review:ics-6')
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  update public.interactions as interaction
  set metadata = COALESCE(interaction.metadata, '{}'::jsonb)
    || '{"prevent_reimport":true}'::jsonb
  where interaction.id = v_interaction_id and interaction.user_id = v_user_a;
  if not found then
    raise exception 'Missing interaction prevent-reimport fixture';
  end if;
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('interaction-prevent@example.invalid', 'ics-review:ics-6')
    ));
    raise exception 'Expected interaction prevent-reimport failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BLOCKED_IDENTITY' then
      raise;
    end if;
  end;

  -- Source-level prevent_reimport remains authoritative for the external identity.
  v_result := public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
    pg_temp.ics_apply_item('source-prevent@example.invalid', 'ics-review:ics-7')
  ));
  v_interaction_id := (v_result->'items'->0->>'interactionId')::uuid;
  update public.external_interaction_sources as source
  set prevent_reimport = true
  where source.user_id = v_user_a
    and source.interaction_id = v_interaction_id
    and source.provider = 'icalendar'
    and source.source_service = 'ics_import'
    and source.is_active;
  if not found then
    raise exception 'Missing source prevent-reimport fixture';
  end if;
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('source-prevent@example.invalid', 'ics-review:ics-7')
    ));
    raise exception 'Expected source prevent-reimport failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BLOCKED_IDENTITY' then
      raise;
    end if;
  end;

  -- Even an inconsistent ICS source cannot make Apply rewrite a manual interaction.
  v_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('protected-manual@example.invalid', 'UTF8'), 'sha256'), 'hex'
  );
  insert into public.interactions (
    user_id, provider, provider_event_id, interaction_type, direction,
    occurred_at, subject, user_notes_raw
  ) values (
    v_user_a, null, null, 'manual', 'unknown', '2026-10-08T13:00:00Z',
    'Protected manual fixture', 'Manual note'
  ) returning id into v_interaction_id;
  insert into public.external_interaction_sources (
    user_id, interaction_id, provider, source_service, external_object_type,
    external_id, content_hash, sync_status, is_active, metadata
  ) values (
    v_user_a, v_interaction_id, 'icalendar', 'ics_import', 'calendar_event',
    v_external_id, pg_catalog.repeat('a', 64), 'imported', true,
    pg_catalog.jsonb_build_object('ics_import', pg_catalog.jsonb_build_object('uid', 'protected-manual@example.invalid'))
  );
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('protected-manual@example.invalid', 'ics-review:ics-8')
    ));
    raise exception 'Expected protected manual interaction failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_BLOCKED_IDENTITY' then
      raise;
    end if;
  end;
  if not exists (
    select 1 from public.interactions interaction
    where interaction.id = v_interaction_id
      and interaction.interaction_type = 'manual'
      and interaction.user_notes_raw = 'Manual note'
  ) then
    raise exception 'Apply modified a protected manual interaction';
  end if;

  -- Reject ownership/provenance fields instead of trusting client-supplied IDs.
  v_item := pg_temp.ics_apply_item('forged@example.invalid', 'ics-review:ics-9')
    || pg_catalog.jsonb_build_object('user_id', v_user_b);
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(v_item));
    raise exception 'Expected forged ownership failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_INVALID_PAYLOAD: invalid item shape' then
      raise;
    end if;
  end;

  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('repeated@example.invalid', 'ics-review:ics-10'),
      pg_temp.ics_apply_item('repeated@example.invalid', 'ics-review:ics-11')
    ));
    raise exception 'Expected duplicate UID batch failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_INVALID_PAYLOAD: duplicate UID in batch' then
      raise;
    end if;
  end;

  -- A late audit failure must roll back every table written by Apply.
  v_before_rollback_counts := array[
    (select pg_catalog.count(*) from public.interactions interaction where interaction.user_id = v_user_a),
    (select pg_catalog.count(*) from public.external_interaction_sources source where source.user_id = v_user_a),
    (select pg_catalog.count(*) from public.interaction_participants participant where participant.user_id = v_user_a),
    (select pg_catalog.count(*) from public.action_invocations invocation where invocation.user_id = v_user_a),
    (select pg_catalog.count(*) from public.audit_log audit where audit.user_id = v_user_a)
  ];
  execute 'create trigger verify_force_ics_apply_rollback before insert on public.audit_log '
    || 'for each row execute function pg_temp.force_ics_apply_rollback()';
  begin
    perform public.apply_ics_import_v1(pg_catalog.jsonb_build_array(
      pg_temp.ics_apply_item('rollback@example.invalid', 'ics-review:ics-12')
    ));
    raise exception 'Expected forced Apply rollback';
  exception when raise_exception then
    if sqlerrm <> 'ics apply verifier forced rollback' then
      raise;
    end if;
  end;
  execute 'drop trigger verify_force_ics_apply_rollback on public.audit_log';
  v_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to('rollback@example.invalid', 'UTF8'), 'sha256'), 'hex'
  );
  if exists (
    select 1 from public.external_interaction_sources source
    where source.user_id = v_user_a and source.external_id = v_external_id
  ) or v_before_rollback_counts is distinct from array[
    (select pg_catalog.count(*) from public.interactions interaction where interaction.user_id = v_user_a),
    (select pg_catalog.count(*) from public.external_interaction_sources source where source.user_id = v_user_a),
    (select pg_catalog.count(*) from public.interaction_participants participant where participant.user_id = v_user_a),
    (select pg_catalog.count(*) from public.action_invocations invocation where invocation.user_id = v_user_a),
    (select pg_catalog.count(*) from public.audit_log audit where audit.user_id = v_user_a)
  ] then
    raise exception 'Late Apply failure did not roll back atomically';
  end if;

  begin
    select pg_catalog.jsonb_agg(
      pg_temp.ics_apply_item(
        'limit-' || fixture.item_number::text || '@example.invalid',
        'ics-review:ics-' || fixture.item_number::text
      )
    ) into v_item
    from pg_catalog.generate_series(1, 501) as fixture(item_number);
    perform public.apply_ics_import_v1(v_item);
    raise exception 'Expected Apply item limit failure';
  exception when raise_exception then
    if sqlerrm <> 'ICS_IMPORT_LIMIT_EXCEEDED' then
      raise;
    end if;
  end;
end;
$verify$;

rollback;
