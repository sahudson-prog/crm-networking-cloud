import ICAL from "ical.js";

export const MAX_ICS_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ICS_EVENT_COMPONENTS = 5000;
export const MAX_ICS_PARTICIPANTS_PER_EVENT = 500;

export type IcsExclusionReason =
  | "cancelled"
  | "recurring"
  | "all_day"
  | "missing_uid"
  | "missing_start"
  | "invalid_date"
  | "unresolved_timezone"
  | "invalid_date_range"
  | "too_many_participants"
  | "unsupported_component";

export type IcsTemporalValue = {
  valueType: "date" | "date-time";
  localValue: string;
  timeZoneKind: "date" | "utc" | "tzid" | "floating";
  timeZoneId: string | null;
  instant: string | null;
  ambiguity: "floating" | "dst_overlap_first" | "dst_gap_before_offset" | null;
};

export type IcsParticipant = {
  email: string;
  commonName: string | null;
  role: "organizer" | string;
  participationStatus: string | null;
};

export type NormalizedIcsEvent = {
  entryId: string;
  uid: string;
  start: IcsTemporalValue;
  end: IcsTemporalValue | null;
  summary: string;
  description: string;
  location: string;
  organizer: IcsParticipant | null;
  attendees: IcsParticipant[];
  status: string | null;
  method: string | null;
  recurrenceSignals: {
    rrule: boolean;
    rdate: boolean;
    exdate: boolean;
    recurrenceId: boolean;
  };
  warnings: Array<"floating_start" | "floating_end" | "dst_overlap" | "dst_gap">;
};

export type ExcludedIcsEvent = {
  entryId: string;
  uid: string | null;
  category: "cancelled" | "recurrent" | "all_day" | "invalid";
  reason: IcsExclusionReason;
};

export type IcsParseResult = {
  events: NormalizedIcsEvent[];
  excluded: ExcludedIcsEvent[];
  counts: {
    total: number;
    importable: number;
    cancelled: number;
    recurrent: number;
    allDay: number;
    invalid: number;
    recurrentSeries: number;
  };
};

export class IcsImportError extends Error {
  readonly code: "file_too_large" | "too_many_components" | "invalid_calendar" | "empty_calendar";

  constructor(
    code: "file_too_large" | "too_many_components" | "invalid_calendar" | "empty_calendar",
    message: string
  ) {
    super(message);
    this.name = "IcsImportError";
    this.code = code;
  }
}

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalProperty = InstanceType<typeof ICAL.Property>;
type IcalTime = InstanceType<typeof ICAL.Time>;

type RecurrenceSignals = NormalizedIcsEvent["recurrenceSignals"];

type ComponentCandidate = {
  component: IcalComponent;
  entryId: string;
  uid: string | null;
  recurrenceSignals: RecurrenceSignals;
};

export function parseIcsCalendar(source: string): IcsParseResult {
  assertSourceLimits(source);

  let calendar: IcalComponent;
  try {
    calendar = new ICAL.Component(ICAL.parse(normalizeLineEndings(source)));
  } catch {
    throw new IcsImportError("invalid_calendar", "No pudimos leer el archivo iCalendar.");
  }

  if (calendar.name !== "vcalendar") {
    throw new IcsImportError("invalid_calendar", "El archivo no contiene un calendario iCalendar válido.");
  }

  const components = calendar.getAllSubcomponents("vevent");
  if (!components.length) {
    throw new IcsImportError("empty_calendar", "No encontramos citas en el archivo iCalendar.");
  }
  if (components.length > MAX_ICS_EVENT_COMPONENTS) {
    throw new IcsImportError(
      "too_many_components",
      `El archivo supera el límite de ${MAX_ICS_EVENT_COMPONENTS} citas.`
    );
  }

  const method = optionalText(calendar.getFirstPropertyValue("method"))?.toUpperCase() ?? null;
  const candidates = components.map((component, index) => buildCandidate(component, index));
  // An isolated occurrence without recurrence properties is indistinguishable from an individual VEVENT.
  const recurringUids = new Set(
    candidates
      .filter((candidate) => candidate.uid && hasRecurrenceSignal(candidate.recurrenceSignals))
      .map((candidate) => candidate.uid as string)
  );

  const events: NormalizedIcsEvent[] = [];
  const excluded: ExcludedIcsEvent[] = [];

  for (const candidate of candidates) {
    const status = optionalText(candidate.component.getFirstPropertyValue("status"))?.toUpperCase() ?? null;
    if (status === "CANCELLED" || method === "CANCEL") {
      excluded.push(exclusion(candidate, "cancelled", "cancelled"));
      continue;
    }

    if (hasRecurrenceSignal(candidate.recurrenceSignals) || (candidate.uid && recurringUids.has(candidate.uid))) {
      excluded.push(exclusion(candidate, "recurrent", "recurring"));
      continue;
    }

    if (isAllDayCandidate(candidate)) {
      excluded.push(exclusion(candidate, "all_day", "all_day"));
      continue;
    }

    try {
      events.push(normalizeEvent(candidate, calendar, method, status));
    } catch (error) {
      excluded.push(exclusion(candidate, "invalid", invalidReason(error)));
    }
  }

  const recurrentSeries = new Set(
    excluded
      .filter((item) => item.category === "recurrent" && item.uid)
      .map((item) => item.uid as string)
  ).size;

  return {
    events,
    excluded,
    counts: {
      total: components.length,
      importable: events.length,
      cancelled: excluded.filter((item) => item.category === "cancelled").length,
      recurrent: excluded.filter((item) => item.category === "recurrent").length,
      allDay: excluded.filter((item) => item.category === "all_day").length,
      invalid: excluded.filter((item) => item.category === "invalid").length,
      recurrentSeries
    }
  };
}

function assertSourceLimits(source: string) {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > MAX_ICS_FILE_BYTES) {
    throw new IcsImportError(
      "file_too_large",
      `El archivo supera el límite de ${Math.floor(MAX_ICS_FILE_BYTES / 1024 / 1024)} MB.`
    );
  }

  const declaredEvents = source.match(/^BEGIN:VEVENT\s*$/gim)?.length ?? 0;
  if (declaredEvents > MAX_ICS_EVENT_COMPONENTS) {
    throw new IcsImportError(
      "too_many_components",
      `El archivo supera el límite de ${MAX_ICS_EVENT_COMPONENTS} citas.`
    );
  }
}

function normalizeLineEndings(source: string) {
  return source.replace(/\r\n|\r|\n/g, "\r\n");
}

function buildCandidate(component: IcalComponent, index: number): ComponentCandidate {
  const uidValue = component.getFirstPropertyValue("uid");
  const uid = typeof uidValue === "string" && uidValue.trim() ? uidValue : null;
  return {
    component,
    entryId: `ics-${index}`,
    uid,
    recurrenceSignals: {
      rrule: component.hasProperty("rrule"),
      rdate: component.hasProperty("rdate"),
      exdate: component.hasProperty("exdate"),
      recurrenceId: component.hasProperty("recurrence-id")
    }
  };
}

function normalizeEvent(
  candidate: ComponentCandidate,
  calendar: IcalComponent,
  method: string | null,
  status: string | null
): NormalizedIcsEvent {
  if (!candidate.uid) throw new EventNormalizationError("missing_uid");

  const participantProperties = candidate.component.getAllProperties("attendee");
  if (participantProperties.length > MAX_ICS_PARTICIPANTS_PER_EVENT) {
    throw new EventNormalizationError("too_many_participants");
  }

  const startProperty = candidate.component.getFirstProperty("dtstart");
  if (!startProperty) throw new EventNormalizationError("missing_start");
  const start = normalizeTemporalValue(startProperty, calendar);
  const endProperty = candidate.component.getFirstProperty("dtend");
  const end = endProperty ? normalizeTemporalValue(endProperty, calendar) : null;
  validateDateRange(start, end);

  const organizerProperty = candidate.component.getFirstProperty("organizer");
  const organizer = organizerProperty ? participantFromProperty(organizerProperty, "organizer") : null;
  const attendees = dedupeParticipants(
    participantProperties
      .map((property) => participantFromProperty(property, attendeeRole(property)))
      .filter((participant): participant is IcsParticipant => Boolean(participant))
  );

  return {
    entryId: candidate.entryId,
    uid: candidate.uid,
    start,
    end,
    summary: optionalText(candidate.component.getFirstPropertyValue("summary")) ?? "",
    description: optionalText(candidate.component.getFirstPropertyValue("description")) ?? "",
    location: optionalText(candidate.component.getFirstPropertyValue("location")) ?? "",
    organizer,
    attendees,
    status,
    method,
    recurrenceSignals: candidate.recurrenceSignals,
    warnings: temporalWarnings(start, end)
  };
}

function isAllDayCandidate(candidate: ComponentCandidate) {
  const startProperty = candidate.component.getFirstProperty("dtstart");
  if (!startProperty) return false;
  const value = startProperty.getFirstValue();
  return startProperty.type === "date" || (value instanceof ICAL.Time && value.isDate);
}

function normalizeTemporalValue(property: IcalProperty, calendar: IcalComponent): IcsTemporalValue {
  const json = property.toJSON() as [string, Record<string, unknown>, string, unknown];
  const rawValue = typeof json[3] === "string" ? json[3] : "";
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time) || !isValidRawTemporal(rawValue, property.type)) {
    throw new EventNormalizationError("invalid_date");
  }

  if (value.isDate) {
    return {
      valueType: "date",
      localValue: rawValue,
      timeZoneKind: "date",
      timeZoneId: null,
      instant: null,
      ambiguity: null
    };
  }

  const localValue = rawValue.replace(/Z$/, "");
  if (rawValue.endsWith("Z")) {
    return temporalResult(localValue, "utc", "UTC", unixTimeToIso(value));
  }

  const timeZoneId = property.getFirstParameter("tzid") || null;
  if (!timeZoneId) {
    return temporalResult(localValue, "floating", null, null, "floating");
  }

  const embeddedTimeZone = calendar.getTimeZoneByID(timeZoneId);
  if (embeddedTimeZone && value.zone.tzid === timeZoneId) {
    return temporalResult(localValue, "tzid", timeZoneId, unixTimeToIso(value));
  }

  const resolved = resolveIanaWallTime(value, timeZoneId);
  if (!resolved) throw new EventNormalizationError("unresolved_timezone");
  return temporalResult(localValue, "tzid", timeZoneId, resolved.instant, resolved.ambiguity);
}

function temporalResult(
  localValue: string,
  timeZoneKind: IcsTemporalValue["timeZoneKind"],
  timeZoneId: string | null,
  instant: string | null,
  ambiguity: IcsTemporalValue["ambiguity"] = null
): IcsTemporalValue {
  return { valueType: "date-time", localValue, timeZoneKind, timeZoneId, instant, ambiguity };
}

function unixTimeToIso(value: IcalTime) {
  const milliseconds = value.toUnixTime() * 1000;
  if (!Number.isFinite(milliseconds)) throw new EventNormalizationError("invalid_date");
  return new Date(milliseconds).toISOString();
}

function resolveIanaWallTime(value: IcalTime, timeZoneId: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZoneId,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    return null;
  }

  const desired = wallParts(value);
  const wallAsUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  const offsets = new Set([
    offsetAt(formatter, wallAsUtc - 36 * 60 * 60 * 1000),
    offsetAt(formatter, wallAsUtc),
    offsetAt(formatter, wallAsUtc + 36 * 60 * 60 * 1000)
  ]);
  const matches = Array.from(offsets)
    .map((offset) => wallAsUtc - offset)
    .filter((candidate) => sameWallParts(formatter, candidate, desired))
    .sort((left, right) => left - right);

  if (matches.length) {
    return {
      instant: new Date(matches[0]).toISOString(),
      ambiguity: matches.length > 1 ? "dst_overlap_first" as const : null
    };
  }

  const offsetBefore = offsetAt(formatter, wallAsUtc - 36 * 60 * 60 * 1000);
  const gapCandidate = wallAsUtc - offsetBefore;
  if (!Number.isFinite(gapCandidate)) return null;
  return { instant: new Date(gapCandidate).toISOString(), ambiguity: "dst_gap_before_offset" as const };
}

function offsetAt(formatter: Intl.DateTimeFormat, instant: number) {
  const parts = formattedParts(formatter, instant);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
}

function formattedParts(formatter: Intl.DateTimeFormat, instant: number) {
  const result: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      result[part.type] = Number(part.value);
    }
  }
  return result as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function wallParts(value: IcalTime) {
  return {
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
    second: value.second
  };
}

function sameWallParts(
  formatter: Intl.DateTimeFormat,
  instant: number,
  desired: ReturnType<typeof wallParts>
) {
  const actual = formattedParts(formatter, instant);
  return Object.entries(desired).every(([key, value]) => actual[key as keyof typeof actual] === value);
}

function isValidRawTemporal(rawValue: string, type: string) {
  if (type === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawValue);
    return Boolean(match && validDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z)?$/.exec(rawValue);
  return Boolean(
    match
      && validDate(Number(match[1]), Number(match[2]), Number(match[3]))
      && Number(match[4]) <= 23
      && Number(match[5]) <= 59
      && Number(match[6]) <= 59
  );
}

function validDate(year: number, month: number, day: number) {
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateDateRange(start: IcsTemporalValue, end: IcsTemporalValue | null) {
  if (!end) return;
  if (start.valueType !== end.valueType) throw new EventNormalizationError("invalid_date_range");

  if (start.valueType === "date") {
    if (end.localValue <= start.localValue) throw new EventNormalizationError("invalid_date_range");
    return;
  }

  if (start.instant && end.instant && end.instant <= start.instant) {
    throw new EventNormalizationError("invalid_date_range");
  }
  if (!start.instant && !end.instant && end.localValue <= start.localValue) {
    throw new EventNormalizationError("invalid_date_range");
  }
}

function participantFromProperty(property: IcalProperty, role: string): IcsParticipant | null {
  const rawValue = property.getFirstValue();
  if (typeof rawValue !== "string") return null;
  const email = calendarAddressEmail(rawValue);
  if (!email) return null;
  return {
    email,
    commonName: optionalText(property.getFirstParameter("cn")) ?? null,
    role,
    participationStatus: optionalText(property.getFirstParameter("partstat"))?.toUpperCase() ?? null
  };
}

function attendeeRole(property: IcalProperty) {
  return optionalText(property.getFirstParameter("role"))?.toUpperCase() ?? "REQ-PARTICIPANT";
}

function calendarAddressEmail(value: string) {
  const withoutScheme = value.replace(/^mailto:/i, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutScheme);
  } catch {
    decoded = withoutScheme;
  }
  const email = decoded.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
}

function dedupeParticipants(participants: IcsParticipant[]) {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = `${participant.email}|${participant.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function temporalWarnings(start: IcsTemporalValue, end: IcsTemporalValue | null) {
  const warnings: NormalizedIcsEvent["warnings"] = [];
  if (start.ambiguity === "floating") warnings.push("floating_start");
  if (end?.ambiguity === "floating") warnings.push("floating_end");
  if (start.ambiguity === "dst_overlap_first" || end?.ambiguity === "dst_overlap_first") warnings.push("dst_overlap");
  if (start.ambiguity === "dst_gap_before_offset" || end?.ambiguity === "dst_gap_before_offset") warnings.push("dst_gap");
  return warnings;
}

function hasRecurrenceSignal(signals: RecurrenceSignals) {
  return signals.rrule || signals.rdate || signals.exdate || signals.recurrenceId;
}

function exclusion(
  candidate: ComponentCandidate,
  category: ExcludedIcsEvent["category"],
  reason: IcsExclusionReason
): ExcludedIcsEvent {
  return { entryId: candidate.entryId, uid: candidate.uid, category, reason };
}

function invalidReason(error: unknown): IcsExclusionReason {
  return error instanceof EventNormalizationError ? error.reason : "unsupported_component";
}

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

class EventNormalizationError extends Error {
  readonly reason: IcsExclusionReason;

  constructor(reason: IcsExclusionReason) {
    super(reason);
    this.reason = reason;
  }
}
