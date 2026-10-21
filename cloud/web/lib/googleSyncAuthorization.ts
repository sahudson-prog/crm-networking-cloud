import { supabase } from "./supabaseClient.ts";

export type ConnectedSyncOperation = "contacts" | "email" | "calendar";

export async function requireGoogleOAuthRolloutEligibility() {
  const db = requireSupabase();
  const { data, error } = await db.rpc("current_user_can_start_connected_oauth_v1", {
    p_provider: "google"
  });
  if (error) throw error;
  if (data !== true) {
    throw new Error("Tu cuenta no está habilitada para conectar datos de Google en esta etapa.");
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
