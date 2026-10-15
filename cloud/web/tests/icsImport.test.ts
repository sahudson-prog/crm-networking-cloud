import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  IcsImportError,
  MAX_ICS_EVENT_COMPONENTS,
  MAX_ICS_FILE_BYTES,
  MAX_ICS_PARTICIPANTS_PER_EVENT,
  parseIcsCalendar
} from "../lib/icsImport.ts";

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/ics/${name}.ics`, import.meta.url), "utf8");
}

function calendar(events: string, method = "PUBLISH") {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:${method}\r\n${events}\r\nEND:VCALENDAR`;
}

function event(properties: string) {
  return `BEGIN:VEVENT\r\n${properties}\r\nEND:VEVENT`;
}

test("normaliza una exportación Google con UID exacto, folding, escapes y participantes", () => {
  const result = parseIcsCalendar(fixture("google"));
  const [item] = result.events;

  assert.equal(result.counts.importable, 1);
  assert.equal(item.uid, "Google-Case-Sensitive@example.com");
  assert.equal(item.start.instant, "2026-09-15T13:00:00.000Z");
  assert.equal(item.end?.instant, "2026-09-15T14:00:00.000Z");
  assert.equal(item.summary, "Café con equipo, producto");
  assert.match(item.description, /siguiente línea sin perder contenido/);
  assert.equal(item.location, "Café Central; Providencia");
  assert.deepEqual(item.organizer, {
    email: "boss@example.com",
    commonName: "Jefa",
    role: "organizer",
    participationStatus: null
  });
  assert.deepEqual(item.attendees.map(({ email, role }) => ({ email, role })), [
    { email: "ada@example.com", role: "REQ-PARTICIPANT" },
    { email: "grace@example.com", role: "OPT-PARTICIPANT" }
  ]);
});

test("resuelve TZID IANA con DST sin depender de la zona local", () => {
  const result = parseIcsCalendar(fixture("apple"));

  assert.deepEqual(result.events.map((item) => item.start.instant), [
    "2026-01-15T14:00:00.000Z",
    "2026-07-15T13:00:00.000Z"
  ]);
  assert.ok(result.events.every((item) => item.start.timeZoneId === "America/New_York"));
});

test("usa VTIMEZONE embebido para un TZID de Outlook no registrado por Intl", () => {
  const [item] = parseIcsCalendar(fixture("outlook")).events;

  assert.equal(item.start.timeZoneKind, "tzid");
  assert.equal(item.start.timeZoneId, "Pacific Standard Time");
  assert.equal(item.start.instant, "2026-06-10T15:30:00.000Z");
  assert.equal(item.attendees[0].email, "external@example.net");
});

test("omite all-day por semántica VALUE=DATE sin contarlo como inválido", () => {
  const result = parseIcsCalendar(calendar(event(`UID:all-day@example.com
DTSTART;VALUE=DATE:20261008
DTEND;VALUE=DATE:20261009
SUMMARY:All day`)));
  assert.equal(result.events.length, 0);
  assert.equal(result.counts.allDay, 1);
  assert.equal(result.counts.invalid, 0);
  assert.deepEqual(result.excluded[0], {
    entryId: "ics-0",
    uid: "all-day@example.com",
    category: "all_day",
    reason: "all_day"
  });
});

test("mantiene floating time explícitamente ambiguo", () => {
  const result = parseIcsCalendar(calendar(event(`UID:floating@example.com
DTSTART:20261008T093000
DTEND:20261008T103000
SUMMARY:Floating`)));
  const [item] = result.events;

  assert.equal(item.start.timeZoneKind, "floating");
  assert.equal(item.start.instant, null);
  assert.deepEqual(item.warnings, ["floating_start", "floating_end"]);
});

test("aplica la semántica RFC para overlap y gap DST", () => {
  const source = calendar([
    event(`UID:overlap@example.com
DTSTART;TZID=America/New_York:20261101T013000
DTEND;TZID=America/New_York:20261101T023000
SUMMARY:Overlap`),
    event(`UID:gap@example.com
DTSTART;TZID=America/New_York:20260308T023000
DTEND;TZID=America/New_York:20260308T040000
SUMMARY:Gap`)
  ].join("\r\n"));
  const result = parseIcsCalendar(source);

  assert.equal(result.events[0].start.instant, "2026-11-01T05:30:00.000Z");
  assert.ok(result.events[0].warnings.includes("dst_overlap"));
  assert.equal(result.events[1].start.instant, "2026-03-08T07:30:00.000Z");
  assert.ok(result.events[1].warnings.includes("dst_gap"));
});

test("UID conserva mayúsculas y minúsculas como identidades distintas", () => {
  const result = parseIcsCalendar(calendar([
    event(`UID:Case@Example.com\r\nDTSTART:20261008T100000Z\r\nSUMMARY:One`),
    event(`UID:case@example.com\r\nDTSTART:20261008T110000Z\r\nSUMMARY:Two`)
  ].join("\r\n")));

  assert.deepEqual(result.events.map((item) => item.uid), ["Case@Example.com", "case@example.com"]);
});

test("clasifica cada entrada una sola vez y propaga una serie por UID", () => {
  const result = parseIcsCalendar(calendar([
    event(`UID:cancelled@example.com\r\nDTSTART:20261008T100000Z\r\nSTATUS:CANCELLED`),
    event(`UID:rrule@example.com\r\nDTSTART:20261008T100000Z\r\nRRULE:FREQ=DAILY`),
    event(`UID:rdate@example.com\r\nDTSTART:20261008T100000Z\r\nRDATE:20261009T100000Z`),
    event(`UID:exdate@example.com\r\nDTSTART:20261008T100000Z\r\nEXDATE:20261009T100000Z`),
    event(`UID:series@example.com\r\nDTSTART:20261008T100000Z\r\nRRULE:FREQ=WEEKLY`),
    event(`UID:series@example.com\r\nRECURRENCE-ID:20261015T100000Z\r\nDTSTART:20261015T110000Z`),
    event(`UID:series@example.com\r\nDTSTART:20261022T100000Z`),
    event(`DTSTART:20261008T100000Z\r\nSUMMARY:Missing UID`),
    event(`UID:bad-date@example.com\r\nDTSTART:20260230T100000Z`),
    event(`UID:valid@example.com\r\nDTSTART:20261008T100000Z`)
  ].join("\r\n")));

  assert.deepEqual(result.counts, {
    total: 10,
    importable: 1,
    cancelled: 1,
    recurrent: 6,
    allDay: 0,
    invalid: 2,
    recurrentSeries: 4
  });
  assert.equal(result.events[0].uid, "valid@example.com");
  assert.deepEqual(result.excluded.map((item) => item.reason), [
    "cancelled",
    "recurring",
    "recurring",
    "recurring",
    "recurring",
    "recurring",
    "recurring",
    "missing_uid",
    "invalid_date"
  ]);
});

test("METHOD:CANCEL excluye el componente sin duplicar conteos", () => {
  const result = parseIcsCalendar(calendar(event(`UID:cancel@example.com\r\nDTSTART:20261008T100000Z`), "CANCEL"));
  assert.deepEqual(result.counts, {
    total: 1,
    importable: 0,
    cancelled: 1,
    recurrent: 0,
    allDay: 0,
    invalid: 0,
    recurrentSeries: 0
  });
});

test("rechaza TZID desconocido sin VTIMEZONE", () => {
  const result = parseIcsCalendar(calendar(event(`UID:unknown-zone@example.com
DTSTART;TZID=Custom/Unknown:20261008T100000
DTEND;TZID=Custom/Unknown:20261008T110000`)));

  assert.equal(result.counts.invalid, 1);
  assert.equal(result.excluded[0].reason, "unresolved_timezone");
});

test("rechaza archivos vacíos o malformados sin incluir contenido en el error", () => {
  assert.throws(() => parseIcsCalendar(""), (error) => {
    assert.ok(error instanceof IcsImportError);
    assert.equal(error.code, "invalid_calendar");
    assert.doesNotMatch(error.message, /BEGIN|correo|UID/);
    return true;
  });
  assert.throws(() => parseIcsCalendar("BEGIN:VCALENDAR\nBROKEN"), IcsImportError);
});

test("limita bytes, componentes y participantes antes de consumir recursos sin límite", () => {
  assert.throws(
    () => parseIcsCalendar("x".repeat(MAX_ICS_FILE_BYTES + 1)),
    (error) => error instanceof IcsImportError && error.code === "file_too_large"
  );

  const tooManyComponents = `BEGIN:VCALENDAR\n${"BEGIN:VEVENT\nEND:VEVENT\n".repeat(MAX_ICS_EVENT_COMPONENTS + 1)}END:VCALENDAR`;
  assert.throws(
    () => parseIcsCalendar(tooManyComponents),
    (error) => error instanceof IcsImportError && error.code === "too_many_components"
  );

  const attendees = Array.from(
    { length: MAX_ICS_PARTICIPANTS_PER_EVENT + 1 },
    (_, index) => `ATTENDEE:mailto:user${index}@example.com`
  ).join("\r\n");
  const result = parseIcsCalendar(calendar(event(`UID:crowded@example.com\r\nDTSTART:20261008T100000Z\r\n${attendees}`)));
  assert.equal(result.excluded[0].reason, "too_many_participants");
});

test("una instancia aislada sin señales es indistinguible y se conserva como individual", () => {
  const result = parseIcsCalendar(calendar(event(`UID:isolated@example.com
DTSTART:20261008T100000Z
DTEND:20261008T110000Z
SUMMARY:Exported occurrence without recurrence markers`)));

  assert.equal(result.counts.importable, 1);
  assert.deepEqual(result.events[0].recurrenceSignals, {
    rrule: false,
    rdate: false,
    exdate: false,
    recurrenceId: false
  });
});
