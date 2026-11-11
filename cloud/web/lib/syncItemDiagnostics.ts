export type SyncItemPhase = "context" | "writer_load" | "normalize" | "rpc" | "response" | "unknown";
export type SyncItemOutcome = "not_sent" | "rejected" | "uncertain";
const localCodes = new Set(["SYNC_ACCOUNT_REQUIRED", "SYNC_ACCOUNT_MISMATCH", "SYNC_WRITER_LOAD_FAILED",
  "SYNC_NORMALIZATION_FAILED", "SYNC_RPC_REJECTED", "SYNC_TRANSPORT_UNCERTAIN", "SYNC_RESPONSE_INVALID",
  "SYNC_ITEM_FAILED", "CALENDAR_LEGACY_ID_REVIEW_REQUIRED"]);
const databaseCodes = new Set(["42501", "P0001", "23505", "23503", "23514", "22P02", "40001",
  "40P01", "57014", "08006", "PGRST202", "PGRST301", "PGRST302", "PGRST204"]);

export class SyncItemFailure extends Error {
  phase: SyncItemPhase;
  code: string;
  outcome: SyncItemOutcome;
  httpStatus: number | null;
  constructor(phase: SyncItemPhase, code: string, outcome: SyncItemOutcome,
    httpStatus: number | null = null) {
    super("No pudimos completar la sincronizacion del elemento.");
    this.phase = phase;
    this.code = code;
    this.outcome = outcome;
    this.httpStatus = httpStatus;
  }
}

export function syncRpcCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && databaseCodes.has(code) ? code : "SYNC_RPC_REJECTED";
}

export function syncItemDiagnostic(error: unknown) {
  const value = error as Partial<SyncItemFailure> | null;
  const phases: SyncItemPhase[] = ["context", "writer_load", "normalize", "rpc", "response", "unknown"];
  const outcomes: SyncItemOutcome[] = ["not_sent", "rejected", "uncertain"];
  return {
    phase: phases.includes(value?.phase as SyncItemPhase) ? value!.phase! : "unknown" as SyncItemPhase,
    code: typeof value?.code === "string" && (localCodes.has(value.code) || databaseCodes.has(value.code))
      ? value.code : "SYNC_ITEM_FAILED",
    outcome: outcomes.includes(value?.outcome as SyncItemOutcome) ? value!.outcome! : "uncertain" as SyncItemOutcome,
    httpStatus: Number.isInteger(value?.httpStatus) && value!.httpStatus! >= 100 && value!.httpStatus! <= 599
      ? value!.httpStatus! : null
  };
}

export function summarizeSyncItemErrors(errors: readonly unknown[]) {
  const groups = new Map<string, ReturnType<typeof syncItemDiagnostic> & { message: string; count: number }>();
  for (const error of errors) {
    const diagnostic = syncItemDiagnostic(error);
    const key = JSON.stringify(diagnostic);
    const previous = groups.get(key);
    if (previous) previous.count++;
    else groups.set(key, { ...diagnostic, message: "No pudimos completar algunas citas.", count: 1 });
  }
  return [...groups.values()];
}
