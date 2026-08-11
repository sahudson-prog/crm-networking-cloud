import {
  GoogleInteractionClientError,
  readGoogleCalendarEvents,
  readGoogleGmailMessages,
  type GoogleCalendarReadResult,
  type GoogleGmailReadResult
} from "./googleInteractionClient.ts";
import {
  mapCalendarEventToExternalInteraction,
  mapGmailMessageToExternalInteraction,
  type GoogleContactIndex
} from "./googleInteractionAdapter.ts";
import { readSyncCursor, markSyncCursorExpired, upsertSyncCursor } from "./syncCursorStore.ts";
import {
  syncCalendarInteractions,
  syncMailInteractions,
  type SyncRunResult
} from "./syncOrchestrator.ts";
import type { ExternalInteractionInput } from "./externalInteractionSync.ts";
import type { ContactRow } from "./readModel.ts";

const GOOGLE_PROVIDER = "google";

export type SyncGoogleInteractionsInput = {
  accessToken: string;
  userEmail: string;
  connectedAccountId?: string | null;
  contactIds?: string[];
  cursorLabel?: string;
  dryRun?: boolean;
  focusedOnly?: boolean;
  forceFullSync?: boolean;
  includeCalendar?: boolean;
  includeMail?: boolean;
  maxCalendarEvents?: number;
  maxMailMessages?: number;
  maxPages?: number;
  calendarQuery?: string | null;
  calendarTimeMin?: string | null;
  gmailSince?: string | null;
  gmailQuery?: string | null;
  saveCursors?: boolean;
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
  markCursorExpired: (input: { cursorLabel?: string; resourceType: "calendar" }) => Promise<void>;
  writeCursor: (input: { cursorLabel?: string; resourceType: "mail" | "calendar"; cursorValue: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  readMail: (input: {
    accessToken: string;
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
  }) => Promise<GoogleCalendarReadResult>;
  syncMail: typeof syncMailInteractions;
  syncCalendar: typeof syncCalendarInteractions;
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
  const warnings: string[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  let mail: SyncRunResult | null = null;
  let calendar: SyncRunResult | null = null;
  let mailRead: GoogleGmailReadResult | null = null;
  let calendarRead: GoogleCalendarReadResult | null = null;

  if (input.includeMail !== false) {
    try {
      mailRead = await deps.readMail({
        accessToken: input.accessToken,
        maxMessages: input.maxMailMessages,
        maxPages: input.maxPages,
        query: input.gmailQuery,
        since: mailCursor ?? input.gmailSince
      });
      const mailItems = mailRead.messages
        .map((message) => mapGmailMessageToExternalInteraction({ contactsByEmail, message, userEmail: input.userEmail }))
        .filter((item): item is ExternalInteractionInput => Boolean(item));
      mail = await deps.syncMail({
        connectedAccountId: input.connectedAccountId,
        cursorAfter: mailRead.nextCursor,
        cursorBefore: mailCursor,
        dryRun: input.dryRun,
        items: mailItems,
        mode: mailCursor ? "incremental" : "historical",
        provider: GOOGLE_PROVIDER,
        scope: { limit: input.maxMailMessages ?? null, reason: "google_gmail_sync" },
        source: "google_gmail_sync_flow"
      });
      warnings.push(...mailRead.warnings, ...mail.warnings);
      if (mail.ok && !input.dryRun && shouldUseCursors) {
        await deps.writeCursor({
          cursorLabel,
          cursorValue: mailRead.nextCursor,
          metadata: { pages_read: mailRead.pagesRead, result_size_estimate: mailRead.resultSizeEstimate },
          resourceType: "mail"
        });
      }
    } catch (error) {
      errors.push(normalizeGoogleSyncError(error));
    }
  }

  if (input.includeCalendar !== false) {
    try {
      calendarRead = await readCalendarWithExpiredCursorRetry(deps, {
        accessToken: input.accessToken,
        calendarTimeMin: input.calendarTimeMin,
        calendarQuery: input.calendarQuery,
        cursorLabel,
        maxCalendarEvents: input.maxCalendarEvents,
        maxPages: input.maxPages,
        syncToken: calendarCursor
      });
      const calendarItems = calendarRead.events
        .map((event) => mapCalendarEventToExternalInteraction({ contactsByEmail, event, userEmail: input.userEmail }))
        .filter((item): item is ExternalInteractionInput => Boolean(item));
      calendar = await deps.syncCalendar({
        connectedAccountId: input.connectedAccountId,
        cursorAfter: calendarRead.nextSyncToken,
        cursorBefore: calendarCursor,
        dryRun: input.dryRun,
        items: calendarItems,
        mode: calendarCursor ? "incremental" : "historical",
        provider: GOOGLE_PROVIDER,
        scope: { limit: input.maxCalendarEvents ?? null, reason: "google_calendar_sync" },
        source: "google_calendar_sync_flow"
      });
      warnings.push(...calendarRead.warnings, ...calendar.warnings);
      if (calendar.ok && calendarRead.nextSyncToken && !input.dryRun && shouldUseCursors) {
        await deps.writeCursor({
          cursorLabel,
          cursorValue: calendarRead.nextSyncToken,
          metadata: { pages_read: calendarRead.pagesRead },
          resourceType: "calendar"
        });
      }
    } catch (error) {
      errors.push(normalizeGoogleSyncError(error));
    }
  }

  return {
    calendar,
    errors,
    googleRead: {
      calendarEvents: calendarRead?.events.length ?? 0,
      calendarPages: calendarRead?.pagesRead ?? 0,
      mailMessages: mailRead?.messages.length ?? 0,
      mailPages: mailRead?.pagesRead ?? 0
    },
    mail,
    ok: errors.length === 0 && (mail?.ok ?? true) && (calendar?.ok ?? true),
    warnings
  };
}

async function readCalendarWithExpiredCursorRetry(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    calendarTimeMin?: string | null;
    calendarQuery?: string | null;
    cursorLabel: string;
    maxCalendarEvents?: number;
    maxPages?: number;
    syncToken: string | null;
  }
) {
  try {
    return await deps.readCalendar({
      accessToken: input.accessToken,
      maxEvents: input.maxCalendarEvents,
      maxPages: input.maxPages,
      query: input.calendarQuery,
      syncToken: input.syncToken,
      timeMin: input.calendarTimeMin
    });
  } catch (error) {
    if (!(error instanceof GoogleInteractionClientError) || error.code !== "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN") throw error;
    await deps.markCursorExpired({ cursorLabel: input.cursorLabel, resourceType: "calendar" });
    return deps.readCalendar({
      accessToken: input.accessToken,
      maxEvents: input.maxCalendarEvents,
      maxPages: input.maxPages,
      query: input.calendarQuery,
      syncToken: null,
      timeMin: input.calendarTimeMin
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
