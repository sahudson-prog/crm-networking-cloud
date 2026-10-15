import assert from "node:assert/strict";
import test from "node:test";

import { parseIcsCalendar, type NormalizedIcsEvent } from "../lib/icsImport.ts";
import {
  ICS_IMPORT_EXTERNAL_OBJECT_TYPE,
  ICS_IMPORT_PROVIDER,
  ICS_IMPORT_SOURCE_SERVICE,
  IcsImportDataError,
  buildIcsImportReviewFromPersistedData,
  buildIcsPersistenceDraft,
  focusContactIdsByUnambiguousEmail,
  icsExternalIdForUid,
  isMissingInteractionLifecycleColumn,
  readIcsImportReviewData,
  type IcsExternalSourceReadRow,
  type IcsImportReadGateway,
  type IcsInteractionReadRow,
  type IcsParticipantReadRow
} from "../lib/icsImportData.ts";

test("resuelve Focus solo cuando el email pertenece a un único contacto activo", () => {
  const contacts = [
    { id: "focus", is_active: true, networking_focus: true },
    { id: "not-focus", is_active: true, networking_focus: false },
    { id: "inactive", is_active: false, networking_focus: true }
  ];
  const result = focusContactIdsByUnambiguousEmail(contacts, [
    { contact_id: "focus", normalized_email: "focus@example.com" },
    { contact_id: "not-focus", normalized_email: "plain@example.com" },
    { contact_id: "inactive", normalized_email: "inactive@example.com" },
    { contact_id: "focus", normalized_email: "ambiguous@example.com" },
    { contact_id: "not-focus", normalized_email: "ambiguous@example.com" }
  ]);

  assert.equal(result.get("focus@example.com"), "focus");
  assert.equal(result.has("plain@example.com"), false);
  assert.equal(result.has("inactive@example.com"), false);
  assert.equal(result.has("ambiguous@example.com"), false);
});

function calendar(events: string) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Coffeecito Test//EN\r\n${events}\r\nEND:VCALENDAR`;
}

function event(input: { uid?: string; summary?: string; start?: string; attendees?: string[] } = {}) {
  const attendees = (input.attendees ?? ["ada@example.com"])
    .map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${email}`)
    .join("\r\n");
  return [
    "BEGIN:VEVENT",
    `UID:${input.uid ?? "Case-Sensitive-UID@example.com"}`,
    `DTSTART:${input.start ?? "20261008T130000Z"}`,
    "DTEND:20261008T140000Z",
    `SUMMARY:${input.summary ?? "Café profesional"}`,
    "DESCRIPTION:Conversación inicial",
    "LOCATION:Café Central",
    "ORGANIZER;CN=Organizadora:mailto:owner@example.com",
    attendees,
    "END:VEVENT"
  ].join("\r\n");
}

function parsedEvent(source = event()) {
  const parsed = parseIcsCalendar(calendar(source));
  assert.equal(parsed.events.length, 1);
  return { parsed, event: parsed.events[0] };
}

function interaction(overrides: Partial<IcsInteractionReadRow> = {}): IcsInteractionReadRow {
  return {
    id: "interaction-1",
    interaction_type: "calendar",
    occurred_at: "2026-10-08T13:00:00.000Z",
    subject: "Café profesional",
    source_detail: "Conversación inicial",
    user_notes_raw: "Nota privada",
    is_deleted: false,
    prevent_reimport: false,
    metadata: {},
    updated_at: "2026-10-08T12:00:00.000Z",
    ...overrides
  };
}

function participant(overrides: Partial<IcsParticipantReadRow> = {}): IcsParticipantReadRow {
  return {
    interaction_id: "interaction-1",
    contact_id: null,
    email_identity: "ada@example.com",
    role: "ATTENDEE",
    ...overrides
  };
}

function source(overrides: Partial<IcsExternalSourceReadRow> = {}): IcsExternalSourceReadRow {
  return {
    interaction_id: "interaction-1",
    provider: "google",
    source_service: "calendar",
    external_object_type: "calendar_event",
    external_id: "CALENDAR_google-event-1",
    prevent_reimport: false,
    is_active: true,
    content_hash: "a".repeat(64),
    metadata: {},
    updated_at: "2026-10-08T12:00:00.000Z",
    ...overrides
  };
}

function gateway(input: {
  userId?: string;
  interactions?: IcsInteractionReadRow[];
  participants?: IcsParticipantReadRow[];
  sources?: IcsExternalSourceReadRow[];
  contacts?: Array<{ id: string; is_active: boolean; networking_focus: boolean }>;
  contactEmails?: Array<{ contact_id: string; normalized_email: string }>;
}) {
  const calls: Array<{ operation: string; userId?: string }> = [];
  const value: IcsImportReadGateway = {
    async currentUserId() {
      calls.push({ operation: "currentUserId" });
      return input.userId ?? "user-1";
    },
    async readCalendarInteractions(userId) {
      calls.push({ operation: "interactions", userId });
      return input.interactions ?? [];
    },
    async readInteractionParticipants(userId) {
      calls.push({ operation: "participants", userId });
      return input.participants ?? [];
    },
    async readActiveExternalSources(userId) {
      calls.push({ operation: "sources", userId });
      return input.sources ?? [];
    },
    async readContacts(userId) {
      calls.push({ operation: "contacts", userId });
      return input.contacts ?? [{ id: "contact-focus", is_active: true, networking_focus: true }];
    },
    async readContactEmails(userId) {
      calls.push({ operation: "contactEmails", userId });
      return input.contactEmails ?? [
        { contact_id: "contact-focus", normalized_email: "ada@example.com" },
        { contact_id: "contact-focus", normalized_email: "owner@example.com" }
      ];
    }
  };
  return { value, calls };
}

test("deriva una identidad determinista desde los bytes exactos del UID", async () => {
  const upper = await icsExternalIdForUid("Case-Sensitive-UID@example.com");
  const repeated = await icsExternalIdForUid("Case-Sensitive-UID@example.com");
  const lower = await icsExternalIdForUid("case-sensitive-uid@example.com");

  assert.equal(upper, repeated);
  assert.notEqual(upper, lower);
  assert.match(upper, /^ics_uid_sha256_[0-9a-f]{64}$/);
});

test("define el contrato de persistencia sin vincular contactos ni perder semántica temporal", async () => {
  const { event: importedEvent } = parsedEvent();
  const draft = await buildIcsPersistenceDraft(importedEvent);

  assert.equal(draft.interactionCreate.provider, ICS_IMPORT_PROVIDER);
  assert.equal(draft.externalSource.source_service, ICS_IMPORT_SOURCE_SERVICE);
  assert.equal(draft.externalSource.external_object_type, ICS_IMPORT_EXTERNAL_OBJECT_TYPE);
  assert.equal(draft.externalSource.connected_account_id, null);
  assert.equal(draft.externalSource.content_hash, null);
  assert.equal(draft.externalSource.last_synced_at, null);
  assert.equal(draft.interactionCreate.occurred_at, "2026-10-08T13:00:00.000Z");
  assert.equal(draft.interactionCreate.source_detail, "Conversación inicial");
  assert.equal(draft.interactionCreate.user_notes_raw, "");
  assert.equal(Object.hasOwn(draft.interactionUpdate, "user_notes_raw"), false);
  assert.equal(draft.externalSource.last_seen_at, null);
  assert.equal((draft.externalSource.metadata.ics_import as { uid: string }).uid, importedEvent.uid);
  assert.equal((draft.interactionCreate.metadata.ics_import as { location: string }).location, "Café Central");
  assert.deepEqual(draft.participants, [
    { contact_id: null, email_identity: "owner@example.com", role: "ORGANIZER" },
    { contact_id: null, email_identity: "ada@example.com", role: "REQ-PARTICIPANT" }
  ]);
});

test("lee filas autenticadas y adapta fuentes .ics y participantes sin contacto", async () => {
  const { event: importedEvent } = parsedEvent();
  const draft = await buildIcsPersistenceDraft(importedEvent);
  const dataGateway = gateway({
    interactions: [interaction({ metadata: draft.interactionCreate.metadata })],
    participants: [participant({ contact_id: null }), participant({ interaction_id: "otra-interaccion" })],
    sources: [source({
      provider: ICS_IMPORT_PROVIDER,
      source_service: ICS_IMPORT_SOURCE_SERVICE,
      external_object_type: ICS_IMPORT_EXTERNAL_OBJECT_TYPE,
      external_id: draft.identity.externalId,
      content_hash: "b".repeat(64),
      metadata: draft.externalSource.metadata
    })]
  });

  const result = await readIcsImportReviewData(dataGateway.value);

  assert.deepEqual(dataGateway.calls, [
    { operation: "currentUserId" },
    { operation: "interactions", userId: "user-1" },
    { operation: "participants", userId: "user-1" },
    { operation: "sources", userId: "user-1" },
    { operation: "contacts", userId: "user-1" },
    { operation: "contactEmails", userId: "user-1" }
  ]);
  assert.deepEqual(result.existingIcsSources, [{
    uid: importedEvent.uid,
    interactionId: "interaction-1",
    contentHash: "b".repeat(64),
    updatedAt: "2026-10-08T12:00:00.000Z",
    preventReimport: false,
    material: {
      start: importedEvent.start,
      end: importedEvent.end,
      location: importedEvent.location,
      organizer: importedEvent.organizer,
      attendees: importedEvent.attendees,
      status: importedEvent.status,
      method: importedEvent.method
    }
  }]);
  assert.deepEqual(result.calendarInteractions[0].participantEmails, ["ada@example.com"]);
  assert.equal(result.calendarInteractions[0].sourceProvider, "ics_file");
  assert.equal(result.calendarInteractions[0].endAt, "2026-10-08T14:00:00.000Z");
});

test("clasifica contra citas Google sin mezclar su identidad con la identidad .ics", async () => {
  const { parsed } = parsedEvent();
  const dataGateway = gateway({
    interactions: [interaction()],
    participants: [participant({ email_identity: "ADA@EXAMPLE.COM" }), participant({ email_identity: "owner@example.com" })],
    sources: [source()]
  });

  const snapshot = await buildIcsImportReviewFromPersistedData({
    gateway: dataGateway.value,
    minimumStartIso: "2026-01-01T00:00:00.000Z",
    parsed
  });

  assert.equal(snapshot.changes[0].metadata?.icsCategory, "possible_duplicate");
  assert.equal(snapshot.changes[0].defaultSelected, false);
  assert.deepEqual(snapshot.changes[0].metadata?.possibleDuplicateSources, ["Google Calendar"]);
});

test("un UID repetido en el archivo nunca produce dos cambios aplicables", async () => {
  const repeated = event({ uid: "same@example.com" });
  const parsed = parseIcsCalendar(calendar(`${repeated}\r\n${repeated}`));
  const snapshot = await buildIcsImportReviewFromPersistedData({
    gateway: gateway({}).value,
    minimumStartIso: "2026-01-01T00:00:00.000Z",
    parsed
  });

  const actionable = snapshot.changes.filter((change) => !change.blocking && change.type !== "unchanged" && change.type !== "skipped");
  assert.equal(actionable.length, 1);
  assert.equal(snapshot.changes.length, 1);
  assert.equal(snapshot.omissionCounts.other, 1);
});

test("falla de forma cerrada si una fuente .ics no coincide con su UID persistido", async () => {
  const { event: importedEvent } = parsedEvent();
  const draft = await buildIcsPersistenceDraft(importedEvent);
  const dataGateway = gateway({
    sources: [source({
      provider: ICS_IMPORT_PROVIDER,
      source_service: ICS_IMPORT_SOURCE_SERVICE,
      external_object_type: ICS_IMPORT_EXTERNAL_OBJECT_TYPE,
      external_id: "ics_uid_sha256_incorrecto",
      metadata: draft.externalSource.metadata
    })]
  });

  await assert.rejects(
    readIcsImportReviewData(dataGateway.value),
    (error: unknown) => error instanceof IcsImportDataError && error.code === "invalid_persisted_identity"
  );
});

test("rechaza Apply draft para una hora floating no resuelta", async () => {
  const floating: NormalizedIcsEvent = {
    ...parsedEvent().event,
    start: {
      valueType: "date-time",
      localValue: "2026-10-08T13:00:00",
      timeZoneKind: "floating",
      timeZoneId: null,
      instant: null,
      ambiguity: "floating"
    }
  };

  await assert.rejects(
    buildIcsPersistenceDraft(floating),
    (error: unknown) => error instanceof IcsImportDataError && error.code === "unsupported_event"
  );
});

test("defensa cliente rechaza all-day aunque el snapshot sea manipulado", async () => {
  const importedEvent: NormalizedIcsEvent = {
    ...parsedEvent().event,
    start: {
      valueType: "date",
      localValue: "2026-10-08",
      timeZoneKind: "date",
      timeZoneId: null,
      instant: null,
      ambiguity: null
    }
  };

  await assert.rejects(
    buildIcsPersistenceDraft(importedEvent),
    (error: unknown) => error instanceof IcsImportDataError && error.code === "unsupported_event"
  );
});

test("la variante legacy sin columnas lifecycle conserva filtros por metadata", async () => {
  const legacy = interaction({ metadata: { dismissed: true } });
  delete legacy.is_deleted;
  delete legacy.prevent_reimport;
  const result = await readIcsImportReviewData(gateway({ interactions: [legacy] }).value);
  assert.equal(result.calendarInteractions.length, 0);

  assert.equal(isMissingInteractionLifecycleColumn({ code: "42703", message: "column interactions.is_deleted does not exist" }), true);
  assert.equal(isMissingInteractionLifecycleColumn({ code: "PGRST204", message: "Could not find prevent_reimport" }), true);
  assert.equal(isMissingInteractionLifecycleColumn({ code: "42501", message: "permission denied" }), false);
});

test("schema canónico conserva soft delete y prevent_reimport físicos", async () => {
  const { event: importedEvent } = parsedEvent();
  const draft = await buildIcsPersistenceDraft(importedEvent);
  const deleted = await readIcsImportReviewData(gateway({
    interactions: [interaction({ is_deleted: true })]
  }).value);
  assert.equal(deleted.calendarInteractions.length, 0);

  const protectedIdentity = await readIcsImportReviewData(gateway({
    interactions: [interaction({ prevent_reimport: true, metadata: draft.interactionCreate.metadata })],
    sources: [source({
      provider: ICS_IMPORT_PROVIDER,
      source_service: ICS_IMPORT_SOURCE_SERVICE,
      external_object_type: ICS_IMPORT_EXTERNAL_OBJECT_TYPE,
      external_id: draft.identity.externalId,
      content_hash: "c".repeat(64),
      metadata: draft.externalSource.metadata
    })]
  }).value);
  assert.equal(protectedIdentity.existingIcsSources[0].preventReimport, true);
});
