import { normalizeEmail } from "./googleAuthLoginConfig.ts";

export const GOOGLE_CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const GOOGLE_GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_DATA_READONLY_SCOPES = [
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE
] as const;

export type GoogleDataCapabilityKey = "contacts_read" | "gmail_read" | "calendar_read";

export type GoogleDataCapabilities = Record<GoogleDataCapabilityKey, boolean>;

export type GoogleAuthorizationVerification =
  | {
      accountEmail: string;
      capabilities: GoogleDataCapabilities;
      effectiveScopes: string[];
      expiresInSeconds: number;
      googleSub: string;
      status: "ok";
    }
  | {
      code:
        | "audience_mismatch"
        | "email_mismatch"
        | "expired_token"
        | "missing_account_identity"
        | "missing_data_scopes"
        | "tokeninfo_invalid"
        | "userinfo_invalid";
      message: string;
      status: "error";
    };

export type GoogleTokenInfo = {
  aud?: unknown;
  audience?: unknown;
  azp?: unknown;
  exp?: unknown;
  expires_in?: unknown;
  scope?: unknown;
};

export type GoogleUserInfo = {
  email?: unknown;
  email_verified?: unknown;
  sub?: unknown;
};

export function effectiveGoogleDataScopesFromTokenScope(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  const granted = new Set(scope.split(/\s+/).map((item) => item.trim()).filter(Boolean));
  return GOOGLE_DATA_READONLY_SCOPES.filter((dataScope) => granted.has(dataScope));
}

export function googleDataCapabilitiesFromEffectiveScopes(scopes: string[]): GoogleDataCapabilities {
  const effective = new Set(scopes);
  return {
    calendar_read: effective.has(GOOGLE_CALENDAR_READONLY_SCOPE),
    contacts_read: effective.has(GOOGLE_CONTACTS_READONLY_SCOPE),
    gmail_read: effective.has(GOOGLE_GMAIL_READONLY_SCOPE)
  };
}

export function hasGoogleDataCapability(
  capabilities: Record<string, unknown> | null | undefined,
  capability: GoogleDataCapabilityKey
) {
  return capabilities?.[capability] === true;
}

export function verifyGoogleAuthorizationEvidence(input: {
  expectedClientId: string;
  sessionEmail: string;
  tokenInfo: GoogleTokenInfo;
  userInfo: GoogleUserInfo;
}): GoogleAuthorizationVerification {
  const expectedClientId = input.expectedClientId.trim();
  const tokenAudience = googleTokenAudience(input.tokenInfo);
  if (!expectedClientId || !tokenAudience.includes(expectedClientId)) {
    return error("audience_mismatch", "No pudimos verificar la autorizacion Google.");
  }

  const expiresInSeconds = googleTokenExpiresInSeconds(input.tokenInfo);
  if (expiresInSeconds <= 0) {
    return error("expired_token", "La autorizacion Google expiro. Autoriza acceso nuevamente.");
  }

  const googleSub = typeof input.userInfo.sub === "string" ? input.userInfo.sub.trim() : "";
  const googleEmail = typeof input.userInfo.email === "string" ? input.userInfo.email.trim() : "";
  if (!googleSub || !googleEmail || input.userInfo.email_verified !== true) {
    return error("missing_account_identity", "No pudimos verificar la cuenta Google.");
  }

  if (normalizeEmail(googleEmail) !== normalizeEmail(input.sessionEmail)) {
    return error("email_mismatch", "Usa la misma cuenta Google con la que entraste a Coffeecito.");
  }

  const effectiveScopes = effectiveGoogleDataScopesFromTokenScope(input.tokenInfo.scope);
  if (!effectiveScopes.length) {
    return error("missing_data_scopes", "Google no entrego permisos de datos para Coffeecito.");
  }

  return {
    accountEmail: googleEmail,
    capabilities: googleDataCapabilitiesFromEffectiveScopes(effectiveScopes),
    effectiveScopes,
    expiresInSeconds,
    googleSub,
    status: "ok"
  };
}

function googleTokenAudience(tokenInfo: GoogleTokenInfo): string[] {
  return [tokenInfo.aud, tokenInfo.azp, tokenInfo.audience]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function googleTokenExpiresInSeconds(tokenInfo: GoogleTokenInfo) {
  const expiresIn = numberFromUnknown(tokenInfo.expires_in);
  if (expiresIn !== null) return expiresIn;

  const exp = numberFromUnknown(tokenInfo.exp);
  if (exp === null) return 0;
  return Math.floor(exp - Date.now() / 1000);
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function error(code: Extract<GoogleAuthorizationVerification, { status: "error" }>["code"], message: string): GoogleAuthorizationVerification {
  return { code, message, status: "error" };
}
