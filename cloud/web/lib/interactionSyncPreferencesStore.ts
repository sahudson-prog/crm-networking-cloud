import {
  DEFAULT_INTERACTION_SYNC_PREFERENCES,
  INTERACTION_SYNC_PREFERENCES_SETTING_KEY,
  parseInteractionSyncPreferences,
  serializeInteractionSyncPreferences,
  type InteractionSyncPreferences
} from "./interactionSyncPreferences.ts";
import { supabase } from "./supabaseClient.ts";

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
  };
  from: (table: string) => any;
};

export async function loadInteractionSyncPreferences(
  client: SupabaseLike | null = supabase
): Promise<InteractionSyncPreferences> {
  const db = requireClient(client);
  const userId = await currentUserId(db);
  const { data, error } = await db
    .from("user_settings")
    .select("setting_value")
    .eq("user_id", userId)
    .eq("setting_key", INTERACTION_SYNC_PREFERENCES_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ...DEFAULT_INTERACTION_SYNC_PREFERENCES };
  return parseInteractionSyncPreferences(data.setting_value ?? null);
}

export async function saveInteractionSyncPreferences(
  preferences: InteractionSyncPreferences,
  client: SupabaseLike | null = supabase
) {
  const db = requireClient(client);
  const userId = await currentUserId(db);
  const normalized = parseInteractionSyncPreferences(serializeInteractionSyncPreferences(preferences));
  const { error } = await db
    .from("user_settings")
    .upsert(
      {
        setting_key: INTERACTION_SYNC_PREFERENCES_SETTING_KEY,
        setting_value: serializeInteractionSyncPreferences(normalized),
        user_id: userId
      },
      { onConflict: "user_id,setting_key" }
    );

  if (error) throw error;
  return normalized;
}

function requireClient(client: SupabaseLike | null): SupabaseLike {
  if (!client) throw new Error("Supabase no esta configurado.");
  return client;
}

async function currentUserId(client: SupabaseLike) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No pude identificar el usuario activo.");
  return userId;
}
