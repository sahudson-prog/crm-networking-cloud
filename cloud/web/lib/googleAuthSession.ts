import { supabase } from "./supabaseClient";
import {
  buildGoogleAuthLoginRequest,
  buildGoogleDataConnectionRedirectTo,
  canFinalizeGoogleDataConnection,
  readGoogleDataConnectionReturn
} from "./googleAuthLoginConfig";
import type { GoogleDataCapabilities } from "./googleConnectedAccountVerification.ts";
import { clearAuthCallbackReturnTo, prepareAuthCallback } from "./authCallback";

export {
  buildGoogleAuthLoginRequest,
  buildGoogleDataConnectionRedirectTo,
  canFinalizeGoogleDataConnection,
  canUseGoogleDataToken,
  GOOGLE_AUTH_LOGIN_SCOPES,
  normalizeEmail,
  readGoogleDataConnectionReturn,
  selectCurrentGoogleConnectedAccount
} from "./googleAuthLoginConfig";

export type GoogleOAuthSession = {
  accessToken: string;
  userEmail: string;
};

export type FinalizedGoogleDataConnection = {
  capabilities: GoogleDataCapabilities;
  effectiveScopes: string[];
};

const GOOGLE_REQUESTED_SCOPES_STORAGE_KEY = "crm_networking_google_requested_scopes";
const GOOGLE_DATA_CONNECTION_INTENT_STORAGE_KEY = "crm_networking_google_data_connection_intent";
const GOOGLE_ACTIVE_DATA_TOKEN_FINGERPRINT_STORAGE_KEY = "crm_networking_google_active_data_token_fingerprint";
const GOOGLE_DATA_AUTHORIZATION_INVALIDATION_STORAGE_KEY = "crm_networking_google_data_authorization_invalidation";
const GOOGLE_DATA_CONNECTION_INTENT_TTL_MS = 10 * 60 * 1000;

type GoogleDataConnectionIntent = {
  createdAt: number;
  nonce: string;
  previousProviderTokenFingerprint: string;
  scopes: string[];
};

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
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const previousProviderTokenFingerprint = await fingerprintProviderToken(data.session?.provider_token ?? "");
  const nonce = createGoogleDataConnectionNonce();
  rememberGoogleDataConnectionIntent({
    createdAt: Date.now(),
    nonce,
    previousProviderTokenFingerprint,
    scopes: scopeList
  });
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: prepareAuthCallback(buildGoogleDataConnectionRedirectTo(
        redirectTo ?? `${window.location.origin}${window.location.pathname}${window.location.search}`,
        nonce
      )),
      scopes: scopeList.join(" ")
    }
  });
  if (error) {
    clearAuthCallbackReturnTo();
    clearPendingGoogleDataConnection();
    throw error;
  }
}

export async function signInWithGoogleForAuth(redirectTo?: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  clearRememberedGoogleRequestedScopes();
  const { error } = await supabase.auth.signInWithOAuth(
    buildGoogleAuthLoginRequest(prepareAuthCallback(redirectTo ?? window.location.origin))
  );
  if (error) {
    clearAuthCallbackReturnTo();
    throw error;
  }
}

export function clearRememberedGoogleRequestedScopes() {
  if (typeof window === "undefined") return;
  clearPendingGoogleDataConnection();
  invalidateActiveGoogleDataAuthorization();
}

export async function finalizeRememberedGoogleDataConnection(
  providerToken: string,
  supabaseAccessToken: string,
  finalizeImpl = finalizeGoogleDataConnectionOnServer
): Promise<FinalizedGoogleDataConnection | null> {
  if (typeof window === "undefined") return null;
  const intent = readRememberedGoogleDataConnectionIntent();
  if (!intent) {
    clearPendingGoogleDataConnection();
    return null;
  }

  const oauthReturn = readGoogleDataConnectionReturn(window.location.href);
  const intentExpired = isExpiredGoogleDataConnectionIntent(intent);
  if (oauthReturn.status === "none" && !intentExpired) return null;
  if (oauthReturn.status === "invalid" || intentExpired) {
    clearPendingGoogleDataConnection();
    return null;
  }

  const currentProviderTokenFingerprint = await fingerprintProviderToken(providerToken);
  const canFinalize = canFinalizeGoogleDataConnection({
    currentProviderTokenFingerprint,
    previousProviderTokenFingerprint: intent.previousProviderTokenFingerprint,
    rememberedScopes: intent.scopes,
    returnNonce: oauthReturn.nonce,
    returnStatus: oauthReturn.status,
    storedNonce: intent.nonce
  });

  if (!canFinalize || !providerToken || !supabaseAccessToken) return null;

  const invalidationGenerationBeforeFinalize = readGoogleDataAuthorizationInvalidationGeneration();
  const finalized = await finalizeImpl({
    providerToken,
    supabaseAccessToken
  });
  if (!finalized) {
    clearPendingGoogleDataConnection();
    return null;
  }
  if (readGoogleDataAuthorizationInvalidationGeneration() !== invalidationGenerationBeforeFinalize) {
    clearPendingGoogleDataConnection();
    return null;
  }

  rememberActiveGoogleDataTokenFingerprint(currentProviderTokenFingerprint);
  clearPendingGoogleDataConnection();
  return finalized;
}

export async function currentGoogleProviderTokenFingerprint(providerToken: string) {
  return fingerprintProviderToken(providerToken);
}

export function readActiveGoogleDataTokenFingerprint() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(GOOGLE_ACTIVE_DATA_TOKEN_FINGERPRINT_STORAGE_KEY) ?? "";
}

export function invalidateActiveGoogleDataAuthorization() {
  clearActiveGoogleDataTokenFingerprint();
  bumpGoogleDataAuthorizationInvalidationGeneration();
}

export function clearPendingGoogleDataConnection() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GOOGLE_REQUESTED_SCOPES_STORAGE_KEY);
  window.sessionStorage.removeItem(GOOGLE_DATA_CONNECTION_INTENT_STORAGE_KEY);
}

async function finalizeGoogleDataConnectionOnServer(input: {
  providerToken: string;
  supabaseAccessToken: string;
}): Promise<FinalizedGoogleDataConnection | null> {
  const response = await fetch("/api/google/connected-account/finalize", {
    body: JSON.stringify({ providerToken: input.providerToken }),
    headers: {
      Authorization: `Bearer ${input.supabaseAccessToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "No pudimos autorizar Google.";
    throw new Error(message);
  }
  const effectiveScopes = Array.isArray(body?.effectiveScopes)
    ? body.effectiveScopes.filter((scope: unknown): scope is string => typeof scope === "string")
    : [];
  const capabilities = isRecord(body?.capabilities)
    ? {
        calendar_read: body.capabilities.calendar_read === true,
        contacts_read: body.capabilities.contacts_read === true,
        gmail_read: body.capabilities.gmail_read === true
      }
    : null;
  if (!effectiveScopes.length || !capabilities) return null;
  return { capabilities, effectiveScopes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeGoogleScopeList(scopes: string | string[]) {
  const parts = Array.isArray(scopes) ? scopes : scopes.split(/\s+/);
  return Array.from(new Set(parts.map((scope) => scope.trim()).filter(Boolean)));
}

function rememberGoogleDataConnectionIntent(intent: GoogleDataConnectionIntent) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(GOOGLE_REQUESTED_SCOPES_STORAGE_KEY, JSON.stringify(intent.scopes));
  window.sessionStorage.setItem(GOOGLE_DATA_CONNECTION_INTENT_STORAGE_KEY, JSON.stringify(intent));
}

function rememberActiveGoogleDataTokenFingerprint(fingerprint: string) {
  if (typeof window === "undefined" || !fingerprint) return;
  window.sessionStorage.setItem(GOOGLE_ACTIVE_DATA_TOKEN_FINGERPRINT_STORAGE_KEY, fingerprint);
}

function clearActiveGoogleDataTokenFingerprint() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GOOGLE_ACTIVE_DATA_TOKEN_FINGERPRINT_STORAGE_KEY);
}

function readGoogleDataAuthorizationInvalidationGeneration() {
  if (typeof window === "undefined") return 0;
  const rawValue = window.sessionStorage.getItem(GOOGLE_DATA_AUTHORIZATION_INVALIDATION_STORAGE_KEY);
  const value = Number.parseInt(rawValue ?? "0", 10);
  return Number.isFinite(value) ? value : 0;
}

function bumpGoogleDataAuthorizationInvalidationGeneration() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    GOOGLE_DATA_AUTHORIZATION_INVALIDATION_STORAGE_KEY,
    String(readGoogleDataAuthorizationInvalidationGeneration() + 1)
  );
}

function readRememberedGoogleDataConnectionIntent(): GoogleDataConnectionIntent | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(GOOGLE_DATA_CONNECTION_INTENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const scopes = normalizeGoogleScopeList(Array.isArray(value?.scopes) ? value.scopes : []);
    const nonce = typeof value?.nonce === "string" ? value.nonce : "";
    const createdAt = typeof value?.createdAt === "number" ? value.createdAt : 0;
    const previousProviderTokenFingerprint = typeof value?.previousProviderTokenFingerprint === "string"
      ? value.previousProviderTokenFingerprint
      : "";
    if (!nonce || !createdAt || !scopes.length) return null;
    return { createdAt, nonce, previousProviderTokenFingerprint, scopes };
  } catch {
    return null;
  }
}

function isExpiredGoogleDataConnectionIntent(intent: GoogleDataConnectionIntent) {
  return Date.now() - intent.createdAt > GOOGLE_DATA_CONNECTION_INTENT_TTL_MS;
}

function createGoogleDataConnectionNonce() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fingerprintProviderToken(providerToken: string) {
  if (!providerToken) return "";
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(providerToken));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
