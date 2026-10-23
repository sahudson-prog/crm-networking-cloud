import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { parseAppAccessRpcResponse } from "../../../../../lib/appAccess";
import {
  verifyGoogleAuthorizationEvidence,
  type GoogleTokenInfo,
  type GoogleUserInfo
} from "../../../../../lib/googleConnectedAccountVerification";

const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleSyncOperation = "contacts" | "email" | "calendar";

const GOOGLE_OPERATION_CAPABILITIES: Record<GoogleSyncOperation, string> = {
  calendar: "interactions.sync_calendar",
  contacts: "contacts.sync_external",
  email: "interactions.sync_email"
};

const GOOGLE_OPERATION_SCOPES: Record<GoogleSyncOperation, string> = {
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  email: "https://www.googleapis.com/auth/gmail.readonly"
};

export async function POST(request: NextRequest) {
  const config = readServerConfig();
  if (!config.ok) {
    return jsonError("server_not_configured", "No pudimos verificar Google.", 500);
  }

  const supabaseAccessToken = bearerToken(request.headers.get("authorization"));
  if (!supabaseAccessToken) {
    return jsonError("missing_session", "Necesitas iniciar sesion.", 401);
  }

  const finalizeRequest = await readFinalizeRequest(request);
  if (!finalizeRequest) {
    return jsonError("missing_google_token", "No pudimos verificar Google.", 400);
  }
  const { providerToken, requestedOperations } = finalizeRequest;

  const userClient = createClient(config.supabaseUrl, config.supabasePublicKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${supabaseAccessToken}`
      }
    }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(supabaseAccessToken);
  const user = userData.user;
  if (userError || !user?.id || !user.email) {
    return jsonError("invalid_session", "Necesitas iniciar sesion.", 401);
  }

  const { data: accessData, error: accessError } = await userClient.rpc("current_user_app_access_status");
  if (accessError) {
    return jsonError("access_check_failed", "No pudimos verificar acceso.", 403);
  }
  const appAccess = parseAppAccessRpcResponse(accessData);
  if (appAccess.status !== "allowed") {
    return jsonError("access_denied", "No tienes acceso activo a Coffeecito.", 403);
  }

  const { data: rolloutAllowed, error: rolloutError } = await userClient.rpc(
    "current_user_can_start_connected_oauth_v1",
    { p_provider: "google" }
  );
  if (rolloutError || rolloutAllowed !== true) {
    return jsonError(
      "google_rollout_denied",
      "Tu cuenta no está habilitada para conectar datos de Google en esta etapa.",
      403
    );
  }

  for (const operation of requestedOperations) {
    const { data: operationAllowed, error: operationError } = await userClient.rpc(
      "current_user_has_capability",
      { p_capability_code: GOOGLE_OPERATION_CAPABILITIES[operation] }
    );
    if (operationError || operationAllowed !== true) {
      return jsonError(
        "google_operation_denied",
        "Esta integración de Google no está disponible para tu cuenta.",
        403
      );
    }
  }

  const googleEvidence = await readGoogleEvidence(providerToken);
  if (!googleEvidence.ok) {
    return jsonError("google_verification_failed", "No pudimos verificar Google.", 403);
  }

  const verification = verifyGoogleAuthorizationEvidence({
    expectedClientId: config.googleClientId,
    sessionEmail: user.email,
    tokenInfo: googleEvidence.tokenInfo,
    userInfo: googleEvidence.userInfo
  });
  if (verification.status === "error") {
    return jsonError(verification.code, verification.message, 403);
  }
  if (requestedOperations.some((operation) => (
    !verification.effectiveScopes.includes(GOOGLE_OPERATION_SCOPES[operation])
  ))) {
    return jsonError("google_scope_missing", "Google no confirmó el permiso solicitado.", 403);
  }

  const adminClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const { data: account, error: finalizeError } = await adminClient
    .rpc("finalize_google_connected_account_verified", {
      p_account_email: verification.accountEmail,
      p_effective_scopes: verification.effectiveScopes,
      p_user_id: user.id
    })
    .single();

  if (finalizeError) {
    const rolloutDenied = finalizeError.code === "42501"
      || String(finalizeError.message ?? "").includes("GOOGLE_CONNECTED_ACCOUNT_ROLLOUT_DENIED");
    return rolloutDenied
      ? jsonError("google_rollout_denied", "Tu cuenta no está habilitada para conectar datos de Google en esta etapa.", 403)
      : jsonError("finalize_failed", "No pudimos guardar la autorizacion Google.", 500);
  }
  if (!isFinalizedGoogleAccount(account)) {
    return jsonError("finalize_failed", "No pudimos guardar la autorizacion Google.", 500);
  }

  return NextResponse.json({
    account,
    capabilities: account.capabilities,
    effectiveScopes: account.scopes
  });
}

function readServerConfig():
  | {
      googleClientId: string;
      ok: true;
      supabasePublicKey: string;
      supabaseServiceRoleKey: string;
      supabaseUrl: string;
    }
  | { ok: false } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabasePublicKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";

  if (!supabaseUrl || !supabasePublicKey || !supabaseServiceRoleKey || !googleClientId) return { ok: false };
  return { googleClientId, ok: true, supabasePublicKey, supabaseServiceRoleKey, supabaseUrl };
}

function bearerToken(value: string | null) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim() ?? "";
}

async function readFinalizeRequest(request: NextRequest): Promise<{
  providerToken: string;
  requestedOperations: GoogleSyncOperation[];
} | null> {
  try {
    const body = await request.json();
    const providerToken = typeof body?.providerToken === "string" ? body.providerToken.trim() : "";
    const rawOperations: unknown[] = Array.isArray(body?.requestedOperations) ? body.requestedOperations : [];
    if (!rawOperations.length || !rawOperations.every(isGoogleSyncOperation)) return null;
    const requestedOperations = Array.from(new Set(rawOperations as GoogleSyncOperation[]));
    if (!providerToken || !requestedOperations.length) return null;
    return { providerToken, requestedOperations };
  } catch {
    return null;
  }
}

function isGoogleSyncOperation(value: unknown): value is GoogleSyncOperation {
  return value === "contacts" || value === "email" || value === "calendar";
}

function isFinalizedGoogleAccount(value: unknown): value is {
  capabilities: Record<string, unknown>;
  scopes: string[];
} {
  if (!value || typeof value !== "object") return false;
  const account = value as Record<string, unknown>;
  return Array.isArray(account.scopes)
    && account.scopes.every((scope) => typeof scope === "string")
    && Boolean(account.capabilities)
    && typeof account.capabilities === "object";
}

async function readGoogleEvidence(providerToken: string): Promise<
  | { ok: true; tokenInfo: GoogleTokenInfo; userInfo: GoogleUserInfo }
  | { ok: false }
> {
  const [tokenInfoResponse, userInfoResponse] = await Promise.all([
    fetch(`${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(providerToken)}`, {
      cache: "no-store"
    }),
    fetch(GOOGLE_USERINFO_URL, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${providerToken}`
      }
    })
  ]);

  if (!tokenInfoResponse.ok || !userInfoResponse.ok) return { ok: false };

  const [tokenInfo, userInfo] = await Promise.all([
    tokenInfoResponse.json().catch(() => null),
    userInfoResponse.json().catch(() => null)
  ]);
  if (!tokenInfo || !userInfo) return { ok: false };

  return { ok: true, tokenInfo: tokenInfo as GoogleTokenInfo, userInfo: userInfo as GoogleUserInfo };
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ code, message }, { status });
}
