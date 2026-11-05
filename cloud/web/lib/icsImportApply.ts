"use client";

import type { NormalizedIcsEvent } from "./icsImport.ts";
import type { IcsImportReviewSnapshot, IcsReviewCategory } from "./icsImportReview.ts";
import { supabase } from "./supabaseClient.ts";
import { revalidateHistoryWindow, type HistoryWindow } from "./historyPolicy.ts";

export const MAX_ICS_APPLY_ITEMS = 500;
export const MAX_ICS_APPLY_PAYLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ICS_APPLY_PARTICIPANTS = 5000;

export type IcsApplyItemResult = {
  changeId: string;
  interactionId: string;
  outcome: "created" | "updated" | "unchanged";
  participantsInserted: number;
  participantsLinked: number;
};

export type IcsApplyResult = {
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  participantsInserted: number;
  participantsLinked: number;
  items: IcsApplyItemResult[];
};

type IcsApplyExpected = {
  interactionId: string;
  interactionUpdatedAt: string;
  sourceContentHash: string;
  sourceUpdatedAt: string;
};

export type IcsApplyRpcItem = {
  changeId: string;
  category: "new" | "modified" | "possible_duplicate";
  expected: IcsApplyExpected | null;
  focusContactIds: string[];
  event: Omit<NormalizedIcsEvent, "entryId" | "warnings">;
};

export type IcsImportApplyGateway = {
  apply(items: IcsApplyRpcItem[], context?: HistoryWindow): Promise<unknown>;
};

export class IcsImportApplyError extends Error {
  readonly code:
    | "not_authenticated"
    | "access_denied"
    | "invalid_selection"
    | "limit_exceeded"
    | "networking_start_required"
    | "before_networking_start"
    | "stale_review"
    | "blocked_identity"
    | "apply_failed";

  constructor(code: IcsImportApplyError["code"], message: string) {
    super(message);
    this.name = "IcsImportApplyError";
    this.code = code;
  }
}

export async function applyIcsImportSelection(input: {
  snapshot: IcsImportReviewSnapshot;
  selectedChangeIds: Iterable<string>;
  gateway?: IcsImportApplyGateway;
}): Promise<IcsApplyResult> {
  const items = buildIcsApplyItems(input.snapshot, input.selectedChangeIds);
  if (!items.length) {
    throw new IcsImportApplyError("invalid_selection", "Selecciona al menos una cita importable.");
  }
  assertApplyLimits(items);

  if (!input.gateway) {
    if (!input.snapshot.historyWindow) throw new IcsImportApplyError("stale_review", "Vuelve a revisar el archivo antes de aplicar.");
    await revalidateHistoryWindow(input.snapshot.historyWindow);
  }
  try {
    return parseApplyResult(await (input.gateway ?? supabaseIcsImportApplyGateway).apply(items, input.snapshot.historyWindow));
  } catch (error) {
    if (error instanceof IcsImportApplyError) throw error;
    throw sanitizedApplyError(error);
  }
}

export function buildIcsApplyItems(
  snapshot: IcsImportReviewSnapshot,
  selectedChangeIds: Iterable<string>
): IcsApplyRpcItem[] {
  const selected = new Set(selectedChangeIds);
  const changesById = new Map(snapshot.changes.map((change) => [change.id, change]));
  const items: IcsApplyRpcItem[] = [];

  for (const { changeId, event, focusContactIds } of snapshot.events) {
    if (!selected.has(changeId)) continue;
    const change = changesById.get(changeId);
    const category = applyCategory(change?.metadata?.icsCategory);
    if (!change || change.blocking || !category) continue;
    if (event.start.valueType === "date") continue;
    items.push({
      changeId,
      category,
      expected: category === "modified" ? readExpected(change.metadata?.icsApplyExpected) : null,
      focusContactIds,
      event: serializeEvent(event)
    });
  }

  return items;
}

export function assertApplyLimits(items: IcsApplyRpcItem[]) {
  if (items.length > MAX_ICS_APPLY_ITEMS) {
    throw new IcsImportApplyError(
      "limit_exceeded",
      `Puedes importar hasta ${MAX_ICS_APPLY_ITEMS} citas por vez. Reduce la selección.`
    );
  }
  const participants = items.reduce(
    (total, item) => total + item.event.attendees.length + (item.event.organizer ? 1 : 0),
    0
  );
  if (participants > MAX_ICS_APPLY_PARTICIPANTS) {
    throw new IcsImportApplyError(
      "limit_exceeded",
      `La selección supera el límite de ${MAX_ICS_APPLY_PARTICIPANTS} participantes. Reduce la selección.`
    );
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(items)).byteLength;
  if (payloadBytes > MAX_ICS_APPLY_PAYLOAD_BYTES) {
    throw new IcsImportApplyError(
      "limit_exceeded",
      "La selección supera el límite de 5 MB. Reduce la selección."
    );
  }
}

export const supabaseIcsImportApplyGateway: IcsImportApplyGateway = {
  async apply(items, context) {
    if (!supabase) throw new IcsImportApplyError("apply_failed", "Supabase no está configurado.");
    if (!context) throw new IcsImportApplyError("stale_review", "Vuelve a revisar el archivo antes de aplicar.");
    const { data, error } = await supabase.rpc("apply_ics_import_v2", { p_items: items, p_context: context });
    if (error) throw error;
    return data;
  }
};

function serializeEvent(event: NormalizedIcsEvent): IcsApplyRpcItem["event"] {
  return {
    uid: event.uid,
    start: event.start,
    end: event.end,
    summary: event.summary,
    description: event.description,
    location: event.location,
    organizer: event.organizer,
    attendees: event.attendees,
    status: event.status,
    method: event.method,
    recurrenceSignals: event.recurrenceSignals
  };
}

function applyCategory(value: unknown): IcsApplyRpcItem["category"] | null {
  return value === "new" || value === "modified" || value === "possible_duplicate" ? value : null;
}

function readExpected(value: unknown): IcsApplyExpected {
  if (!isObject(value)
    || !isUuid(value.interactionId)
    || !isTimestamp(value.interactionUpdatedAt)
    || typeof value.sourceContentHash !== "string"
    || !/^[0-9a-f]{64}$/.test(value.sourceContentHash)
    || !isTimestamp(value.sourceUpdatedAt)) {
    throw new IcsImportApplyError(
      "stale_review",
      "La revisión ya no contiene el estado necesario. Vuelve a revisar el archivo antes de importar."
    );
  }
  return value as IcsApplyExpected;
}

function parseApplyResult(value: unknown): IcsApplyResult {
  if (!isObject(value)
    || !isCount(value.createdCount)
    || !isCount(value.updatedCount)
    || !isCount(value.unchangedCount)
    || !isCount(value.participantsInserted)
    || !isCount(value.participantsLinked)
    || !Array.isArray(value.items)) {
    throw new IcsImportApplyError("apply_failed", "La importación no devolvió un resultado válido.");
  }
  const items = value.items.map((item) => {
    if (!isObject(item)
      || typeof item.changeId !== "string"
      || !isUuid(item.interactionId)
      || (item.outcome !== "created" && item.outcome !== "updated" && item.outcome !== "unchanged")
      || !isCount(item.participantsInserted)) {
      throw new IcsImportApplyError("apply_failed", "La importación no devolvió un resultado válido.");
    }
    if (!isCount(item.participantsLinked)) {
      throw new IcsImportApplyError("apply_failed", "La importación no devolvió un resultado válido.");
    }
    return item as IcsApplyItemResult;
  });
  return { ...value, items } as IcsApplyResult;
}

function sanitizedApplyError(error: unknown) {
  const message = errorMessage(error);
  if (message.includes("history_context_stale")) {
    return new IcsImportApplyError("stale_review", "El proceso o el límite cambió. Vuelve a revisar el archivo antes de aplicar.");
  }
  if (message.includes("ICS_IMPORT_NOT_AUTHENTICATED")) {
    return new IcsImportApplyError("not_authenticated", "Tu sesión ya no está disponible. Vuelve a ingresar.");
  }
  if (message.includes("ICS_IMPORT_ACCESS_DENIED") || message.includes("app_access_denied")) {
    return new IcsImportApplyError("access_denied", "Tu cuenta no tiene acceso para importar citas.");
  }
  if (message.includes("ICS_IMPORT_LIMIT_EXCEEDED")) {
    return new IcsImportApplyError("limit_exceeded", "La selección supera los límites seguros de importación.");
  }
  if (/ICS_IMPORT_NETWORKING_START_REQUIRED|history_active_cycle_required|history_cycle_start_required/.test(message)) {
    return new IcsImportApplyError(
      "networking_start_required",
      "Configura el inicio de tu proceso en Objetivos antes de importar citas."
    );
  }
  if (message.includes("ICS_IMPORT_BEFORE_NETWORKING_START")) {
    return new IcsImportApplyError(
      "before_networking_start",
      "La selección contiene una cita anterior a la ventana vigente. Vuelve a revisar el archivo."
    );
  }
  if (message.includes("ICS_IMPORT_STALE_REVIEW")) {
    return new IcsImportApplyError("stale_review", "Las citas cambiaron desde la revisión. Vuelve a revisar el archivo.");
  }
  if (message.includes("ICS_IMPORT_STALE_FOCUS")) {
    return new IcsImportApplyError("stale_review", "Los contactos Foco cambiaron desde la revisión. Vuelve a revisar el archivo.");
  }
  if (message.includes("ICS_IMPORT_BLOCKED_IDENTITY")) {
    return new IcsImportApplyError("blocked_identity", "Una cita está bloqueada y no puede volver a importarse.");
  }
  if (message.includes("ICS_IMPORT_INVALID_PAYLOAD")) {
    return new IcsImportApplyError("invalid_selection", "La selección contiene una cita no válida para importar.");
  }
  return new IcsImportApplyError("apply_failed", "No pudimos confirmar la importación. Vuelve a revisar el archivo antes de reintentar.");
}

function errorMessage(error: unknown) {
  return isObject(error) && typeof error.message === "string" ? error.message : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
