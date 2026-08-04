import test from "node:test";
import assert from "node:assert/strict";

import { syncGoogleInteractions } from "../lib/googleInteractionSyncFlow.ts";
import type { ExternalInteractionBatchInput, SyncRunResult } from "../lib/syncOrchestrator.ts";
import type { ContactRow } from "../lib/readModel.ts";

const contacts: ContactRow[] = [
  {
    id: "contact-maria",
    display_name: "Maria Solis",
    company: "",
    role: "",
    networking_status: "Contactado",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: "maria@empresa.cl", domain: "empresa.cl" }],
    contact_phones: []
  }
];

test("syncGoogleInteractions mapea Gmail y Calendar a lotes agnosticos y guarda cursores", async () => {
  const mailBatches: ExternalInteractionBatchInput[] = [];
  const calendarBatches: ExternalInteractionBatchInput[] = [];
  const writtenCursors: Array<{ resourceType: string; cursorValue: string | null }> = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    userEmail: "sergio@crm.cl",
    maxMailMessages: 5,
    maxCalendarEvents: 5
  }, {
    readAppContacts: async () => contacts,
    readCursor: async ({ resourceType }) => resourceType === "mail" ? "2026-08-01T00:00:00Z" : "calendar-prev",
    readMail: async () => ({
      messages: [{
        id: "mail-1",
        threadId: "thread-1",
        payload: {
          headers: [
            { name: "From", value: "Sergio <sergio@crm.cl>" },
            { name: "To", value: "Maria <maria@empresa.cl>" },
            { name: "Subject", value: "Seguimiento" }
          ],
          body: { data: Buffer.from("Hola Maria").toString("base64url") },
          mimeType: "text/plain"
        }
      }],
      nextCursor: "2026-08-04T12:00:00Z",
      pagesRead: 1,
      resultSizeEstimate: 1,
      warnings: []
    }),
    readCalendar: async () => ({
      events: [{
        id: "event-1",
        summary: "Cafe Maria",
        htmlLink: "https://calendar.google.com/event?eid=abc",
        start: { dateTime: "2026-08-04T15:00:00-04:00" },
        attendees: [{ email: "maria@empresa.cl" }]
      }],
      mode: "incremental",
      nextSyncToken: "calendar-next",
      pagesRead: 1,
      warnings: []
    }),
    syncMail: async (input) => {
      const batch = { ...input, resourceType: "mail" as const };
      mailBatches.push(batch);
      return syncResult(batch, "mail-interaction");
    },
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-interaction");
    },
    writeCursor: async ({ resourceType, cursorValue }) => {
      writtenCursors.push({ resourceType, cursorValue });
    },
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.googleRead.mailMessages, 1);
  assert.equal(result.googleRead.calendarEvents, 1);
  assert.equal(mailBatches[0].items[0].externalId, "GMAIL_mail-1");
  assert.equal(mailBatches[0].items[0].participants?.[0]?.contactId, "contact-maria");
  assert.equal(calendarBatches[0].items[0].externalUrl, "https://calendar.google.com/event?eid=abc");
  assert.deepEqual(writtenCursors, [
    { resourceType: "mail", cursorValue: "2026-08-04T12:00:00Z" },
    { resourceType: "calendar", cursorValue: "calendar-next" }
  ]);
});

test("syncGoogleInteractions no guarda cursores en dry-run", async () => {
  let cursorWrites = 0;
  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeCalendar: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      nextCursor: "next",
      pagesRead: 1,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 0,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "dry-run"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {
      cursorWrites += 1;
    },
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(cursorWrites, 0);
});

function syncResult(input: ExternalInteractionBatchInput, interactionId: string): SyncRunResult {
  return {
    affected: {
      contactIds: [],
      externalSourceIds: input.items.map((item) => `${item.externalId}-source`),
      interactionIds: [interactionId]
    },
    counts: {
      created: input.dryRun ? 0 : input.items.length,
      failed: 0,
      participantsInserted: input.items.reduce((total, item) => total + (item.participants?.length ?? 0), 0),
      scanned: input.items.length,
      skipped: input.dryRun ? input.items.length : 0,
      updated: 0
    },
    cursorAfter: input.cursorAfter,
    cursorBefore: input.cursorBefore,
    dryRun: Boolean(input.dryRun),
    errors: [],
    finishedAt: "2026-08-04T12:00:00Z",
    mode: input.mode,
    ok: true,
    provider: input.provider,
    resourceType: input.resourceType,
    scope: input.scope ?? {},
    startedAt: "2026-08-04T12:00:00Z",
    warnings: input.dryRun ? ["Dry-run: no se escribieron cambios."] : []
  };
}
