import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { verifyContactRequestTurnstile } from "../../../lib/contactRequestServer";
import { validateContactRequestInput } from "../../../lib/contactRequests";

const MAX_REQUEST_BYTES = 12_000;

export async function POST(request: NextRequest) {
  const config = readServerConfig();
  if (!config.ok) {
    return jsonError("server_not_configured", "El formulario no está disponible en este momento.", 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonError("payload_too_large", "La solicitud es demasiado extensa.", 413);
  }

  const parsedBody = await readLimitedJson(request);
  if (parsedBody.status === "too_large") {
    return jsonError("payload_too_large", "La solicitud es demasiado extensa.", 413);
  }
  const body = parsedBody.status === "ok" ? parsedBody.value : null;
  const validation = validateContactRequestInput(body);
  if (!validation.ok) return jsonError("invalid_request", validation.message, 400);

  const turnstile = await verifyContactRequestTurnstile({
    secretKey: config.turnstileSecretKey,
    token: typeof body?.turnstileToken === "string" ? body.turnstileToken : ""
  });
  if (!turnstile.ok) {
    const unavailable = turnstile.code === "turnstile_not_configured" || turnstile.code === "turnstile_unavailable";
    return jsonError(
      turnstile.code,
      unavailable ? "No pudimos verificar la solicitud. Intenta nuevamente más tarde." : "Completa nuevamente la verificación.",
      unavailable ? 503 : 400
    );
  }

  const session = await readOptionalSessionUser(request, config.supabaseUrl, config.supabasePublicKey);
  if (!session.ok) return jsonError("invalid_session", "La sesión no es válida. Recarga e intenta nuevamente.", 401);

  const adminClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });
  const { data, error } = await adminClient.rpc("submit_contact_request_v1", {
    p_email: validation.value.email,
    p_message: validation.value.message,
    p_name: validation.value.name,
    p_privacy_subreason: validation.value.privacySubreason,
    p_reason: validation.value.reason,
    p_user_id: session.userId
  });
  if (error || typeof data !== "string") {
    return jsonError("submission_failed", "No pudimos guardar la solicitud. Intenta nuevamente.", 500);
  }

  return NextResponse.json({ id: data }, { status: 201 });
}

function readServerConfig():
  | { ok: true; supabasePublicKey: string; supabaseServiceRoleKey: string; supabaseUrl: string; turnstileSecretKey: string }
  | { ok: false } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabasePublicKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  ).trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !supabasePublicKey || !supabaseServiceRoleKey || !turnstileSecretKey) return { ok: false };
  return { ok: true, supabasePublicKey, supabaseServiceRoleKey, supabaseUrl, turnstileSecretKey };
}

async function readOptionalSessionUser(
  request: NextRequest,
  supabaseUrl: string,
  supabasePublicKey: string
): Promise<{ ok: true; userId: string | null } | { ok: false }> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: true, userId: null };

  const userClient = createClient(supabaseUrl, supabasePublicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await userClient.auth.getUser(token);
  return error || !data.user?.id ? { ok: false } : { ok: true, userId: data.user.id };
}

function bearerToken(value: string | null) {
  return /^Bearer\s+(.+)$/i.exec(value ?? "")?.[1]?.trim() ?? "";
}

async function readLimitedJson(request: NextRequest): Promise<
  | { status: "invalid" }
  | { status: "ok"; value: Record<string, unknown> }
  | { status: "too_large" }
> {
  if (!request.body) return { status: "invalid" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { status: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value)
      ? { status: "ok", value: value as Record<string, unknown> }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ code, message }, { status });
}
