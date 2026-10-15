import { CURRENT_LEGAL_CONTRACT } from "./legalContract.ts";

const LEGAL_ACCEPTANCE_INTENT_KEY = "coffeecito_legal_acceptance_intent_v1";
const LEGAL_ACCEPTANCE_TIMEOUT_MS = 10000;

export type LegalAcceptanceStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type LegalAcceptanceRpcClient = {
  rpc: (
    functionName: "current_user_legal_acceptance_status_v1" | "record_current_user_legal_acceptance_v1"
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type LegalAcceptanceGateState =
  | { status: "checking" }
  | { status: "accepted"; acceptedAt: string }
  | { status: "required" }
  | { status: "error"; message: string };

type LegalAcceptanceRpcRow = {
  accepted: boolean;
  accepted_at: string | null;
  privacy_sha256: string;
  privacy_version: string;
  terms_sha256: string;
  terms_version: string;
};

export function rememberLegalAcceptanceIntent(storage: LegalAcceptanceStorage, accepted: boolean) {
  try {
    if (!accepted) {
      storage.removeItem(LEGAL_ACCEPTANCE_INTENT_KEY);
      return;
    }
    storage.setItem(LEGAL_ACCEPTANCE_INTENT_KEY, JSON.stringify(CURRENT_LEGAL_CONTRACT));
  } catch {
    // Storage is only a convenience for crossing the auth redirect; the post-auth gate remains fail-closed.
  }
}

export function clearLegalAcceptanceIntent(storage: LegalAcceptanceStorage) {
  try {
    storage.removeItem(LEGAL_ACCEPTANCE_INTENT_KEY);
  } catch {
    // A blocked storage API cannot bypass the server-side acceptance check.
  }
}

export function hasCurrentLegalAcceptanceIntent(storage: LegalAcceptanceStorage) {
  try {
    const value = storage.getItem(LEGAL_ACCEPTANCE_INTENT_KEY);
    if (!value) return false;
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const current = Object.entries(CURRENT_LEGAL_CONTRACT).every(([key, expected]) => parsed[key] === expected);
    if (!current) storage.removeItem(LEGAL_ACCEPTANCE_INTENT_KEY);
    return current;
  } catch {
    clearLegalAcceptanceIntent(storage);
    return false;
  }
}

export async function resolveLegalAcceptanceForSession(
  client: LegalAcceptanceRpcClient,
  storage: LegalAcceptanceStorage,
  timeoutMs = LEGAL_ACCEPTANCE_TIMEOUT_MS
): Promise<LegalAcceptanceGateState> {
  const current = await readCurrentLegalAcceptance(client, timeoutMs);
  if (current.status !== "required") {
    if (current.status === "accepted") clearLegalAcceptanceIntent(storage);
    return current;
  }
  if (!hasCurrentLegalAcceptanceIntent(storage)) return current;

  const recorded = await recordCurrentLegalAcceptance(client, timeoutMs);
  if (recorded.status === "accepted") clearLegalAcceptanceIntent(storage);
  return recorded;
}

export async function readCurrentLegalAcceptance(
  client: LegalAcceptanceRpcClient,
  timeoutMs = LEGAL_ACCEPTANCE_TIMEOUT_MS
): Promise<LegalAcceptanceGateState> {
  return callLegalAcceptanceRpc(client, "current_user_legal_acceptance_status_v1", timeoutMs);
}

export async function recordCurrentLegalAcceptance(
  client: LegalAcceptanceRpcClient,
  timeoutMs = LEGAL_ACCEPTANCE_TIMEOUT_MS
): Promise<LegalAcceptanceGateState> {
  return callLegalAcceptanceRpc(client, "record_current_user_legal_acceptance_v1", timeoutMs);
}

async function callLegalAcceptanceRpc(
  client: LegalAcceptanceRpcClient,
  functionName: "current_user_legal_acceptance_status_v1" | "record_current_user_legal_acceptance_v1",
  timeoutMs: number
): Promise<LegalAcceptanceGateState> {
  try {
    const { data, error } = await withTimeout(client.rpc(functionName), timeoutMs);
    if (error) return { status: "error", message: error.message ?? "No se pudo revisar la aceptación legal." };

    const row = Array.isArray(data) ? data[0] : data;
    if (!isLegalAcceptanceRpcRow(row) || !matchesCurrentContract(row)) {
      return { status: "error", message: "La respuesta de aceptación legal no tiene el formato esperado." };
    }
    if (!row.accepted) return { status: "required" };
    if (!row.accepted_at) {
      return { status: "error", message: "La aceptación legal registrada no tiene fecha." };
    }
    return { status: "accepted", acceptedAt: row.accepted_at };
  } catch {
    return { status: "error", message: "No se pudo revisar la aceptación legal." };
  }
}

function matchesCurrentContract(row: LegalAcceptanceRpcRow) {
  return row.terms_version === CURRENT_LEGAL_CONTRACT.termsVersion
    && row.privacy_version === CURRENT_LEGAL_CONTRACT.privacyVersion
    && row.terms_sha256 === CURRENT_LEGAL_CONTRACT.termsSha256
    && row.privacy_sha256 === CURRENT_LEGAL_CONTRACT.privacySha256;
}

function isLegalAcceptanceRpcRow(value: unknown): value is LegalAcceptanceRpcRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<LegalAcceptanceRpcRow>;
  return typeof row.accepted === "boolean"
    && (row.accepted_at === null || typeof row.accepted_at === "string")
    && typeof row.terms_version === "string"
    && typeof row.privacy_version === "string"
    && typeof row.terms_sha256 === "string"
    && typeof row.privacy_sha256 === "string";
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("legal acceptance timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
