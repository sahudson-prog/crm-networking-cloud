import test from "node:test";
import assert from "node:assert/strict";

import { GoogleInteractionClientError } from "../lib/googleInteractionClient.ts";
import { externalInteractionSourceIdsForPreview, syncGoogleInteractions } from "../lib/googleInteractionSyncFlow.ts";
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

test("syncGoogleInteractions mapea Gmail y Calendar a lotes agnosticos y guarda cursores", async () => {
  const mailBatches: ExternalInteractionBatchInput[] = [];
  const calendarBatches: ExternalInteractionBatchInput[] = [];
  const writtenCursors: Array<{ resourceType: string; cursorValue: string | null }> = [];
  let receivedHistoryId: string | null | undefined = "";

  const result = await syncGoogleInteractions({
    accessToken: "token",
    userEmail: "sergio@crm.cl",
    maxMailMessages: 5,
    maxCalendarEvents: 5
  }, {
    readAppContacts: async () => contacts,
    readCursor: async ({ resourceType }) => resourceType === "mail" ? "100" : "calendar-prev",
    readMail: async ({ historyId }) => {
      receivedHistoryId = historyId;
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
  assert.equal(receivedHistoryId, "100");
  assert.equal(mailBatches[0].mode, "incremental");
  assert.equal(mailBatches[0].items[0].externalId, "GMAIL_mail-1");
  assert.equal(mailBatches[0].items[0].participants?.[0]?.contactId, "contact-maria");
  assert.equal(calendarBatches[0].items[0].externalUrl, "https://calendar.google.com/event?eid=abc");
  assert.deepEqual(writtenCursors, [
    { resourceType: "mail", cursorValue: "104" },
    { resourceType: "calendar", cursorValue: "calendar-next" }
  ]);
});

test("syncGoogleInteractions no bloquea Calendar si falta permiso Gmail", async () => {
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

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.includes("Gmail necesita permiso de lectura."), true);
  assert.equal(calendarBatches[0].items.length, 1);
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

test("syncGoogleInteractions evita lectura amplia si hay demasiados contactos en foco", async () => {
  let mailReads = 0;
  let calendarReads = 0;
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
    userEmail: "sergio@crm.cl"
  }, {
    readAppContacts: async () => manyFocusedContacts,
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
    readCalendar: async () => {
      calendarReads += 1;
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

  assert.equal(mailReads, 0);
  assert.equal(calendarReads, 0);
  assert.match(result.warnings.join(" "), /demasiados/);
});

test("syncGoogleInteractions evita lectura amplia Calendar si hay demasiados correos en foco", async () => {
  let calendarReads = 0;
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
    readCalendar: async () => {
      calendarReads += 1;
      throw new Error("No debe hacer lectura amplia de Calendar.");
    },
    syncMail: async (input) => syncResult({ ...input, resourceType: "mail" as const }, "mail"),
    syncCalendar: async (input) => syncResult({ ...input, resourceType: "calendar" as const }, "calendar"),
    writeCursor: async () => {},
    markCursorExpired: async () => {}
  });

  assert.equal(calendarReads, 0);
  assert.match(result.warnings.join(" "), /demasiados correos/);
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
