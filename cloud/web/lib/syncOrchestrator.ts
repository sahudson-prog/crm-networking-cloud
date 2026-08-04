import type {
  ExternalInteractionInput,
  ExternalInteractionSyncResult
} from "./externalInteractionSync";
import { buildContactSyncPreview, type ContactSyncPreviewInput } from "./contactSyncPreview.ts";
import type { ContactRow } from "./readModel.ts";

export type SyncProvider = "google" | "microsoft" | "apple" | "csv" | string;
export type SyncResourceType = "contacts" | "mail" | "calendar" | "messages";
export type SyncMode = "incremental" | "historical" | "single_contact" | "manual_batch";

export type SyncScope = {
  contactIds?: string[];
  externalIds?: string[];
  emails?: string[];
  since?: string | null;
  until?: string | null;
  limit?: number | null;
  reason?: string;
};

export type SyncRunInput = {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  mode: SyncMode;
  scope?: SyncScope;
  connectedAccountId?: string | null;
  cursorBefore?: string | null;
  cursorAfter?: string | null;
  dryRun?: boolean;
  source?: string;
};

export type SyncCounts = {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  participantsInserted: number;
};

export type SyncIssue = {
  code: string;
  message: string;
  externalId?: string | null;
  objectId?: string | null;
};

export type SyncAffectedObjects = {
  contactIds: string[];
  interactionIds: string[];
  externalSourceIds: string[];
};

export type SyncPreviewChangeType =
  | "new"
  | "modified"
  | "deleted"
  | "deactivated"
  | "consolidation"
  | "duplicate_complex"
  | "unchanged";

export type SyncPreviewFieldChange = {
  label: string;
  before?: string | null;
  after?: string | null;
  changed?: boolean;
  operation?: "add" | "remove" | "replace" | "match" | "info";
  apply?: boolean;
  required?: boolean;
};

export type SyncPreviewChange = {
  id: string;
  type: SyncPreviewChangeType;
  title: string;
  subtitle?: string | null;
  sourceLabel?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  fields: SyncPreviewFieldChange[];
  defaultSelected: boolean;
  blocking?: boolean;
  metadata?: Record<string, unknown>;
};

export type SyncRunResult = {
  ok: boolean;
  provider: SyncProvider;
  resourceType: SyncResourceType;
  mode: SyncMode;
  scope: SyncScope;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  cursorBefore?: string | null;
  cursorAfter?: string | null;
  counts: SyncCounts;
  affected: SyncAffectedObjects;
  preview?: SyncPreviewChange[];
  warnings: string[];
  errors: SyncIssue[];
};

export type ExternalInteractionBatchInput = SyncRunInput & {
  items: ExternalInteractionInput[];
};

export type ExternalInteractionSyncHandler = (
  item: ExternalInteractionInput
) => Promise<ExternalInteractionSyncResult>;

export type ExternalContactInput = {
  provider: SyncProvider;
  externalId: string;
  connectedAccountId?: string | null;
  displayName: string;
  company?: string | null;
  role?: string | null;
  emails?: string[];
  phones?: string[];
  metadata?: Record<string, unknown>;
  lastSeenAt?: string | null;
};

export type ContactSyncInput = SyncRunInput & {
  items?: ExternalContactInput[];
  appContacts?: ContactRow[];
  externalIdToContactId?: ContactSyncPreviewInput["externalIdToContactId"];
  knownExternalValuesByContactId?: ContactSyncPreviewInput["knownExternalValuesByContactId"];
  suppressedChangeKeys?: string[];
};

export async function syncMailInteractions(
  input: Omit<ExternalInteractionBatchInput, "resourceType">,
  handler: ExternalInteractionSyncHandler = defaultExternalInteractionSyncHandler
) {
  return syncExternalInteractionBatch({ ...input, resourceType: "mail" }, handler);
}

export async function syncCalendarInteractions(
  input: Omit<ExternalInteractionBatchInput, "resourceType">,
  handler: ExternalInteractionSyncHandler = defaultExternalInteractionSyncHandler
) {
  return syncExternalInteractionBatch({ ...input, resourceType: "calendar" }, handler);
}

export async function syncExternalInteractionBatch(
  input: ExternalInteractionBatchInput,
  handler: ExternalInteractionSyncHandler = defaultExternalInteractionSyncHandler
): Promise<SyncRunResult> {
  const result = createBaseSyncResult(input);
  const items = filterAndLimitItems(input.items, input.scope);
  result.counts.scanned = items.length;

  if (input.dryRun) {
    result.counts.skipped = items.length;
    result.warnings.push("Dry-run: no se escribieron cambios.");
    return finishSyncResult(result);
  }

  const interactionIds = new Set<string>();
  const externalSourceIds = new Set<string>();

  for (const item of items) {
    try {
      const itemResult = await handler(item);
      if (itemResult.status === "created") result.counts.created += 1;
      if (itemResult.status === "updated") result.counts.updated += 1;
      if (itemResult.status === "skipped_prevent_reimport") result.counts.skipped += 1;
      result.counts.participantsInserted += itemResult.participantsInserted ?? 0;
      if (itemResult.interactionId) interactionIds.add(itemResult.interactionId);
      if (itemResult.externalSourceId) externalSourceIds.add(itemResult.externalSourceId);
    } catch (error) {
      result.counts.failed += 1;
      result.errors.push({
        code: "SYNC_ITEM_FAILED",
        message: error instanceof Error ? error.message : "No pude sincronizar el objeto.",
        externalId: item.externalId
      });
    }
  }

  result.affected.interactionIds = Array.from(interactionIds);
  result.affected.externalSourceIds = Array.from(externalSourceIds);
  result.ok = result.errors.length === 0;
  return finishSyncResult(result);
}

async function defaultExternalInteractionSyncHandler(item: ExternalInteractionInput) {
  const { syncExternalInteraction } = await import("./externalInteractionSync");
  return syncExternalInteraction(item);
}

export async function syncContacts(input: ContactSyncInput): Promise<SyncRunResult> {
  const result = createBaseSyncResult(input);
  const items = filterAndLimitContacts(input.items ?? [], input.scope);
  result.counts.scanned = items.length;

  if (input.appContacts) {
    result.preview = buildContactSyncPreview({
      appContacts: input.appContacts,
      externalContacts: items,
      externalIdToContactId: input.externalIdToContactId,
      knownExternalValuesByContactId: input.knownExternalValuesByContactId,
      provider: input.provider,
      suppressedChangeKeys: input.suppressedChangeKeys
    });
    result.counts.created = result.preview.filter((change) => change.type === "new").length;
    result.counts.updated = result.preview.filter((change) => change.type === "modified" || change.type === "consolidation").length;
    result.counts.skipped = result.preview.filter((change) => change.type === "deleted" || change.type === "deactivated" || change.type === "unchanged").length;
    result.warnings.push("Preview de contactos: no se escribieron cambios hasta que el usuario confirme.");
    return finishSyncResult(result);
  }

  result.ok = false;
  result.errors.push({
    code: "CONTACT_SYNC_PREVIEW_REQUIRED",
    message: "La sincronizacion de contactos debe recibir datos de la app y de la fuente para generar preview antes de aplicar cambios."
  });
  return finishSyncResult(result);
}

function createBaseSyncResult(input: SyncRunInput): SyncRunResult {
  const now = new Date().toISOString();
  return {
    ok: true,
    provider: input.provider,
    resourceType: input.resourceType,
    mode: input.mode,
    scope: input.scope ?? {},
    startedAt: now,
    finishedAt: now,
    dryRun: Boolean(input.dryRun),
    cursorBefore: input.cursorBefore ?? null,
    cursorAfter: input.cursorAfter ?? null,
    counts: {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      participantsInserted: 0
    },
    affected: {
      contactIds: [],
      interactionIds: [],
      externalSourceIds: []
    },
    warnings: [],
    errors: []
  };
}

function finishSyncResult(result: SyncRunResult) {
  return {
    ...result,
    finishedAt: new Date().toISOString()
  };
}

function filterAndLimitItems(items: ExternalInteractionInput[], scope?: SyncScope) {
  const externalIds = new Set((scope?.externalIds ?? []).map((id) => id.toLowerCase()));
  const filtered = externalIds.size
    ? items.filter((item) => externalIds.has(item.externalId.toLowerCase()))
    : items;
  return applyLimit(filtered, scope?.limit);
}

function filterAndLimitContacts(items: ExternalContactInput[], scope?: SyncScope) {
  const externalIds = new Set((scope?.externalIds ?? []).map((id) => id.toLowerCase()));
  const filtered = externalIds.size
    ? items.filter((item) => externalIds.has(item.externalId.toLowerCase()))
    : items;
  return applyLimit(filtered, scope?.limit);
}

function applyLimit<T>(items: T[], limit?: number | null) {
  if (!limit || limit < 1) return items;
  return items.slice(0, limit);
}
