import {
  GoogleInteractionClientError,
  readGoogleCalendarEvents,
  readGoogleGmailMessages,
  type GoogleCalendarReadResult,
  type GoogleGmailReadResult
} from "./googleInteractionClient.ts";
import {
  saveCalendarReadDiagnostics,
  type CalendarReadDiagnosticInput
} from "./externalInteractionReadDiagnostics.ts";
import {
  mapCalendarEventToExternalInteraction,
  mapGmailMessageToExternalInteraction,
  type GoogleContactIndex
} from "./googleInteractionAdapter.ts";
import { readSyncCursor, markSyncCursorExpired, upsertSyncCursor } from "./syncCursorStore.ts";
import {
  syncCalendarInteractions,
  syncMailInteractions,
  type SyncPreviewChange,
  type SyncRunResult
} from "./syncOrchestrator.ts";
import type { ExternalInteractionInput } from "./externalInteractionSync.ts";
import type { ContactRow } from "./readModel.ts";
import { supabase } from "./supabaseClient.ts";

const GOOGLE_PROVIDER = "google";
const MAX_FOCUSED_CONTACTS_FOR_ACTIVITY_SYNC = 50;
const MAX_SCOPED_EMAILS_FOR_GMAIL_QUERY = 30;

export type SyncGoogleInteractionsInput = {
  accessToken: string;
  userEmail: string;
  connectedAccountId?: string | null;
  contactIds?: string[];
  cursorLabel?: string;
  dryRun?: boolean;
  externalIds?: string[];
  focusedOnly?: boolean;
  forceFullSync?: boolean;
  includeCalendar?: boolean;
  includeMail?: boolean;
  maxCalendarEvents?: number;
  maxMailMessages?: number;
  maxPages?: number;
  calendarQuery?: string | null;
  calendarFutureTimeMax?: string | null;
  calendarFutureTimeMin?: string | null;
  calendarTimeMin?: string | null;
  gmailSince?: string | null;
  gmailQuery?: string | null;
  saveCursors?: boolean;
  saveReadDiagnostics?: boolean;
};

export type SyncGoogleInteractionsResult = {
  ok: boolean;
  mail: SyncRunResult | null;
  calendar: SyncRunResult | null;
  googleRead: {
    mailMessages: number;
    mailPages: number;
    calendarEvents: number;
    calendarPages: number;
  };
  warnings: string[];
  errors: Array<{ code: string; message: string }>;
};

type SyncGoogleInteractionsDependencies = {
  readAppContacts: () => Promise<ContactRow[]>;
  readCursor: (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => Promise<string | null>;
  markCursorExpired: (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => Promise<void>;
  writeCursor: (input: { cursorLabel?: string; resourceType: "mail" | "calendar"; cursorValue: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  readMail: (input: {
    accessToken: string;
    historyId?: string | null;
    maxMessages?: number;
    maxPages?: number;
    query?: string | null;
    since?: string | null;
  }) => Promise<GoogleGmailReadResult>;
  readCalendar: (input: {
    accessToken: string;
    maxEvents?: number;
    maxPages?: number;
    query?: string | null;
    syncToken?: string | null;
    timeMin?: string | null;
    timeMax?: string | null;
  }) => Promise<GoogleCalendarReadResult>;
  readExternalSourcesForPreview: (input: { items: ExternalInteractionInput[]; provider: string; sourceService: string }) => Promise<ExternalInteractionSourcePreviewRow[]>;
  saveCalendarReadDiagnostics: (input: CalendarReadDiagnosticInput) => Promise<void>;
  syncMail: typeof syncMailInteractions;
  syncCalendar: typeof syncCalendarInteractions;
};

type ExternalInteractionSourcePreviewRow = {
  external_id: string;
  external_url?: string | null;
  source_subject?: string | null;
  source_detail?: string | null;
  last_seen_at?: string | null;
  prevent_reimport?: boolean | null;
  sync_status?: string | null;
  interactions?: {
    id?: string | null;
    occurred_at?: string | null;
    subject?: string | null;
    source_detail?: string | null;
  } | Array<{
    id?: string | null;
    occurred_at?: string | null;
    subject?: string | null;
    source_detail?: string | null;
  }> | null;
};

type ScopedCalendarReadResult = GoogleCalendarReadResult & {
  matchedContactEmailsByEventKey?: Record<string, string[]>;
};

export async function syncGoogleInteractions(
  input: SyncGoogleInteractionsInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {}
): Promise<SyncGoogleInteractionsResult> {
  const deps = defaultDependencies(dependencies);
  const cursorLabel = input.cursorLabel ?? "";
  const shouldUseCursors = input.forceFullSync ? false : input.saveCursors !== false;
  const [contacts, mailCursor, calendarCursor] = await Promise.all([
    deps.readAppContacts(),
    input.includeMail === false || !shouldUseCursors ? Promise.resolve(null) : deps.readCursor({ cursorLabel, resourceType: "mail" }),
    input.includeCalendar === false || !shouldUseCursors ? Promise.resolve(null) : deps.readCursor({ cursorLabel, resourceType: "calendar" })
  ]);
  const scopedContacts = filterContactsForSync(contacts, input);
  const contactsByEmail = contactIndexByEmail(scopedContacts);
  const scopedEmailQuery = input.gmailQuery ?? gmailQueryForScopedContacts(scopedContacts);
  const scopedCalendarQueries = calendarQueriesForScopedContacts(input, scopedContacts);
  const warnings: string[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  let mail: SyncRunResult | null = null;
  let calendar: SyncRunResult | null = null;
  let mailRead: GoogleGmailReadResult | null = null;
  let calendarRead: ScopedCalendarReadResult | null = null;

  if (input.includeMail !== false) {
    try {
      const skipMail = shouldSkipFocusedMail(input, scopedContacts, scopedEmailQuery);
      if (skipMail) {
        warnings.push(skipMail);
      } else {
        mailRead = await readMailWithExpiredCursorRetry(deps, {
        accessToken: input.accessToken,
        cursorLabel,
        historyId: mailCursor,
        maxMessages: input.maxMailMessages,
        maxPages: input.maxPages,
        query: scopedEmailQuery,
        since: input.gmailSince
        });
        const mailItems = filterExternalInteractionsFromDate(
          mailRead.messages
            .map((message) => mapGmailMessageToExternalInteraction({ contactsByEmail, message, userEmail: input.userEmail }))
            .filter((item): item is ExternalInteractionInput => Boolean(item)),
          input.gmailSince
        );
        const mailPreview = await buildInteractionSyncPreview(deps, {
          items: mailItems,
          provider: GOOGLE_PROVIDER,
          sourceService: "gmail"
        });
        mail = await deps.syncMail({
          connectedAccountId: input.connectedAccountId,
          cursorAfter: mailRead.nextCursor,
          cursorBefore: mailCursor,
          dryRun: input.dryRun,
          items: mailItems,
          mode: mailRead.mode === "incremental" ? "incremental" : "historical",
          provider: GOOGLE_PROVIDER,
          scope: { externalIds: input.externalIds, limit: input.maxMailMessages ?? null, reason: "google_gmail_sync" },
          source: "google_gmail_sync_flow"
        });
        mail.preview = mailPreview;
        warnings.push(...mailRead.warnings, ...mail.warnings);
        if (mail.ok && !input.dryRun && shouldUseCursors) {
          await deps.writeCursor({
            cursorLabel,
            cursorValue: mailRead.nextCursor,
            metadata: { mode: mailRead.mode, pages_read: mailRead.pagesRead, result_size_estimate: mailRead.resultSizeEstimate },
            resourceType: "mail"
          });
        }
      }
    } catch (error) {
      errors.push(normalizeGoogleSyncError(error));
    }
  }

  if (input.includeCalendar !== false) {
    try {
      const skipCalendar = shouldSkipFocusedCalendar(input, scopedContacts, scopedCalendarQueries);
      if (skipCalendar) {
        warnings.push(skipCalendar);
      } else {
        calendarRead = await readCalendarWithExpiredCursorRetry(deps, {
        accessToken: input.accessToken,
        calendarQueries: scopedCalendarQueries,
        calendarFutureTimeMax: input.calendarFutureTimeMax,
        calendarFutureTimeMin: input.calendarFutureTimeMin,
        calendarTimeMin: input.calendarTimeMin,
        calendarQuery: input.calendarQuery,
        cursorLabel,
        maxCalendarEvents: input.maxCalendarEvents,
        maxPages: input.maxPages,
        syncToken: calendarCursor
        });
        const mappedCalendarItems = calendarRead.events
            .map((event) => mapCalendarEventToExternalInteraction({
              contactsByEmail,
              event,
              matchedContactEmails: calendarRead?.matchedContactEmailsByEventKey?.[calendarEventKey(event)] ?? [],
              userEmail: input.userEmail
            }))
            .filter((item): item is ExternalInteractionInput => Boolean(item));
        const calendarItems = filterExternalInteractionsFromDate(
          mappedCalendarItems,
          input.calendarTimeMin
        );
        if (input.saveReadDiagnostics) {
          await deps.saveCalendarReadDiagnostics({
            calendarTimeMin: input.calendarTimeMin,
            events: calendarRead.events,
            mappedItems: mappedCalendarItems,
            matchedContactEmailsByEventKey: calendarRead.matchedContactEmailsByEventKey,
            provider: GOOGLE_PROVIDER,
            readContext: {
              cursor_label: cursorLabel,
              dry_run: Boolean(input.dryRun),
              focused_only: Boolean(input.focusedOnly),
              mode: calendarRead.mode,
              pages_read: calendarRead.pagesRead
            },
            sourceService: "calendar",
            syncedItems: calendarItems
          });
        }
        const calendarPreview = await buildInteractionSyncPreview(deps, {
          items: calendarItems,
          provider: GOOGLE_PROVIDER,
          sourceService: "calendar"
        });
        calendar = await deps.syncCalendar({
          connectedAccountId: input.connectedAccountId,
          cursorAfter: calendarRead.nextSyncToken,
          cursorBefore: calendarCursor,
          dryRun: input.dryRun,
          items: calendarItems,
          mode: calendarCursor ? "incremental" : "historical",
          provider: GOOGLE_PROVIDER,
          scope: { externalIds: input.externalIds, limit: input.maxCalendarEvents ?? null, reason: "google_calendar_sync" },
          source: "google_calendar_sync_flow"
        });
        calendar.preview = calendarPreview;
        warnings.push(...calendarRead.warnings, ...calendar.warnings);
        if (calendar.ok && calendarRead.nextSyncToken && !input.dryRun && shouldUseCursors) {
          await deps.writeCursor({
            cursorLabel,
            cursorValue: calendarRead.nextSyncToken,
            metadata: { pages_read: calendarRead.pagesRead },
            resourceType: "calendar"
          });
        }
      }
    } catch (error) {
      errors.push(normalizeGoogleSyncError(error));
    }
  }

  const effectiveErrors = effectiveSyncErrors(errors, { calendar, includeCalendar: input.includeCalendar, includeMail: input.includeMail, mail });
  const effectiveWarnings = effectiveErrors.length === errors.length
    ? warnings
    : [
        ...warnings,
        ...errors
          .filter((error) => !effectiveErrors.includes(error))
          .map((error) => error.message)
      ];

  return {
    calendar,
    errors: effectiveErrors,
    googleRead: {
      calendarEvents: calendarRead?.events.length ?? 0,
      calendarPages: calendarRead?.pagesRead ?? 0,
      mailMessages: mailRead?.messages.length ?? 0,
      mailPages: mailRead?.pagesRead ?? 0
    },
    mail,
    ok: effectiveErrors.length === 0 && (mail?.ok ?? true) && (calendar?.ok ?? true),
    warnings: effectiveWarnings
  };
}

async function readCalendarWithExpiredCursorRetry(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    calendarQueries?: string[];
    calendarFutureTimeMax?: string | null;
    calendarFutureTimeMin?: string | null;
    calendarTimeMin?: string | null;
    calendarQuery?: string | null;
    cursorLabel: string;
    maxCalendarEvents?: number;
    maxPages?: number;
    syncToken: string | null;
  }
) {
  try {
    return await readCalendarForScope(deps, input);
  } catch (error) {
    if (!(error instanceof GoogleInteractionClientError) || error.code !== "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN") throw error;
    await deps.markCursorExpired({ cursorLabel: input.cursorLabel, resourceType: "calendar" });
    return readCalendarForScope(deps, { ...input, syncToken: null });
  }
}

async function readCalendarForScope(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    calendarQueries?: string[];
    calendarFutureTimeMax?: string | null;
    calendarFutureTimeMin?: string | null;
    calendarTimeMin?: string | null;
    calendarQuery?: string | null;
    maxCalendarEvents?: number;
    maxPages?: number;
    syncToken: string | null;
  }
): Promise<ScopedCalendarReadResult> {
  const calendarQueries = input.calendarQueries ?? [];
  if (input.syncToken) {
    const result = await deps.readCalendar({
      accessToken: input.accessToken,
      maxEvents: input.maxCalendarEvents,
      maxPages: input.maxPages,
      query: null,
      syncToken: input.syncToken,
      timeMin: null,
      timeMax: null
    });
    const incrementalResult: ScopedCalendarReadResult = {
      ...result,
      matchedContactEmailsByEventKey: calendarQueries.length
        ? matchedContactEmailsForEvents(result.events, calendarQueries)
        : undefined
    };
    if (!calendarQueries.length || !input.calendarFutureTimeMax) return incrementalResult;
    const futureResult = await readCalendarQueriesForWindows(deps, input, [{
      timeMin: input.calendarFutureTimeMin,
      timeMax: input.calendarFutureTimeMax
    }]);
    return mergeScopedCalendarReadResults(incrementalResult, futureResult);
  }

  if (input.calendarQuery || !calendarQueries.length) {
    const result = await deps.readCalendar({
      accessToken: input.accessToken,
      maxEvents: input.maxCalendarEvents,
      maxPages: input.maxPages,
      query: input.calendarQuery,
      syncToken: null,
      timeMin: input.calendarTimeMin,
      timeMax: input.calendarFutureTimeMax
    });
    return result;
  }

  return readCalendarQueriesForWindows(deps, input, calendarScopedWindows(input));
}

async function readCalendarQueriesForWindows(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    calendarQueries?: string[];
    maxCalendarEvents?: number;
    maxPages?: number;
  },
  windows: Array<{ timeMin?: string | null; timeMax?: string | null }>
): Promise<ScopedCalendarReadResult> {
  const calendarQueries = input.calendarQueries ?? [];
  const eventsById = new Map<string, GoogleCalendarReadResult["events"][number]>();
  const matchedContactEmailsByEventKey: Record<string, string[]> = {};
  const warnings: string[] = [];
  let pagesRead = 0;

  for (const window of windows) {
    for (const query of calendarQueries) {
      const result = await deps.readCalendar({
        accessToken: input.accessToken,
        maxEvents: input.maxCalendarEvents,
        maxPages: input.maxPages,
        query,
        syncToken: null,
        timeMin: window.timeMin,
        timeMax: window.timeMax
      });
      pagesRead += result.pagesRead;
      warnings.push(...result.warnings);
      for (const event of result.events) {
        const key = calendarEventKey(event);
        eventsById.set(key, event);
        matchedContactEmailsByEventKey[key] = Array.from(new Set([
          ...(matchedContactEmailsByEventKey[key] ?? []),
          query.trim().toLowerCase()
        ].filter(Boolean)));
        if (eventsById.size >= (input.maxCalendarEvents ?? Number.POSITIVE_INFINITY)) break;
      }
      if (eventsById.size >= (input.maxCalendarEvents ?? Number.POSITIVE_INFINITY)) break;
    }
    if (eventsById.size >= (input.maxCalendarEvents ?? Number.POSITIVE_INFINITY)) break;
  }

  return {
    events: Array.from(eventsById.values()),
    matchedContactEmailsByEventKey,
    mode: "full",
    nextSyncToken: null,
    pagesRead,
    warnings
  };
}

function calendarScopedWindows(input: {
  calendarFutureTimeMax?: string | null;
  calendarFutureTimeMin?: string | null;
  calendarTimeMin?: string | null;
}) {
  const futureMin = cleanIso(input.calendarFutureTimeMin);
  const futureMax = cleanIso(input.calendarFutureTimeMax);
  const historyMin = cleanIso(input.calendarTimeMin);
  if (!futureMax || !futureMin) return [{ timeMin: historyMin, timeMax: futureMax }];
  return [
    { timeMin: futureMin, timeMax: futureMax },
    { timeMin: historyMin, timeMax: futureMin }
  ];
}

function mergeScopedCalendarReadResults(
  primary: ScopedCalendarReadResult,
  supplemental: ScopedCalendarReadResult
): ScopedCalendarReadResult {
  const eventsByKey = new Map<string, GoogleCalendarReadResult["events"][number]>();
  for (const event of [...primary.events, ...supplemental.events]) {
    eventsByKey.set(calendarEventKey(event), event);
  }
  return {
    ...primary,
    events: Array.from(eventsByKey.values()),
    matchedContactEmailsByEventKey: {
      ...(primary.matchedContactEmailsByEventKey ?? {}),
      ...(supplemental.matchedContactEmailsByEventKey ?? {})
    },
    pagesRead: primary.pagesRead + supplemental.pagesRead,
    warnings: [...primary.warnings, ...supplemental.warnings]
  };
}

function cleanIso(value?: string | null) {
  return value?.trim() || null;
}

async function readMailWithExpiredCursorRetry(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    cursorLabel: string;
    historyId?: string | null;
    maxMessages?: number;
    maxPages?: number;
    query?: string | null;
    since?: string | null;
  }
) {
  const historyId = numericCursor(input.historyId);
  try {
    return await deps.readMail({
      accessToken: input.accessToken,
      historyId,
      maxMessages: input.maxMessages,
      maxPages: input.maxPages,
      query: historyId ? null : input.query,
      since: historyId ? null : input.since
    });
  } catch (error) {
    if (!(error instanceof GoogleInteractionClientError) || error.code !== "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN") throw error;
    await deps.markCursorExpired({ cursorLabel: input.cursorLabel, resourceType: "mail" });
    return deps.readMail({
      accessToken: input.accessToken,
      historyId: null,
      maxMessages: input.maxMessages,
      maxPages: input.maxPages,
      query: input.query,
      since: input.since
    });
  }
}

function defaultDependencies(overrides: Partial<SyncGoogleInteractionsDependencies>): SyncGoogleInteractionsDependencies {
  return {
    markCursorExpired: async (input) => {
      await markSyncCursorExpired({
        cursorLabel: input.cursorLabel,
        provider: GOOGLE_PROVIDER,
        resourceType: input.resourceType
      });
    },
    readAppContacts: async () => {
      const { readAllActiveContacts } = await import("./cloudData.ts");
      return readAllActiveContacts();
    },
    readCalendar: readGoogleCalendarEvents,
    readCursor: async (input) => {
      const cursor = await readSyncCursor({
        cursorLabel: input.cursorLabel,
        provider: GOOGLE_PROVIDER,
        resourceType: input.resourceType
      });
      return cursor?.status === "ok" ? cursor.cursor_value : null;
    },
    readMail: readGoogleGmailMessages,
    readExternalSourcesForPreview: readExternalSourcesForPreview,
    saveCalendarReadDiagnostics,
    syncCalendar: syncCalendarInteractions,
    syncMail: syncMailInteractions,
    writeCursor: async (input) => {
      await upsertSyncCursor({
        cursorLabel: input.cursorLabel,
        cursorValue: input.cursorValue,
        metadata: input.metadata,
        provider: GOOGLE_PROVIDER,
        resourceType: input.resourceType
      });
    },
    ...overrides
  };
}

async function buildInteractionSyncPreview(
  deps: SyncGoogleInteractionsDependencies,
  input: { items: ExternalInteractionInput[]; provider: string; sourceService: string }
): Promise<SyncPreviewChange[]> {
  if (!input.items.length) return [];
  const existingRows = await deps.readExternalSourcesForPreview(input);
  const existingByExternalId = new Map(existingRows.map((row) => [row.external_id.toLowerCase(), row]));

  return input.items
    .map((item) => previewChangeForInteraction(item, existingByExternalId.get(item.externalId.toLowerCase())))
    .sort((a, b) => comparePreviewDates(b, a) || a.title.localeCompare(b.title, "es", { sensitivity: "base" }));
}

function previewChangeForInteraction(
  item: ExternalInteractionInput,
  existing?: ExternalInteractionSourcePreviewRow
): SyncPreviewChange {
  const currentInteraction = firstInteraction(existing?.interactions);
  const sourceLabel = item.sourceService === "gmail" ? "Gmail" : "Calendar";
  const title = item.subject || (item.interactionType === "calendar" ? "Reunion sin titulo" : "Correo sincronizado");
  const fields = [
    previewField("Tipo", null, interactionTypeLabel(item.interactionType), "info"),
    previewField("Fecha", currentInteraction?.occurred_at ?? existing?.last_seen_at ?? null, item.occurredAt ?? null, "replace"),
    previewField("Asunto", currentInteraction?.subject ?? existing?.source_subject ?? null, item.subject ?? null, "replace"),
    previewField("Contenido", currentInteraction?.source_detail ?? existing?.source_detail ?? null, item.sourceDetail ?? null, "replace"),
    previewField("Participantes", null, participantSummary(item), "info"),
    previewField("Origen", null, sourceLabel, "info")
  ];

  if (!existing) {
    return {
      defaultSelected: true,
      fields: fields.map((field) => ({ ...field, before: null, changed: true, operation: field.operation === "info" ? "info" : "add" })),
      id: `${item.sourceService}:${item.externalId}`,
      metadata: interactionPreviewMetadata(item),
      sourceLabel,
      title,
      type: "new"
    };
  }

  if (existing.prevent_reimport) {
    return {
      blocking: true,
      defaultSelected: false,
      fields: [
        previewField("Motivo", null, "La interaccion fue eliminada o bloqueada para no reimportar.", "info"),
        previewField("Origen", null, sourceLabel, "info")
      ],
      id: `${item.sourceService}:${item.externalId}`,
      metadata: interactionPreviewMetadata(item),
      sourceLabel,
      title,
      type: "skipped"
    };
  }

  const changedFields = fields;
  const changed = changedFields.some((field) => field.changed);
  return {
    defaultSelected: changed,
    fields: changedFields,
    id: `${item.sourceService}:${item.externalId}`,
    metadata: interactionPreviewMetadata(item),
    sourceLabel,
    title,
    type: changed ? "modified" : "unchanged"
  };
}

function previewField(
  label: string,
  before: string | null,
  after: string | null,
  operation: "add" | "replace" | "info"
) {
  return {
    after: formatPreviewValue(label, after),
    before: formatPreviewValue(label, before),
    changed: operation !== "info" && !samePreviewValue(label, before, after),
    label,
    operation
  };
}

function interactionPreviewMetadata(item: ExternalInteractionInput) {
  return {
    occurredAt: item.occurredAt ?? null,
    externalId: item.externalId,
    interactionType: item.interactionType,
    sourceService: item.sourceService
  };
}

async function readExternalSourcesForPreview(input: { items: ExternalInteractionInput[]; provider: string; sourceService: string }): Promise<ExternalInteractionSourcePreviewRow[]> {
  if (!supabase || !input.items.length) return [];
  const externalIds = externalInteractionSourceIdsForPreview(input.items);
  if (!externalIds.length) return [];
  const { data, error } = await supabase
    .from("external_interaction_sources")
    .select("external_id,external_url,source_subject,source_detail,last_seen_at,prevent_reimport,sync_status,interactions(id,occurred_at,subject,source_detail)")
    .eq("provider", input.provider)
    .eq("source_service", input.sourceService)
    .eq("is_active", true)
    .in("external_id", externalIds);
  if (error) throw error;
  return (data ?? []) as ExternalInteractionSourcePreviewRow[];
}

export function externalInteractionSourceIdsForPreview(items: Array<{ externalId: string }>) {
  return Array.from(new Set(items.map((item) => item.externalId.toLowerCase()).filter(Boolean)));
}

function firstInteraction(value: ExternalInteractionSourcePreviewRow["interactions"]) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function participantSummary(item: ExternalInteractionInput) {
  const participants = item.participants ?? [];
  const labels = participants.map((participant) => participant.email || participant.contactId).filter(Boolean);
  if (!labels.length) return "sin participantes vinculados";
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} y ${labels.length - 3} mas`;
}

function interactionTypeLabel(type: ExternalInteractionInput["interactionType"]) {
  if (type === "email") return "Correo";
  if (type === "calendar") return "Cita";
  if (type === "call") return "Llamada";
  if (type === "message") return "Mensaje";
  return "Manual";
}

function formatPreviewValue(label: string, value?: string | null) {
  const cleanValue = value?.trim() ?? "";
  if (!cleanValue) return "";
  if (label === "Fecha") return formatPreviewDate(cleanValue);
  if (label === "Contenido") return cleanValue.length > 120 ? `${cleanValue.slice(0, 120).trim()}...` : cleanValue;
  return cleanValue;
}

function formatPreviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "2-digit"
  });
}

function samePreviewValue(label: string, left?: string | null, right?: string | null) {
  if (label === "Fecha") {
    const leftTime = parsedTime(left);
    const rightTime = parsedTime(right);
    if (leftTime !== null && rightTime !== null) return leftTime === rightTime;
  }
  return sameComparableValue(left, right);
}

function sameComparableValue(left?: string | null, right?: string | null) {
  return (left ?? "").trim() === (right ?? "").trim();
}

function filterExternalInteractionsFromDate(items: ExternalInteractionInput[], minIso?: string | null) {
  const minTime = parsedTime(minIso);
  if (minTime === null) return items;
  return items.filter((item) => {
    const itemTime = parsedTime(item.occurredAt);
    return itemTime === null || itemTime >= minTime;
  });
}

function parsedTime(value?: string | null) {
  const cleanValue = value?.trim();
  if (!cleanValue) return null;
  const time = new Date(normalizeIsoTimezone(cleanValue)).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalizeIsoTimezone(value: string) {
  return value.replace(/([+-]\d{2})$/, "$1:00");
}

function comparePreviewDates(left: SyncPreviewChange, right: SyncPreviewChange) {
  const leftTime = previewSortTime(left);
  const rightTime = previewSortTime(right);
  return leftTime === rightTime ? 0 : leftTime - rightTime;
}

function previewSortTime(change: SyncPreviewChange) {
  const value = typeof change.metadata?.occurredAt === "string"
    ? change.metadata.occurredAt
    : change.fields.find((field) => field.label === "Fecha")?.after;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function contactIndexByEmail(contacts: ContactRow[]): GoogleContactIndex {
  const entries: Array<[string, { contactId: string }]> = [];
  for (const contact of contacts) {
    for (const item of contact.contact_emails ?? []) {
      const email = item.email?.trim().toLowerCase();
      if (email) entries.push([email, { contactId: contact.id }]);
    }
  }
  return Object.fromEntries(entries);
}

function gmailQueryForScopedContacts(contacts: ContactRow[]) {
  const emails = uniqueContactEmails(contacts);
  if (!emails.length || emails.length > MAX_SCOPED_EMAILS_FOR_GMAIL_QUERY) return null;
  return `(${emails.map((email) => `(from:${email} OR to:${email} OR cc:${email} OR bcc:${email})`).join(" OR ")})`;
}

function calendarQueriesForScopedContacts(input: SyncGoogleInteractionsInput, contacts: ContactRow[]) {
  if (input.calendarQuery) return [];
  if (!input.focusedOnly && !(input.contactIds?.length ?? 0)) return [];
  const emails = uniqueContactEmails(contacts);
  if (!emails.length || emails.length > MAX_SCOPED_EMAILS_FOR_GMAIL_QUERY) return [];
  return emails;
}

function shouldSkipFocusedMail(input: SyncGoogleInteractionsInput, contacts: ContactRow[], scopedEmailQuery: string | null) {
  if (!input.focusedOnly) return "";
  if (!contacts.length) return "No hay contactos en foco para revisar Gmail.";
  if (!scopedEmailQuery) {
    return `Gmail no se reviso porque hay demasiados correos en contactos foco. Deja hasta ${MAX_SCOPED_EMAILS_FOR_GMAIL_QUERY} correos foco para esta revision beta.`;
  }
  return "";
}

function shouldSkipFocusedCalendar(input: SyncGoogleInteractionsInput, contacts: ContactRow[], calendarQueries: string[]) {
  const isScopedReview = Boolean(input.focusedOnly || (input.contactIds?.length ?? 0));
  if (!isScopedReview || input.calendarQuery) return "";
  if (!contacts.length) return "No hay contactos en foco para revisar Calendar.";
  if (contacts.length > MAX_FOCUSED_CONTACTS_FOR_ACTIVITY_SYNC) {
    return `Calendar no se reviso porque hay demasiados contactos en foco. Deja hasta ${MAX_FOCUSED_CONTACTS_FOR_ACTIVITY_SYNC} contactos foco para esta revision beta.`;
  }
  const emails = uniqueContactEmails(contacts);
  if (!emails.length) return "Calendar no se reviso porque los contactos seleccionados no tienen correos.";
  if (!calendarQueries.length) {
    return `Calendar no se reviso porque hay demasiados correos en contactos foco. Deja hasta ${MAX_SCOPED_EMAILS_FOR_GMAIL_QUERY} correos foco para esta revision beta.`;
  }
  return "";
}

function uniqueContactEmails(contacts: ContactRow[]) {
  return Array.from(new Set(
    contacts.flatMap((contact) => (
      contact.contact_emails ?? []
    ).map((item) => item.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email)))
  ));
}

function calendarEventKey(event: GoogleCalendarReadResult["events"][number]) {
  const id = event.id?.trim().toLowerCase();
  if (id) return id;
  return [
    event.summary ?? "",
    event.start?.dateTime ?? event.start?.date ?? ""
  ].join("|").toLowerCase();
}

function matchedContactEmailsForEvents(events: GoogleCalendarReadResult["events"], emails: string[]) {
  const cleanEmails = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);
  const matches: Record<string, string[]> = {};
  for (const event of events) {
    const eventText = JSON.stringify(event).toLowerCase();
    const eventMatches = cleanEmails.filter((email) => eventText.includes(email));
    if (eventMatches.length) matches[calendarEventKey(event)] = Array.from(new Set(eventMatches));
  }
  return matches;
}

function filterContactsForSync(contacts: ContactRow[], input: SyncGoogleInteractionsInput) {
  const ids = new Set((input.contactIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (ids.size) return contacts.filter((contact) => ids.has(contact.id));
  if (input.focusedOnly) return contacts.filter((contact) => contact.networking_focus && contact.is_active);
  return contacts.filter((contact) => contact.is_active);
}

function normalizeGoogleSyncError(error: unknown) {
  if (error instanceof GoogleInteractionClientError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "GOOGLE_INTERACTION_SYNC_FAILED",
    message: error instanceof Error ? error.message : "No pude sincronizar interacciones Google."
  };
}

function effectiveSyncErrors(
  errors: Array<{ code: string; message: string }>,
  input: {
    calendar: SyncRunResult | null;
    includeCalendar?: boolean;
    includeMail?: boolean;
    mail: SyncRunResult | null;
  }
) {
  if (!errors.length) return errors;
  const hasSuccessfulRequestedService =
    (input.includeMail !== false && Boolean(input.mail?.ok)) ||
    (input.includeCalendar !== false && Boolean(input.calendar?.ok));
  if (!hasSuccessfulRequestedService) return errors;
  const nonPermissionErrors = errors.filter((error) => error.code !== "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
  return nonPermissionErrors;
}

function numericCursor(value?: string | null) {
  const clean = value?.trim() ?? "";
  return /^\d+$/.test(clean) ? clean : null;
}
