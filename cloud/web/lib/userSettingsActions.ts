import { supabase } from "./supabaseClient";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

export async function saveUserSetting(settingKey: string, settingValue: string) {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error("No pude identificar el usuario activo.");

  const { error } = await client
    .from("user_settings")
    .upsert(
      {
        setting_key: settingKey,
        setting_value: settingValue,
        user_id: userId
      },
      { onConflict: "user_id,setting_key" }
    );

  if (error) throw error;
  return { settingKey, settingValue };
}
