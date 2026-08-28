import { supabase } from "./supabaseClient";

export type GoogleOAuthSession = {
  accessToken: string;
  userEmail: string;
};

const GOOGLE_REQUESTED_SCOPES_STORAGE_KEY = "crm_networking_google_requested_scopes";

export async function readGoogleOAuthSession(): Promise<GoogleOAuthSession> {
  if (!supabase) return { accessToken: "", userEmail: "" };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return {
    accessToken: data.session?.provider_token ?? "",
    userEmail: data.session?.user.email ?? ""
  };
}

export async function reconnectGoogle(scopes: string | string[], redirectTo?: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const scopeList = normalizeGoogleScopeList(scopes);
  rememberGoogleRequestedScopes(scopeList);
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo ?? `${window.location.origin}${window.location.pathname}${window.location.search}`,
      scopes: scopeList.join(" ")
    }
  });
}

export function rememberGoogleRequestedScopes(scopes: string | string[]) {
  if (typeof window === "undefined") return;
  const scopeList = normalizeGoogleScopeList(scopes);
  if (!scopeList.length) return;
  window.sessionStorage.setItem(GOOGLE_REQUESTED_SCOPES_STORAGE_KEY, JSON.stringify(scopeList));
}

export function readRememberedGoogleRequestedScopes() {
  if (typeof window === "undefined") return [];
  const raw = window.sessionStorage.getItem(GOOGLE_REQUESTED_SCOPES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return normalizeGoogleScopeList(Array.isArray(value) ? value : []);
  } catch {
    return [];
  }
}

export function clearRememberedGoogleRequestedScopes() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GOOGLE_REQUESTED_SCOPES_STORAGE_KEY);
}

export function normalizeGoogleScopeList(scopes: string | string[]) {
  const parts = Array.isArray(scopes) ? scopes : scopes.split(/\s+/);
  return Array.from(new Set(parts.map((scope) => scope.trim()).filter(Boolean)));
}
