type AppAccessRpcRow = {
  allowed: boolean;
  reason: string | null;
};

export type AppAccessSession = {
  user?: {
    email?: string | null;
    id?: string | null;
  } | null;
} | null;

export type AppAccessRpcClient = {
  rpc: (
    functionName: "current_user_app_access_status"
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type AppAccessResolution =
  | { status: "unauthenticated" }
  | { status: "allowed" }
  | { status: "denied"; reason: string }
  | { status: "error"; message: string };

export type AppAccessGateState = AppAccessResolution | { status: "checking" };

const DEFAULT_ACCESS_CHECK_TIMEOUT_MS = 10000;

export function resetAppAccessForLogout(): AppAccessResolution {
  return { status: "unauthenticated" };
}

export async function resolveAppAccessForSession(
  session: AppAccessSession,
  client: AppAccessRpcClient,
  timeoutMs = DEFAULT_ACCESS_CHECK_TIMEOUT_MS
): Promise<AppAccessResolution> {
  if (!session) return { status: "unauthenticated" };

  try {
    const { data, error } = await withTimeout(
      client.rpc("current_user_app_access_status"),
      timeoutMs
    );
    if (error) {
      return { status: "error", message: error.message ?? "No se pudo revisar el acceso." };
    }

    return parseAppAccessRpcResponse(data);
  } catch {
    return { status: "error", message: "No se pudo revisar el acceso." };
  }
}

export function parseAppAccessRpcResponse(data: unknown): AppAccessResolution {
  const row = Array.isArray(data) ? data[0] : data;

  if (!isAppAccessRpcRow(row)) {
    return { status: "error", message: "La respuesta de acceso no tiene el formato esperado." };
  }

  if (row.allowed) return { status: "allowed" };

  return { status: "denied", reason: row.reason ?? "access_denied" };
}

export function shouldPreservePrivateUiDuringAccessRevalidation(input: {
  currentAccess: AppAccessGateState;
  event: string;
  nextSession: AppAccessSession;
  previousSession: AppAccessSession;
}) {
  return Boolean(
    input.currentAccess.status === "allowed" &&
    isNonDestructiveAuthRefreshEvent(input.event) &&
    isSameAppAccessUser(input.previousSession, input.nextSession)
  );
}

export function applyAccessRevalidationResult(
  currentAccess: AppAccessGateState,
  nextAccess: AppAccessResolution,
  preservePrivateUi: boolean
): AppAccessGateState {
  if (preservePrivateUi && nextAccess.status === "error") return currentAccess;
  return nextAccess;
}

function isAppAccessRpcRow(value: unknown): value is AppAccessRpcRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as AppAccessRpcRow;
  return (
    typeof row.allowed === "boolean" &&
    (row.reason === undefined || row.reason === null || typeof row.reason === "string")
  );
}

function isNonDestructiveAuthRefreshEvent(event: string) {
  return event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED";
}

function isSameAppAccessUser(previousSession: AppAccessSession, nextSession: AppAccessSession) {
  const previousUser = previousSession?.user;
  const nextUser = nextSession?.user;
  const previousId = normalizeUserKey(previousUser?.id);
  const nextId = normalizeUserKey(nextUser?.id);
  if (previousId || nextId) return Boolean(previousId && previousId === nextId);

  const previousEmail = normalizeUserKey(previousUser?.email);
  const nextEmail = normalizeUserKey(nextUser?.email);
  return Boolean(previousEmail && previousEmail === nextEmail);
}

function normalizeUserKey(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("access check timeout")), timeoutMs);
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
