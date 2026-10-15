import assert from "node:assert/strict";
import test from "node:test";

import { parseIcsCalendar } from "../lib/icsImport.ts";
import {
  IcsImportApplyError,
  MAX_ICS_APPLY_ITEMS,
  MAX_ICS_APPLY_PARTICIPANTS,
  applyIcsImportSelection,
  assertApplyLimits,
  buildIcsApplyItems,
  type IcsApplyRpcItem
} from "../lib/icsImportApply.ts";
import { buildIcsImportReviewSnapshot } from "../lib/icsImportReview.ts";

const INTERACTION_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-10-08T12:00:00.000Z";

function calendar(uid = "uid@example.com", summary = "Café profesional") {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTART:20261008T130000Z",
    "DTEND:20261008T140000Z",
    `SUMMARY:${summary}`,
    "DESCRIPTION:Conversación inicial",
    "LOCATION:Café Central",
    "ORGANIZER:mailto:owner@example.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:ada@example.com",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function snapshot(input: { modified?: boolean; possibleDuplicate?: boolean } = {}) {
  const parsed = parseIcsCalendar(calendar("Case-Sensitive@example.com", input.modified ? "Título nuevo" : "Café profesional"));
  const event = parsed.events[0];
  return buildIcsImportReviewSnapshot({
    parsed,
    existingIcsSources: input.modified ? [{
      uid: "Case-Sensitive@example.com",
      interactionId: INTERACTION_ID,
      contentHash: "a".repeat(64),
      updatedAt: UPDATED_AT,
      material: {
        start: event.start,
        end: event.end,
        location: event.location,
        organizer: event.organizer,
        attendees: event.attendees,
        status: event.status,
        method: event.method
      }
    }] : [],
    calendarInteractions: input.modified || input.possibleDuplicate ? [{
      id: INTERACTION_ID,
      interactionType: "calendar",
      title: "Café profesional",
      description: "Conversación inicial",
      occurredAt: "2026-10-08T13:00:00.000Z",
      endAt: "2026-10-08T14:00:00.000Z",
      participantEmails: ["ada@example.com", "owner@example.com"],
      sourceProvider: input.possibleDuplicate ? "google" : "ics_file",
      updatedAt: UPDATED_AT
    }] : [],
    focusContactIdsByEmail: new Map([
      ["ada@example.com", "22222222-2222-4222-8222-222222222222"],
      ["owner@example.com", "33333333-3333-4333-8333-333333333333"]
    ]),
    minimumStartIso: "2026-01-01T00:00:00.000Z"
  });
}

test("construye Apply únicamente desde IDs accionables seleccionados del snapshot", () => {
  const review = snapshot();
  const items = buildIcsApplyItems(review, [review.changes[0].id, "fuera-del-snapshot"]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].focusContactIds, [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]);
  assert.equal(items[0].category, "new");
  assert.equal(items[0].event.uid, "Case-Sensitive@example.com");
  assert.equal(Object.hasOwn(items[0].event, "entryId"), false);
  assert.equal(Object.hasOwn(items[0], "userId"), false);
  assert.equal(Object.hasOwn(items[0], "externalId"), false);
});

test("incluye los tokens de concurrencia del review para una modificación", () => {
  const review = snapshot({ modified: true });
  const [item] = buildIcsApplyItems(review, [review.changes[0].id]);

  assert.equal(item.category, "modified");
  assert.deepEqual(item.expected, {
    interactionId: INTERACTION_ID,
    interactionUpdatedAt: UPDATED_AT,
    sourceContentHash: "a".repeat(64),
    sourceUpdatedAt: UPDATED_AT
  });
});

test("un duplicado heurístico seleccionado sigue siendo una creación independiente", () => {
  const review = snapshot({ possibleDuplicate: true });
  assert.equal(review.changes[0].metadata?.icsCategory, "possible_duplicate");
  const [item] = buildIcsApplyItems(review, [review.changes[0].id]);

  assert.equal(item.category, "possible_duplicate");
  assert.equal(item.expected, null);
});

test("envía una sola llamada RPC y valida el resultado estructurado", async () => {
  const review = snapshot();
  const calls: IcsApplyRpcItem[][] = [];
  const result = await applyIcsImportSelection({
    snapshot: review,
    selectedChangeIds: [review.changes[0].id],
    gateway: {
      async apply(items) {
        calls.push(items);
        return {
          createdCount: 1,
          updatedCount: 0,
          unchangedCount: 0,
          participantsInserted: 2,
          participantsLinked: 2,
          items: [{
            changeId: items[0].changeId,
            interactionId: INTERACTION_ID,
            outcome: "created",
            participantsInserted: 2,
            participantsLinked: 2
          }]
        };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(result.createdCount, 1);
  assert.equal(result.participantsInserted, 2);
});

test("rechaza una selección vacía sin invocar persistencia", async () => {
  let called = false;
  await assert.rejects(
    applyIcsImportSelection({
      snapshot: snapshot(),
      selectedChangeIds: [],
      gateway: { async apply() { called = true; return null; } }
    }),
    (error: unknown) => error instanceof IcsImportApplyError && error.code === "invalid_selection"
  );
  assert.equal(called, false);
});

test("sanitiza conflictos stale, límites y fallos con rollback", async () => {
  const review = snapshot();
  const selected = [review.changes[0].id];
  const cases = [
    ["ICS_IMPORT_STALE_REVIEW: secret uid@example.com", "stale_review"],
    ["ICS_IMPORT_STALE_FOCUS: secret uid@example.com", "stale_review"],
    ["ICS_IMPORT_LIMIT_EXCEEDED: 9999 emails", "limit_exceeded"],
    ["ICS_IMPORT_NETWORKING_START_REQUIRED: secret uid@example.com", "networking_start_required"],
    ["ICS_IMPORT_BEFORE_NETWORKING_START: secret uid@example.com", "before_networking_start"],
    ["database failure with private@example.com", "apply_failed"]
  ] as const;

  for (const [message, code] of cases) {
    await assert.rejects(
      applyIcsImportSelection({
        snapshot: review,
        selectedChangeIds: selected,
        gateway: { async apply() { throw new Error(message); } }
      }),
      (error: unknown) => error instanceof IcsImportApplyError
        && error.code === code
        && !error.message.includes("uid@example.com")
        && !error.message.includes("private@example.com")
    );
  }
});

test("falla cerrado si un review modificado no conserva tokens de concurrencia", () => {
  const review = snapshot({ modified: true });
  delete review.changes[0].metadata?.icsApplyExpected;

  assert.throws(
    () => buildIcsApplyItems(review, [review.changes[0].id]),
    (error: unknown) => error instanceof IcsImportApplyError && error.code === "stale_review"
  );
});
test("preflight cliente respeta límites atómicos sin dividir el lote", () => {
  const item = buildIcsApplyItems(snapshot(), [snapshot().changes[0].id])[0];
  assert.throws(
    () => assertApplyLimits(Array.from({ length: MAX_ICS_APPLY_ITEMS + 1 }, (_, index) => ({
      ...item,
      changeId: `ics-review:ics-${index}`
    }))),
    (error: unknown) => error instanceof IcsImportApplyError && error.code === "limit_exceeded"
  );

  assert.throws(
    () => assertApplyLimits([{
      ...item,
      event: {
        ...item.event,
        attendees: Array.from({ length: MAX_ICS_APPLY_PARTICIPANTS + 1 }, (_, index) => ({
          email: `person-${index}@example.invalid`,
          commonName: null,
          role: "REQ-PARTICIPANT",
          participationStatus: null
        }))
      }
    }]),
    (error: unknown) => error instanceof IcsImportApplyError && error.code === "limit_exceeded"
  );

  assert.throws(
    () => assertApplyLimits([{
      ...item,
      event: { ...item.event, description: "x".repeat(5 * 1024 * 1024) }
    }]),
    (error: unknown) => error instanceof IcsImportApplyError && error.code === "limit_exceeded"
  );
});
