import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseIcsCalendar, type NormalizedIcsEvent } from "../lib/icsImport.ts";
import {
  buildIcsImportReviewSnapshot,
  icsReviewDescription,
  isPossibleDuplicate,
  selectedIcsEventsFromSnapshot,
  type CalendarInteractionForIcsReview,
  type ExistingIcsSourceForReview,
  type IcsMaterialSnapshot
} from "../lib/icsImportReview.ts";

function calendar(events: string) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:PUBLISH\r\n${events}\r\nEND:VCALENDAR`;
}

function event(input: {
  uid: string;
  start?: string;
  end?: string;
  summary?: string;
  description?: string;
  attendees?: string[];
  extra?: string;
}) {
  return `BEGIN:VEVENT\r\nUID:${input.uid}\r\nDTSTART:${input.start ?? "20261008T130000Z"}\r\n${input.end ? `DTEND:${input.end}\r\n` : ""}SUMMARY:${input.summary ?? "Café profesional"}\r\nDESCRIPTION:${input.description ?? "Conversación inicial"}\r\n${(input.attendees ?? ["ada@example.com"]).map((email) => `ATTENDEE:mailto:${email}`).join("\r\n")}\r\n${input.extra ?? ""}\r\nEND:VEVENT`;
}

function parsed(events: string) {
  return parseIcsCalendar(calendar(events));
}

function interaction(overrides: Partial<CalendarInteractionForIcsReview> = {}): CalendarInteractionForIcsReview {
  return {
    id: "interaction-1",
    interactionType: "calendar",
    title: "Café profesional",
    description: "Conversación inicial",
    occurredAt: "2026-10-08T13:00:00.000Z",
    endAt: null,
    participantEmails: ["ada@example.com"],
    sourceProvider: "google",
    ...overrides
  };
}

function material(source = event({ uid: "persisted@example.com" })): IcsMaterialSnapshot {
  const [persisted] = parsed(source).events;
  return {
    start: persisted.start,
    end: persisted.end,
    location: persisted.location,
    organizer: persisted.organizer,
    attendees: persisted.attendees,
    status: persisted.status,
    method: persisted.method
  };
}

function existingSource(
  uid: string,
  interactionId = "interaction-1",
  persistedMaterial = material()
): ExistingIcsSourceForReview {
  return {
    uid,
    interactionId,
    contentHash: "a".repeat(64),
    updatedAt: "2026-10-08T12:00:00.000Z",
    material: persistedMaterial
  };
}

function snapshot(input: {
  source?: string;
  sources?: ExistingIcsSourceForReview[];
  interactions?: CalendarInteractionForIcsReview[];
} = {}) {
  const parsedResult = parsed(input.source ?? event({ uid: "new@example.com" }));
  const focusContactIdsByEmail = new Map<string, string>();
  for (const parsedEvent of parsedResult.events) {
    if (parsedEvent.organizer) focusContactIdsByEmail.set(parsedEvent.organizer.email.toLowerCase(), "11111111-1111-4111-8111-111111111111");
    for (const attendee of parsedEvent.attendees) {
      focusContactIdsByEmail.set(attendee.email.toLowerCase(), "11111111-1111-4111-8111-111111111111");
    }
  }
  return buildIcsImportReviewSnapshot({
    parsed: parsedResult,
    existingIcsSources: input.sources ?? [],
    calendarInteractions: input.interactions ?? [],
    focusContactIdsByEmail,
    minimumStartIso: "2026-01-01T00:00:00.000Z"
  });
}

test("clasifica nuevas sin seleccionarlas por defecto", () => {
  const result = snapshot();
  assert.equal(result.changes[0].metadata?.icsCategory, "new");
  assert.equal(result.changes[0].type, "new");
  assert.equal(result.changes[0].defaultSelected, false);
  assert.equal(result.changes[0].blocking, false);
});

test("clasifica mismo UID exacto como modificado sin exponer DESCRIPTION en la fila", () => {
  const result = snapshot({
    source: event({ uid: "Case@Example.com", summary: "Título nuevo", description: "Descripción nueva" }),
    sources: [existingSource("Case@Example.com")],
    interactions: [interaction({ title: "Título anterior", description: "Descripción anterior" })]
  });
  const [change] = result.changes;

  assert.equal(change.type, "modified");
  assert.equal(change.defaultSelected, false);
  assert.equal(change.fields.find((field) => field.label === "Fecha")?.changed, false);
  assert.equal(change.fields.find((field) => field.label === "Título")?.changed, true);
  assert.equal(change.fields.some((field) => field.label === "Descripción"), false);
  assert.equal(change.fields.find((field) => field.label === "Estado de importación")?.after, "Modificada");
});

test("un cambio de fecha final también clasifica la identidad exacta como modificada", () => {
  const result = snapshot({
    source: event({ uid: "changed-end@example.com", end: "20261008T143000Z" }),
    sources: [existingSource(
      "changed-end@example.com",
      "interaction-1",
      material(event({ uid: "changed-end@example.com", end: "20261008T140000Z" }))
    )],
    interactions: [interaction({ endAt: "2026-10-08T14:00:00.000Z" })]
  });

  assert.equal(result.changes[0].type, "modified");
  assert.equal(result.changes[0].fields.find((field) => field.label === "Fecha")?.changed, true);
});

test("clasifica mismo UID y contenido material como sin cambios", () => {
  const result = snapshot({
    source: event({ uid: "same@example.com" }),
    sources: [existingSource("same@example.com")],
    interactions: [interaction()]
  });
  const [change] = result.changes;

  assert.equal(change.type, "unchanged");
  assert.equal(change.defaultSelected, false);
  assert.equal(change.blocking, true);
  assert.equal(change.metadata?.showInformationalFields, true);
});

test("clasifica como modificada una cita cuyo único cambio es la ubicación", () => {
  const result = snapshot({
    source: event({ uid: "location@example.com", extra: "LOCATION:Sala nueva" }),
    sources: [existingSource("location@example.com")],
    interactions: [interaction()]
  });

  assert.equal(result.changes[0].type, "modified");
  assert.equal(result.changes[0].fields.find((field) => field.label === "Ubicación")?.changed, true);
});

test("clasifica como modificada una cita cuyo único cambio son los participantes", () => {
  const result = snapshot({
    source: event({ uid: "participants-change@example.com", attendees: ["grace@example.com"] }),
    sources: [existingSource("participants-change@example.com")],
    interactions: [interaction()]
  });

  assert.equal(result.changes[0].type, "modified");
  assert.equal(result.changes[0].fields.find((field) => field.label === "Participantes del archivo")?.changed, true);
});

test("el orden de participantes no genera una modificación artificial", () => {
  const result = snapshot({
    source: event({
      uid: "participant-order@example.com",
      attendees: ["grace@example.com", "ada@example.com"]
    }),
    sources: [existingSource(
      "participant-order@example.com",
      "interaction-1",
      material(event({
        uid: "participant-order@example.com",
        attendees: ["ada@example.com", "grace@example.com"]
      }))
    )],
    interactions: [interaction({ participantEmails: ["ada@example.com", "grace@example.com"] })]
  });

  assert.equal(result.changes[0].type, "unchanged");
});

test("clasifica como modificada una cita cuyo único cambio es la zona horaria", () => {
  const zoned = [
    "BEGIN:VEVENT",
    "UID:timezone@example.com",
    "DTSTART;TZID=America/Santiago:20261008T100000",
    "SUMMARY:Café profesional",
    "DESCRIPTION:Conversación inicial",
    "ATTENDEE:mailto:ada@example.com",
    "END:VEVENT"
  ].join("\r\n");
  const result = snapshot({
    source: zoned,
    sources: [existingSource("timezone@example.com")],
    interactions: [interaction()]
  });

  assert.equal(result.changes[0].type, "modified");
  assert.equal(result.changes[0].fields.find((field) => field.label === "Fecha")?.changed, false);
  assert.equal(result.changes[0].fields.find((field) => field.label === "Zona horaria")?.changed, true);
});

test("clasifica cambios funcionales de organizador y estado, pero no METHOD informativo", () => {
  const changed = snapshot({
    source: event({
      uid: "other-material@example.com",
      extra: "ORGANIZER;CN=Grace:mailto:grace@example.com\r\nSTATUS:TENTATIVE"
    }),
    sources: [existingSource("other-material@example.com")],
    interactions: [interaction()]
  });
  assert.equal(changed.changes[0].type, "modified");
  assert.equal(changed.changes[0].fields.find((field) => field.label === "Organizador")?.changed, true);
  assert.equal(changed.changes[0].fields.find((field) => field.label === "Estado del evento")?.changed, true);

  const methodOnly = snapshot({
    source: event({ uid: "method-only@example.com" }),
    sources: [existingSource("method-only@example.com", "interaction-1", {
      ...material(),
      method: null
    })],
    interactions: [interaction()]
  });
  assert.equal(methodOnly.changes[0].type, "unchanged");
});

test("UID es case-sensitive y no enlaza una fuente con casing distinto", () => {
  const result = snapshot({
    source: event({ uid: "Case@Example.com" }),
    sources: [existingSource("case@example.com")]
  });
  assert.equal(result.changes[0].metadata?.icsCategory, "new");
});

test("el mismo UID registrado por otro archivo mantiene idempotencia exacta", () => {
  const first = snapshot();
  const eventFromFirstFile = first.events[0].event;
  const second = buildIcsImportReviewSnapshot({
    parsed: { events: [eventFromFirstFile], excluded: [], counts: first.sourceCounts },
    existingIcsSources: [existingSource(eventFromFirstFile.uid)],
    calendarInteractions: [interaction()],
    focusContactIdsByEmail: new Map([["ada@example.com", "11111111-1111-4111-8111-111111111111"]]),
    minimumStartIso: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(second.changes[0].type, "unchanged");
});

test("omite sin candidatos una cita sin coincidencia Focus y conserva el recuento agregado", () => {
  const parsedResult = parsed(event({ uid: "no-focus@example.com", attendees: ["no-focus@example.com"] }));
  const result = buildIcsImportReviewSnapshot({
    parsed: parsedResult,
    existingIcsSources: [],
    calendarInteractions: [],
    focusContactIdsByEmail: new Map(),
    minimumStartIso: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(result.events.length, 0);
  assert.equal(result.changes.length, 0);
  assert.equal(result.focusOmittedCount, 1);
  assert.match(icsReviewDescription(result), /1 cita sin contactos Foco fue omitida/);
});

test("conserva todos los contactos Focus inequívocos de organizador y asistentes", () => {
  const parsedResult = parsed(event({
    uid: "several-focus@example.com",
    attendees: ["one@example.com", "two@example.com"],
    extra: "ORGANIZER:mailto:owner@example.com"
  }));
  const result = buildIcsImportReviewSnapshot({
    parsed: parsedResult,
    existingIcsSources: [],
    calendarInteractions: [],
    focusContactIdsByEmail: new Map([
      ["owner@example.com", "11111111-1111-4111-8111-111111111111"],
      ["one@example.com", "22222222-2222-4222-8222-222222222222"],
      ["two@example.com", "33333333-3333-4333-8333-333333333333"]
    ]),
    minimumStartIso: "2026-01-01T00:00:00.000Z"
  });

  assert.deepEqual(result.events[0].focusContactIds, [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]);
});

test("detecta duplicado heurístico contra Google sin confundir event.id con UID", () => {
  const result = snapshot({ interactions: [interaction({ id: "google-event-id", sourceProvider: "google" })] });
  const [change] = result.changes;

  assert.equal(change.metadata?.icsCategory, "possible_duplicate");
  assert.equal(change.defaultSelected, false);
  assert.equal(change.blocking, false);
  assert.deepEqual(change.metadata?.possibleDuplicateInteractionIds, ["google-event-id"]);
  assert.equal(change.metadata?.icsUid, "new@example.com");
  assert.match(change.reason ?? "", /Café profesional/);
  assert.match(change.reason ?? "", /Google Calendar/);
  assert.match(change.reason ?? "", /fecha y hora exactas/);
});

test("detecta duplicados heurísticos dentro del mismo archivo", () => {
  const result = snapshot({
    source: [
      event({ uid: "first@example.com" }),
      event({ uid: "second@example.com" })
    ].join("\r\n")
  });

  assert.deepEqual(result.changes.map((change) => change.metadata?.icsCategory), ["new", "possible_duplicate"]);
  assert.deepEqual(result.changes.map((change) => change.defaultSelected), [false, false]);
});

test("no marca citas parecidas si cambia hora, título, participantes o duración conocida", () => {
  const [candidate] = parsed(event({
    uid: "candidate@example.com",
    end: "20261008T140000Z"
  })).events;
  const base = interaction({ endAt: "2026-10-08T14:00:00.000Z" });

  assert.equal(isPossibleDuplicate(candidate, { ...base, occurredAt: "2026-10-08T13:01:00.000Z" }), false);
  assert.equal(isPossibleDuplicate(candidate, { ...base, title: "Otro café" }), false);
  assert.equal(isPossibleDuplicate(candidate, { ...base, participantEmails: ["grace@example.com"] }), false);
  assert.equal(isPossibleDuplicate(candidate, { ...base, endAt: "2026-10-08T14:30:00.000Z" }), false);
});

test("Google puede conservar un subconjunto Foco, pero no admite participantes ajenos", () => {
  const [candidate] = parsed(event({
    uid: "participants@example.com",
    attendees: ["Ada@Example.com", "grace@example.com"]
  })).events;

  assert.equal(isPossibleDuplicate(candidate, interaction({ participantEmails: ["GRACE@example.com", "ada@example.com"] })), true);
  assert.equal(isPossibleDuplicate(candidate, interaction({ participantEmails: ["ada@example.com"], sourceProvider: "google" })), true);
  assert.equal(isPossibleDuplicate(candidate, interaction({ participantEmails: ["ada@example.com"], sourceProvider: "ics_file" })), false);
  assert.equal(isPossibleDuplicate(candidate, interaction({ participantEmails: ["ada@example.com", "other@example.com"], sourceProvider: "google" })), false);
  assert.equal(isPossibleDuplicate({ ...candidate, attendees: [], organizer: null }, interaction({ participantEmails: [] })), false);
});

test("all-day queda omitido solo como recuento agregado", () => {
  const allDay = `BEGIN:VEVENT\r\nUID:all-day@example.com\r\nDTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009\r\nSUMMARY:Offsite\r\nATTENDEE:mailto:ada@example.com\r\nEND:VEVENT`;
  const result = snapshot({
    source: allDay,
    interactions: [interaction({ occurredAt: null, title: "Offsite" })]
  });

  assert.equal(result.sourceCounts.allDay, 1);
  assert.equal(result.changes.length, 0);
  assert.equal(result.omissionCounts.allDay, 1);
  assert.match(icsReviewDescription(result), /1 cita de día completo fue omitida/);
});

test("iCalendar conserva tabs propios vacíos cuando el archivo solo tiene omisiones agregadas", () => {
  const allDay = `BEGIN:VEVENT\r\nUID:omitted-tab@example.com\r\nDTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009\r\nSUMMARY:Offsite\r\nATTENDEE:mailto:ada@example.com\r\nEND:VEVENT`;
  const result = snapshot({ source: allDay });
  const previewSource = readFileSync(new URL("../components/IcsImportPreviewDialog.tsx", import.meta.url), "utf8");
  const syncPreviewSource = readFileSync(new URL("../components/SyncPreviewDialog.tsx", import.meta.url), "utf8");

  assert.deepEqual(result.changes, []);
  assert.match(previewSource, /ICS_PREVIEW_TABS\.filter\(\(tab\) => snapshot\?\.changes\.some\(tab\.matches\)\)/);
  assert.match(previewSource, /tabs=\{tabs\}/);
  assert.match(syncPreviewSource, /if \(customTabs !== undefined\) return \[\.\.\.customTabs\];/);
  assert.doesNotMatch(syncPreviewSource, /customTabs\?\.length/);
});

test("floating queda omitido de forma agregada y no inventa timezone", () => {
  const result = snapshot({
    source: event({ uid: "floating@example.com", start: "20261008T100000", end: "20261008T110000" })
  });
  assert.equal(result.changes.length, 0);
  assert.equal(result.omissionCounts.other, 1);
});

test("preserva participantes sin contactos como emails en el snapshot", () => {
  const result = snapshot({ source: event({ uid: "people@example.com", attendees: ["external@example.net"] }) });
  assert.deepEqual(result.events[0].event.attendees.map((attendee) => attendee.email), ["external@example.net"]);
  assert.match(result.changes[0].fields.find((field) => field.label === "Participantes")?.after ?? "", /external@example.net/);
});

test("recurrentes, canceladas e inválidas se resumen sin filas individuales", () => {
  const source = [
    event({ uid: "recurring@example.com", extra: "RRULE:FREQ=WEEKLY" }),
    event({ uid: "cancelled@example.com", extra: "STATUS:CANCELLED" }),
    `BEGIN:VEVENT\r\nDTSTART:20261008T130000Z\r\nSUMMARY:No UID\r\nEND:VEVENT`
  ].join("\r\n");
  const result = snapshot({ source });

  assert.deepEqual(result.sourceCounts, {
    total: 3,
    importable: 0,
    cancelled: 1,
    recurrent: 1,
    allDay: 0,
    invalid: 1,
    recurrentSeries: 1
  });
  assert.equal(result.changes.length, 0);
  assert.match(icsReviewDescription(result), /1 cita recurrente fue omitida/);
  assert.match(icsReviewDescription(result), /1 cita cancelada fue omitida/);
  assert.match(icsReviewDescription(result), /1 cita inválida fue omitida/);
});

test("omite por fecha civil antes de Foco y mantiene inclusivo el día configurado", () => {
  const parsedResult = parsed([
    event({ uid: "before@example.com", start: "20260101T235959Z" }),
    event({ uid: "inclusive@example.com", start: "20260102T000000Z" })
  ].join("\r\n"));
  const result = buildIcsImportReviewSnapshot({
    parsed: parsedResult,
    existingIcsSources: [],
    calendarInteractions: [interaction({ occurredAt: "2026-01-01T23:59:59.000Z" })],
    focusContactIdsByEmail: new Map([["ada@example.com", "11111111-1111-4111-8111-111111111111"]]),
    minimumStartIso: "2026-01-02T00:00:00.000Z"
  });

  assert.deepEqual(result.changes.map((change) => change.metadata?.icsUid), ["inclusive@example.com"]);
  assert.equal(result.omissionCounts.beforeNetworkingStart, 1);
  assert.match(icsReviewDescription(result), /1 cita anterior al inicio de networking fue omitida/);
});

test("filtra por fecha civil UTC del instante y no por la fecha local declarada", () => {
  const parsedResult = parsed([
    event({ uid: "utc-inclusive@example.com", start: "20260102T003000Z" }),
    event({ uid: "utc-before@example.com", start: "20260101T233000Z" })
  ].join("\r\n"));
  parsedResult.events[0] = {
    ...parsedResult.events[0],
    start: {
      ...parsedResult.events[0].start,
      localValue: "2026-01-01T21:30:00",
      timeZoneKind: "tzid",
      timeZoneId: "America/Santiago"
    }
  };
  parsedResult.events[1] = {
    ...parsedResult.events[1],
    start: {
      ...parsedResult.events[1].start,
      localValue: "2026-01-02T00:30:00"
    }
  };

  const result = buildIcsImportReviewSnapshot({
    parsed: parsedResult,
    existingIcsSources: [],
    calendarInteractions: [],
    focusContactIdsByEmail: new Map([["ada@example.com", "11111111-1111-4111-8111-111111111111"]]),
    minimumStartIso: "2026-01-02T00:00:00.000Z"
  });

  assert.deepEqual(result.changes.map((change) => change.metadata?.icsUid), ["utc-inclusive@example.com"]);
  assert.equal(result.omissionCounts.beforeNetworkingStart, 1);
});

test("ordena citas elegibles por fecha descendente y conserva orden fuente en empates", () => {
  const result = snapshot({
    source: [
      event({ uid: "old@example.com", start: "20261008T120000Z" }),
      event({ uid: "new-a@example.com", start: "20261009T120000Z" }),
      event({ uid: "new-b@example.com", start: "20261009T120000Z", summary: "Otra cita" })
    ].join("\r\n")
  });
  assert.deepEqual(result.events.map(({ event: item }) => item.uid), [
    "new-a@example.com",
    "new-b@example.com",
    "old@example.com"
  ]);
});

test("la selección devuelve solo eventos accionables del snapshot sin reparsear", () => {
  const result = snapshot({
    source: [event({ uid: "first@example.com" }), event({ uid: "second@example.com", start: "20261008T150000Z" })].join("\r\n")
  });
  const secondChange = result.changes.find((change) => change.metadata?.icsUid === "second@example.com");
  const selected = selectedIcsEventsFromSnapshot(result, [secondChange?.id ?? "", "outside-snapshot"]);

  assert.deepEqual(selected.map((item) => item.uid), ["second@example.com"]);
});

test("el wrapper reutiliza SyncPreviewDialog y Cuenta mantiene feature gate explícito", () => {
  const previewSource = readFileSync(new URL("../components/IcsImportPreviewDialog.tsx", import.meta.url), "utf8");
  const accountSource = readFileSync(new URL("../components/AccountPage.tsx", import.meta.url), "utf8");
  const syncPreviewSource = readFileSync(new URL("../components/SyncPreviewDialog.tsx", import.meta.url), "utf8");

  assert.match(previewSource, /<SyncPreviewDialog/);
  assert.match(previewSource, /Importar selección/);
  assert.doesNotMatch(previewSource, /supabase|syncExternalInteraction|insert\(|update\(/);
  assert.match(accountSource, /isIcsImportEnabled\(\)/);
  assert.match(accountSource, /<IcsImportPanel \/>/);
  assert.match(accountSource, /SourcePlaceholder icon="file" title="iCalendar \(\.ics\)"/);
  assert.match(syncPreviewSource, /showInformationalFields === true/);
  assert.match(syncPreviewSource, /showReason === true/);
});
