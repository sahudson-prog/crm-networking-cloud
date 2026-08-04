import { supabase } from "./supabaseClient.ts";
import type { SyncProvider, SyncResourceType } from "./syncOrchestrator.ts";

export type SyncCursorStatus = "ok" | "expired" | "error" | "paused";

export type SyncCursorRecord = {
  id?: string;
  user_id?: string;
  connected_account_id?: string | null;
  provider: SyncProvider;
  resource_type: SyncResourceType;
  cursor_label: string;
  cursor_value: string | null;
  last_synced_at: string | null;
  status: SyncCursorStatus;
  metadata: Record<string, unknown>;
};

export type SyncCursorKey = {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  cursorLabel?: string;
};

export type SyncCursorWriteInput = SyncCursorKey & {
  cursorValue: string | null;
  connectedAccountId?: string | null;
  status?: SyncCursorStatus;
  metadata?: Record<string, unknown>;
  syncedAt?: string;
};

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
  };
  from: (table: string) => any;
};

export async function readSyncCursor(input: SyncCursorKey, client: SupabaseLike | null = supabase) {
  const db = requireClient(client);
  const userId = await currentUserId(db);
  const { data, error } = await db
    .from("sync_cursors")
    .select("id,user_id,connected_account_id,provider,resource_type,cursor_label,cursor_value,last_synced_at,status,metadata")
    .eq("user_id", userId)
    .eq("provider", input.provider)
    .eq("resource_type", input.resourceType)
    .eq("cursor_label", input.cursorLabel ?? "")
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as SyncCursorRecord | null;
}

export async function upsertSyncCursor(input: SyncCursorWriteInput, client: SupabaseLike | null = supabase) {
  const db = requireClient(client);
  const userId = await currentUserId(db);
  const row = {
    connected_account_id: input.connectedAccountId ?? null,
    cursor_label: input.cursorLabel ?? "",
    cursor_value: input.cursorValue,
    last_synced_at: input.syncedAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
    provider: input.provider,
    resource_type: input.resourceType,
    status: input.status ?? "ok",
    user_id: userId
  };

  const { data, error } = await db
    .from("sync_cursors")
    .upsert(row, { onConflict: "user_id,provider,resource_type,cursor_label" })
    .select("id,user_id,connected_account_id,provider,resource_type,cursor_label,cursor_value,last_synced_at,status,metadata")
    .single();

  if (error) throw error;
  return data as SyncCursorRecord;
}

export async function markSyncCursorExpired(input: SyncCursorKey, client: SupabaseLike | null = supabase) {
  return upsertSyncCursor({
    ...input,
    cursorValue: null,
    metadata: { expired_at: new Date().toISOString() },
    status: "expired"
  }, client);
}

function requireClient(client: SupabaseLike | null): SupabaseLike {
  if (!client) throw new Error("Supabase no esta configurado.");
  return client;
}

async function currentUserId(client: SupabaseLike) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");
  return userId;
}
