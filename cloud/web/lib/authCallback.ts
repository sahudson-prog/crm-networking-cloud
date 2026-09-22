export const AUTH_CALLBACK_PATH = "/auth/callback";

const AUTH_CALLBACK_RETURN_TO_STORAGE_KEY = "coffeecito_auth_callback_return_to";
export const AUTH_CALLBACK_RETURN_TO_TTL_MS = 15 * 60 * 1000;
const SENSITIVE_AUTH_FRAGMENT_PATTERN = /(?:^|&)(?:access_token|refresh_token|provider_token|provider_refresh_token|error|error_code|error_description)=/i;

type AuthCallbackReturnTo = {
  createdAt: number;
  path: string;
};

export type AuthCodeExchangeClient = {
  exchangeCodeForSession(code: string): Promise<{
    data: { session: unknown | null };
    error: unknown | null;
  }>;
};

export type AuthCallbackFailureCategory =
  | "callback_missing_code"
  | "exchange_exception"
  | "exchange_rejected"
  | "oauth_error"
  | "pkce_verifier_missing"
  | "session_missing"
  | "supabase_not_configured";

export type AuthCallbackDiagnostic = {
  category: AuthCallbackFailureCategory;
  code?: string;
  name?: string;
  status?: number;
};

export type AuthCallbackExchangeResult =
  | { completed: true; diagnostic: null }
  | { completed: false; diagnostic: AuthCallbackDiagnostic };

export function buildAuthCallbackUrl(origin: string) {
  return new URL(AUTH_CALLBACK_PATH, origin).toString();
}

export function prepareAuthCallback(returnTo: string) {
  if (typeof window === "undefined") return AUTH_CALLBACK_PATH;
  const path = normalizeInternalReturnTo(returnTo, window.location.origin);
  const value: AuthCallbackReturnTo = { createdAt: Date.now(), path };
  window.sessionStorage.setItem(AUTH_CALLBACK_RETURN_TO_STORAGE_KEY, JSON.stringify(value));
  return buildAuthCallbackUrl(window.location.origin);
}

export function consumeAuthCallbackReturnTo(origin: string) {
  if (typeof window === "undefined") return "/";
  const rawValue = window.sessionStorage.getItem(AUTH_CALLBACK_RETURN_TO_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_CALLBACK_RETURN_TO_STORAGE_KEY);
  return resolveAuthCallbackReturnTo(rawValue, origin);
}

export function resolveAuthCallbackReturnTo(rawValue: string | null, origin: string, now = Date.now()) {
  if (!rawValue) return "/";

  try {
    const value = JSON.parse(rawValue) as Partial<AuthCallbackReturnTo>;
    if (
      typeof value.createdAt !== "number"
      || now - value.createdAt > AUTH_CALLBACK_RETURN_TO_TTL_MS
      || typeof value.path !== "string"
    ) {
      return "/";
    }
    return normalizeInternalReturnTo(value.path, origin);
  } catch {
    return "/";
  }
}

export function clearAuthCallbackReturnTo() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_CALLBACK_RETURN_TO_STORAGE_KEY);
}

export function readAuthCallback(url: string) {
  const parsedUrl = new URL(url);
  const oauthErrorCode = sanitizeDiagnosticToken(
    parsedUrl.searchParams.get("error") ?? parsedUrl.searchParams.get("error_code")
  );
  return {
    code: parsedUrl.searchParams.get("code") ?? "",
    hasError: parsedUrl.searchParams.has("error")
      || parsedUrl.searchParams.has("error_code")
      || parsedUrl.searchParams.has("error_description"),
    oauthErrorCode
  };
}

export function cleanAuthCallbackUrl(url: string) {
  const parsedUrl = new URL(url);
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

export function cleanLegacyImplicitAuthFragment(url: string) {
  const parsedUrl = new URL(url);
  const fragment = parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash;
  if (!fragment || !SENSITIVE_AUTH_FRAGMENT_PATTERN.test(fragment)) return null;
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

export async function exchangeAuthCallbackCode(code: string, client: AuthCodeExchangeClient) {
  if (!code) {
    return failure("callback_missing_code");
  }
  try {
    const { data, error } = await client.exchangeCodeForSession(code);
    if (error) {
      const metadata = safeErrorMetadata(error);
      const missingVerifier = metadata.code === "pkce_code_verifier_not_found"
        || metadata.name === "AuthPKCECodeVerifierMissingError";
      return failure(missingVerifier ? "pkce_verifier_missing" : "exchange_rejected", metadata);
    }
    if (!data.session) return failure("session_missing");
    return { completed: true, diagnostic: null } as const;
  } catch (error) {
    return failure("exchange_exception", safeErrorMetadata(error));
  }
}

export function prepareAuthCallbackExchange(url: string, client: AuthCodeExchangeClient | null) {
  const callback = readAuthCallback(url);
  const cleanedUrl = cleanAuthCallbackUrl(url);
  let completion: Promise<AuthCallbackExchangeResult>;
  if (callback.hasError) {
    completion = Promise.resolve(failure("oauth_error", { code: callback.oauthErrorCode }));
  } else if (!callback.code) {
    completion = Promise.resolve(failure("callback_missing_code"));
  } else if (!client) {
    completion = Promise.resolve(failure("supabase_not_configured"));
  } else {
    completion = exchangeAuthCallbackCode(callback.code, client);
  }
  return { cleanedUrl, completion };
}

export function createSingleAuthCallbackCompletion<T>(operation: () => Promise<T>) {
  let completion: Promise<T> | null = null;
  return () => {
    completion ??= operation();
    return completion;
  };
}

export function normalizeInternalReturnTo(returnTo: string, origin: string) {
  try {
    const baseUrl = new URL(origin);
    const returnUrl = new URL(returnTo || "/", baseUrl);
    if (returnUrl.origin !== baseUrl.origin) return "/";
    return `${returnUrl.pathname}${returnUrl.search}` || "/";
  } catch {
    return "/";
  }
}

function failure(
  category: AuthCallbackFailureCategory,
  metadata: Omit<AuthCallbackDiagnostic, "category"> = {}
): AuthCallbackExchangeResult {
  return { completed: false, diagnostic: { category, ...metadata } };
}

function safeErrorMetadata(error: unknown): Omit<AuthCallbackDiagnostic, "category"> {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  const code = sanitizeDiagnosticToken(value.code);
  const name = sanitizeDiagnosticToken(value.name);
  const status = typeof value.status === "number" && Number.isInteger(value.status)
    ? value.status
    : undefined;
  return {
    ...(code ? { code } : {}),
    ...(name ? { name } : {}),
    ...(status ? { status } : {})
  };
}

function sanitizeDiagnosticToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(normalized) ? normalized : undefined;
}
