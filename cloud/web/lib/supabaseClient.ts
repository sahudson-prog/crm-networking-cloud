"use client";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabasePublicKey
    ? "Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    : "";

export const supabaseProjectHost = safeHostname(supabaseUrl);

export const supabase =
  supabaseUrl && supabasePublicKey
    ? createClient(supabaseUrl, supabasePublicKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce",
          persistSession: true
        }
      })
    : null;

function safeHostname(value: string | undefined) {
  if (!value) return "not_configured";
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid_url";
  }
}
