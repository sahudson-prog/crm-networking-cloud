import {
  PRODUCT_ONBOARDING_SETTING_KEY,
  resolveStoredOnboardingState,
  serializeProductOnboardingState,
  type ProductOnboardingState
} from "./onboarding";
import { supabase } from "./supabaseClient";

export type StoredProductOnboardingState = {
  exists: boolean;
  state: ProductOnboardingState;
};

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

async function currentUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("No pude identificar el usuario activo.");
  return data.user.id;
}

export async function loadProductOnboardingState(): Promise<StoredProductOnboardingState> {
  const client = requireSupabase();
  const userId = await currentUserId();
  const { data, error } = await client
    .from("user_settings")
    .select("setting_value")
    .eq("user_id", userId)
    .eq("setting_key", PRODUCT_ONBOARDING_SETTING_KEY)
    .maybeSingle();

  if (error) throw error;
  const exists = Boolean(data);
  return {
    exists,
    state: resolveStoredOnboardingState({
      exists,
      value: data?.setting_value ?? null
    })
  };
}

export async function saveProductOnboardingState(state: ProductOnboardingState) {
  const client = requireSupabase();
  const userId = await currentUserId();
  const { error } = await client
    .from("user_settings")
    .upsert(
      {
        setting_key: PRODUCT_ONBOARDING_SETTING_KEY,
        setting_value: serializeProductOnboardingState(state),
        user_id: userId
      },
      { onConflict: "user_id,setting_key" }
    );

  if (error) throw error;
  return state;
}

export async function deleteProductOnboardingState() {
  const client = requireSupabase();
  const userId = await currentUserId();
  const { error } = await client
    .from("user_settings")
    .delete()
    .eq("user_id", userId)
    .eq("setting_key", PRODUCT_ONBOARDING_SETTING_KEY);

  if (error) throw error;
}
