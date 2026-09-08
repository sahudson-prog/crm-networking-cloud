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

export async function POST(request: NextRequest) {
  const config = readServerConfig();
  if (!config.ok) {
    return jsonError("server_not_configured", "No pudimos verificar Google.", 500);
  }

  const supabaseAccessToken = bearerToken(request.headers.get("authorization"));
  if (!supabaseAccessToken) {
    return jsonError("missing_session", "Necesitas iniciar sesion.", 401);
  }

  const providerToken = await readProviderToken(request);
  if (!providerToken) {
    return jsonError("missing_google_token", "No pudimos verificar Google.", 400);
  }

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
    return jsonError("finalize_failed", "No pudimos guardar la autorizacion Google.", 500);
  }

  return NextResponse.json({
    account,
    capabilities: verification.capabilities,
    effectiveScopes: verification.effectiveScopes
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

async function readProviderToken(request: NextRequest) {
  try {
    const body = await request.json();
    return typeof body?.providerToken === "string" ? body.providerToken.trim() : "";
  } catch {
    return "";
  }
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
