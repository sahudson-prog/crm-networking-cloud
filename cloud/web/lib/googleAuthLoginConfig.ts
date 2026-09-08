export const GOOGLE_AUTH_LOGIN_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_DATA_CONNECTION_INTENT_PARAM = "google_oauth_intent";
export const GOOGLE_DATA_CONNECTION_INTENT_VALUE = "data_connection";
export const GOOGLE_DATA_CONNECTION_NONCE_PARAM = "google_oauth_nonce";

export function buildGoogleAuthLoginRequest(redirectTo = defaultAuthRedirectTo()) {
  return {
    provider: "google" as const,
    options: {
      redirectTo,
      scopes: GOOGLE_AUTH_LOGIN_SCOPES.join(" ")
    }
  };
}

export function buildGoogleDataConnectionRedirectTo(redirectTo: string, nonce: string) {
  const base = defaultUrlBase();
  const url = new URL(redirectTo || defaultAuthRedirectTo(), base);
  url.searchParams.set(GOOGLE_DATA_CONNECTION_INTENT_PARAM, GOOGLE_DATA_CONNECTION_INTENT_VALUE);
  url.searchParams.set(GOOGLE_DATA_CONNECTION_NONCE_PARAM, nonce);
  return url.toString();
}

export function readGoogleDataConnectionReturn(url: string) {
  const parsedUrl = new URL(url, defaultUrlBase());
  const intent = parsedUrl.searchParams.get(GOOGLE_DATA_CONNECTION_INTENT_PARAM);
  if (intent !== GOOGLE_DATA_CONNECTION_INTENT_VALUE) return { status: "none" as const, nonce: "" };

  const nonce = parsedUrl.searchParams.get(GOOGLE_DATA_CONNECTION_NONCE_PARAM) ?? "";
  const hasError = parsedUrl.searchParams.has("error")
    || parsedUrl.searchParams.has("error_code")
    || parsedUrl.searchParams.has("error_description");

  if (hasError || !nonce) return { status: "invalid" as const, nonce };
  return { status: "completed" as const, nonce };
}

export function canFinalizeGoogleDataConnection(input: {
  currentProviderTokenFingerprint: string;
  previousProviderTokenFingerprint: string;
  rememberedScopes: string[];
  returnNonce: string;
  returnStatus: "none" | "completed" | "invalid";
  storedNonce: string;
}) {
  return Boolean(
    input.returnStatus === "completed"
    && input.returnNonce
    && input.returnNonce === input.storedNonce
    && input.currentProviderTokenFingerprint
    && input.currentProviderTokenFingerprint !== input.previousProviderTokenFingerprint
    && input.rememberedScopes.length
  );
}

export function canUseGoogleDataToken(input: {
  accountEmail: string;
  activeDataTokenFingerprint: string;
  currentProviderTokenFingerprint: string;
  sessionEmail: string;
}) {
  return Boolean(
    normalizeEmail(input.accountEmail)
    && normalizeEmail(input.accountEmail) === normalizeEmail(input.sessionEmail)
    && input.currentProviderTokenFingerprint
    && input.currentProviderTokenFingerprint === input.activeDataTokenFingerprint
  );
}

export function selectCurrentGoogleConnectedAccount<T extends { accountEmail: string; provider: string; status: string }>(
  accounts: T[],
  sessionEmail: string
) {
  const normalizedSessionEmail = normalizeEmail(sessionEmail);
  if (!normalizedSessionEmail) return null;
  return accounts.find((account) => (
    account.provider === "google"
    && account.status === "active"
    && normalizeEmail(account.accountEmail) === normalizedSessionEmail
  )) ?? null;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function defaultAuthRedirectTo() {
  if (typeof window === "undefined") return "/";
  return window.location.origin;
}

function defaultUrlBase() {
  if (typeof window === "undefined") return "http://localhost";
  return window.location.origin;
}
