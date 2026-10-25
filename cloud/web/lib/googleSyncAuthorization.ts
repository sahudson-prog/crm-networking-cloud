import { supabase } from "./supabaseClient.ts";

export type ConnectedSyncOperation = "contacts" | "email" | "calendar";

const GOOGLE_OPERATION_CAPABILITIES: Record<ConnectedSyncOperation, string> = {
  calendar: "interactions.sync_calendar",
  contacts: "contacts.sync_external",
  email: "interactions.sync_email"
};

const GOOGLE_OPERATION_SCOPES: Record<ConnectedSyncOperation, string> = {
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  email: "https://www.googleapis.com/auth/gmail.readonly"
};

export function googleSyncOperationsForScopes(scopes: string[]) {
  const scopeSet = new Set(scopes);
  return (Object.keys(GOOGLE_OPERATION_SCOPES) as ConnectedSyncOperation[])
    .filter((operation) => scopeSet.has(GOOGLE_OPERATION_SCOPES[operation]));
}

export async function readGoogleOAuthOperationEligibility(operation: ConnectedSyncOperation) {
  const db = requireSupabase();
  const [{ data: rolloutAllowed, error: rolloutError }, { data: operationAllowed, error: operationError }] = await Promise.all([
    db.rpc("current_user_can_start_connected_oauth_v1", { p_provider: "google" }),
    db.rpc("current_user_has_capability", { p_capability_code: GOOGLE_OPERATION_CAPABILITIES[operation] })
  ]);
  if (rolloutError) throw rolloutError;
  if (operationError) throw operationError;
  return rolloutAllowed === true && operationAllowed === true;
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
  if (!connectedAccountId) {
    throw new Error("Primero conecta una cuenta Google válida para esta operación.");
  }
  const db = requireSupabase();
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
