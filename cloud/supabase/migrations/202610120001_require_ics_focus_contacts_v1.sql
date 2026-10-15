-- Forward-only A3.4 contract: historical .ics imports require at least one
-- unambiguous active Focus contact and persist those participant links.

begin;

create or replace function public.apply_ics_import_v1(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_item jsonb;
  v_event jsonb;
  v_start jsonb;
  v_end jsonb;
  v_expected jsonb;
  v_expected_focus_contact_ids jsonb;
  v_actual_focus_contact_ids jsonb;
  v_participant jsonb;
  v_participants jsonb;
  v_recurrence jsonb;
  v_uid text;
  v_change_id text;
  v_category text;
  v_external_id text;
  v_content_hash text;
  v_content_json jsonb;
  v_material_start jsonb;
  v_material_end jsonb;
  v_material_organizer jsonb;
  v_material_attendees jsonb;
  v_material_status text;
  v_ics_metadata jsonb;
  v_interaction_metadata jsonb;
  v_source_metadata jsonb;
  v_subject text;
  v_description text;
  v_location text;
  v_email text;
  v_role text;
  v_start_kind text;
  v_start_local text;
  v_end_kind text;
  v_end_local text;
  v_occurred_at timestamptz;
  v_end_instant timestamptz;
  v_interaction_id uuid;
  v_contact_id uuid;
  v_expected_interaction_id uuid;
  v_source public.external_interaction_sources%rowtype;
  v_interaction public.interactions%rowtype;
  v_source_found boolean;
  v_same_content boolean;
  v_outcome text;
  v_inserted integer;
  v_linked integer;
  v_rows integer;
  v_item_participants integer;
  v_total_participants integer := 0;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_participants_inserted integer := 0;
  v_participants_linked integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'ICS_IMPORT_NOT_AUTHENTICATED';
  end if;
  if not public.current_user_has_app_access() then
    raise exception 'ICS_IMPORT_ACCESS_DENIED';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'ICS_IMPORT_INVALID_PAYLOAD: items must be an array';
  end if;
  if pg_catalog.jsonb_array_length(p_items) < 1 then
    raise exception 'ICS_IMPORT_INVALID_PAYLOAD: empty selection';
  end if;
  if pg_catalog.jsonb_array_length(p_items) > 500
    or pg_catalog.octet_length(pg_catalog.convert_to(p_items::text, 'UTF8')) > 5 * 1024 * 1024 then
    raise exception 'ICS_IMPORT_LIMIT_EXCEEDED';
  end if;

  -- Validate the full batch before taking locks or writing anything.
  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
      or not (v_item ?& array['changeId', 'category', 'expected', 'focusContactIds', 'event'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_item) as item_key(key_name)
        where key_name not in ('changeId', 'category', 'expected', 'focusContactIds', 'event')
      ) then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid item shape';
    end if;

    v_change_id := v_item->>'changeId';
    v_category := v_item->>'category';
    v_expected := v_item->'expected';
    v_expected_focus_contact_ids := v_item->'focusContactIds';
    v_event := v_item->'event';
    if v_change_id is null or v_change_id !~ '^ics-review:ics-[0-9]+$'
      or pg_catalog.octet_length(v_change_id) > 100
      or v_category not in ('new', 'modified', 'possible_duplicate')
      or pg_catalog.jsonb_typeof(v_event) <> 'object'
      or not (v_event ?& array[
        'uid', 'start', 'end', 'summary', 'description', 'location',
        'organizer', 'attendees', 'status', 'method', 'recurrenceSignals'
      ])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_event) as event_key(key_name)
        where key_name not in (
          'uid', 'start', 'end', 'summary', 'description', 'location',
          'organizer', 'attendees', 'status', 'method', 'recurrenceSignals'
        )
      ) then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid reviewed item';
    end if;
    if pg_catalog.jsonb_typeof(v_expected_focus_contact_ids) <> 'array'
      or pg_catalog.jsonb_array_length(v_expected_focus_contact_ids) < 1
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_expected_focus_contact_ids) focus_id(value)
        where pg_catalog.jsonb_typeof(focus_id.value) <> 'string'
          or pg_catalog.btrim(focus_id.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or pg_catalog.jsonb_array_length(v_expected_focus_contact_ids) <> (
        select pg_catalog.count(distinct focus_id.value #>> '{}')
        from pg_catalog.jsonb_array_elements(v_expected_focus_contact_ids) focus_id(value)
      ) then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid Focus review';
    end if;

    if v_category = 'modified' then
      if pg_catalog.jsonb_typeof(v_expected) <> 'object'
        or not (v_expected ?& array['interactionId', 'interactionUpdatedAt', 'sourceContentHash', 'sourceUpdatedAt'])
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_expected) as expected_key(key_name)
          where key_name not in ('interactionId', 'interactionUpdatedAt', 'sourceContentHash', 'sourceUpdatedAt')
        )
        or coalesce(v_expected->>'interactionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(v_expected->>'sourceContentHash', '') !~ '^[0-9a-f]{64}$'
        or coalesce(v_expected->>'interactionUpdatedAt', '') = ''
        or coalesce(v_expected->>'sourceUpdatedAt', '') = '' then
        raise exception 'ICS_IMPORT_STALE_REVIEW';
      end if;
      begin
        perform (v_expected->>'interactionUpdatedAt')::timestamptz;
        perform (v_expected->>'sourceUpdatedAt')::timestamptz;
      exception when others then
        raise exception 'ICS_IMPORT_STALE_REVIEW';
      end;
    elsif pg_catalog.jsonb_typeof(v_expected) <> 'null' then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: unexpected review state';
    end if;

    v_uid := v_event->>'uid';
    if v_uid is null or v_uid = '' or pg_catalog.octet_length(pg_catalog.convert_to(v_uid, 'UTF8')) > 2048
      or pg_catalog.jsonb_typeof(v_event->'summary') <> 'string'
      or pg_catalog.jsonb_typeof(v_event->'description') <> 'string'
      or pg_catalog.jsonb_typeof(v_event->'location') <> 'string'
      or pg_catalog.octet_length(pg_catalog.convert_to(v_event->>'summary', 'UTF8')) > 10000
      or pg_catalog.octet_length(pg_catalog.convert_to(v_event->>'description', 'UTF8')) > 1048576
      or pg_catalog.octet_length(pg_catalog.convert_to(v_event->>'location', 'UTF8')) > 4000 then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid event text';
    end if;
    if (v_event->'status' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_event->'status') <> 'string')
      or (v_event->'method' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_event->'method') <> 'string')
      or pg_catalog.upper(coalesce(v_event->>'status', '')) = 'CANCELLED'
      or pg_catalog.upper(coalesce(v_event->>'method', '')) = 'CANCEL' then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: cancelled or invalid event';
    end if;

    v_recurrence := v_event->'recurrenceSignals';
    if pg_catalog.jsonb_typeof(v_recurrence) <> 'object'
      or not (v_recurrence ?& array['rrule', 'rdate', 'exdate', 'recurrenceId'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_recurrence) as recurrence_key(key_name)
        where key_name not in ('rrule', 'rdate', 'exdate', 'recurrenceId')
      )
      or pg_catalog.jsonb_typeof(v_recurrence->'rrule') <> 'boolean'
      or pg_catalog.jsonb_typeof(v_recurrence->'rdate') <> 'boolean'
      or pg_catalog.jsonb_typeof(v_recurrence->'exdate') <> 'boolean'
      or pg_catalog.jsonb_typeof(v_recurrence->'recurrenceId') <> 'boolean'
      or (v_recurrence->>'rrule')::boolean
      or (v_recurrence->>'rdate')::boolean
      or (v_recurrence->>'exdate')::boolean
      or (v_recurrence->>'recurrenceId')::boolean then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: recurrent event';
    end if;

    v_start := v_event->'start';
    if pg_catalog.jsonb_typeof(v_start) <> 'object'
      or not (v_start ?& array['valueType', 'localValue', 'timeZoneKind', 'timeZoneId', 'instant', 'ambiguity'])
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_start) as start_key(key_name)
        where key_name not in ('valueType', 'localValue', 'timeZoneKind', 'timeZoneId', 'instant', 'ambiguity')
      ) then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid start';
    end if;
    if pg_catalog.jsonb_typeof(v_start->'valueType') <> 'string'
      or pg_catalog.jsonb_typeof(v_start->'localValue') <> 'string'
      or pg_catalog.jsonb_typeof(v_start->'timeZoneKind') <> 'string'
      or (v_start->'timeZoneId' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_start->'timeZoneId') <> 'string')
      or (v_start->'instant' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_start->'instant') <> 'string')
      or (v_start->'ambiguity' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_start->'ambiguity') <> 'string') then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid start values';
    end if;
    v_start_kind := v_start->>'valueType';
    v_start_local := v_start->>'localValue';
    if v_start_kind = 'date' then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: all-day event is not supported';
    elsif v_start_kind = 'date-time' then
      if v_start->>'timeZoneKind' not in ('utc', 'tzid')
        or coalesce(v_start->>'instant', '') = ''
        or coalesce(v_start_local, '') = ''
        or (v_start->>'timeZoneKind' = 'tzid' and coalesce(v_start->>'timeZoneId', '') = '')
        or coalesce(v_start->>'ambiguity', '') not in ('', 'dst_overlap_first', 'dst_gap_before_offset') then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: unresolved start';
      end if;
      begin
        v_occurred_at := (v_start->>'instant')::timestamptz;
      exception when others then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid start instant';
      end;
    else
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid start kind';
    end if;

    v_end := v_event->'end';
    v_end_instant := null;
    if v_end <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(v_end) <> 'object'
        or not (v_end ?& array['valueType', 'localValue', 'timeZoneKind', 'timeZoneId', 'instant', 'ambiguity'])
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_end) as end_key(key_name)
          where key_name not in ('valueType', 'localValue', 'timeZoneKind', 'timeZoneId', 'instant', 'ambiguity')
        ) then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid end';
      end if;
      if pg_catalog.jsonb_typeof(v_end->'valueType') <> 'string'
        or pg_catalog.jsonb_typeof(v_end->'localValue') <> 'string'
        or pg_catalog.jsonb_typeof(v_end->'timeZoneKind') <> 'string'
        or (v_end->'timeZoneId' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_end->'timeZoneId') <> 'string')
        or (v_end->'instant' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_end->'instant') <> 'string')
        or (v_end->'ambiguity' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_end->'ambiguity') <> 'string') then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid end values';
      end if;
      v_end_kind := v_end->>'valueType';
      v_end_local := v_end->>'localValue';
      if v_end_kind <> v_start_kind then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: mixed date range';
      elsif v_end_kind = 'date' then
        begin
          if v_end->>'timeZoneKind' <> 'date' or v_end_local !~ '^\d{4}-\d{2}-\d{2}$'
            or v_end->'timeZoneId' <> 'null'::jsonb
            or v_end->'instant' <> 'null'::jsonb
            or v_end->'ambiguity' <> 'null'::jsonb
            or (v_end_local::date)::text <> v_end_local
            or v_end_local::date <= v_start_local::date then
            raise exception 'invalid date range';
          end if;
        exception when others then
          raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid all-day end';
        end;
      else
        if v_end->>'timeZoneKind' not in ('utc', 'tzid')
          or coalesce(v_end->>'instant', '') = ''
          or coalesce(v_end_local, '') = ''
          or (v_end->>'timeZoneKind' = 'tzid' and coalesce(v_end->>'timeZoneId', '') = '')
          or coalesce(v_end->>'ambiguity', '') not in ('', 'dst_overlap_first', 'dst_gap_before_offset') then
          raise exception 'ICS_IMPORT_INVALID_PAYLOAD: unresolved end';
        end if;
        begin
          v_end_instant := (v_end->>'instant')::timestamptz;
          if v_end_instant <= v_occurred_at then
            raise exception 'invalid date range';
          end if;
        exception when others then
          raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid end instant';
        end;
      end if;
    end if;

    if pg_catalog.jsonb_typeof(v_event->'attendees') <> 'array'
      or (v_event->'organizer' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_event->'organizer') <> 'object') then
      raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid participants';
    end if;
    v_participants := '[]'::jsonb;
    if v_event->'organizer' <> 'null'::jsonb then
      v_participants := v_participants || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'value', v_event->'organizer',
        'applyRole', 'ORGANIZER'
      ));
    end if;
    for v_participant in select value from pg_catalog.jsonb_array_elements(v_event->'attendees')
    loop
      v_participants := v_participants || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'value', v_participant,
        'applyRole', null
      ));
    end loop;
    v_item_participants := pg_catalog.jsonb_array_length(v_participants);
    v_total_participants := v_total_participants + v_item_participants;
    if v_item_participants > 500 or v_total_participants > 5000 then
      raise exception 'ICS_IMPORT_LIMIT_EXCEEDED';
    end if;
    for v_participant in select value from pg_catalog.jsonb_array_elements(v_participants)
    loop
      v_role := v_participant->>'applyRole';
      v_participant := v_participant->'value';
      if pg_catalog.jsonb_typeof(v_participant) <> 'object'
        or not (v_participant ?& array['email', 'commonName', 'role', 'participationStatus'])
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(v_participant) as participant_key(key_name)
          where key_name not in ('email', 'commonName', 'role', 'participationStatus')
        )
        or pg_catalog.jsonb_typeof(v_participant->'email') <> 'string'
        or (v_participant->'commonName' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_participant->'commonName') <> 'string')
        or pg_catalog.jsonb_typeof(v_participant->'role') <> 'string'
        or (v_participant->'participationStatus' <> 'null'::jsonb and pg_catalog.jsonb_typeof(v_participant->'participationStatus') <> 'string') then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid participant';
      end if;
      v_email := pg_catalog.lower(pg_catalog.btrim(v_participant->>'email'));
      v_role := pg_catalog.upper(pg_catalog.btrim(coalesce(v_role, v_participant->>'role', 'ATTENDEE')));
      if v_email = '' or pg_catalog.octet_length(v_email) > 320 or pg_catalog.strpos(v_email, '@') <= 1
        or v_email ~ '[[:cntrl:]]' or v_role = '' or pg_catalog.octet_length(v_role) > 64 then
        raise exception 'ICS_IMPORT_INVALID_PAYLOAD: invalid participant identity';
      end if;
    end loop;

    select coalesce(pg_catalog.jsonb_agg(resolved.contact_id order by resolved.contact_id), '[]'::jsonb)
    into v_actual_focus_contact_ids
    from (
      select distinct matched_email.contact_id
      from (
        select (pg_catalog.array_agg(contact.id order by contact.id))[1] as contact_id
        from pg_catalog.jsonb_array_elements(v_participants) participant_entry(value)
        join public.contact_emails email
          on email.user_id = v_user_id
         and pg_catalog.lower(pg_catalog.btrim(email.normalized_email)) = pg_catalog.lower(pg_catalog.btrim(participant_entry.value->'value'->>'email'))
        join public.contacts contact
          on contact.id = email.contact_id
         and contact.user_id = v_user_id
         and contact.is_active
        group by pg_catalog.lower(pg_catalog.btrim(participant_entry.value->'value'->>'email'))
        having pg_catalog.count(distinct contact.id) = 1
          and pg_catalog.bool_and(contact.networking_focus)
      ) matched_email
    ) resolved;
    select coalesce(pg_catalog.jsonb_agg(value order by value #>> '{}'), '[]'::jsonb)
    into v_expected_focus_contact_ids
    from pg_catalog.jsonb_array_elements(v_expected_focus_contact_ids) expected_focus(value);
    if v_actual_focus_contact_ids = '[]'::jsonb
      or v_actual_focus_contact_ids is distinct from v_expected_focus_contact_ids then
      raise exception 'ICS_IMPORT_STALE_FOCUS';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) item
    group by item->'event'->>'uid'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'ICS_IMPORT_INVALID_PAYLOAD: duplicate UID in batch';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) item
    group by item->>'changeId'
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'ICS_IMPORT_INVALID_PAYLOAD: duplicate changeId in batch';
  end if;

  -- All calls lock the same identities in the same order before reading/writing.
  for v_external_id in
    select 'ics_uid_sha256_' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(item->'event'->>'uid', 'UTF8'), 'sha256'),
      'hex'
    )
    from pg_catalog.jsonb_array_elements(p_items) item
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text || ':' || v_external_id, 0)
    );
  end loop;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    v_event := v_item->'event';
    v_expected := v_item->'expected';
    v_change_id := v_item->>'changeId';
    v_category := v_item->>'category';
    v_uid := v_event->>'uid';
    v_external_id := 'ics_uid_sha256_' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_uid, 'UTF8'), 'sha256'),
      'hex'
    );
    v_start := v_event->'start';
    v_end := v_event->'end';
    v_start_kind := v_start->>'valueType';
    v_start_local := v_start->>'localValue';
    v_end_kind := null;
    v_end_local := null;
    v_end_instant := null;
    if v_end <> 'null'::jsonb then
      v_end_kind := v_end->>'valueType';
      v_end_local := v_end->>'localValue';
      if v_end_kind = 'date-time' then
        v_end_instant := (v_end->>'instant')::timestamptz;
      end if;
    end if;
    if v_start_kind = 'date' then
      v_occurred_at := (v_start_local::date::timestamp + interval '12 hours') at time zone 'UTC';
    else
      v_occurred_at := (v_start->>'instant')::timestamptz;
    end if;
    v_subject := nullif(pg_catalog.btrim(pg_catalog.replace(
      pg_catalog.replace(v_event->>'summary', E'\r\n', E'\n'), E'\r', E'\n'
    )), '');
    v_description := nullif(pg_catalog.btrim(pg_catalog.replace(
      pg_catalog.replace(v_event->>'description', E'\r\n', E'\n'), E'\r', E'\n'
    )), '');
    v_location := coalesce(nullif(pg_catalog.btrim(pg_catalog.replace(
      pg_catalog.replace(v_event->>'location', E'\r\n', E'\n'), E'\r', E'\n'
    )), ''), '');
    v_material_start := pg_catalog.jsonb_build_object(
      'valueType', v_start_kind,
      'localValue', v_start_local,
      'timeZoneKind', v_start->>'timeZoneKind',
      'timeZoneId', v_start->'timeZoneId',
      'instant', case when v_start_kind = 'date' then 'null'::jsonb else pg_catalog.to_jsonb(v_occurred_at) end
    );
    v_material_end := case when v_end = 'null'::jsonb then 'null'::jsonb else pg_catalog.jsonb_build_object(
      'valueType', v_end_kind,
      'localValue', v_end_local,
      'timeZoneKind', v_end->>'timeZoneKind',
      'timeZoneId', v_end->'timeZoneId',
      'instant', case when v_end_kind = 'date' then 'null'::jsonb else pg_catalog.to_jsonb(v_end_instant) end
    ) end;
    v_material_organizer := case when v_event->'organizer' = 'null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object(
        'email', pg_catalog.lower(pg_catalog.btrim(v_event->'organizer'->>'email')),
        'commonName', nullif(pg_catalog.btrim(v_event->'organizer'->>'commonName'), ''),
        'role', 'ORGANIZER',
        'participationStatus', nullif(pg_catalog.upper(pg_catalog.btrim(v_event->'organizer'->>'participationStatus')), '')
      )
    end;
    select coalesce(
      pg_catalog.jsonb_agg(
        canonical.participant
        order by canonical.participant->>'email', canonical.participant->>'role',
          canonical.participant->>'commonName', canonical.participant->>'participationStatus'
      ),
      '[]'::jsonb
    ) into v_material_attendees
    from (
      select distinct pg_catalog.jsonb_build_object(
        'email', pg_catalog.lower(pg_catalog.btrim(attendee.value->>'email')),
        'commonName', nullif(pg_catalog.btrim(attendee.value->>'commonName'), ''),
        'role', pg_catalog.upper(pg_catalog.btrim(coalesce(attendee.value->>'role', 'ATTENDEE'))),
        'participationStatus', nullif(pg_catalog.upper(pg_catalog.btrim(attendee.value->>'participationStatus')), '')
      ) as participant
      from pg_catalog.jsonb_array_elements(v_event->'attendees') attendee(value)
    ) canonical;
    v_material_status := nullif(pg_catalog.upper(pg_catalog.btrim(v_event->>'status')), '');
    v_ics_metadata := pg_catalog.jsonb_build_object(
      'version', 1,
      'uid', v_uid,
      'start', v_start,
      'end', v_end,
      'allDay', v_start_kind = 'date',
      'location', v_location,
      'organizer', v_event->'organizer',
      'attendees', v_event->'attendees',
      'status', v_event->'status',
      'method', v_event->'method'
    );
    v_content_json := pg_catalog.jsonb_build_object(
      'start', v_material_start,
      'end', v_material_end,
      'summary', coalesce(v_subject, ''),
      'description', coalesce(v_description, ''),
      'location', v_location,
      'organizer', v_material_organizer,
      'attendees', v_material_attendees,
      'status', v_material_status
    );
    v_content_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_content_json::text, 'UTF8'), 'sha256'),
      'hex'
    );
    v_interaction_metadata := pg_catalog.jsonb_build_object(
      'source', 'ics_import',
      'external_provider', 'icalendar',
      'external_source_service', 'ics_import',
      'ics_import', v_ics_metadata
    );
    v_source_metadata := pg_catalog.jsonb_build_object('ics_import', v_ics_metadata);

    select source.* into v_source
    from public.external_interaction_sources source
    where source.user_id = v_user_id
      and source.provider = 'icalendar'
      and source.source_service = 'ics_import'
      and source.external_id = v_external_id
      and source.is_active
    for update;
    v_source_found := found;

    if not v_source_found then
      if exists (
        select 1 from public.external_interaction_sources source
        where source.user_id = v_user_id
          and source.provider = 'icalendar'
          and source.source_service = 'ics_import'
          and source.external_id = v_external_id
          and not source.is_active
      ) then
        raise exception 'ICS_IMPORT_BLOCKED_IDENTITY';
      end if;
      if v_category = 'modified' then
        raise exception 'ICS_IMPORT_STALE_REVIEW';
      end if;

      insert into public.interactions (
        user_id, provider, provider_event_id, provider_thread_id,
        interaction_type, direction, occurred_at, subject, source_detail,
        user_notes_raw, metadata
      ) values (
        v_user_id, 'icalendar', v_external_id, null,
        'calendar', 'unknown', v_occurred_at, v_subject, v_description,
        '', v_interaction_metadata
      ) returning id into v_interaction_id;

      insert into public.external_interaction_sources (
        user_id, interaction_id, connected_account_id, provider, source_service,
        external_object_type, external_id, external_thread_id, external_url,
        source_subject, source_detail, content_hash, sync_status,
        prevent_reimport, is_active, last_seen_at, last_synced_at, metadata
      ) values (
        v_user_id, v_interaction_id, null, 'icalendar', 'ics_import',
        'calendar_event', v_external_id, null, null,
        v_subject, v_description, v_content_hash, 'imported',
        false, true, v_now, null, v_source_metadata
      );
      v_outcome := 'created';
      v_created_count := v_created_count + 1;
    else
      if coalesce(v_source.metadata->'ics_import'->>'uid', '') <> v_uid then
        raise exception 'ICS_IMPORT_BLOCKED_IDENTITY';
      end if;
      select interaction.* into v_interaction
      from public.interactions interaction
      where interaction.id = v_source.interaction_id
        and interaction.user_id = v_user_id
      for update;
      if not found
        or v_interaction.provider <> 'icalendar'
        or v_interaction.provider_event_id <> v_external_id
        or v_interaction.interaction_type <> 'calendar'
        or coalesce((pg_catalog.to_jsonb(v_interaction)->>'is_deleted')::boolean, false)
        or coalesce((pg_catalog.to_jsonb(v_interaction)->>'prevent_reimport')::boolean, false)
        or coalesce(v_interaction.metadata->'deleted', 'false'::jsonb) = 'true'::jsonb
        or coalesce(v_interaction.metadata->'dismissed', 'false'::jsonb) = 'true'::jsonb
        or coalesce(v_interaction.metadata->'prevent_reimport', 'false'::jsonb) = 'true'::jsonb
        or v_source.prevent_reimport
        or v_source.external_object_type <> 'calendar_event'
        or exists (
          select 1 from public.external_interaction_sources other_source
          where other_source.user_id = v_user_id
            and other_source.interaction_id = v_interaction.id
            and other_source.is_active
            and other_source.id <> v_source.id
        ) then
        raise exception 'ICS_IMPORT_BLOCKED_IDENTITY';
      end if;

      v_interaction_id := v_interaction.id;
      v_same_content := v_source.content_hash = v_content_hash
        and v_interaction.occurred_at is not distinct from v_occurred_at
        and v_interaction.subject is not distinct from v_subject
        and v_interaction.source_detail is not distinct from v_description;

      if v_same_content then
        update public.external_interaction_sources
        set last_seen_at = v_now,
            sync_status = 'imported',
            last_synced_at = null,
            updated_at = v_now
        where id = v_source.id;
        v_outcome := 'unchanged';
        v_unchanged_count := v_unchanged_count + 1;
      else
        if v_category <> 'modified' then
          raise exception 'ICS_IMPORT_STALE_REVIEW';
        end if;
        begin
          v_expected_interaction_id := (v_expected->>'interactionId')::uuid;
        exception when others then
          raise exception 'ICS_IMPORT_STALE_REVIEW';
        end;
        if v_expected_interaction_id <> v_interaction.id
          or (v_expected->>'interactionUpdatedAt')::timestamptz <> v_interaction.updated_at
          or v_expected->>'sourceContentHash' <> v_source.content_hash
          or (v_expected->>'sourceUpdatedAt')::timestamptz <> v_source.updated_at then
          raise exception 'ICS_IMPORT_STALE_REVIEW';
        end if;

        update public.interactions
        set provider = 'icalendar',
            provider_event_id = v_external_id,
            provider_thread_id = null,
            interaction_type = 'calendar',
            direction = 'unknown',
            occurred_at = v_occurred_at,
            subject = v_subject,
            source_detail = v_description,
            metadata = coalesce(metadata, '{}'::jsonb) || v_interaction_metadata,
            updated_at = v_now
        where id = v_interaction.id and user_id = v_user_id;

        update public.external_interaction_sources
        set connected_account_id = null,
            external_object_type = 'calendar_event',
            external_thread_id = null,
            external_url = null,
            source_subject = v_subject,
            source_detail = v_description,
            content_hash = v_content_hash,
            sync_status = 'imported',
            last_seen_at = v_now,
            last_synced_at = null,
            metadata = coalesce(metadata, '{}'::jsonb) || v_source_metadata,
            updated_at = v_now
        where id = v_source.id and user_id = v_user_id;
        v_outcome := 'updated';
        v_updated_count := v_updated_count + 1;
      end if;
    end if;

    v_participants := '[]'::jsonb;
    if v_event->'organizer' <> 'null'::jsonb then
      v_participants := v_participants || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'value', v_event->'organizer',
        'applyRole', 'ORGANIZER'
      ));
    end if;
    for v_participant in select value from pg_catalog.jsonb_array_elements(v_event->'attendees')
    loop
      v_participants := v_participants || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'value', v_participant,
        'applyRole', null
      ));
    end loop;
    v_inserted := 0;
    v_linked := 0;
    for v_participant in select value from pg_catalog.jsonb_array_elements(v_participants)
    loop
      v_role := v_participant->>'applyRole';
      v_participant := v_participant->'value';
      v_email := pg_catalog.lower(pg_catalog.btrim(v_participant->>'email'));
      v_role := pg_catalog.upper(pg_catalog.btrim(coalesce(v_role, v_participant->>'role', 'ATTENDEE')));
      select (pg_catalog.array_agg(contact.id order by contact.id))[1]
      into v_contact_id
      from public.contact_emails email
      join public.contacts contact
        on contact.id = email.contact_id
       and contact.user_id = v_user_id
       and contact.is_active
      where email.user_id = v_user_id
        and pg_catalog.lower(pg_catalog.btrim(email.normalized_email)) = v_email
      having pg_catalog.count(distinct contact.id) = 1
        and pg_catalog.bool_and(contact.networking_focus);

      if v_contact_id is not null then
        update public.interaction_participants participant
        set contact_id = v_contact_id
        where participant.user_id = v_user_id
          and participant.interaction_id = v_interaction_id
          and participant.contact_id is null
          and pg_catalog.lower(pg_catalog.btrim(coalesce(participant.email_identity, ''))) = v_email
          and pg_catalog.upper(pg_catalog.btrim(coalesce(participant.role, ''))) = v_role;
        get diagnostics v_rows = row_count;
        v_linked := v_linked + v_rows;
      end if;
      if not exists (
        select 1 from public.interaction_participants participant
        where participant.user_id = v_user_id
          and participant.interaction_id = v_interaction_id
          and pg_catalog.lower(pg_catalog.btrim(coalesce(participant.email_identity, ''))) = v_email
          and pg_catalog.upper(pg_catalog.btrim(coalesce(participant.role, ''))) = v_role
      ) then
        insert into public.interaction_participants (
          user_id, interaction_id, contact_id, email_identity, role
        ) values (
          v_user_id, v_interaction_id, v_contact_id, v_email, v_role
        );
        v_inserted := v_inserted + 1;
      end if;
    end loop;
    v_participants_inserted := v_participants_inserted + v_inserted;
    v_participants_linked := v_participants_linked + v_linked;
    v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'changeId', v_change_id,
      'interactionId', v_interaction_id,
      'outcome', v_outcome,
      'participantsInserted', v_inserted,
      'participantsLinked', v_linked
    ));
  end loop;

  insert into public.action_invocations (
    user_id, action_name, actor_type, status, object_type, input_json, output_json,
    requires_confirmation, confirmed_at, executed_at
  ) values (
    v_user_id, 'interaction.import_ics.apply', 'user', 'executed', 'ics_import',
    pg_catalog.jsonb_build_object('selectedCount', pg_catalog.jsonb_array_length(p_items)),
    pg_catalog.jsonb_build_object(
      'createdCount', v_created_count,
      'updatedCount', v_updated_count,
      'unchangedCount', v_unchanged_count,
      'participantsInserted', v_participants_inserted
      ,'participantsLinked', v_participants_linked
    ),
    true, v_now, v_now
  );

  insert into public.audit_log (
    user_id, actor, action, object_type, before_json, after_json
  ) values (
    v_user_id, 'user', 'interaction.import_ics.apply', 'ics_import', null,
    pg_catalog.jsonb_build_object(
      'selectedCount', pg_catalog.jsonb_array_length(p_items),
      'createdCount', v_created_count,
      'updatedCount', v_updated_count,
      'unchangedCount', v_unchanged_count,
      'participantsInserted', v_participants_inserted
      ,'participantsLinked', v_participants_linked
    )
  );

  return pg_catalog.jsonb_build_object(
    'createdCount', v_created_count,
    'updatedCount', v_updated_count,
    'unchangedCount', v_unchanged_count,
    'participantsInserted', v_participants_inserted,
    'participantsLinked', v_participants_linked,
    'items', v_results
  );
end;
$$;

alter function public.apply_ics_import_v1(jsonb) owner to postgres;

revoke all on function public.apply_ics_import_v1(jsonb)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.apply_ics_import_v1(jsonb)
  to authenticated;

create or replace function public.reconcile_ics_focus_participants_v1(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_eligible_participants integer := 0;
  v_eligible_interactions integer := 0;
  v_updated_participants integer := 0;
begin
  if v_user_id is null then
    raise exception 'ICS_IMPORT_NOT_AUTHENTICATED';
  end if;
  if not public.current_user_has_app_access() then
    raise exception 'ICS_IMPORT_ACCESS_DENIED';
  end if;

  if p_apply then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ics-focus-reconcile:' || v_user_id::text, 0)
    );
  end if;

  with eligible as (
    select participant.id, participant.interaction_id, (pg_catalog.array_agg(contact.id order by contact.id))[1] as contact_id
    from public.interaction_participants participant
    join public.interactions interaction
      on interaction.id = participant.interaction_id
     and interaction.user_id = v_user_id
     and interaction.provider = 'icalendar'
     and interaction.interaction_type = 'calendar'
     and coalesce(pg_catalog.to_jsonb(interaction)->>'is_deleted', 'false') <> 'true'
     and coalesce(pg_catalog.to_jsonb(interaction)->>'prevent_reimport', 'false') <> 'true'
     and coalesce(interaction.metadata->>'deleted', 'false') <> 'true'
     and coalesce(interaction.metadata->>'dismissed', 'false') <> 'true'
     and coalesce(interaction.metadata->>'prevent_reimport', 'false') <> 'true'
    join public.external_interaction_sources source
      on source.interaction_id = interaction.id
     and source.user_id = v_user_id
     and source.provider = 'icalendar'
     and source.source_service = 'ics_import'
     and source.external_object_type = 'calendar_event'
     and source.is_active
     and not source.prevent_reimport
     and interaction.provider_event_id = source.external_id
     and coalesce(source.metadata->'ics_import'->>'uid', '') <> ''
     and interaction.metadata->'ics_import'->>'uid' = source.metadata->'ics_import'->>'uid'
     and source.external_id = 'ics_uid_sha256_' || pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(source.metadata->'ics_import'->>'uid', 'UTF8'), 'sha256'), 'hex'
     )
    join public.contact_emails email
      on email.user_id = v_user_id
     and pg_catalog.lower(pg_catalog.btrim(email.normalized_email)) = pg_catalog.lower(pg_catalog.btrim(participant.email_identity))
    join public.contacts contact
      on contact.id = email.contact_id
     and contact.user_id = v_user_id
     and contact.is_active
    where participant.user_id = v_user_id
      and participant.contact_id is null
      and coalesce(participant.email_identity, '') <> ''
    group by participant.id, participant.interaction_id
    having pg_catalog.count(distinct contact.id) = 1
      and pg_catalog.bool_and(contact.networking_focus)
  )
  select pg_catalog.count(*), pg_catalog.count(distinct interaction_id)
  into v_eligible_participants, v_eligible_interactions
  from eligible;

  if p_apply then
    with eligible as (
      select participant.id, (pg_catalog.array_agg(contact.id order by contact.id))[1] as contact_id
      from public.interaction_participants participant
      join public.interactions interaction
        on interaction.id = participant.interaction_id
       and interaction.user_id = v_user_id
       and interaction.provider = 'icalendar'
       and interaction.interaction_type = 'calendar'
       and coalesce(pg_catalog.to_jsonb(interaction)->>'is_deleted', 'false') <> 'true'
       and coalesce(pg_catalog.to_jsonb(interaction)->>'prevent_reimport', 'false') <> 'true'
       and coalesce(interaction.metadata->>'deleted', 'false') <> 'true'
       and coalesce(interaction.metadata->>'dismissed', 'false') <> 'true'
       and coalesce(interaction.metadata->>'prevent_reimport', 'false') <> 'true'
      join public.external_interaction_sources source
        on source.interaction_id = interaction.id
       and source.user_id = v_user_id
       and source.provider = 'icalendar'
       and source.source_service = 'ics_import'
       and source.external_object_type = 'calendar_event'
       and source.is_active
       and not source.prevent_reimport
       and interaction.provider_event_id = source.external_id
       and coalesce(source.metadata->'ics_import'->>'uid', '') <> ''
       and interaction.metadata->'ics_import'->>'uid' = source.metadata->'ics_import'->>'uid'
       and source.external_id = 'ics_uid_sha256_' || pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(source.metadata->'ics_import'->>'uid', 'UTF8'), 'sha256'), 'hex'
       )
      join public.contact_emails email
        on email.user_id = v_user_id
       and pg_catalog.lower(pg_catalog.btrim(email.normalized_email)) = pg_catalog.lower(pg_catalog.btrim(participant.email_identity))
      join public.contacts contact
        on contact.id = email.contact_id
       and contact.user_id = v_user_id
       and contact.is_active
      where participant.user_id = v_user_id
        and participant.contact_id is null
        and coalesce(participant.email_identity, '') <> ''
      group by participant.id
      having pg_catalog.count(distinct contact.id) = 1
        and pg_catalog.bool_and(contact.networking_focus)
    )
    update public.interaction_participants participant
    set contact_id = eligible.contact_id
    from eligible
    where participant.id = eligible.id
      and participant.user_id = v_user_id
      and participant.contact_id is null;
    get diagnostics v_updated_participants = row_count;

    insert into public.action_invocations (
      user_id, action_name, actor_type, status, object_type, input_json, output_json,
      requires_confirmation, confirmed_at, executed_at
    ) values (
      v_user_id, 'interaction.import_ics.reconcile_focus', 'user', 'executed', 'ics_import',
      pg_catalog.jsonb_build_object('apply', true),
      pg_catalog.jsonb_build_object('participantsLinked', v_updated_participants),
      true, v_now, v_now
    );
    insert into public.audit_log (user_id, actor, action, object_type, before_json, after_json)
    values (
      v_user_id, 'user', 'interaction.import_ics.reconcile_focus', 'ics_import', null,
      pg_catalog.jsonb_build_object('participantsLinked', v_updated_participants)
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'apply', p_apply,
    'eligibleInteractions', v_eligible_interactions,
    'eligibleParticipants', v_eligible_participants,
    'participantsLinked', v_updated_participants
  );
end;
$$;

alter function public.reconcile_ics_focus_participants_v1(boolean) owner to postgres;
revoke all on function public.reconcile_ics_focus_participants_v1(boolean)
  from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.reconcile_ics_focus_participants_v1(boolean)
  to authenticated;

commit;
