import { supabase } from "./supabaseClient.ts";
import { calendarScopeGranted, googleProductOperationEnabled, GOOGLE_CALENDAR_OWNED_SCOPE } from "./googleProductPolicy.ts";

export type ConnectedSyncOperation = "contacts" | "email" | "calendar";

const GOOGLE_OPERATION_CAPABILITIES: Record<ConnectedSyncOperation, string> = {
  calendar: "interactions.sync_calendar",
  contacts: "contacts.sync_external",
  email: "interactions.sync_email"
};

const GOOGLE_OPERATION_SCOPES: Record<ConnectedSyncOperation, string> = {
  calendar: GOOGLE_CALENDAR_OWNED_SCOPE,
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  email: "https://www.googleapis.com/auth/gmail.readonly"
};

export function googleSyncOperationsForScopes(scopes: string[]) {
  const scopeSet = new Set(scopes);
  return (Object.keys(GOOGLE_OPERATION_SCOPES) as ConnectedSyncOperation[])
    .filter((operation) => operation === "calendar" ? calendarScopeGranted(scopes) : scopeSet.has(GOOGLE_OPERATION_SCOPES[operation]));
}

export async function readGoogleOAuthOperationEligibility(operation: ConnectedSyncOperation) {
  if (!googleProductOperationEnabled(operation)) return false;
  const db = requireSupabase();
  const [{ data: rolloutAllowed, error: rolloutError }, { data: operationAllowed, error: operationError }] = await Promise.all([
    db.rpc("current_user_can_start_connected_oauth_v1", { p_provider: "google" }),
    db.rpc("current_user_has_capability", { p_capability_code: GOOGLE_OPERATION_CAPABILITIES[operation] })
  ]);
  if (rolloutError) throw rolloutError;
  if (operationError) throw operationError;
  if (operation !== "calendar" || rolloutAllowed !== true || operationAllowed !== true) {
    return rolloutAllowed === true && operationAllowed === true;
  }
  const { data: adminAllowed, error: adminError } = await db.rpc("current_user_can_use_calendar_admin_v1");
  if (adminError) throw adminError;
  return adminAllowed === true;
}

export async function requireGoogleOAuthRolloutEligibility(operation: ConnectedSyncOperation) {
  if (!await readGoogleOAuthOperationEligibility(operation)) {
    throw new Error("Tu cuenta no está habilitada para conectar datos de Google en esta etapa.");
  }
}

export async function requireGoogleOAuthRolloutOperations(operations: ConnectedSyncOperation[]) {
  for (const operation of Array.from(new Set(operations))) {
    await requireGoogleOAuthRolloutEligibility(operation);
  }
}

export async function requireGoogleConnectedSyncAuthorization(
  connectedAccountId: string | null | undefined,
  operation: ConnectedSyncOperation
) {
  if (!googleProductOperationEnabled(operation)) throw new Error("Esta fuente no está disponible en esta versión.");
  if (!connectedAccountId) {
    throw new Error("Primero conecta una cuenta Google válida para esta operación.");
  }
  const db = requireSupabase();
  if (operation === "calendar") {
    const { data: adminAllowed, error: adminError } = await db.rpc("current_user_can_use_calendar_admin_v1");
    if (adminError) throw adminError;
    if (adminAllowed !== true) throw new Error("Calendar solo está disponible para administradores.");
  }
  const { data, error } = await db.rpc("current_user_can_sync_connected_account_v1", {
    p_connected_account_id: connectedAccountId,
    p_operation: operation
  });
  if (error) throw error;
  if (data !== true) {
    throw new Error("Tu cuenta no tiene autorización vigente para esta sincronización.");
  }
}

export async function requireGoogleConnectedSyncOperations(
  connectedAccountId: string | null | undefined,
  operations: ConnectedSyncOperation[]
) {
  for (const operation of Array.from(new Set(operations))) {
    await requireGoogleConnectedSyncAuthorization(connectedAccountId, operation);
  }
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}
