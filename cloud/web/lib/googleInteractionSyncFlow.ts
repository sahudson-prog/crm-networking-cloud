import {
  GOOGLE_GMAIL_DEFAULT_MAX_MESSAGES,
  GOOGLE_GMAIL_DEFAULT_MAX_PAGES,
  GoogleInteractionClientError,
  createGoogleGmailRequestGovernor,
  readGoogleCalendarEvents,
  readGoogleGmailMessages,
  readGoogleGmailProfileHistoryId,
  type GoogleCalendarReadResult,
  type GoogleGmailReadResult,
  type GoogleGmailRequestGovernor
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
import { readSyncCursor, markSyncCursorExpired, upsertSyncCursor, type SyncCursorRecord } from "./syncCursorStore.ts";
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
const GMAIL_SCOPED_EMAILS_PER_BATCH = 20;
const GMAIL_FOCUSED_RECOVERY_DAYS = 14;
const GMAIL_CONTACT_BACKFILL_DAYS = 14;

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
  calendarRollingWindowSync?: "global" | "contact";
  calendarRollingSnapshot?: GoogleCalendarRollingSnapshot | null;
  calendarTimeMin?: string | null;
  gmailSince?: string | null;
  gmailQuery?: string | null;
  globalFocusedMailSync?: boolean;
  gmailFocusedSnapshot?: GoogleGmailFocusedSyncSnapshot | null;
  contactRecentMailSync?: boolean;
  contactRecentNow?: string;
  gmailContactSnapshot?: GoogleGmailContactBackfillSnapshot | null;
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
  calendarRollingSnapshot: GoogleCalendarRollingSnapshot | null;
  gmailFocusedSnapshot: GoogleGmailFocusedSyncSnapshot | null;
  gmailContactSnapshot: GoogleGmailContactBackfillSnapshot | null;
};

export type GoogleCalendarRollingSnapshot = {
  complete: boolean;
  connectedAccountId: string | null;
  eventsRead: number;
  items: ExternalInteractionInput[];
  pagesRead: number;
  preview: SyncPreviewChange[];
  scope: "global" | "contact";
  timeMax: string;
  timeMin: string;
  warnings: string[];
};

export type GoogleGmailContactBackfillSnapshot = {
  complete: boolean;
  connectedAccountId: string | null;
  contactId: string;
  items: ExternalInteractionInput[];
  messagesRead: number;
  pagesRead: number;
  preview: SyncPreviewChange[];
  resultSizeEstimate: number | null;
  since: string;
  truncatedBy: Array<"max_messages" | "max_pages">;
  until: string;
  warnings: string[];
};

export type ReviewGoogleGmailContactBackfillInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  contactId: string;
  maxMailMessages?: number;
  maxPages?: number;
  now?: string;
  userEmail: string;
};

export type ApplyGoogleGmailContactBackfillInput = {
  connectedAccountId?: string | null;
  contactId: string;
  externalIds: string[];
  snapshot: GoogleGmailContactBackfillSnapshot;
};

export type GoogleGmailFocusedSyncSnapshot = {
  candidateHistoryId: string;
  complete: boolean;
  connectedAccountId: string | null;
  cursorBefore: string | null;
  items: ExternalInteractionInput[];
  messagesRead: number;
  mode: "incremental" | "recovery";
  pagesRead: number;
  preview: SyncPreviewChange[];
  recoverySince: string | null;
  resultSizeEstimate: number | null;
  truncatedBy: Array<"max_messages" | "max_pages">;
  warnings: string[];
};

export type ReviewGoogleGmailFocusedSyncInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  maxMailMessages?: number;
  maxPages?: number;
  now?: string;
  userEmail: string;
};

export type ApplyGoogleGmailFocusedSyncInput = {
  connectedAccountId?: string | null;
  externalIds: string[];
  snapshot: GoogleGmailFocusedSyncSnapshot;
};

export type GoogleGmailHistoricalBootstrapSnapshot = {
  baselineHistoryId: string;
  complete: boolean;
  items: ExternalInteractionInput[];
  label: {
    id: string;
    name: string;
  };
  pagesRead: number;
  preview: SyncPreviewChange[];
  resultSizeEstimate: number | null;
  truncatedBy: Array<"max_messages" | "max_pages">;
  warnings: string[];
};

export type ReviewGoogleGmailHistoricalBootstrapInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  label: {
    id: string;
    name: string;
  };
  maxMailMessages?: number;
  maxPages?: number;
  since?: string | null;
  userEmail: string;
};

export type ApplyGoogleGmailHistoricalBootstrapInput = {
  connectedAccountId?: string | null;
  externalIds: string[];
  snapshot: GoogleGmailHistoricalBootstrapSnapshot;
};

type GoogleGmailReadDependencyResult = Omit<GoogleGmailReadResult, "complete" | "truncatedBy"> & {
  complete?: boolean;
  truncatedBy?: GoogleGmailReadResult["truncatedBy"];
};

type SyncGoogleInteractionsDependencies = {
  createMailRequestGovernor: () => GoogleGmailRequestGovernor;
  readAppContacts: () => Promise<ContactRow[]>;
  readCursor: (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => Promise<string | null>;
  readCursorRecord: (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => Promise<SyncCursorRecord | null>;
  markCursorExpired: (input: { cursorLabel?: string; resourceType: "mail" | "calendar" }) => Promise<void>;
  writeCursor: (input: { connectedAccountId?: string | null; cursorLabel?: string; resourceType: "mail" | "calendar"; cursorValue: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  readMail: (input: {
    accessToken: string;
    excludeMessageIds?: readonly string[];
    historyId?: string | null;
    labelIds?: readonly string[];
    maxMessages?: number;
    maxPages?: number;
    query?: string | null;
    requestGovernor?: GoogleGmailRequestGovernor;
    since?: string | null;
  }) => Promise<GoogleGmailReadDependencyResult>;
  readMailProfileHistoryId: (input: {
    accessToken: string;
    requestGovernor?: GoogleGmailRequestGovernor;
  }) => Promise<string>;
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
    input.includeMail === false || !shouldUseCursors || input.globalFocusedMailSync || input.contactRecentMailSync
      ? Promise.resolve(null)
      : deps.readCursor({ cursorLabel, resourceType: "mail" }),
    input.includeCalendar === false || !shouldUseCursors || input.calendarRollingWindowSync
      ? Promise.resolve(null)
      : deps.readCursor({ cursorLabel, resourceType: "calendar" })
  ]);
  const scopedContacts = filterContactsForSync(contacts, input);
  const contactsByEmail = contactIndexByEmail(scopedContacts);
  const hasExplicitGmailQuery = input.gmailQuery !== undefined && input.gmailQuery !== null;
  const explicitGmailQuery = input.gmailQuery?.trim() ?? "";
  const scopedEmailQueries = hasExplicitGmailQuery
    ? (explicitGmailQuery ? [explicitGmailQuery] : [])
    : gmailQueriesForScopedContacts(scopedContacts);
  const scopedCalendarQueries = calendarQueriesForScopedContacts(input, scopedContacts);
  const warnings: string[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  let mail: SyncRunResult | null = null;
  let calendar: SyncRunResult | null = null;
  let mailRead: GoogleGmailReadDependencyResult | null = null;
  let calendarRead: ScopedCalendarReadResult | null = null;
  let calendarRollingSnapshot: GoogleCalendarRollingSnapshot | null = null;
  let gmailFocusedSnapshot: GoogleGmailFocusedSyncSnapshot | null = null;
  let gmailContactSnapshot: GoogleGmailContactBackfillSnapshot | null = null;

  if (input.includeMail !== false) {
    try {
      if (input.globalFocusedMailSync) {
        const focusedResult = input.dryRun
          ? await reviewGoogleGmailFocusedSync({
              accessToken: input.accessToken,
              connectedAccountId: input.connectedAccountId,
              maxMailMessages: input.maxMailMessages,
              maxPages: input.maxPages,
              userEmail: input.userEmail
            }, deps, contacts)
          : await applyGoogleGmailFocusedSync({
              connectedAccountId: input.connectedAccountId,
              externalIds: globalMailExternalIds(input.externalIds ?? []),
              snapshot: requireFocusedSnapshot(input.gmailFocusedSnapshot)
            }, deps).then((result) => ({ result, snapshot: input.gmailFocusedSnapshot! }));
        mail = focusedResult.result.mail;
        gmailFocusedSnapshot = focusedResult.snapshot;
        warnings.push(...focusedResult.result.warnings);
        errors.push(...focusedResult.result.errors);
      } else if (input.contactRecentMailSync) {
        const contactId = requireSingleContactId(input.contactIds);
        const contactResult = input.dryRun
          ? await reviewGoogleGmailContactBackfill({
              accessToken: input.accessToken,
              connectedAccountId: input.connectedAccountId,
              contactId,
              maxMailMessages: input.maxMailMessages,
              maxPages: input.maxPages,
              now: input.contactRecentNow,
              userEmail: input.userEmail
            }, deps, contacts)
          : await applyGoogleGmailContactBackfill({
              connectedAccountId: input.connectedAccountId,
              contactId,
              externalIds: contactMailExternalIds(input.externalIds ?? []),
              snapshot: requireContactSnapshot(input.gmailContactSnapshot)
            }, deps).then((result) => ({ result, snapshot: input.gmailContactSnapshot! }));
        mail = contactResult.result.mail;
        gmailContactSnapshot = contactResult.snapshot;
        warnings.push(...contactResult.result.warnings);
        errors.push(...contactResult.result.errors);
      } else {
        const skipMail = shouldSkipFocusedMail(input, scopedContacts, scopedEmailQueries);
        if (skipMail) {
          warnings.push(skipMail);
        } else {
          mailRead = await readMailWithExpiredCursorRetry(deps, {
            accessToken: input.accessToken,
            cursorLabel,
            historyId: mailCursor,
            maxMessages: input.maxMailMessages,
            maxPages: input.maxPages,
            queries: scopedEmailQueries,
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
      }
    } catch (error) {
      errors.push(normalizeGoogleSyncError(error));
    }
  }

  if (input.includeCalendar !== false) {
    try {
      const skipCalendar = shouldSkipFocusedCalendar(input, scopedContacts);
      if (skipCalendar) {
        warnings.push(skipCalendar);
        if (input.calendarRollingWindowSync === "global" && !input.dryRun && shouldUseCursors) {
          await writeRollingCalendarFreshness(deps, input, 0);
        }
      } else {
        const reviewedRollingSnapshot = input.calendarRollingWindowSync && !input.dryRun && input.calendarRollingSnapshot
          ? requireCalendarRollingSnapshot(input.calendarRollingSnapshot, input)
          : null;
        const calendarReadInput = {
          accessToken: input.accessToken,
          calendarQueries: scopedCalendarQueries,
          calendarFutureTimeMax: input.calendarFutureTimeMax,
          calendarFutureTimeMin: input.calendarFutureTimeMin,
          calendarTimeMin: input.calendarTimeMin,
          calendarQuery: input.calendarQuery,
          cursorLabel,
          maxCalendarEvents: input.maxCalendarEvents,
          maxPages: input.maxPages,
          rollingWindow: Boolean(input.calendarRollingWindowSync),
          syncToken: input.calendarRollingWindowSync ? null : calendarCursor
        };
        calendarRead = reviewedRollingSnapshot
          ? calendarReadFromRollingSnapshot(reviewedRollingSnapshot)
          : input.calendarRollingWindowSync
            ? await readCalendarForScope(deps, calendarReadInput)
            : await readCalendarWithExpiredCursorRetry(deps, calendarReadInput);
        warnings.push(...calendarRead.warnings);
        if (input.calendarRollingWindowSync && calendarRead.complete === false) {
          errors.push({
            code: "GOOGLE_CALENDAR_READ_INCOMPLETE",
            message: "Calendar no pudo completar la ventana de actualización. Intenta nuevamente."
          });
        } else {
          const mappedCalendarItems = reviewedRollingSnapshot
            ? reviewedRollingSnapshot.items
            : calendarRead.events
                .map((event) => mapCalendarEventToExternalInteraction({
                  contactsByEmail,
                  event,
                  matchedContactEmails: calendarRead?.matchedContactEmailsByEventKey?.[calendarEventKey(event)] ?? [],
                  userEmail: input.userEmail
                }))
                .filter((item): item is ExternalInteractionInput => Boolean(item));
          const calendarItems = reviewedRollingSnapshot
            ? reviewedRollingSnapshot.items
            : filterExternalInteractionsFromDate(mappedCalendarItems, input.calendarTimeMin);
          if (input.saveReadDiagnostics && !reviewedRollingSnapshot) {
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
          const calendarPreview = reviewedRollingSnapshot?.preview ?? await buildInteractionSyncPreview(deps, {
              items: calendarItems,
              provider: GOOGLE_PROVIDER,
              sourceService: "calendar"
            });
          if (input.calendarRollingWindowSync && input.dryRun) {
            calendarRollingSnapshot = createCalendarRollingSnapshot(input, calendarItems, calendarPreview, calendarRead);
          } else if (reviewedRollingSnapshot) {
            calendarRollingSnapshot = reviewedRollingSnapshot;
          }
          calendar = await deps.syncCalendar({
            connectedAccountId: input.connectedAccountId,
            cursorAfter: input.calendarRollingWindowSync ? null : calendarRead.nextSyncToken,
            cursorBefore: input.calendarRollingWindowSync ? null : calendarCursor,
            dryRun: input.dryRun,
            items: calendarItems,
            mode: input.calendarRollingWindowSync === "contact"
              ? "single_contact"
              : (input.calendarRollingWindowSync || calendarCursor ? "incremental" : "historical"),
            provider: GOOGLE_PROVIDER,
            scope: { externalIds: input.externalIds, limit: input.maxCalendarEvents ?? null, reason: "google_calendar_sync" },
            source: "google_calendar_sync_flow"
          });
          calendar.preview = calendarPreview;
          warnings.push(...calendar.warnings);
          if (calendar.ok && !input.dryRun && shouldUseCursors) {
            if (input.calendarRollingWindowSync === "global") {
              await writeRollingCalendarFreshness(deps, input, calendarRead.pagesRead);
            } else if (!input.calendarRollingWindowSync && (calendarRead.nextSyncToken || input.globalFocusedMailSync)) {
              await deps.writeCursor({
                connectedAccountId: input.connectedAccountId,
                cursorLabel,
                cursorValue: calendarRead.nextSyncToken ?? calendarCursor,
                metadata: {
                  mode: calendarRead.mode,
                  pages_read: calendarRead.pagesRead,
                  token_available: Boolean(calendarRead.nextSyncToken ?? calendarCursor)
                },
                resourceType: "calendar"
              });
            }
          }
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
    calendarRollingSnapshot,
    errors: effectiveErrors,
    gmailContactSnapshot,
    gmailFocusedSnapshot,
    googleRead: {
      calendarEvents: calendarRollingSnapshot?.eventsRead ?? calendarRead?.events.length ?? 0,
      calendarPages: calendarRollingSnapshot?.pagesRead ?? calendarRead?.pagesRead ?? 0,
      mailMessages: gmailContactSnapshot?.messagesRead ?? gmailFocusedSnapshot?.messagesRead ?? mailRead?.messages.length ?? 0,
      mailPages: gmailContactSnapshot?.pagesRead ?? gmailFocusedSnapshot?.pagesRead ?? mailRead?.pagesRead ?? 0
    },
    mail,
    ok: effectiveErrors.length === 0 && (mail?.ok ?? true) && (calendar?.ok ?? true),
    warnings: effectiveWarnings
  };
}

export async function reviewGoogleGmailHistoricalBootstrap(
  input: ReviewGoogleGmailHistoricalBootstrapInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {}
): Promise<{ result: SyncGoogleInteractionsResult; snapshot: GoogleGmailHistoricalBootstrapSnapshot }> {
  const deps = defaultDependencies(dependencies);
  const labelId = requireHistoricalBootstrapLabelId(input.label.id);
  const labelName = input.label.name.trim() || "Etiqueta Gmail";
  const requestGovernor = deps.createMailRequestGovernor();
  const baselineHistoryId = await deps.readMailProfileHistoryId({
    accessToken: input.accessToken,
    requestGovernor
  });
  const contacts = await deps.readAppContacts();
  const contactsByEmail = contactIndexByEmail(contacts.filter((contact) => contact.is_active));
  const mailRead = await deps.readMail({
    accessToken: input.accessToken,
    historyId: null,
    labelIds: [labelId],
    maxMessages: input.maxMailMessages,
    maxPages: input.maxPages,
    query: null,
    requestGovernor,
    since: input.since
  });
  const items = filterExternalInteractionsFromDate(
    mailRead.messages
      .map((message) => mapGmailMessageToExternalInteraction({
        contactsByEmail,
        includeUnresolvedParticipants: true,
        message,
        userEmail: input.userEmail
      }))
      .filter((item): item is ExternalInteractionInput => Boolean(item)),
    input.since
  );
  const preview = await buildInteractionSyncPreview(deps, {
    items,
    provider: GOOGLE_PROVIDER,
    sourceService: "gmail"
  });
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: baselineHistoryId,
    cursorBefore: null,
    dryRun: true,
    items,
    mode: "historical",
    provider: GOOGLE_PROVIDER,
    scope: { limit: input.maxMailMessages ?? null, reason: "google_gmail_historical_bootstrap" },
    source: "google_gmail_historical_bootstrap"
  });
  mail.preview = preview;
  const snapshotWarnings = [...mailRead.warnings];
  if (!mailRead.complete) {
    snapshotWarnings.push("La lectura alcanzo un limite y no recorrio completamente la etiqueta seleccionada.");
  }
  const snapshot: GoogleGmailHistoricalBootstrapSnapshot = {
    baselineHistoryId,
    complete: mailRead.complete === true,
    items,
    label: { id: labelId, name: labelName },
    pagesRead: mailRead.pagesRead,
    preview,
    resultSizeEstimate: mailRead.resultSizeEstimate,
    truncatedBy: [...(mailRead.truncatedBy ?? [])],
    warnings: snapshotWarnings
  };
  return {
    result: googleMailOnlyResult(mail, mailRead, [...snapshotWarnings, ...mail.warnings]),
    snapshot
  };
}

export async function applyGoogleGmailHistoricalBootstrap(
  input: ApplyGoogleGmailHistoricalBootstrapInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {}
): Promise<SyncGoogleInteractionsResult> {
  const deps = defaultDependencies(dependencies);
  const selectedIds = Array.from(new Set(input.externalIds.map((id) => id.trim()).filter(Boolean)));
  const itemsByExternalId = new Map(input.snapshot.items.map((item) => [item.externalId.toLowerCase(), item]));
  const missingIds = selectedIds.filter((id) => !itemsByExternalId.has(id.toLowerCase()));
  if (missingIds.length) {
    throw new Error("La seleccion contiene correos que no pertenecen al snapshot revisado.");
  }
  const selectedItems = selectedIds.map((id) => itemsByExternalId.get(id.toLowerCase())!);
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: input.snapshot.baselineHistoryId,
    cursorBefore: null,
    dryRun: false,
    items: selectedItems,
    mode: "historical",
    provider: GOOGLE_PROVIDER,
    scope: { externalIds: selectedIds, limit: selectedItems.length, reason: "google_gmail_historical_bootstrap" },
    source: "google_gmail_historical_bootstrap"
  });
  const applyComplete = mail.ok
    && mail.counts.failed === 0
    && mail.counts.scanned === selectedItems.length;
  if (input.snapshot.complete && applyComplete) {
    await deps.writeCursor({
      connectedAccountId: input.connectedAccountId,
      cursorLabel: "",
      cursorValue: input.snapshot.baselineHistoryId,
      metadata: {
        bootstrap_label_id: input.snapshot.label.id,
        mode: "historical_bootstrap",
        pages_read: input.snapshot.pagesRead,
        selected_items: selectedItems.length
      },
      resourceType: "mail"
    });
  }
  const warnings = [...input.snapshot.warnings, ...mail.warnings];
  if (!input.snapshot.complete) warnings.push("El cursor global no se actualizo porque la lectura historica fue incompleta.");
  if (!applyComplete) warnings.push("El cursor global no se actualizo porque no se aplicaron todos los correos seleccionados.");
  return googleMailOnlyResult(mail, {
    complete: input.snapshot.complete,
    messages: [],
    mode: "full",
    nextCursor: input.snapshot.baselineHistoryId,
    pagesRead: input.snapshot.pagesRead,
    resultSizeEstimate: input.snapshot.resultSizeEstimate,
    truncatedBy: input.snapshot.truncatedBy,
    warnings: input.snapshot.warnings
  }, warnings);
}

export async function reviewGoogleGmailFocusedSync(
  input: ReviewGoogleGmailFocusedSyncInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {},
  appContacts?: ContactRow[]
): Promise<{ result: SyncGoogleInteractionsResult; snapshot: GoogleGmailFocusedSyncSnapshot }> {
  const deps = defaultDependencies(dependencies);
  const [cursorRecord, contacts] = await Promise.all([
    deps.readCursorRecord({ cursorLabel: "", resourceType: "mail" }),
    appContacts ? Promise.resolve(appContacts) : deps.readAppContacts()
  ]);
  const focusedContacts = contacts.filter((contact) => contact.is_active && contact.networking_focus);
  const contactsByEmail = contactIndexByEmail(focusedContacts);
  const requestGovernor = deps.createMailRequestGovernor();
  const cursorBefore = validGlobalMailCursor(cursorRecord, input.connectedAccountId);
  let mode: GoogleGmailFocusedSyncSnapshot["mode"] = cursorBefore ? "incremental" : "recovery";
  let recoverySince: string | null = null;
  let candidateHistoryId = "";
  let mailRead: GoogleGmailReadDependencyResult;

  if (!uniqueContactEmails(focusedContacts).length) {
    mode = "recovery";
    candidateHistoryId = await deps.readMailProfileHistoryId({ accessToken: input.accessToken, requestGovernor });
    recoverySince = focusedRecoverySince(input.now);
    mailRead = emptyFocusedRecoveryRead(candidateHistoryId);
  } else if (cursorBefore) {
    try {
      mailRead = await deps.readMail({
        accessToken: input.accessToken,
        historyId: cursorBefore,
        maxMessages: input.maxMailMessages,
        maxPages: input.maxPages,
        query: null,
        requestGovernor,
        since: null
      });
      candidateHistoryId = numericCursor(mailRead.nextCursor) ?? "";
    } catch (error) {
      if (!(error instanceof GoogleInteractionClientError) || error.code !== "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN") throw error;
      await deps.markCursorExpired({ cursorLabel: "", resourceType: "mail" });
      mode = "recovery";
      ({ candidateHistoryId, mailRead, recoverySince } = await readFocusedMailRecovery(deps, input, focusedContacts, requestGovernor));
    }
  } else {
    ({ candidateHistoryId, mailRead, recoverySince } = await readFocusedMailRecovery(deps, input, focusedContacts, requestGovernor));
  }

  const items = filterExternalInteractionsFromDate(
    mailRead.messages
      .map((message) => mapGmailMessageToExternalInteraction({ contactsByEmail, message, userEmail: input.userEmail }))
      .filter((item): item is ExternalInteractionInput => Boolean(item)),
    recoverySince
  );
  const preview = await buildInteractionSyncPreview(deps, {
    items,
    provider: GOOGLE_PROVIDER,
    sourceService: "gmail"
  });
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: candidateHistoryId,
    cursorBefore,
    dryRun: true,
    items,
    mode: mode === "incremental" ? "incremental" : "historical",
    provider: GOOGLE_PROVIDER,
    scope: { limit: input.maxMailMessages ?? null, reason: mode === "incremental" ? "google_gmail_global_incremental" : "google_gmail_global_recovery" },
    source: mode === "incremental" ? "google_gmail_global_incremental" : "google_gmail_global_recovery"
  });
  mail.preview = preview;
  const warnings = [...mailRead.warnings, ...mail.warnings];
  const complete = mailRead.complete === true && mail.ok && Boolean(candidateHistoryId);
  if (!mailRead.complete) warnings.push("El cursor global no avanzara porque la lectura Gmail quedo incompleta.");
  if (!candidateHistoryId) warnings.push("El cursor global no avanzara porque Gmail no entrego un historyId candidato valido.");
  if (!mail.ok) warnings.push("El cursor global no avanzara porque el preview Gmail no pudo completarse.");
  const snapshot: GoogleGmailFocusedSyncSnapshot = {
    candidateHistoryId,
    complete,
    connectedAccountId: cleanNullable(input.connectedAccountId),
    cursorBefore,
    items,
    messagesRead: mailRead.messages.length,
    mode,
    pagesRead: mailRead.pagesRead,
    preview,
    recoverySince,
    resultSizeEstimate: mailRead.resultSizeEstimate,
    truncatedBy: [...(mailRead.truncatedBy ?? [])],
    warnings
  };
  return {
    result: googleMailOnlyResult(mail, mailRead, warnings, snapshot),
    snapshot
  };
}

export async function applyGoogleGmailFocusedSync(
  input: ApplyGoogleGmailFocusedSyncInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {}
): Promise<SyncGoogleInteractionsResult> {
  const deps = defaultDependencies(dependencies);
  if (cleanNullable(input.connectedAccountId) !== input.snapshot.connectedAccountId) {
    throw new Error("La cuenta Google activa cambio desde la revision. Vuelve a revisar Gmail.");
  }
  const selectedIds = Array.from(new Set(input.externalIds.map((id) => id.trim()).filter(Boolean)));
  const itemsByExternalId = new Map(input.snapshot.items.map((item) => [item.externalId.toLowerCase(), item]));
  const missingIds = selectedIds.filter((id) => !itemsByExternalId.has(id.toLowerCase()));
  if (missingIds.length) {
    throw new Error("La seleccion contiene correos que no pertenecen al snapshot revisado.");
  }
  const selectedItems = selectedIds.map((id) => itemsByExternalId.get(id.toLowerCase())!);
  const requiredIds = actionablePreviewExternalIds(input.snapshot.preview);
  const selectedIdSet = new Set(selectedIds.map((id) => id.toLowerCase()));
  const allEligibleSelected = requiredIds.every((id) => selectedIdSet.has(id.toLowerCase()));
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: input.snapshot.candidateHistoryId,
    cursorBefore: input.snapshot.cursorBefore,
    dryRun: false,
    items: selectedItems,
    mode: input.snapshot.mode === "incremental" ? "incremental" : "historical",
    provider: GOOGLE_PROVIDER,
    scope: {
      externalIds: selectedIds,
      limit: selectedItems.length,
      reason: input.snapshot.mode === "incremental" ? "google_gmail_global_incremental" : "google_gmail_global_recovery"
    },
    source: input.snapshot.mode === "incremental" ? "google_gmail_global_incremental" : "google_gmail_global_recovery"
  });
  const applyComplete = input.snapshot.complete
    && allEligibleSelected
    && mail.ok
    && mail.counts.failed === 0
    && mail.counts.scanned === selectedItems.length;
  if (applyComplete) {
    await deps.writeCursor({
      connectedAccountId: input.connectedAccountId,
      cursorLabel: "",
      cursorValue: input.snapshot.candidateHistoryId,
      metadata: {
        mode: input.snapshot.mode,
        pages_read: input.snapshot.pagesRead,
        recovery_since: input.snapshot.recoverySince,
        selected_items: selectedItems.length
      },
      resourceType: "mail"
    });
  }
  const warnings = [...input.snapshot.warnings, ...mail.warnings];
  if (!input.snapshot.complete) warnings.push("El cursor global no se actualizo porque la lectura Gmail fue incompleta.");
  if (!allEligibleSelected) warnings.push("El cursor global no se actualizo porque quedaron correos Foco elegibles sin aplicar.");
  if (!mail.ok || mail.counts.failed > 0 || mail.counts.scanned !== selectedItems.length) {
    warnings.push("El cursor global no se actualizo porque no se aplicaron todos los correos Foco seleccionados.");
  }
  return googleMailOnlyResult(mail, {
    complete: input.snapshot.complete,
    messages: [],
    mode: input.snapshot.mode === "incremental" ? "incremental" : "full",
    nextCursor: input.snapshot.candidateHistoryId,
    pagesRead: input.snapshot.pagesRead,
    resultSizeEstimate: input.snapshot.resultSizeEstimate,
    truncatedBy: input.snapshot.truncatedBy,
    warnings: input.snapshot.warnings
  }, warnings, input.snapshot);
}

export async function reviewGoogleGmailContactBackfill(
  input: ReviewGoogleGmailContactBackfillInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {},
  appContacts?: ContactRow[]
): Promise<{ result: SyncGoogleInteractionsResult; snapshot: GoogleGmailContactBackfillSnapshot }> {
  const deps = defaultDependencies(dependencies);
  const contacts = appContacts ?? await deps.readAppContacts();
  const contact = contacts.find((item) => item.id === input.contactId && item.is_active);
  const window = contactBackfillWindow(input.now);
  const warnings: string[] = [];
  const requestGovernor = deps.createMailRequestGovernor();
  let mailRead = emptyContactBackfillRead();

  if (!contact) {
    warnings.push("Gmail no se reviso porque el contacto ya no esta activo.");
  } else if (!contact.networking_focus) {
    warnings.push("Gmail no se reviso porque el contacto no esta marcado como Foco.");
  } else {
    const queries = gmailQueriesForScopedContacts([contact]);
    if (!queries.length) {
      warnings.push("Gmail no se reviso porque el contacto no tiene correos utilizables.");
    } else {
      mailRead = await readMailForQueries(deps, {
        accessToken: input.accessToken,
        maxMessages: input.maxMailMessages,
        maxPages: input.maxPages,
        queries,
        requestGovernor,
        since: window.since
      });
    }
  }

  const contactsByEmail = contact ? contactIndexByEmail([contact]) : {};
  const items = filterExternalInteractionsToDate(
    filterExternalInteractionsFromDate(
      mailRead.messages
        .map((message) => mapGmailMessageToExternalInteraction({ contactsByEmail, message, userEmail: input.userEmail }))
        .filter((item): item is ExternalInteractionInput => Boolean(item)),
      window.since
    ),
    window.until
  );
  const preview = await buildInteractionSyncPreview(deps, {
    items,
    provider: GOOGLE_PROVIDER,
    sourceService: "gmail"
  });
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: null,
    cursorBefore: null,
    dryRun: true,
    items,
    mode: "single_contact",
    provider: GOOGLE_PROVIDER,
    scope: {
      contactIds: [input.contactId],
      limit: input.maxMailMessages ?? null,
      reason: "google_gmail_contact_backfill",
      since: window.since,
      until: window.until
    },
    source: "google_gmail_contact_backfill"
  });
  mail.preview = preview;
  warnings.push(...mailRead.warnings, ...mail.warnings);
  const complete = mailRead.complete !== false && mail.ok;
  if (mailRead.complete === false) {
    warnings.push("La lectura Gmail de los ultimos 14 dias quedo incompleta.");
  }
  const snapshot: GoogleGmailContactBackfillSnapshot = {
    complete,
    connectedAccountId: cleanNullable(input.connectedAccountId),
    contactId: input.contactId,
    items,
    messagesRead: mailRead.messages.length,
    pagesRead: mailRead.pagesRead,
    preview,
    resultSizeEstimate: mailRead.resultSizeEstimate,
    since: window.since,
    truncatedBy: [...(mailRead.truncatedBy ?? [])],
    until: window.until,
    warnings
  };
  return {
    result: googleMailOnlyResult(mail, mailRead, warnings, null, snapshot),
    snapshot
  };
}

export async function applyGoogleGmailContactBackfill(
  input: ApplyGoogleGmailContactBackfillInput,
  dependencies: Partial<SyncGoogleInteractionsDependencies> = {}
): Promise<SyncGoogleInteractionsResult> {
  const deps = defaultDependencies(dependencies);
  if (!input.snapshot.complete) {
    throw new Error("La lectura Gmail de los ultimos 14 dias quedo incompleta. Vuelve a actualizar la ficha.");
  }
  if (cleanNullable(input.connectedAccountId) !== input.snapshot.connectedAccountId) {
    throw new Error("La cuenta Google activa cambio desde la revision. Vuelve a actualizar la ficha.");
  }
  if (input.contactId !== input.snapshot.contactId) {
    throw new Error("El contacto cambio desde la revision. Vuelve a actualizar la ficha.");
  }
  const selectedIds = Array.from(new Set(input.externalIds.map((id) => id.trim()).filter(Boolean)));
  const itemsByExternalId = new Map(input.snapshot.items.map((item) => [item.externalId.toLowerCase(), item]));
  const missingIds = selectedIds.filter((id) => !itemsByExternalId.has(id.toLowerCase()));
  if (missingIds.length) {
    throw new Error("La actualizacion contiene correos que no pertenecen al snapshot de la ficha.");
  }
  const selectedItems = selectedIds.map((id) => itemsByExternalId.get(id.toLowerCase())!);
  const requiredIds = actionablePreviewExternalIds(input.snapshot.preview);
  const selectedIdSet = new Set(selectedIds.map((id) => id.toLowerCase()));
  const allEligibleSelected = requiredIds.every((id) => selectedIdSet.has(id.toLowerCase()));
  const mail = await deps.syncMail({
    connectedAccountId: input.connectedAccountId,
    cursorAfter: null,
    cursorBefore: null,
    dryRun: false,
    items: selectedItems,
    mode: "single_contact",
    provider: GOOGLE_PROVIDER,
    scope: {
      contactIds: [input.contactId],
      externalIds: selectedIds,
      limit: selectedItems.length,
      reason: "google_gmail_contact_backfill",
      since: input.snapshot.since,
      until: input.snapshot.until
    },
    source: "google_gmail_contact_backfill"
  });
  const warnings = [...input.snapshot.warnings, ...mail.warnings];
  if (!input.snapshot.complete) warnings.push("La lectura Gmail de los ultimos 14 dias estaba incompleta.");
  if (!allEligibleSelected) warnings.push("Quedaron correos elegibles sin aplicar en la ficha.");
  return googleMailOnlyResult(mail, {
    complete: input.snapshot.complete,
    messages: [],
    mode: "full",
    nextCursor: "",
    pagesRead: input.snapshot.pagesRead,
    resultSizeEstimate: input.snapshot.resultSizeEstimate,
    truncatedBy: input.snapshot.truncatedBy,
    warnings: input.snapshot.warnings
  }, warnings, null, input.snapshot);
}

async function readFocusedMailRecovery(
  deps: SyncGoogleInteractionsDependencies,
  input: ReviewGoogleGmailFocusedSyncInput,
  focusedContacts: ContactRow[],
  requestGovernor: GoogleGmailRequestGovernor
) {
  const candidateHistoryId = await deps.readMailProfileHistoryId({ accessToken: input.accessToken, requestGovernor });
  const recoverySince = focusedRecoverySince(input.now);
  const queries = gmailQueriesForScopedContacts(focusedContacts);
  const mailRead = queries.length
    ? await readMailForQueries(deps, {
        accessToken: input.accessToken,
        maxMessages: input.maxMailMessages,
        maxPages: input.maxPages,
        queries,
        requestGovernor,
        since: recoverySince
      })
    : emptyFocusedRecoveryRead(candidateHistoryId);
  return { candidateHistoryId, mailRead, recoverySince };
}

function emptyFocusedRecoveryRead(nextCursor: string): GoogleGmailReadDependencyResult {
  return {
    complete: true,
    messages: [],
    mode: "full",
    nextCursor,
    pagesRead: 0,
    resultSizeEstimate: 0,
    truncatedBy: [],
    warnings: []
  };
}

function validGlobalMailCursor(cursor: SyncCursorRecord | null, connectedAccountId?: string | null) {
  if (!cursor || cursor.status !== "ok") return null;
  if (cleanNullable(cursor.connected_account_id) !== cleanNullable(connectedAccountId)) return null;
  return numericCursor(cursor.cursor_value);
}

function focusedRecoverySince(now?: string) {
  const reference = now ? new Date(now) : new Date();
  if (Number.isNaN(reference.getTime())) throw new Error("La fecha de referencia para recovery Gmail no es valida.");
  reference.setUTCDate(reference.getUTCDate() - GMAIL_FOCUSED_RECOVERY_DAYS);
  return reference.toISOString();
}

function actionablePreviewExternalIds(preview: SyncPreviewChange[]) {
  return preview
    .filter((change) => change.type !== "unchanged" && change.type !== "skipped")
    .map((change) => typeof change.metadata?.externalId === "string" ? change.metadata.externalId.trim() : "")
    .filter(Boolean);
}

function globalMailExternalIds(externalIds: string[]) {
  return externalIds.filter((externalId) => externalId.trim().toUpperCase().startsWith("GMAIL_"));
}

function contactMailExternalIds(externalIds: string[]) {
  return globalMailExternalIds(externalIds);
}

function cleanNullable(value: string | null | undefined) {
  return value?.trim() || null;
}

function requireFocusedSnapshot(snapshot: GoogleGmailFocusedSyncSnapshot | null | undefined) {
  if (!snapshot) throw new Error("El snapshot Gmail global ya no esta disponible. Vuelve a revisar la actividad.");
  return snapshot;
}

function requireContactSnapshot(snapshot: GoogleGmailContactBackfillSnapshot | null | undefined) {
  if (!snapshot) throw new Error("El snapshot Gmail de la ficha ya no esta disponible. Vuelve a actualizarla.");
  return snapshot;
}

function requireSingleContactId(contactIds?: string[]) {
  const ids = Array.from(new Set((contactIds ?? []).map((id) => id.trim()).filter(Boolean)));
  if (ids.length !== 1) throw new Error("La actualizacion Gmail de ficha requiere un unico contacto.");
  return ids[0];
}

function contactBackfillWindow(now?: string) {
  const until = now ? new Date(now) : new Date();
  if (Number.isNaN(until.getTime())) throw new Error("La fecha de referencia para la ficha Gmail no es valida.");
  const since = new Date(until.getTime() - GMAIL_CONTACT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

function emptyContactBackfillRead(): GoogleGmailReadDependencyResult {
  return {
    complete: true,
    messages: [],
    mode: "full",
    nextCursor: "",
    pagesRead: 0,
    resultSizeEstimate: 0,
    truncatedBy: [],
    warnings: []
  };
}

export function requireHistoricalBootstrapLabelId(value: string | null | undefined) {
  const labelId = value?.trim() ?? "";
  if (!labelId) throw new Error("Selecciona una etiqueta Gmail antes de revisar correos.");
  return labelId;
}

function googleMailOnlyResult(
  mail: SyncRunResult,
  mailRead: GoogleGmailReadDependencyResult,
  warnings: string[],
  gmailFocusedSnapshot: GoogleGmailFocusedSyncSnapshot | null = null,
  gmailContactSnapshot: GoogleGmailContactBackfillSnapshot | null = null
): SyncGoogleInteractionsResult {
  return {
    calendar: null,
    calendarRollingSnapshot: null,
    errors: mail.errors,
    gmailContactSnapshot,
    gmailFocusedSnapshot,
    googleRead: {
      calendarEvents: 0,
      calendarPages: 0,
      mailMessages: mailRead.messages.length || mail.counts.scanned,
      mailPages: mailRead.pagesRead
    },
    mail,
    ok: mail.ok,
    warnings
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
    rollingWindow?: boolean;
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

function createCalendarRollingSnapshot(
  input: SyncGoogleInteractionsInput,
  items: ExternalInteractionInput[],
  preview: SyncPreviewChange[],
  calendarRead: ScopedCalendarReadResult
): GoogleCalendarRollingSnapshot {
  if (!input.calendarRollingWindowSync || !input.calendarTimeMin || !input.calendarFutureTimeMax) {
    throw new Error("La lectura rolling de Calendar no tiene una ventana valida.");
  }
  return {
    complete: calendarRead.complete !== false,
    connectedAccountId: input.connectedAccountId ?? null,
    eventsRead: calendarRead.events.length,
    items,
    pagesRead: calendarRead.pagesRead,
    preview,
    scope: input.calendarRollingWindowSync,
    timeMax: input.calendarFutureTimeMax,
    timeMin: input.calendarTimeMin,
    warnings: calendarRead.warnings
  };
}

function requireCalendarRollingSnapshot(
  snapshot: GoogleCalendarRollingSnapshot | null | undefined,
  input: SyncGoogleInteractionsInput
) {
  if (!snapshot || !snapshot.complete) {
    throw new Error("Falta el snapshot completo de Calendar revisado para aplicar.");
  }
  if (snapshot.scope !== input.calendarRollingWindowSync) {
    throw new Error("El snapshot de Calendar no corresponde al alcance solicitado.");
  }
  if (snapshot.connectedAccountId !== (input.connectedAccountId ?? null)) {
    throw new Error("El snapshot de Calendar no corresponde a la cuenta conectada actual.");
  }
  return snapshot;
}

function calendarReadFromRollingSnapshot(snapshot: GoogleCalendarRollingSnapshot): ScopedCalendarReadResult {
  return {
    complete: snapshot.complete,
    events: [],
    mode: "full",
    nextSyncToken: null,
    pagesRead: snapshot.pagesRead,
    truncatedBy: [],
    warnings: snapshot.warnings
  };
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
    rollingWindow?: boolean;
    syncToken: string | null;
  }
): Promise<ScopedCalendarReadResult> {
  const calendarQueries = input.calendarQueries ?? [];
  if (input.rollingWindow) {
    const result = await deps.readCalendar({
      accessToken: input.accessToken,
      maxEvents: input.maxCalendarEvents,
      maxPages: input.maxPages,
      query: null,
      syncToken: null,
      timeMin: input.calendarTimeMin,
      timeMax: input.calendarFutureTimeMax
    });
    const matchedContactEmailsByEventKey = matchedParticipantEmailsForEvents(result.events, calendarQueries);
    const relevantEvents = new Map<string, GoogleCalendarReadResult["events"][number]>();
    for (const event of result.events) {
      const key = calendarEventKey(event);
      if (matchedContactEmailsByEventKey[key]?.length) relevantEvents.set(key, event);
    }
    return {
      ...result,
      events: Array.from(relevantEvents.values()),
      matchedContactEmailsByEventKey
    };
  }
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
  const truncatedBy = new Set<"max_events" | "max_pages">();
  let complete = true;
  let pagesRead = 0;
  let readsCompleted = 0;
  const plannedReads = windows.length * calendarQueries.length;

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
      readsCompleted += 1;
      pagesRead += result.pagesRead;
      warnings.push(...result.warnings);
      complete = complete && result.complete !== false;
      for (const reason of result.truncatedBy ?? []) truncatedBy.add(reason);
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

  if (readsCompleted < plannedReads) {
    complete = false;
    truncatedBy.add("max_events");
    warnings.push("Se alcanzo el limite total de eventos antes de completar todas las consultas de Calendar.");
  }

  return {
    complete,
    events: Array.from(eventsById.values()),
    matchedContactEmailsByEventKey,
    mode: "full",
    nextSyncToken: null,
    pagesRead,
    truncatedBy: Array.from(truncatedBy),
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
    complete: primary.complete !== false && supplemental.complete !== false,
    events: Array.from(eventsByKey.values()),
    matchedContactEmailsByEventKey: {
      ...(primary.matchedContactEmailsByEventKey ?? {}),
      ...(supplemental.matchedContactEmailsByEventKey ?? {})
    },
    pagesRead: primary.pagesRead + supplemental.pagesRead,
    truncatedBy: Array.from(new Set([
      ...(primary.truncatedBy ?? []),
      ...(supplemental.truncatedBy ?? [])
    ])),
    warnings: [...primary.warnings, ...supplemental.warnings]
  };
}

function cleanIso(value?: string | null) {
  return value?.trim() || null;
}

async function writeRollingCalendarFreshness(
  deps: SyncGoogleInteractionsDependencies,
  input: SyncGoogleInteractionsInput,
  pagesRead: number
) {
  await deps.writeCursor({
    connectedAccountId: input.connectedAccountId,
    cursorLabel: "",
    cursorValue: null,
    metadata: {
      mode: "rolling_window",
      pages_read: pagesRead,
      time_max: cleanIso(input.calendarFutureTimeMax),
      time_min: cleanIso(input.calendarTimeMin),
      token_available: false
    },
    resourceType: "calendar"
  });
}

async function readMailWithExpiredCursorRetry(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    cursorLabel: string;
    historyId?: string | null;
    maxMessages?: number;
    maxPages?: number;
    queries: string[];
    since?: string | null;
  }
) {
  const historyId = numericCursor(input.historyId);
  const requestGovernor = deps.createMailRequestGovernor();
  try {
    if (historyId) {
      return await deps.readMail({
        accessToken: input.accessToken,
        historyId,
        maxMessages: input.maxMessages,
        maxPages: input.maxPages,
        query: null,
        requestGovernor,
        since: null
      });
    }
    return readMailForQueries(deps, { ...input, requestGovernor });
  } catch (error) {
    if (!(error instanceof GoogleInteractionClientError) || error.code !== "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN") throw error;
    await deps.markCursorExpired({ cursorLabel: input.cursorLabel, resourceType: "mail" });
    return readMailForQueries(deps, { ...input, requestGovernor });
  }
}

async function readMailForQueries(
  deps: SyncGoogleInteractionsDependencies,
  input: {
    accessToken: string;
    maxMessages?: number;
    maxPages?: number;
    queries: string[];
    requestGovernor: GoogleGmailRequestGovernor;
    since?: string | null;
  }
): Promise<GoogleGmailReadDependencyResult> {
  if (input.queries.length <= 1) {
    return deps.readMail({
      accessToken: input.accessToken,
      historyId: null,
      maxMessages: input.maxMessages,
      maxPages: input.maxPages,
      query: input.queries[0] ?? null,
      requestGovernor: input.requestGovernor,
      since: input.since
    });
  }

  const maxMessages = input.maxMessages ?? GOOGLE_GMAIL_DEFAULT_MAX_MESSAGES;
  const configuredPageBudget = input.maxPages ?? GOOGLE_GMAIL_DEFAULT_MAX_PAGES;
  const totalPageBudget = Math.max(configuredPageBudget, input.queries.length);
  const messagesById = new Map<string, GoogleGmailReadResult["messages"][number]>();
  const warnings = new Set<string>();
  const truncatedBy = new Set<"max_messages" | "max_pages">();
  let complete = true;
  const cursors: string[] = [];
  let pagesRead = 0;
  let pageBudgetAssigned = 0;
  let processedQueries = 0;
  let resultSizeEstimate = 0;
  let hasResultSizeEstimate = false;

  for (const [index, query] of input.queries.entries()) {
    if (messagesById.size >= maxMessages) break;
    const remainingBatches = input.queries.length - index;
    const remainingPageBudget = totalPageBudget - pageBudgetAssigned;
    const batchPageBudget = Math.max(1, remainingPageBudget - (remainingBatches - 1));
    pageBudgetAssigned += batchPageBudget;
    const result = await deps.readMail({
      accessToken: input.accessToken,
      excludeMessageIds: Array.from(messagesById.keys()),
      historyId: null,
      maxMessages: maxMessages - messagesById.size,
      maxPages: batchPageBudget,
      query,
      requestGovernor: input.requestGovernor,
      since: input.since
    });
    processedQueries += 1;

    pagesRead += result.pagesRead;
    complete = complete && result.complete !== false;
    for (const reason of result.truncatedBy ?? []) truncatedBy.add(reason);
    if (result.nextCursor) cursors.push(result.nextCursor);
    for (const warning of result.warnings) warnings.add(warning);
    if (result.resultSizeEstimate !== null) {
      resultSizeEstimate += result.resultSizeEstimate;
      hasResultSizeEstimate = true;
    }
    for (const message of result.messages) {
      const messageId = message.id?.trim();
      if (!messageId || messagesById.has(messageId)) continue;
      messagesById.set(messageId, message);
      if (messagesById.size >= maxMessages) break;
    }
  }

  if (processedQueries < input.queries.length) {
    complete = false;
    truncatedBy.add("max_messages");
  }

  return {
    complete,
    messages: Array.from(messagesById.values()),
    mode: "full",
    nextCursor: latestNumericCursor(cursors),
    pagesRead,
    resultSizeEstimate: hasResultSizeEstimate ? resultSizeEstimate : null,
    truncatedBy: Array.from(truncatedBy),
    warnings: Array.from(warnings)
  };
}

function defaultDependencies(overrides: Partial<SyncGoogleInteractionsDependencies>): SyncGoogleInteractionsDependencies {
  return {
    createMailRequestGovernor: createGoogleGmailRequestGovernor,
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
    readCursorRecord: async (input) => readSyncCursor({
      cursorLabel: input.cursorLabel,
      provider: GOOGLE_PROVIDER,
      resourceType: input.resourceType
    }),
    readMail: readGoogleGmailMessages,
    readMailProfileHistoryId: readGoogleGmailProfileHistoryId,
    readExternalSourcesForPreview: readExternalSourcesForPreview,
    saveCalendarReadDiagnostics,
    syncCalendar: syncCalendarInteractions,
    syncMail: syncMailInteractions,
    writeCursor: async (input) => {
      await upsertSyncCursor({
        connectedAccountId: input.connectedAccountId,
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

function filterExternalInteractionsToDate(items: ExternalInteractionInput[], maxIso?: string | null) {
  const maxTime = parsedTime(maxIso);
  if (maxTime === null) return items;
  return items.filter((item) => {
    const itemTime = parsedTime(item.occurredAt);
    return itemTime === null || itemTime <= maxTime;
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

function gmailQueriesForScopedContacts(contacts: ContactRow[]) {
  const emails = uniqueContactEmails(contacts);
  const queries: string[] = [];
  for (let index = 0; index < emails.length; index += GMAIL_SCOPED_EMAILS_PER_BATCH) {
    const batch = emails.slice(index, index + GMAIL_SCOPED_EMAILS_PER_BATCH);
    queries.push(`(${batch.map((email) => `(from:${email} OR to:${email} OR cc:${email} OR bcc:${email})`).join(" OR ")})`);
  }
  return queries;
}

function calendarQueriesForScopedContacts(input: SyncGoogleInteractionsInput, contacts: ContactRow[]) {
  if (input.calendarQuery) return [];
  if (!input.focusedOnly && !(input.contactIds?.length ?? 0)) return [];
  const emails = uniqueContactEmails(contacts);
  if (!emails.length) return [];
  return emails;
}

function shouldSkipFocusedMail(input: SyncGoogleInteractionsInput, contacts: ContactRow[], scopedEmailQueries: string[]) {
  if (input.gmailQuery !== undefined && input.gmailQuery !== null && !scopedEmailQueries.length) {
    return "Gmail no se reviso porque la busqueda indicada esta vacia.";
  }
  if (!input.focusedOnly) return "";
  if (!contacts.length) return "No hay contactos en foco para revisar Gmail.";
  if (!scopedEmailQueries.length) {
    return "Gmail no se reviso porque los contactos seleccionados no tienen correos.";
  }
  return "";
}

function shouldSkipFocusedCalendar(input: SyncGoogleInteractionsInput, contacts: ContactRow[]) {
  const isScopedReview = Boolean(input.focusedOnly || (input.contactIds?.length ?? 0));
  if (!isScopedReview || input.calendarQuery) return "";
  if (!contacts.length) return "No hay contactos en foco para revisar Calendar.";
  const emails = uniqueContactEmails(contacts);
  if (!emails.length) return "Calendar no se reviso porque los contactos seleccionados no tienen correos.";
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

function matchedParticipantEmailsForEvents(events: GoogleCalendarReadResult["events"], emails: string[]) {
  const scopedEmails = new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const matches: Record<string, string[]> = {};
  for (const event of events) {
    const participantEmails = [
      event.organizer?.email,
      ...(event.attendees ?? []).map((attendee) => attendee.email)
    ]
      .map((email) => email?.trim().toLowerCase() ?? "")
      .filter((email) => scopedEmails.has(email));
    if (participantEmails.length) {
      matches[calendarEventKey(event)] = Array.from(new Set(participantEmails));
    }
  }
  return matches;
}

function filterContactsForSync(contacts: ContactRow[], input: SyncGoogleInteractionsInput) {
  const ids = new Set((input.contactIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (ids.size) {
    return contacts.filter((contact) => (
      ids.has(contact.id)
      && contact.is_active
      && (!input.focusedOnly || contact.networking_focus)
    ));
  }
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
  const hasPermissionError = errors.some((error) => error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
  if (hasPermissionError) return errors;

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

function latestNumericCursor(values: string[]) {
  return values
    .map((value) => numericCursor(value))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => {
      const leftValue = BigInt(left);
      const rightValue = BigInt(right);
      if (leftValue === rightValue) return 0;
      return leftValue > rightValue ? -1 : 1;
    })[0] ?? "";
}
