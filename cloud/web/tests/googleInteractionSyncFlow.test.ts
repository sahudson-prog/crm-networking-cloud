import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleInteractionClientError,
  createGoogleGmailRequestGovernor,
  readGoogleGmailMessages
} from "../lib/googleInteractionClient.ts";
import {
  applyGoogleGmailContactBackfill,
  applyGoogleGmailHistoricalBootstrap,
  applyGoogleGmailFocusedSync,
  externalInteractionSourceIdsForPreview,
  requireHistoricalBootstrapLabelId,
  reviewGoogleGmailContactBackfill,
  reviewGoogleGmailHistoricalBootstrap,
  reviewGoogleGmailFocusedSync,
  syncGoogleInteractions
} from "../lib/googleInteractionSyncFlow.ts";
import type { CalendarReadDiagnosticInput } from "../lib/externalInteractionReadDiagnostics.ts";
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
  },
  {
    id: "contact-fuera-foco",
    display_name: "Fuera Foco",
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: false,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: "fuera@empresa.cl", domain: "empresa.cl" }],
    contact_phones: []
  }
];

test("normaliza ids externos para buscar fuentes existentes en preview", () => {
  assert.deepEqual(
    externalInteractionSourceIdsForPreview([
      { externalId: "CALENDAR_EventABC" },
      { externalId: "calendar_eventabc" },
      { externalId: "GMAIL_MessageXYZ" }
    ]),
    ["calendar_eventabc", "gmail_messagexyz"]
  );
});

test("bootstrap Gmail exige etiqueta antes de revisar", () => {
  assert.throws(
    () => requireHistoricalBootstrapLabelId("  "),
    /Selecciona una etiqueta Gmail/
  );
  assert.equal(requireHistoricalBootstrapLabelId(" Label_1 "), "Label_1");
});

test("bootstrap Gmail captura baseline antes del scan y conserva mensajes sin contacto", async () => {
  const order: string[] = [];
  let receivedLabelIds: readonly string[] | undefined;
  let receivedSince: string | null | undefined;
  const reviewed = await reviewGoogleGmailHistoricalBootstrap({
    accessToken: "token",
    connectedAccountId: "account-1",
    label: { id: "Label_networking", name: "Networking" },
    maxMailMessages: 25,
    maxPages: 2,
    since: "2026-08-01T00:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readMailProfileHistoryId: async () => {
      order.push("profile");
      return "500";
    },
    readMail: async ({ labelIds, since }) => {
      order.push("messages");
      receivedLabelIds = labelIds;
      receivedSince = since;
      return {
        complete: true,
        messages: [
          gmailFromUser("mail-unlinked", "NUEVA@EMPRESA.CL"),
          gmailFromUser("mail-linked", "maria@empresa.cl")
        ],
        mode: "full",
        nextCursor: "550",
        pagesRead: 1,
        resultSizeEstimate: 2,
        truncatedBy: [],
        warnings: []
      };
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "bootstrap-review"),
    writeCursor: async () => {
      throw new Error("Review no debe escribir cursor.");
    }
  });

  assert.deepEqual(order, ["profile", "messages"]);
  assert.deepEqual(receivedLabelIds, ["Label_networking"]);
  assert.equal(receivedSince, "2026-08-01T00:00:00.000Z");
  assert.equal(reviewed.snapshot.baselineHistoryId, "500");
  assert.equal(reviewed.snapshot.complete, true);
  assert.equal(reviewed.snapshot.items.length, 2);
  assert.deepEqual(reviewed.snapshot.items[0].participants, [
    { contactId: null, email: "nueva@empresa.cl", role: "TO" }
  ]);
  assert.deepEqual(reviewed.snapshot.items[1].participants, [
    { contactId: "contact-maria", email: "maria@empresa.cl", role: "TO" }
  ]);
});

test("apply Gmail usa el snapshot, aplica solo seleccionados y guarda cursor global", async () => {
  const reviewed = await bootstrapReviewFixture();
  const appliedIds: string[] = [];
  const cursorWrites: Array<{ cursorLabel?: string; cursorValue: string | null }> = [];
  const result = await applyGoogleGmailHistoricalBootstrap({
    connectedAccountId: "account-1",
    externalIds: ["GMAIL_mail-linked"],
    snapshot: reviewed.snapshot
  }, {
    readMail: async () => {
      throw new Error("Apply no debe volver a leer mensajes Gmail.");
    },
    readMailProfileHistoryId: async () => {
      throw new Error("Apply no debe volver a leer el perfil Gmail.");
    },
    syncMail: async (input) => {
      appliedIds.push(...input.items.map((item) => item.externalId));
      return syncResult({ ...input, resourceType: "mail" as const }, "bootstrap-apply");
    },
    writeCursor: async (input) => {
      cursorWrites.push(input);
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(appliedIds, ["GMAIL_mail-linked"]);
  assert.deepEqual(cursorWrites, [{
    connectedAccountId: "account-1",
    cursorLabel: "",
    cursorValue: "500",
    metadata: {
      bootstrap_label_id: "Label_networking",
      mode: "historical_bootstrap",
      pages_read: 1,
      selected_items: 1
    },
    resourceType: "mail"
  }]);
});

test("apply Gmail rechaza IDs fuera del snapshot sin aplicar ni avanzar cursor", async () => {
  const reviewed = await bootstrapReviewFixture();
  let syncCalls = 0;
  let cursorWrites = 0;
  await assert.rejects(
    applyGoogleGmailHistoricalBootstrap({
      externalIds: ["GMAIL_missing"],
      snapshot: reviewed.snapshot
    }, {
      syncMail: async (input) => {
        syncCalls += 1;
        return syncResult({ ...input, resourceType: "mail" as const }, "unexpected");
      },
      writeCursor: async () => {
        cursorWrites += 1;
      }
    }),
    /no pertenecen al snapshot/
  );
  assert.equal(syncCalls, 0);
  assert.equal(cursorWrites, 0);
});

test("bootstrap Gmail no avanza cursor si la lectura esta truncada o Apply falla", async () => {
  const truncated = await bootstrapReviewFixture(false);
  const complete = await bootstrapReviewFixture(true);
  let cursorWrites = 0;
  const apply = (snapshot: typeof complete.snapshot, fail: boolean) => applyGoogleGmailHistoricalBootstrap({
    externalIds: ["GMAIL_mail-linked"],
    snapshot
  }, {
    syncMail: async (input) => {
      const result = syncResult({ ...input, resourceType: "mail" as const }, "bootstrap-apply");
      if (fail) {
        result.ok = false;
        result.counts.failed = 1;
        result.counts.created = 0;
        result.errors.push({ code: "SYNC_ITEM_FAILED", externalId: "GMAIL_mail-linked", message: "Fallo controlado." });
      }
      return result;
    },
    writeCursor: async () => {
      cursorWrites += 1;
    }
  });

  const truncatedResult = await apply(truncated.snapshot, false);
  const failedResult = await apply(complete.snapshot, true);
  assert.equal(truncatedResult.ok, true);
  assert.equal(failedResult.ok, false);
  assert.equal(cursorWrites, 0);
});

test("bootstrap Gmail no avanza cursor si Apply lanza un error", async () => {
  const reviewed = await bootstrapReviewFixture();
  let cursorWrites = 0;
  await assert.rejects(
    applyGoogleGmailHistoricalBootstrap({
      externalIds: ["GMAIL_mail-linked"],
      snapshot: reviewed.snapshot
    }, {
      syncMail: async () => {
        throw new Error("Persistencia no disponible.");
      },
      writeCursor: async () => {
        cursorWrites += 1;
      }
    }),
    /Persistencia no disponible/
  );
  assert.equal(cursorWrites, 0);
});

test("bootstrap Gmail permite deseleccionar items y completar los seleccionados", async () => {
  const reviewed = await bootstrapReviewFixture();
  let cursorWrites = 0;
  const result = await applyGoogleGmailHistoricalBootstrap({
    externalIds: [],
    snapshot: reviewed.snapshot
  }, {
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "bootstrap-selected"),
    writeCursor: async () => {
      cursorWrites += 1;
    }
  });
  assert.equal(result.mail?.counts.scanned, 0);
  assert.equal(cursorWrites, 1);
});

test("syncGoogleInteractions mapea Gmail y Calendar a lotes agnosticos y guarda cursores", async () => {
  const mailBatches: ExternalInteractionBatchInput[] = [];
  const calendarBatches: ExternalInteractionBatchInput[] = [];
  const writtenCursors: Array<{ resourceType: string; cursorValue: string | null }> = [];
  let receivedHistoryId: string | null | undefined = "";
  let receivedMailQuery: string | null | undefined = "unexpected";
  let mailReads = 0;

  const result = await syncGoogleInteractions({
    accessToken: "token",
    userEmail: "sergio@crm.cl",
    maxMailMessages: 5,
    maxCalendarEvents: 5
  }, {
    readAppContacts: async () => contacts,
    readCursor: async ({ resourceType }) => resourceType === "mail" ? "100" : "calendar-prev",
    readMail: async ({ historyId, query }) => {
      mailReads += 1;
      receivedHistoryId = historyId;
      receivedMailQuery = query;
      return {
        messages: [{
          id: "mail-1",
          historyId: "104",
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
        mode: historyId ? "incremental" as const : "full" as const,
        nextCursor: "104",
        pagesRead: 1,
        resultSizeEstimate: 1,
        warnings: []
      };
    },
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
  assert.equal(mailReads, 1);
  assert.equal(receivedHistoryId, "100");
  assert.equal(receivedMailQuery, null);
  assert.equal(mailBatches[0].mode, "incremental");
  assert.equal(mailBatches[0].items[0].externalId, "GMAIL_mail-1");
  assert.equal(mailBatches[0].items[0].participants?.[0]?.contactId, "contact-maria");
  assert.equal(calendarBatches[0].items[0].externalUrl, "https://calendar.google.com/event?eid=abc");
  assert.deepEqual(writtenCursors, [
    { resourceType: "mail", cursorValue: "104" },
    { resourceType: "calendar", cursorValue: "calendar-next" }
  ]);
});

test("sync global registra exito Calendar aunque Google no entregue nextSyncToken", async () => {
  const writtenCursors: Array<{
    connectedAccountId?: string | null;
    cursorValue: string | null;
    resourceType: string;
  }> = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    dryRun: false,
    globalFocusedMailSync: true,
    includeCalendar: true,
    includeMail: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 1,
      warnings: []
    }),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    writeCursor: async (input) => {
      writtenCursors.push(input);
    },
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(writtenCursors, [{
    connectedAccountId: "account-1",
    cursorLabel: "",
    cursorValue: null,
    metadata: { mode: "full", pages_read: 1, token_available: false },
    resourceType: "calendar"
  }]);
});

test("syncGoogleInteractions falla cerrado si Gmail devuelve permiso invalido aunque Calendar lea datos", async () => {
  const calendarBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeCalendar: true,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => {
      throw new GoogleInteractionClientError(
        "GOOGLE_INTERACTIONS_AUTH_REQUIRED",
        "Gmail necesita permiso de lectura.",
        403
      );
    },
    readCalendar: async () => ({
      events: [{
        attendees: [{ email: "maria@empresa.cl" }],
        id: "event-permitido",
        start: { dateTime: "2026-08-15T10:00:00-04:00" },
        summary: "Cita autorizada"
      }],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 1,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail-interaction"),
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-interaction");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{
    code: "GOOGLE_INTERACTIONS_AUTH_REQUIRED",
    message: "Gmail necesita permiso de lectura."
  }]);
  assert.equal(result.warnings.includes("Gmail necesita permiso de lectura."), false);
  assert.equal(calendarBatches[0].items.length, 1);
});

test("syncGoogleInteractions devuelve rate limit Gmail como error temporal explicito", async () => {
  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeCalendar: false,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => {
      throw new GoogleInteractionClientError(
        "GOOGLE_INTERACTIONS_RATE_LIMITED",
        "Gmail alcanzo temporalmente su limite de consultas.",
        403
      );
    },
    readCalendar: async () => {
      throw new Error("Calendar no participa en esta prueba.");
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.mail, null);
  assert.deepEqual(result.errors, [{
    code: "GOOGLE_INTERACTIONS_RATE_LIMITED",
    message: "Gmail alcanzo temporalmente su limite de consultas."
  }]);
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
      mode: "full",
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

test("syncGoogleInteractions arma preview de interacciones nuevas, modificadas, omitidas y sin cambios", async () => {
  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeCalendar: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [
        gmailFromUser("mail-new", "maria@empresa.cl", "Nuevo cafe", "Hola nuevo"),
        gmailFromUser("mail-modified", "maria@empresa.cl", "Asunto nuevo", "Cuerpo nuevo"),
        gmailFromUser("mail-skipped", "maria@empresa.cl", "Ignorado", "No volver"),
        gmailFromUser("mail-unchanged", "maria@empresa.cl", "Sin cambio", "Mismo cuerpo")
      ],
      mode: "full",
      nextCursor: "next",
      pagesRead: 1,
      resultSizeEstimate: 4,
      warnings: []
    }),
    readExternalSourcesForPreview: async () => [
      {
        external_id: "GMAIL_mail-modified",
        source_subject: "Asunto antiguo",
        source_detail: "Cuerpo antiguo",
        last_seen_at: "2026-08-01T12:00:00.000Z",
        interactions: {
          id: "interaction-modified",
          occurred_at: "2026-08-01T12:00:00.000Z",
          subject: "Asunto antiguo",
          source_detail: "Cuerpo antiguo"
        }
      },
      {
        external_id: "GMAIL_mail-skipped",
        prevent_reimport: true
      },
      {
        external_id: "GMAIL_mail-unchanged",
        source_subject: "Sin cambio",
        source_detail: "Mismo cuerpo",
        last_seen_at: "2026-08-04T12:00:00.000Z",
        interactions: {
          id: "interaction-unchanged",
          occurred_at: "2026-08-04T12:00:00.000Z",
          subject: "Sin cambio",
          source_detail: "Mismo cuerpo"
        }
      }
    ],
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 0,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "preview-sync"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {
      throw new Error("No debe guardar cursor en dry-run.");
    },
    markCursorExpired: async () => {}
  });

  assert.deepEqual(result.mail?.preview?.map((change) => change.type).sort(), ["modified", "new", "skipped", "unchanged"]);
  assert.equal(result.mail?.preview?.find((change) => change.type === "skipped")?.blocking, true);
  assert.equal(result.mail?.preview?.find((change) => change.type === "modified")?.fields.some((field) => field.label === "Asunto" && field.changed), true);
});

test("syncGoogleInteractions con focusedOnly solo vincula contactos en foco", async () => {
  const mailBatches: ExternalInteractionBatchInput[] = [];
  let receivedQuery = "";

  await syncGoogleInteractions({
    accessToken: "token",
    focusedOnly: true,
    includeCalendar: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async ({ query }) => {
      receivedQuery = query ?? "";
      return {
      messages: [
        gmailFromUser("mail-focus", "maria@empresa.cl"),
        gmailFromUser("mail-no-focus", "fuera@empresa.cl")
      ],
      mode: "full",
      nextCursor: "next",
      pagesRead: 1,
      resultSizeEstimate: 2,
      warnings: []
      };
    },
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 0,
      warnings: []
    }),
    syncMail: async (input) => {
      const batch = { ...input, resourceType: "mail" as const };
      mailBatches.push(batch);
      return syncResult(batch, "focus-sync");
    },
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.match(receivedQuery, /from:maria@empresa\.cl/);
  assert.doesNotMatch(receivedQuery, /fuera@empresa\.cl/);
  assert.deepEqual(mailBatches[0].items.map((item) => item.externalId), ["GMAIL_mail-focus"]);
  assert.equal(mailBatches[0].items[0].participants?.[0]?.contactId, "contact-maria");
});

test("syncGoogleInteractions revisa Gmail y Calendar con mas de 50 contactos y 30 correos en foco", async () => {
  let mailReads = 0;
  let calendarReads = 0;
  const receivedMailQueries: string[] = [];
  const receivedMailPageBudgets: Array<number | undefined> = [];
  const receivedMailSince: Array<string | null | undefined> = [];
  const receivedCalendarQueries: string[] = [];
  const manyFocusedContacts = Array.from({ length: 60 }, (_, index): ContactRow => ({
    id: `contact-${index}`,
    display_name: `Contacto ${index}`,
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: `contacto${index}@empresa.cl`, domain: "empresa.cl" }],
    contact_phones: []
  }));

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    focusedOnly: true,
    gmailSince: "2026-01-01T00:00:00.000Z",
    maxPages: 3,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => manyFocusedContacts,
    readCursor: async () => null,
    readMail: async ({ maxPages, query, since }) => {
      mailReads += 1;
      receivedMailQueries.push(query ?? "");
      receivedMailPageBudgets.push(maxPages);
      receivedMailSince.push(since);
      return {
        messages: [],
        mode: "full",
        nextCursor: "next",
        pagesRead: 0,
        resultSizeEstimate: 0,
        warnings: []
      };
    },
    readCalendar: async ({ query }) => {
      calendarReads += 1;
      receivedCalendarQueries.push(query ?? "");
      return {
        events: [],
        mode: "full",
        nextSyncToken: null,
        pagesRead: 0,
        warnings: []
      };
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(mailReads, 3);
  assert.equal(calendarReads, 60);
  assert.deepEqual(receivedMailQueries.map((query) => (query.match(/from:/g) ?? []).length), [20, 20, 20]);
  assert.match(receivedMailQueries[0], /from:contacto0@empresa\.cl/);
  assert.match(receivedMailQueries[2], /from:contacto59@empresa\.cl/);
  assert.deepEqual(receivedMailPageBudgets, [1, 1, 1]);
  assert.deepEqual(receivedMailSince, Array(3).fill("2026-01-01T00:00:00.000Z"));
  assert.equal(new Set(receivedCalendarQueries).size, 60);
  assert.ok(receivedCalendarQueries.includes("contacto0@empresa.cl"));
  assert.ok(receivedCalendarQueries.includes("contacto59@empresa.cl"));
  assert.doesNotMatch(result.warnings.join(" "), /demasiados|revision beta/i);
});

test("syncGoogleInteractions deduplica Gmail entre batches y respeta el limite total de mensajes", async () => {
  const focusedContacts = Array.from({ length: 41 }, (_, index): ContactRow => ({
    id: `contact-${index}`,
    display_name: `Contacto ${index}`,
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: `contacto${index}@empresa.cl`, domain: "empresa.cl" }],
    contact_phones: []
  }));
  const receivedMessageBudgets: Array<number | undefined> = [];
  const receivedExcludedIds: string[][] = [];
  const mailBatches: ExternalInteractionBatchInput[] = [];
  let readIndex = 0;

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    focusedOnly: true,
    includeCalendar: false,
    maxMailMessages: 4,
    maxPages: 3,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => focusedContacts,
    readCursor: async () => null,
    readMail: async ({ excludeMessageIds, maxMessages }) => {
      receivedMessageBudgets.push(maxMessages);
      receivedExcludedIds.push(Array.from(excludeMessageIds ?? []));
      const uniqueRecipient = ["contacto1@empresa.cl", "contacto21@empresa.cl", "contacto40@empresa.cl"][readIndex];
      readIndex += 1;
      const messages = [
        gmailFromUser("shared", "contacto0@empresa.cl"),
        gmailFromUser(`unique-${readIndex}`, uniqueRecipient)
      ].filter((message) => !(excludeMessageIds ?? []).includes(message.id ?? ""));
      return {
        messages: messages.slice(0, maxMessages),
        mode: "full",
        nextCursor: String(100 + readIndex),
        pagesRead: 1,
        resultSizeEstimate: 2,
        warnings: []
      };
    },
    readCalendar: async () => {
      throw new Error("Calendar no participa en esta prueba.");
    },
    syncMail: async (input) => {
      const batch = { ...input, resourceType: "mail" as const };
      mailBatches.push(batch);
      return syncResult(batch, "mail");
    },
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(readIndex, 3);
  assert.deepEqual(receivedMessageBudgets, [4, 2, 1]);
  assert.deepEqual(receivedExcludedIds, [
    [],
    ["shared", "unique-1"],
    ["shared", "unique-1", "unique-2"]
  ]);
  assert.equal(mailBatches[0].items.length, 4);
  assert.deepEqual(mailBatches[0].items.map((item) => item.externalId), [
    "GMAIL_shared",
    "GMAIL_unique-1",
    "GMAIL_unique-2",
    "GMAIL_unique-3"
  ]);
});

test("syncGoogleInteractions limita a 250 las lecturas de detalle Gmail entre batches", async () => {
  const focusedContacts = Array.from({ length: 60 }, (_, index): ContactRow => ({
    id: `contact-${index}`,
    display_name: `Contacto ${index}`,
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: `contacto${index}@empresa.cl`, domain: "empresa.cl" }],
    contact_phones: []
  }));
  let listRequests = 0;
  let detailRequests = 0;
  let currentTime = 0;
  const mailBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    focusedOnly: true,
    includeCalendar: false,
    maxMailMessages: 250,
    maxPages: 3,
    userEmail: "sergio@crm.cl"
  }, {
    createMailRequestGovernor: () => createGoogleGmailRequestGovernor({
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      }
    }),
    readAppContacts: async () => focusedContacts,
    readCursor: async () => null,
    readMail: async (input) => readGoogleGmailMessages({
      ...input,
      fetchImpl: async (url) => {
        const requestedUrl = new URL(String(url));
        if (requestedUrl.pathname.endsWith("/messages")) {
          listRequests += 1;
          if (listRequests === 1) {
            return jsonResponse({ messages: Array.from({ length: 200 }, (_, index) => ({ id: `mail-${index}` })) });
          }
          if (listRequests === 2) {
            return jsonResponse({
              messages: [
                ...Array.from({ length: 50 }, (_, index) => ({ id: `mail-${150 + index}` })),
                ...Array.from({ length: 50 }, (_, index) => ({ id: `mail-${200 + index}` }))
              ]
            });
          }
          throw new Error("No debe listar un batch adicional despues de alcanzar 250 mensajes.");
        }
        detailRequests += 1;
        const messageId = requestedUrl.pathname.split("/").pop() ?? "";
        return jsonResponse(gmailFromUser(messageId, "contacto0@empresa.cl"));
      }
    }),
    readCalendar: async () => {
      throw new Error("Calendar no participa en esta prueba.");
    },
    syncMail: async (input) => {
      const batch = { ...input, resourceType: "mail" as const };
      mailBatches.push(batch);
      return syncResult(batch, "mail");
    },
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(listRequests, 2);
  assert.equal(detailRequests, 250);
  assert.ok(currentTime >= 60_000);
  assert.equal(mailBatches[0].items.length, 250);
});

test("syncGoogleInteractions no aplica batching scoped al camino incremental de Gmail", async () => {
  const focusedContacts = Array.from({ length: 60 }, (_, index): ContactRow => ({
    id: `contact-${index}`,
    display_name: `Contacto ${index}`,
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [{ email: `contacto${index}@empresa.cl`, domain: "empresa.cl" }],
    contact_phones: []
  }));
  const mailInputs: Array<{ historyId?: string | null; query?: string | null; since?: string | null }> = [];

  await syncGoogleInteractions({
    accessToken: "token",
    focusedOnly: true,
    gmailSince: "2026-01-01T00:00:00.000Z",
    includeCalendar: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => focusedContacts,
    readCursor: async () => "100",
    readMail: async ({ historyId, query, since }) => {
      mailInputs.push({ historyId, query, since });
      return {
        messages: [],
        mode: "incremental",
        nextCursor: "101",
        pagesRead: 1,
        resultSizeEstimate: 0,
        warnings: []
      };
    },
    readCalendar: async () => {
      throw new Error("Calendar no participa en esta prueba.");
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.deepEqual(mailInputs, [{ historyId: "100", query: null, since: null }]);
});

test("syncGoogleInteractions consulta Calendar con todos los correos unicos del scope", async () => {
  let calendarReads = 0;
  const receivedCalendarQueries: string[] = [];
  const contactWithManyEmails: ContactRow[] = [{
    id: "contact-many-emails",
    display_name: "Contacto con muchos correos",
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: Array.from({ length: 31 }, (_, index) => ({
      domain: "empresa.cl",
      email: `correo${index}@empresa.cl`
    })),
    contact_phones: []
  }];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contactWithManyEmails,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "next",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async ({ query }) => {
      calendarReads += 1;
      receivedCalendarQueries.push(query ?? "");
      return {
        events: [],
        mode: "full",
        nextSyncToken: null,
        pagesRead: 0,
        warnings: []
      };
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(calendarReads, 31);
  assert.equal(new Set(receivedCalendarQueries).size, 31);
  assert.ok(receivedCalendarQueries.includes("correo0@empresa.cl"));
  assert.ok(receivedCalendarQueries.includes("correo30@empresa.cl"));
  assert.doesNotMatch(result.warnings.join(" "), /demasiados|revision beta/i);
});

test("syncGoogleInteractions omite Gmail si la query explicita esta vacia", async () => {
  for (const gmailQuery of ["", "   \t"]) {
    let mailReads = 0;
    const result = await syncGoogleInteractions({
      accessToken: "token",
      gmailQuery,
      includeCalendar: false,
      userEmail: "sergio@crm.cl"
    }, {
      readAppContacts: async () => contacts,
      readCursor: async () => null,
      readMail: async () => {
        mailReads += 1;
        throw new Error("No debe hacer una lectura amplia de Gmail con una query vacia.");
      },
      readCalendar: async () => {
        throw new Error("Calendar no participa en esta prueba.");
      },
      syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
      syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
      writeCursor: async () => {},
      markCursorExpired: async () => {}
    });

    assert.equal(mailReads, 0);
    assert.match(result.warnings.join(" "), /busqueda indicada esta vacia/);
  }
});

test("syncGoogleInteractions conserva el skip focal sin contactos o sin correos", async () => {
  const contactWithoutEmail: ContactRow = {
    id: "contact-without-email",
    display_name: "Contacto sin correo",
    company: "",
    role: "",
    networking_status: "Pendiente",
    networking_focus: true,
    is_headhunter: false,
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [],
    contact_phones: []
  };

  for (const testCase of [
    { contacts: [] as ContactRow[], warning: /No hay contactos en foco/ },
    { contacts: [contactWithoutEmail], warning: /no tienen correos/ }
  ]) {
    let mailReads = 0;
    let calendarReads = 0;
    const result = await syncGoogleInteractions({
      accessToken: "token",
      dryRun: true,
      focusedOnly: true,
      userEmail: "sergio@crm.cl"
    }, {
      readAppContacts: async () => testCase.contacts,
      readCursor: async () => null,
      readMail: async () => {
        mailReads += 1;
        throw new Error("No debe leer Gmail sin scope de correos.");
      },
      readCalendar: async () => {
        calendarReads += 1;
        throw new Error("No debe leer Calendar sin scope de correos.");
      },
      syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
      syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
      writeCursor: async () => {},
      markCursorExpired: async () => {}
    });

    assert.equal(mailReads, 0);
    assert.equal(calendarReads, 0);
    assert.match(result.warnings.join(" "), testCase.warning);
  }
});

test("syncGoogleInteractions permite revisar solo Calendar y busca por correos en foco", async () => {
  let mailReads = 0;
  let calendarReads = 0;
  let receivedCalendarQuery = "";
  let mailBatches = 0;
  const calendarBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeMail: false,
    includeCalendar: true,
    focusedOnly: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => {
      mailReads += 1;
      return {
        messages: [],
        mode: "full",
        nextCursor: "next",
        pagesRead: 0,
        resultSizeEstimate: 0,
        warnings: []
      };
    },
    readCalendar: async ({ query }) => {
      receivedCalendarQuery = query ?? "";
      calendarReads += 1;
      return {
        events: [{
          id: "event-calendar-only",
          summary: "Cafe Maria",
          start: { dateTime: "2026-08-04T15:00:00-04:00" },
          attendees: [{ email: "maria@empresa.cl" }]
        }],
        mode: "full",
        nextSyncToken: "calendar-next",
        pagesRead: 1,
        warnings: []
      };
    },
    syncMail: async (input) => {
      mailBatches += 1;
      return syncResult({ ...input, resourceType: "mail" as const }, "mail");
    },
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-only");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.mail, null);
  assert.equal(result.calendar?.counts.scanned, 1);
  assert.equal(mailReads, 0);
  assert.equal(calendarReads, 1);
  assert.equal(mailBatches, 0);
  assert.equal(calendarBatches.length, 1);
  assert.equal(receivedCalendarQuery, "maria@empresa.cl");
});

test("syncGoogleInteractions vincula Calendar por email usado en la busqueda aunque no venga como asistente", async () => {
  const calendarBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    forceFullSync: true,
    includeMail: false,
    includeCalendar: true,
    focusedOnly: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "next",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async ({ query }) => ({
      events: query === "maria@empresa.cl"
        ? [{
          id: "event-query-only",
          summary: "Cafe Maria encontrado por q",
          description: "El email aparece en texto del evento, no en asistentes.",
          start: { dateTime: "2026-08-15T10:00:00-04:00" }
        }]
        : [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 1,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-query-only");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(calendarBatches[0].items[0].externalId, "CALENDAR_event-query-only");
  assert.deepEqual(
    calendarBatches[0].items[0].participants?.map((participant) => [participant.contactId, participant.email, participant.role]),
    [["contact-maria", "maria@empresa.cl", "MATCH"]]
  );
});

test("syncGoogleInteractions revisa primero ventana futura de Calendar y luego historico", async () => {
  const calendarWindows: Array<{ query?: string | null; timeMin?: string | null; timeMax?: string | null }> = [];
  const calendarBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2026-11-13T12:00:00.000Z",
    calendarFutureTimeMin: "2026-08-13T12:00:00.000Z",
    calendarTimeMin: "2025-10-01T00:00:00.000Z",
    dryRun: true,
    forceFullSync: true,
    includeCalendar: true,
    includeMail: false,
    focusedOnly: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "next",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async ({ query, timeMin, timeMax }) => {
      calendarWindows.push({ query, timeMin, timeMax });
      return {
        events: [{
          id: timeMin === "2026-08-13T12:00:00.000Z" ? "event-future" : "event-history",
          summary: timeMin === "2026-08-13T12:00:00.000Z" ? "Cita futura Maria" : "Cita historica Maria",
          start: { dateTime: timeMin === "2026-08-13T12:00:00.000Z" ? "2026-08-15T10:00:00-04:00" : "2026-03-15T10:00:00-04:00" }
        }],
        mode: "full",
        nextSyncToken: null,
        pagesRead: 1,
        warnings: []
      };
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-window");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calendarWindows.map((window) => [window.timeMin, window.timeMax]), [
    ["2026-08-13T12:00:00.000Z", "2026-11-13T12:00:00.000Z"],
    ["2025-10-01T00:00:00.000Z", "2026-08-13T12:00:00.000Z"]
  ]);
  assert.deepEqual(calendarBatches[0].items.map((item) => item.externalId), ["CALENDAR_event-future", "CALENDAR_event-history"]);
});

test("syncGoogleInteractions vincula Calendar incremental si el evento menciona un email en foco", async () => {
  const calendarBatches: ExternalInteractionBatchInput[] = [];
  let receivedSyncToken: string | null | undefined = "";

  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeMail: false,
    includeCalendar: true,
    focusedOnly: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async ({ resourceType }) => resourceType === "calendar" ? "calendar-cursor" : null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "next",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async ({ syncToken }) => {
      receivedSyncToken = syncToken;
      return {
        events: [{
          id: "event-incremental-query-only",
          summary: "Cafe Maria incremental",
          description: "Confirmado con maria@empresa.cl",
          start: { dateTime: "2026-08-15T10:00:00-04:00" }
        }],
        mode: "incremental",
        nextSyncToken: "calendar-next",
        pagesRead: 1,
        warnings: []
      };
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-incremental-query-only");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(receivedSyncToken, "calendar-cursor");
  assert.deepEqual(
    calendarBatches[0].items[0].participants?.map((participant) => [participant.contactId, participant.email, participant.role]),
    [["contact-maria", "maria@empresa.cl", "MATCH"]]
  );
});

test("syncGoogleInteractions individual no usa cursores globales y filtra por contactIds", async () => {
  let cursorReads = 0;
  let cursorWrites = 0;
  let receivedQuery = "";
  let receivedSince: string | null | undefined = "";

  const result = await syncGoogleInteractions({
    accessToken: "token",
    contactIds: ["contact-maria"],
    forceFullSync: true,
    gmailQuery: "(from:maria@empresa.cl OR to:maria@empresa.cl)",
    gmailSince: "2025-10-01T00:00:00.000Z",
    includeCalendar: false,
    saveCursors: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => {
      cursorReads += 1;
      return "cursor";
    },
    readMail: async ({ query, since }) => {
      receivedQuery = query ?? "";
      receivedSince = since;
      return {
        messages: [
          gmailFromUser("mail-focus", "maria@empresa.cl"),
          gmailFromUser("mail-no-focus", "fuera@empresa.cl")
        ],
        mode: "full",
        nextCursor: "next",
        pagesRead: 1,
        resultSizeEstimate: 2,
        warnings: []
      };
    },
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 0,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "single-sync"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {
      cursorWrites += 1;
    },
    markCursorExpired: async () => {}
  });

  assert.equal(result.mail?.counts.scanned, 1);
  assert.equal(cursorReads, 0);
  assert.equal(cursorWrites, 0);
  assert.equal(receivedQuery, "(from:maria@empresa.cl OR to:maria@empresa.cl)");
  assert.equal(receivedSince, "2025-10-01T00:00:00.000Z");
});

test("syncGoogleInteractions reintenta Gmail como carga base si historyId vence", async () => {
  const expiredCursors: string[] = [];
  const receivedHistoryIds: Array<string | null | undefined> = [];
  const receivedSince: Array<string | null | undefined> = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    gmailSince: "2026-08-01T00:00:00.000Z",
    includeCalendar: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => "100",
    readMail: async ({ historyId, since }) => {
      receivedHistoryIds.push(historyId);
      receivedSince.push(since);
      if (historyId) {
        throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN", "History vencido.", 404);
      }
      return {
        messages: [],
        mode: "full",
        nextCursor: "200",
        pagesRead: 1,
        resultSizeEstimate: 0,
        warnings: []
      };
    },
    readCalendar: async () => ({
      events: [],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 0,
      warnings: []
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "retry-sync"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async ({ resourceType }) => {
      expiredCursors.push(resourceType);
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(expiredCursors, ["mail"]);
  assert.deepEqual(receivedHistoryIds, ["100", null]);
  assert.deepEqual(receivedSince, [null, "2026-08-01T00:00:00.000Z"]);
});

test("syncGoogleInteractions no marca fecha modificada si solo cambia el formato ISO", async () => {
  const result = await syncGoogleInteractions({
    accessToken: "token",
    dryRun: true,
    includeMail: false,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "next",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async () => ({
      events: [{
        id: "event-same-date",
        summary: "Cafe Maria",
        description: "Mismo detalle",
        start: { dateTime: "2026-03-16T09:00:00-03:00" },
        attendees: [{ email: "maria@empresa.cl" }]
      }],
      mode: "full",
      nextSyncToken: null,
      pagesRead: 1,
      warnings: []
    }),
    readExternalSourcesForPreview: async () => [{
      external_id: "calendar_event-same-date",
      source_subject: "Cafe Maria",
      source_detail: "Mismo detalle",
      last_seen_at: "2026-03-16T12:00:00+00",
      interactions: {
        id: "interaction-same-date",
        occurred_at: "2026-03-16T12:00:00+00",
        subject: "Cafe Maria",
        source_detail: "Mismo detalle"
      }
    }],
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  const change = result.calendar?.preview?.[0];
  assert.equal(change?.type, "unchanged");
  assert.equal(change?.fields.find((field) => field.label === "Fecha")?.changed, false);
});

test("syncGoogleInteractions aplica la fecha de inicio despues de leer Gmail y Calendar", async () => {
  const mailBatches: ExternalInteractionBatchInput[] = [];
  const calendarBatches: ExternalInteractionBatchInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarTimeMin: "2026-08-01T00:00:00.000Z",
    gmailSince: "2026-08-01T00:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => "100",
    readMail: async () => ({
      messages: [
        gmailFromUser("mail-old", "maria@empresa.cl", "Antiguo", "Viejo", "Mon, 1 Jun 2026 08:00:00 -0400"),
        gmailFromUser("mail-new", "maria@empresa.cl", "Nuevo", "Nuevo", "Tue, 4 Aug 2026 08:00:00 -0400")
      ],
      mode: "incremental",
      nextCursor: "200",
      pagesRead: 1,
      resultSizeEstimate: 2,
      warnings: []
    }),
    readCalendar: async () => ({
      events: [
        {
          id: "event-old",
          summary: "Cita antigua",
          start: { dateTime: "2026-06-01T09:00:00-04:00" },
          attendees: [{ email: "maria@empresa.cl" }]
        },
        {
          id: "event-new",
          summary: "Cita nueva",
          start: { dateTime: "2026-08-04T09:00:00-04:00" },
          attendees: [{ email: "maria@empresa.cl" }]
        }
      ],
      mode: "incremental",
      nextSyncToken: "calendar-next",
      pagesRead: 1,
      warnings: []
    }),
    syncMail: async (input) => {
      const batch = { ...input, resourceType: "mail" as const };
      mailBatches.push(batch);
      return syncResult(batch, "mail-filter");
    },
    syncCalendar: async (input) => {
      const batch = { ...input, resourceType: "calendar" as const };
      calendarBatches.push(batch);
      return syncResult(batch, "calendar-filter");
    },
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(mailBatches[0].items.map((item) => item.externalId), ["GMAIL_mail-new"]);
  assert.deepEqual(calendarBatches[0].items.map((item) => item.externalId), ["CALENDAR_event-new"]);
});

test("syncGoogleInteractions guarda diagnostico Calendar con eventos leidos aunque no todos sean candidatos", async () => {
  const diagnostics: CalendarReadDiagnosticInput[] = [];

  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarTimeMin: "2026-08-01T00:00:00.000Z",
    dryRun: true,
    focusedOnly: true,
    includeMail: false,
    saveReadDiagnostics: true,
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readMail: async () => ({
      messages: [],
      mode: "full",
      nextCursor: "",
      pagesRead: 0,
      resultSizeEstimate: 0,
      warnings: []
    }),
    readCalendar: async () => ({
      events: [
        {
          id: "event-old",
          summary: "Cita antigua",
          start: { dateTime: "2026-06-01T09:00:00-04:00" },
          attendees: [{ email: "maria@empresa.cl" }]
        },
        {
          id: "event-new",
          summary: "Cita Maria",
          start: { dateTime: "2026-08-04T09:00:00-04:00" },
          attendees: [{ email: "maria@empresa.cl" }]
        },
        {
          id: "event-unmapped",
          summary: "Cita sin match",
          start: { dateTime: "2026-08-05T09:00:00-04:00" },
          attendees: [{ email: "externo@otra.cl" }]
        }
      ],
      mode: "full",
      nextSyncToken: "calendar-next",
      pagesRead: 1,
      warnings: []
    }),
    saveCalendarReadDiagnostics: async (input) => {
      diagnostics.push(input);
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].events.length, 3);
  assert.deepEqual(diagnostics[0].mappedItems.map((item) => item.externalId), [
    "CALENDAR_event-old",
    "CALENDAR_event-new",
    "CALENDAR_event-unmapped"
  ]);
  assert.deepEqual(diagnostics[0].syncedItems.map((item) => item.externalId), [
    "CALENDAR_event-new",
    "CALENDAR_event-unmapped"
  ]);
});

test("Gmail de ficha usa todos los emails Foco, como máximo 14 dias y Apply reutiliza el snapshot sin cursores", async () => {
  const focusedContact: ContactRow = {
    ...contacts[0],
    contact_emails: [
      { email: "maria@empresa.cl", domain: "empresa.cl" },
      { email: "maria.alias@empresa.cl", domain: "empresa.cl" }
    ]
  };
  const mailReads: Array<{
    historyId?: string | null;
    labelIds?: readonly string[];
    query?: string | null;
    since?: string | null;
  }> = [];
  let cursorReads = 0;
  let cursorWrites = 0;
  let profileReads = 0;
  const dependencies = contactBackfillDependencies({
    readAppContacts: async () => [focusedContact],
    readCursor: async () => {
      cursorReads += 1;
      return "cursor-que-no-debe-usarse";
    },
    readMail: async (input: {
      historyId?: string | null;
      labelIds?: readonly string[];
      query?: string | null;
      since?: string | null;
    }) => {
      mailReads.push(input);
      return gmailRead({
        messages: [
          gmailFromUser("mail-reciente", "maria.alias@empresa.cl", "Reciente", "Hola", "Thu, 1 Oct 2026 08:00:00 -0400"),
          gmailFromUser("mail-antiguo", "maria@empresa.cl", "Antiguo", "Hola", "Tue, 1 Sep 2026 08:00:00 -0400"),
          gmailFromUser("mail-futuro", "maria@empresa.cl", "Futuro", "Hola", "Tue, 6 Oct 2026 08:00:00 -0400")
        ]
      });
    },
    readMailProfileHistoryId: async () => {
      profileReads += 1;
      return "history-que-no-debe-usarse";
    },
    writeCursor: async () => {
      cursorWrites += 1;
    }
  });

  const reviewed = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactIds: [focusedContact.id],
    contactRecentMailSync: true,
    contactRecentNow: "2026-10-05T12:00:00.000Z",
    cursorLabel: `contact:${focusedContact.id}`,
    dryRun: true,
    includeCalendar: false,
    includeMail: true,
    gmailSince: "2026-10-01T00:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, dependencies);

  assert.equal(reviewed.ok, true);
  assert.equal(mailReads.length, 1);
  assert.equal(mailReads[0]?.historyId, null);
  assert.equal(mailReads[0]?.labelIds, undefined);
  assert.equal(mailReads[0]?.since, "2026-10-01T00:00:00.000Z");
  assert.match(mailReads[0]?.query ?? "", /maria@empresa\.cl/);
  assert.match(mailReads[0]?.query ?? "", /maria\.alias@empresa\.cl/);
  assert.deepEqual(reviewed.gmailContactSnapshot?.items.map((item) => item.externalId), ["GMAIL_mail-reciente"]);
  assert.equal(reviewed.gmailContactSnapshot?.until, "2026-10-05T12:00:00.000Z");
  assert.equal(reviewed.googleRead.mailMessages, 3);

  const applied = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactIds: [focusedContact.id],
    contactRecentMailSync: true,
    cursorLabel: `contact:${focusedContact.id}`,
    dryRun: false,
    externalIds: ["GMAIL_mail-reciente"],
    gmailContactSnapshot: reviewed.gmailContactSnapshot,
    includeCalendar: false,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, dependencies);

  assert.equal(applied.ok, true);
  assert.equal(applied.mail?.counts.created, 1);
  assert.equal(mailReads.length, 1);
  assert.equal(profileReads, 0);
  assert.equal(cursorReads, 0);
  assert.equal(cursorWrites, 0);
});

test("Gmail de ficha omite contactos fuera de Foco sin error tecnico", async () => {
  let mailReads = 0;
  const result = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactIds: ["contact-fuera-foco"],
    contactRecentMailSync: true,
    contactRecentNow: "2026-10-05T12:00:00.000Z",
    dryRun: true,
    includeCalendar: false,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readMail: async () => {
      mailReads += 1;
      return gmailRead();
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.mail?.counts.scanned, 0);
  assert.equal(result.gmailContactSnapshot?.complete, true);
  assert.match(result.warnings.join(" "), /no esta marcado como Foco/);
  assert.equal(mailReads, 0);
});

test("Apply Gmail de ficha rechaza un snapshot truncado", async () => {
  let applyCalls = 0;
  const reviewed = await reviewGoogleGmailContactBackfill({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactId: "contact-maria",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readMail: async () => gmailRead({ complete: false, truncatedBy: ["max_pages"] })
  }), contacts);

  assert.equal(reviewed.snapshot.complete, false);
  await assert.rejects(
    applyGoogleGmailContactBackfill({
      connectedAccountId: "account-1",
      contactId: "contact-maria",
      externalIds: [],
      snapshot: reviewed.snapshot
    }, contactBackfillDependencies({
      syncMail: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
        applyCalls += 1;
        return syncResult({ ...input, resourceType: "mail" }, "unexpected-apply");
      }
    })),
    /quedo incompleta/
  );
  assert.equal(applyCalls, 0);
});

test("Gmail de ficha conserva idempotencia al repetir review y apply", async () => {
  let persisted = false;
  const dependencies = contactBackfillDependencies({
    readExternalSourcesForPreview: async ({ items }: { items: Array<{
      externalId: string;
      occurredAt?: string | null;
      sourceDetail?: string | null;
      subject?: string | null;
    }> }) => persisted ? items.map((item) => ({
      external_id: item.externalId.toLowerCase(),
      last_seen_at: item.occurredAt,
      source_detail: item.sourceDetail,
      source_subject: item.subject,
      interactions: {
        id: "interaction-existente",
        occurred_at: item.occurredAt,
        source_detail: item.sourceDetail,
        subject: item.subject
      }
    })) : [],
    readMail: async () => gmailRead({
      messages: [gmailFromUser("mail-repetido", "maria@empresa.cl", "Repetido", "Hola", "Thu, 1 Oct 2026 08:00:00 -0400")]
    }),
    syncMail: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
      const result = syncResult({ ...input, resourceType: "mail" }, "contact-backfill");
      if (!input.dryRun && input.items.length) {
        result.counts.created = persisted ? 0 : input.items.length;
        result.counts.skipped = persisted ? input.items.length : 0;
        persisted = true;
      }
      return result;
    }
  });

  const firstReview = await reviewGoogleGmailContactBackfill({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactId: "contact-maria",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, dependencies, contacts);
  const firstIds = firstReview.snapshot.preview
    .filter((change) => change.type === "new" || change.type === "modified")
    .map((change) => String(change.metadata?.externalId ?? ""));
  const firstApply = await applyGoogleGmailContactBackfill({
    connectedAccountId: "account-1",
    contactId: "contact-maria",
    externalIds: firstIds,
    snapshot: firstReview.snapshot
  }, dependencies);

  const secondReview = await reviewGoogleGmailContactBackfill({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactId: "contact-maria",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, dependencies, contacts);
  const secondIds = secondReview.snapshot.preview
    .filter((change) => change.type === "new" || change.type === "modified")
    .map((change) => String(change.metadata?.externalId ?? ""));
  const secondApply = await applyGoogleGmailContactBackfill({
    connectedAccountId: "account-1",
    contactId: "contact-maria",
    externalIds: secondIds,
    snapshot: secondReview.snapshot
  }, dependencies);

  assert.equal(firstApply.mail?.counts.created, 1);
  assert.deepEqual(secondReview.snapshot.preview.map((change) => change.type), ["unchanged"]);
  assert.deepEqual(secondIds, []);
  assert.equal(secondApply.mail?.counts.created, 0);
});

test("Calendar de ficha conserva cursor contact:id y syncToken", async () => {
  const cursorReads: Array<{ cursorLabel?: string; resourceType: "mail" | "calendar" }> = [];
  const cursorWrites: Array<{ cursorLabel?: string; cursorValue: string | null; resourceType: "mail" | "calendar" }> = [];
  let receivedSyncToken: string | null | undefined;

  const result = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    contactIds: ["contact-maria"],
    contactRecentMailSync: true,
    cursorLabel: "contact:contact-maria",
    dryRun: false,
    includeCalendar: true,
    includeMail: false,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readCursor: async (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => {
      cursorReads.push(input);
      return input.resourceType === "calendar" ? "calendar-contact-token" : "mail-token-no-esperado";
    },
    readCalendar: async ({ syncToken }: { syncToken?: string | null }) => {
      receivedSyncToken = syncToken;
      return {
        events: [],
        mode: "incremental",
        nextSyncToken: "calendar-contact-next",
        pagesRead: 1,
        warnings: []
      };
    },
    syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => (
      syncResult({ ...input, resourceType: "calendar" }, "calendar-contact")
    ),
    writeCursor: async (input: { cursorLabel?: string; cursorValue: string | null; resourceType: "mail" | "calendar" }) => {
      cursorWrites.push(input);
    }
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(cursorReads, [{ cursorLabel: "contact:contact-maria", resourceType: "calendar" }]);
  assert.equal(receivedSyncToken, "calendar-contact-token");
  assert.deepEqual(cursorWrites, [{
    connectedAccountId: "account-1",
    cursorLabel: "contact:contact-maria",
    cursorValue: "calendar-contact-next",
    metadata: {
      mode: "incremental",
      pages_read: 1,
      token_available: true
    },
    resourceType: "calendar"
  }]);
});

test("Calendar periodico global usa ventana movil Foco, deduplica y actualiza freshness idempotentemente", async () => {
  const scopedContacts: ContactRow[] = [
    {
      ...contacts[0],
      contact_emails: [
        { email: "maria@empresa.cl", domain: "empresa.cl" },
        { email: "maria.secundario@empresa.cl", domain: "empresa.cl" }
      ]
    },
    contacts[1],
    { ...contacts[0], id: "contact-inactivo", is_active: false, contact_emails: [{ email: "inactivo@empresa.cl", domain: "empresa.cl" }] }
  ];
  const reads: Array<{ query?: string | null; syncToken?: string | null; timeMin?: string | null; timeMax?: string | null }> = [];
  const writes: Array<{ connectedAccountId?: string | null; cursorLabel?: string; cursorValue: string | null; metadata?: Record<string, unknown> }> = [];
  let cursorReads = 0;
  const persisted = new Set<string>();
  const createdPerRun: number[] = [];
  const dependencies = contactBackfillDependencies({
    readAppContacts: async () => scopedContacts,
    readCursor: async () => {
      cursorReads += 1;
      return "legacy-token-no-esperado";
    },
    readCalendar: async (input: { query?: string | null; syncToken?: string | null; timeMin?: string | null; timeMax?: string | null }) => {
      reads.push(input);
      return {
        complete: true,
        events: [
          {
            attendees: [{ email: "MARIA@EMPRESA.CL" }],
            id: "event-rolling-shared",
            summary: "Cafe Maria",
            start: { dateTime: "2026-10-07T14:00:00.000Z" }
          },
          {
            attendees: [{ email: "maria@empresa.cl" }],
            id: "event-rolling-shared",
            summary: "Cafe Maria duplicado",
            start: { dateTime: "2026-10-07T14:00:00.000Z" }
          },
          {
            id: "event-organized-by-focus",
            organizer: { email: "maria.secundario@empresa.cl" },
            summary: "Cafe secundario",
            start: { dateTime: "2026-10-08T14:00:00.000Z" }
          },
          {
            attendees: [{ email: "fuera@empresa.cl" }],
            id: "event-outside-focus",
            summary: "No corresponde al Foco",
            start: { dateTime: "2026-10-09T14:00:00.000Z" }
          },
          {
            id: "event-without-participants",
            summary: "Sin participantes",
            start: { dateTime: "2026-10-10T14:00:00.000Z" }
          }
        ],
        mode: "full" as const,
        nextSyncToken: "token-que-no-debe-usarse",
        pagesRead: 1,
        truncatedBy: [],
        warnings: []
      };
    },
    syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
      let created = 0;
      for (const item of input.items) {
        if (!persisted.has(item.externalId)) {
          persisted.add(item.externalId);
          created += 1;
        }
      }
      const result = syncResult({ ...input, resourceType: "calendar" }, "calendar-rolling-global");
      result.counts.created = created;
      result.counts.skipped = input.items.length - created;
      createdPerRun.push(created);
      return result;
    },
    writeCursor: async (input: { connectedAccountId?: string | null; cursorLabel?: string; cursorValue: string | null; metadata?: Record<string, unknown> }) => {
      writes.push(input);
    }
  });
  const run = () => syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
    calendarRollingWindowSync: "global",
    calendarTimeMin: "2026-09-22T15:30:00.000Z",
    connectedAccountId: "account-1",
    dryRun: false,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    maxCalendarEvents: 2500,
    maxPages: 2,
    saveCursors: true,
    userEmail: "sergio@crm.cl"
  }, dependencies);

  const first = await run();
  const second = await run();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(createdPerRun, [2, 0]);
  assert.equal(first.calendar?.counts.created, 2);
  assert.equal(second.calendar?.counts.created, 0);
  assert.equal(cursorReads, 0);
  assert.equal(reads.length, 2);
  assert.deepEqual(new Set(reads.map((read) => read.query)), new Set([null]));
  assert.equal(reads.every((read) => read.syncToken === null), true);
  assert.equal(reads.every((read) => read.timeMin === "2026-09-22T15:30:00.000Z"), true);
  assert.equal(reads.every((read) => read.timeMax === "2027-01-06T15:30:00.000Z"), true);
  assert.equal(writes.length, 2);
  assert.equal(writes.every((write) => write.cursorLabel === "" && write.cursorValue === null), true);
  assert.equal(writes.every((write) => write.connectedAccountId === "account-1"), true);
  assert.equal(writes.every((write) => write.metadata?.mode === "rolling_window"), true);
});

test("Calendar rolling hace un solo scan aunque existan 150 emails Foco", async () => {
  const focusedContacts = Array.from({ length: 150 }, (_, index): ContactRow => ({
    ...contacts[0],
    id: `contact-${index}`,
    display_name: `Contacto ${index}`,
    contact_emails: [{ email: `contacto-${index}@empresa.cl`, domain: "empresa.cl" }]
  }));
  const reads: Array<{ query?: string | null }> = [];
  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2026-11-05T15:30:00.000Z",
    calendarRollingWindowSync: "global",
    calendarTimeMin: "2026-09-29T15:30:00.000Z",
    connectedAccountId: "account-1",
    dryRun: true,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    maxCalendarEvents: 2500,
    maxPages: 2,
    saveCursors: true,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readAppContacts: async () => focusedContacts,
    readCalendar: async (input: { query?: string | null }) => {
      reads.push(input);
      return {
        complete: true,
        events: [{
          attendees: [{ email: "CONTACTO-149@EMPRESA.CL" }],
          id: "event-contact-149",
          start: { dateTime: "2026-10-07T14:00:00.000Z" },
          summary: "Cafe"
        }],
        mode: "full" as const,
        nextSyncToken: null,
        pagesRead: 1,
        truncatedBy: [],
        warnings: []
      };
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.calendarRollingSnapshot?.items.length, 1);
  assert.equal(result.calendarRollingSnapshot?.items[0]?.externalId, "CALENDAR_event-contact-149");
  assert.equal(reads.length, 1);
  assert.equal(reads[0].query, null);
});

test("Calendar rolling aplica el snapshot revisado sin repetir lecturas Google", async () => {
  let calendarReads = 0;
  let cursorWrites = 0;
  const dryRuns: boolean[] = [];
  const dependencies = contactBackfillDependencies({
    readCalendar: async () => {
      calendarReads += 1;
      return {
        complete: true,
        events: [{
          attendees: [{ email: "maria@empresa.cl" }],
          id: "event-snapshot",
          summary: "Cafe Maria",
          start: { dateTime: "2026-10-07T14:00:00.000Z" }
        }],
        mode: "full" as const,
        nextSyncToken: null,
        pagesRead: 1,
        truncatedBy: [],
        warnings: []
      };
    },
    syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
      dryRuns.push(Boolean(input.dryRun));
      return syncResult({ ...input, resourceType: "calendar" }, "calendar-snapshot");
    },
    writeCursor: async () => {
      cursorWrites += 1;
    }
  });
  const baseInput = {
    accessToken: "token",
    calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
    calendarRollingWindowSync: "global" as const,
    calendarTimeMin: "2026-09-22T15:30:00.000Z",
    connectedAccountId: "account-1",
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    saveCursors: true,
    userEmail: "sergio@crm.cl"
  };

  const reviewed = await syncGoogleInteractions({ ...baseInput, dryRun: true }, dependencies);
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.calendarRollingSnapshot?.complete, true);
  assert.equal(calendarReads, 1);

  const applied = await syncGoogleInteractions({
    ...baseInput,
    calendarRollingSnapshot: reviewed.calendarRollingSnapshot,
    dryRun: false,
    externalIds: reviewed.calendarRollingSnapshot?.items.map((item) => item.externalId) ?? []
  }, dependencies);

  assert.equal(applied.ok, true);
  assert.equal(calendarReads, 1);
  assert.deepEqual(dryRuns, [true, false]);
  assert.equal(cursorWrites, 1);
});

test("Calendar periodico global falla cerrado ante truncacion o error y conserva freshness", async () => {
  for (const failure of ["truncated", "runtime"] as const) {
    let syncCalls = 0;
    let writes = 0;
    const result = await syncGoogleInteractions({
      accessToken: "token",
      calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
      calendarRollingWindowSync: "global",
      calendarTimeMin: "2026-09-22T15:30:00.000Z",
      connectedAccountId: "account-1",
      dryRun: false,
      focusedOnly: true,
      includeCalendar: true,
      includeMail: false,
      saveCursors: true,
      userEmail: "sergio@crm.cl"
    }, contactBackfillDependencies({
      readCalendar: async () => {
        if (failure === "runtime") throw new Error("Calendar temporalmente no disponible");
        return {
          complete: false,
          events: [{ id: "event-partial", start: { dateTime: "2026-10-07T14:00:00.000Z" } }],
          mode: "full" as const,
          nextSyncToken: null,
          pagesRead: 2,
          truncatedBy: ["max_pages" as const],
          warnings: ["Lectura parcial"]
        };
      },
      syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
        syncCalls += 1;
        return syncResult({ ...input, resourceType: "calendar" }, "calendar-partial");
      },
      writeCursor: async () => {
        writes += 1;
      }
    }));

    assert.equal(result.ok, false, failure);
    assert.equal(syncCalls, 0, failure);
    assert.equal(writes, 0, failure);
  }
});

test("Calendar periodico global sin Foco es no-op exitoso sin API y actualiza freshness", async () => {
  let calendarReads = 0;
  const writes: Array<{ cursorLabel?: string; cursorValue: string | null }> = [];
  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
    calendarRollingWindowSync: "global",
    calendarTimeMin: "2026-09-22T15:30:00.000Z",
    connectedAccountId: "account-1",
    dryRun: false,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    saveCursors: true,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readAppContacts: async () => contacts.map((contact) => ({ ...contact, networking_focus: false })),
    readCalendar: async () => {
      calendarReads += 1;
      throw new Error("No debe consultar Calendar sin Foco.");
    },
    writeCursor: async (input: { cursorLabel?: string; cursorValue: string | null }) => {
      writes.push(input);
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(calendarReads, 0);
  assert.deepEqual(writes, [{
    connectedAccountId: "account-1",
    cursorLabel: "",
    cursorValue: null,
    metadata: {
      mode: "rolling_window",
      pages_read: 0,
      time_max: "2027-01-06T15:30:00.000Z",
      time_min: "2026-09-22T15:30:00.000Z",
      token_available: false
    },
    resourceType: "calendar"
  }]);
});

test("Calendar periodico global sin emails es no-op exitoso y actualiza freshness", async () => {
  let calendarReads = 0;
  let writes = 0;
  const result = await syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
    calendarRollingWindowSync: "global",
    calendarTimeMin: "2026-09-22T15:30:00.000Z",
    connectedAccountId: "account-1",
    dryRun: false,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    saveCursors: true,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readAppContacts: async () => [{ ...contacts[0], contact_emails: [] }],
    readCalendar: async () => {
      calendarReads += 1;
      throw new Error("No debe consultar Calendar sin emails.");
    },
    writeCursor: async () => {
      writes += 1;
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(calendarReads, 0);
  assert.equal(writes, 1);
});

test("Calendar periodico de ficha exige Foco y no lee ni escribe cursores", async () => {
  let cursorReads = 0;
  let cursorWrites = 0;
  let calendarReads = 0;
  const persisted = new Set<string>();
  const createdPerRun: number[] = [];
  const run = (contactId: string) => syncGoogleInteractions({
    accessToken: "token",
    calendarFutureTimeMax: "2027-01-06T15:30:00.000Z",
    calendarRollingWindowSync: "contact",
    calendarTimeMin: "2026-09-22T15:30:00.000Z",
    contactIds: [contactId],
    cursorLabel: `contact:${contactId}`,
    dryRun: false,
    focusedOnly: true,
    includeCalendar: true,
    includeMail: false,
    saveCursors: false,
    userEmail: "sergio@crm.cl"
  }, contactBackfillDependencies({
    readCursor: async () => {
      cursorReads += 1;
      return "legacy-contact-token";
    },
    readCalendar: async ({ query, syncToken, timeMin, timeMax }: { query?: string | null; syncToken?: string | null; timeMin?: string | null; timeMax?: string | null }) => {
      calendarReads += 1;
      assert.equal(query, null);
      assert.equal(syncToken, null);
      assert.equal(timeMin, "2026-09-22T15:30:00.000Z");
      assert.equal(timeMax, "2027-01-06T15:30:00.000Z");
      return {
        complete: true,
        events: [{
          attendees: [{ email: "maria@empresa.cl" }],
          id: "event-contact-rolling",
          summary: "Cafe Maria",
          start: { dateTime: "2026-10-07T14:00:00.000Z" }
        }],
        mode: "full" as const,
        nextSyncToken: null,
        pagesRead: 1,
        truncatedBy: [],
        warnings: []
      };
    },
    syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => {
      let created = 0;
      for (const item of input.items) {
        if (!persisted.has(item.externalId)) {
          persisted.add(item.externalId);
          created += 1;
        }
      }
      const result = syncResult({ ...input, resourceType: "calendar" }, "calendar-contact-rolling");
      result.counts.created = created;
      result.counts.skipped = input.items.length - created;
      createdPerRun.push(created);
      return result;
    },
    writeCursor: async () => {
      cursorWrites += 1;
    }
  }));

  const focused = await run("contact-maria");
  const focusedAgain = await run("contact-maria");
  const notFocused = await run("contact-fuera-foco");

  assert.equal(focused.ok, true);
  assert.equal(focusedAgain.ok, true);
  assert.equal(notFocused.ok, true);
  assert.deepEqual(createdPerRun, [1, 0]);
  assert.equal(calendarReads, 2);
  assert.equal(cursorReads, 0);
  assert.equal(cursorWrites, 0);
});

test("Gmail global usa history cursor valido, filtra Foco y Apply no vuelve a leer Google", async () => {
  const mailReads: Array<{ historyId?: string | null; query?: string | null; since?: string | null }> = [];
  let profileReads = 0;
  const writes: Array<{ connectedAccountId?: string | null; cursorValue: string | null }> = [];
  const dependencies = focusedSyncDependencies({
    readMail: async (input: { historyId?: string | null; query?: string | null; since?: string | null }) => {
      mailReads.push(input);
      return gmailRead({
        messages: [
          gmailFromUser("mail-focus", "maria@empresa.cl"),
          gmailFromUser("mail-focus-old", "maria@empresa.cl", "Antiguo", "Viejo", "Mon, 1 Jun 2026 08:00:00 -0400"),
          gmailFromUser("mail-non-focus", "fuera@empresa.cl")
        ],
        mode: "incremental",
        nextCursor: "205"
      });
    },
    readMailProfileHistoryId: async () => {
      profileReads += 1;
      return "profile-should-not-run";
    },
    writeCursor: async (input: { connectedAccountId?: string | null; cursorValue: string | null }) => {
      writes.push(input);
    }
  });

  const reviewed = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    dryRun: true,
    globalFocusedMailSync: true,
    gmailSince: "2026-08-01T00:00:00.000Z",
    includeCalendar: false,
    includeMail: true,
    maxMailMessages: 25,
    maxPages: 3,
    userEmail: "sergio@crm.cl"
  }, dependencies);

  assert.equal(mailReads.length, 1);
  assert.equal(mailReads[0]?.historyId, "100");
  assert.equal(mailReads[0]?.query, null);
  assert.equal(mailReads[0]?.since, null);
  assert.equal(profileReads, 0);
  assert.equal(reviewed.gmailFocusedSnapshot?.mode, "incremental");
  assert.equal(reviewed.gmailFocusedSnapshot?.candidateHistoryId, "205");
  assert.deepEqual(reviewed.gmailFocusedSnapshot?.items.map((item) => item.externalId), ["GMAIL_mail-focus"]);

  const applied = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    dryRun: false,
    externalIds: ["GMAIL_mail-focus"],
    globalFocusedMailSync: true,
    gmailFocusedSnapshot: reviewed.gmailFocusedSnapshot,
    includeCalendar: false,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, dependencies);

  assert.equal(applied.ok, true);
  assert.equal(mailReads.length, 1);
  assert.equal(profileReads, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.connectedAccountId, "account-1");
  assert.equal(writes[0]?.cursorValue, "205");
});

test("Gmail global no avanza cursor si history queda truncado o falla", async () => {
  let writes = 0;
  const truncated = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readMail: async () => gmailRead({ complete: false, nextCursor: "205", truncatedBy: ["max_pages"] }),
    writeCursor: async () => {
      writes += 1;
    }
  }));
  await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [],
    snapshot: truncated.snapshot
  }, focusedSyncDependencies({
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(writes, 0);

  const failed = await syncGoogleInteractions({
    accessToken: "token",
    connectedAccountId: "account-1",
    dryRun: true,
    globalFocusedMailSync: true,
    includeCalendar: false,
    includeMail: true,
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readMail: async () => {
      throw new Error("history failed");
    },
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(failed.ok, false);
  assert.equal(failed.gmailFocusedSnapshot, null);
  assert.equal(writes, 0);
});

test("Gmail global recovery captura baseline antes, usa Foco y exactamente 14 dias", async () => {
  type RecoveryReadInput = {
    historyId?: string | null;
    labelIds?: readonly string[];
    query?: string | null;
    since?: string | null;
  };
  const order: string[] = [];
  let recoveryInput: RecoveryReadInput | null = null;
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readCursorRecord: async () => null,
    readMailProfileHistoryId: async () => {
      order.push("baseline");
      return "300";
    },
    readMail: async (input: RecoveryReadInput) => {
      order.push("recovery");
      recoveryInput = input;
      return gmailRead({ messages: [gmailFromUser("mail-focus", "maria@empresa.cl")], nextCursor: "310" });
    }
  }));

  assert.deepEqual(order, ["baseline", "recovery"]);
  assert.equal(reviewed.snapshot.mode, "recovery");
  assert.equal(reviewed.snapshot.candidateHistoryId, "300");
  assert.equal(reviewed.snapshot.recoverySince, "2026-09-21T12:00:00.000Z");
  const capturedRecoveryInput = recoveryInput as RecoveryReadInput | null;
  assert.equal(capturedRecoveryInput?.historyId, null);
  assert.equal(capturedRecoveryInput?.labelIds, undefined);
  assert.equal(capturedRecoveryInput?.since, "2026-09-21T12:00:00.000Z");
  assert.match(capturedRecoveryInput?.query ?? "", /maria@empresa\.cl/);
  assert.doesNotMatch(capturedRecoveryInput?.query ?? "", /fuera@empresa\.cl/);
});

test("Gmail global recovery conserva el límite temporal más restrictivo", async () => {
  let recoverySince: string | null | undefined;
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    minimumOccurredAt: "2026-10-01T00:00:00.000Z",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readCursorRecord: async () => null,
    readMail: async ({ since }: { since?: string | null }) => {
      recoverySince = since;
      return gmailRead();
    },
    readMailProfileHistoryId: async () => "301"
  }));

  assert.equal(recoverySince, "2026-10-01T00:00:00.000Z");
  assert.equal(reviewed.snapshot.recoverySince, "2026-10-01T00:00:00.000Z");
});

test("Gmail global usa recovery ante cursor vencido o de otra cuenta", async () => {
  let expiredMarked = 0;
  let profileReads = 0;
  const expired = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    markCursorExpired: async () => {
      expiredMarked += 1;
    },
    readMail: async ({ historyId }: { historyId?: string | null }) => {
      if (historyId) throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN", "expired", 404);
      return gmailRead();
    },
    readMailProfileHistoryId: async () => {
      profileReads += 1;
      return "300";
    }
  }));
  assert.equal(expired.snapshot.mode, "recovery");
  assert.equal(expiredMarked, 1);
  assert.equal(profileReads, 1);

  let historyReads = 0;
  const mismatch = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-2",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readCursorRecord: async () => focusedCursor("100", "account-1"),
    readMail: async ({ historyId }: { historyId?: string | null }) => {
      if (historyId) historyReads += 1;
      return gmailRead();
    },
    readMailProfileHistoryId: async () => "400"
  }));
  assert.equal(mismatch.snapshot.mode, "recovery");
  assert.equal(mismatch.snapshot.candidateHistoryId, "400");
  assert.equal(historyReads, 0);
});

test("Gmail global recovery sin Foco es no-op y puede inicializar cursor", async () => {
  let mailReads = 0;
  const writes: string[] = [];
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readAppContacts: async () => contacts.map((contact) => ({ ...contact, networking_focus: false })),
    readMail: async () => {
      mailReads += 1;
      return gmailRead();
    },
    readMailProfileHistoryId: async () => "500"
  }));
  assert.equal(reviewed.snapshot.complete, true);
  assert.equal(reviewed.snapshot.items.length, 0);
  assert.equal(mailReads, 0);

  await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [],
    snapshot: reviewed.snapshot
  }, focusedSyncDependencies({
    writeCursor: async ({ cursorValue }: { cursorValue: string | null }) => {
      writes.push(cursorValue ?? "");
    }
  }));
  assert.deepEqual(writes, ["500"]);
});

test("Gmail global no avanza cursor si falla persistencia Foco o quedan elegibles sin aplicar", async () => {
  let writes = 0;
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies());
  const externalId = reviewed.snapshot.items[0]?.externalId ?? "";

  const failed = await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [externalId],
    snapshot: reviewed.snapshot
  }, focusedSyncDependencies({
    syncMail: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => ({
      ...syncResult({ ...input, resourceType: "mail" }, "failed"),
      counts: { ...syncResult({ ...input, resourceType: "mail" }, "failed").counts, failed: 1 },
      errors: [{ code: "persist_failed", message: "persist failed" }],
      ok: false
    }),
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(failed.ok, false);
  assert.equal(writes, 0);

  const omitted = await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [],
    snapshot: reviewed.snapshot
  }, focusedSyncDependencies({
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.match(omitted.warnings.join(" "), /quedaron correos Foco elegibles/);
  assert.equal(writes, 0);
});

test("Gmail global recovery truncado o fallido no guarda baseline", async () => {
  let writes = 0;
  const truncated = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readCursorRecord: async () => null,
    readMail: async () => gmailRead({ complete: false, nextCursor: "ignored", truncatedBy: ["max_messages"] }),
    readMailProfileHistoryId: async () => "600"
  }));
  await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [],
    snapshot: truncated.snapshot
  }, focusedSyncDependencies({
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(writes, 0);

  await assert.rejects(
    reviewGoogleGmailFocusedSync({
      accessToken: "token",
      connectedAccountId: "account-1",
      now: "2026-10-05T12:00:00.000Z",
      userEmail: "sergio@crm.cl"
    }, focusedSyncDependencies({
      readCursorRecord: async () => null,
      readMail: async () => {
        throw new Error("recovery failed");
      },
      readMailProfileHistoryId: async () => "600",
      writeCursor: async () => {
        writes += 1;
      }
    })),
    /recovery failed/
  );
  assert.equal(writes, 0);
});

test("Gmail global recovery no considera completa una lectura que deja batches sin consultar", async () => {
  const focusedContacts = Array.from({ length: 21 }, (_, index) => ({
    ...contacts[0]!,
    contact_emails: [{ email: `foco-${index}@empresa.cl` }],
    id: `focus-${index}`,
    networking_focus: true
  }));
  let reads = 0;
  let writes = 0;
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    maxMailMessages: 1,
    now: "2026-10-05T12:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readAppContacts: async () => focusedContacts,
    readCursorRecord: async () => null,
    readMail: async () => {
      reads += 1;
      return gmailRead({
        messages: [gmailFromUser(`mail-${reads}`, `foco-${reads - 1}@empresa.cl`, undefined, undefined, "Sun, 4 Oct 2026 08:00:00 -0400")]
      });
    },
    readMailProfileHistoryId: async () => "700"
  }));

  assert.equal(reads, 1);
  assert.equal(reviewed.snapshot.complete, false);
  assert.deepEqual(reviewed.snapshot.truncatedBy, ["max_messages"]);

  await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [reviewed.snapshot.items[0]!.externalId],
    snapshot: reviewed.snapshot
  }, focusedSyncDependencies({
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(writes, 0);
});

test("Gmail global rechaza IDs fuera del snapshot y absorbe fuentes ya conocidas", async () => {
  let writes = 0;
  const reviewed = await reviewGoogleGmailFocusedSync({
    accessToken: "token",
    connectedAccountId: "account-1",
    userEmail: "sergio@crm.cl"
  }, focusedSyncDependencies({
    readExternalSourcesForPreview: async () => [{
      external_id: "GMAIL_mail-focus",
      source_subject: "Mail mail-focus",
      source_detail: "Hola",
      last_seen_at: "2026-08-04T12:00:00.000Z",
      interactions: {
        id: "interaction-existing",
        occurred_at: "2026-08-04T12:00:00.000Z",
        subject: "Mail mail-focus",
        source_detail: "Hola"
      }
    }]
  }));
  assert.deepEqual(reviewed.snapshot.preview.map((change) => change.type), ["unchanged"]);
  await applyGoogleGmailFocusedSync({
    connectedAccountId: "account-1",
    externalIds: [],
    snapshot: reviewed.snapshot
  }, focusedSyncDependencies({
    writeCursor: async () => {
      writes += 1;
    }
  }));
  assert.equal(writes, 1);

  await assert.rejects(
    applyGoogleGmailFocusedSync({
      connectedAccountId: "account-1",
      externalIds: ["GMAIL_not-reviewed"],
      snapshot: reviewed.snapshot
    }, focusedSyncDependencies()),
    /no pertenecen al snapshot/
  );
});

function focusedSyncDependencies(overrides: Record<string, unknown> = {}) {
  return {
    markCursorExpired: async () => {},
    readAppContacts: async () => contacts,
    readCursorRecord: async () => focusedCursor(),
    readExternalSourcesForPreview: async () => [],
    readMail: async () => gmailRead({ messages: [gmailFromUser("mail-focus", "maria@empresa.cl")], mode: "incremental", nextCursor: "205" }),
    readMailProfileHistoryId: async () => "300",
    syncMail: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => syncResult({ ...input, resourceType: "mail" }, "focused-sync"),
    writeCursor: async () => {},
    ...overrides
  };
}

function contactBackfillDependencies(overrides: Record<string, unknown> = {}) {
  return {
    markCursorExpired: async () => {},
    readAppContacts: async () => contacts,
    readCursor: async () => null,
    readExternalSourcesForPreview: async () => [],
    readMail: async () => gmailRead({
      messages: [gmailFromUser("mail-contact", "maria@empresa.cl", "Contacto", "Hola", "Thu, 1 Oct 2026 08:00:00 -0400")]
    }),
    readMailProfileHistoryId: async () => "history-no-esperado",
    syncCalendar: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => (
      syncResult({ ...input, resourceType: "calendar" }, "calendar-contact")
    ),
    syncMail: async (input: Omit<ExternalInteractionBatchInput, "resourceType">) => (
      syncResult({ ...input, resourceType: "mail" }, "contact-backfill")
    ),
    writeCursor: async () => {},
    ...overrides
  };
}

function focusedCursor(cursorValue = "100", connectedAccountId = "account-1") {
  return {
    connected_account_id: connectedAccountId,
    cursor_label: "",
    cursor_value: cursorValue,
    last_synced_at: "2026-10-05T10:00:00.000Z",
    metadata: {},
    provider: "google" as const,
    resource_type: "mail" as const,
    status: "ok" as const
  };
}

function gmailRead(input: {
  complete?: boolean;
  messages?: ReturnType<typeof gmailFromUser>[];
  mode?: "full" | "incremental";
  nextCursor?: string;
  truncatedBy?: Array<"max_messages" | "max_pages">;
} = {}) {
  return {
    complete: input.complete ?? true,
    messages: input.messages ?? [],
    mode: input.mode ?? "full" as const,
    nextCursor: input.nextCursor ?? "300",
    pagesRead: 1,
    resultSizeEstimate: input.messages?.length ?? 0,
    truncatedBy: input.truncatedBy ?? [],
    warnings: []
  };
}

async function bootstrapReviewFixture(complete = true) {
  return reviewGoogleGmailHistoricalBootstrap({
    accessToken: "token",
    label: { id: "Label_networking", name: "Networking" },
    maxMailMessages: 25,
    maxPages: 2,
    since: "2026-08-01T00:00:00.000Z",
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => contacts,
    readMailProfileHistoryId: async () => "500",
    readMail: async () => ({
      complete,
      messages: [
        gmailFromUser("mail-linked", "maria@empresa.cl"),
        gmailFromUser("mail-unlinked", "nueva@empresa.cl")
      ],
      mode: "full",
      nextCursor: "550",
      pagesRead: 1,
      resultSizeEstimate: 2,
      truncatedBy: complete ? [] : ["max_messages"],
      warnings: complete ? [] : ["Se alcanzo el limite de mensajes para esta lectura de Gmail."]
    }),
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "bootstrap-review")
  });
}

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

function gmailFromUser(id: string, to: string, subject = `Mail ${id}`, body = "Hola", date = "Tue, 4 Aug 2026 08:00:00 -0400") {
  return {
    id,
    historyId: "104",
    threadId: `${id}-thread`,
    payload: {
      headers: [
        { name: "From", value: "Sergio <sergio@crm.cl>" },
        { name: "To", value: to },
        { name: "Date", value: date },
        { name: "Subject", value: subject }
      ],
      body: { data: Buffer.from(body).toString("base64url") },
      mimeType: "text/plain"
    }
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
