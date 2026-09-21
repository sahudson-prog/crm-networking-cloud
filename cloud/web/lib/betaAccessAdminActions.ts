import { supabase } from "./supabaseClient.ts";
import { requireCurrentUserCapability } from "./accessControl.ts";

export type BetaAccessRow = {
  accessAllowed: boolean | null;
  accessReason: string;
  accountStatus: string;
  allowlistStatus: "authorized" | "revoked" | "missing";
  authorizedAt: string | null;
  authProvider: string;
  betaAccessStatus: string;
  capabilities: string[];
  email: string;
  note: string;
  planCode: string;
  registered: boolean;
  revokedAt: string | null;
  roles: string[];
  userId: string;
};

type BetaAccessRpcRow = {
  access_allowed?: boolean | null;
  access_reason?: string | null;
  account_status?: string | null;
  allowlist_status?: string | null;
  authorized_at?: string | null;
  auth_provider?: string | null;
  beta_access_status?: string | null;
  capabilities?: string[] | null;
  email?: string | null;
  note?: string | null;
  plan_code?: string | null;
  registered?: boolean | null;
  revoked_at?: string | null;
  roles?: string[] | null;
  user_id?: string | null;
};

type BetaAccessDiagnosticRpcRow = Omit<BetaAccessRpcRow, "access_allowed" | "access_reason" | "registered"> & {
  allowed?: boolean | null;
  reason?: string | null;
};

export const BETA_ACCESS_DIAGNOSTIC_RPC = "admin_get_app_access_diagnostic";

export function normalizeAdminEmailInput(email: string) {
  return email.trim().toLowerCase();
}

export function betaAllowlistLabel(status: BetaAccessRow["allowlistStatus"]) {
  if (status === "authorized") return "Autorizado";
  if (status === "revoked") return "Revocado";
  return "Sin autorización";
}

export function betaRegistrationLabel(row: Pick<BetaAccessRow, "registered">) {
  return row.registered ? "Sí" : "No";
}

export function betaEffectiveAccessLabel(row: Pick<BetaAccessRow, "accessAllowed" | "accessReason">) {
  if (row.accessAllowed === true) return "Acceso permitido — allowed";
  if (row.accessAllowed === false) return `Acceso bloqueado — ${row.accessReason || "sin_detalle"}`;
  return "Sin usuario registrado";
}

export function mapBetaAccessRow(row: BetaAccessRpcRow): BetaAccessRow {
  return {
    accessAllowed: row.access_allowed ?? null,
    accessReason: row.access_reason ?? "",
    accountStatus: row.account_status ?? "",
    allowlistStatus: normalizeAllowlistStatus(row.allowlist_status),
    authorizedAt: row.authorized_at ?? null,
    authProvider: row.auth_provider ?? "",
    betaAccessStatus: row.beta_access_status ?? "",
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    email: row.email ?? "",
    note: row.note ?? "",
    planCode: row.plan_code ?? "",
    registered: row.registered === true,
    revokedAt: row.revoked_at ?? null,
    roles: Array.isArray(row.roles) ? row.roles : [],
    userId: row.user_id ?? ""
  };
}

export function mapBetaAccessDiagnosticRow(row: BetaAccessDiagnosticRpcRow): BetaAccessRow {
  return {
    ...mapBetaAccessRow({
      account_status: row.account_status,
      allowlist_status: row.allowlist_status,
      authorized_at: row.authorized_at,
      auth_provider: row.auth_provider,
      beta_access_status: row.beta_access_status,
      capabilities: row.capabilities,
      email: row.email,
      note: row.note,
      plan_code: row.plan_code,
      revoked_at: row.revoked_at,
      roles: row.roles,
      user_id: row.user_id,
      access_allowed: row.allowed,
      access_reason: row.reason
    }),
    registered: true
  };
}

export function mapBetaAccessDiagnosticResponse(data: unknown): BetaAccessRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapBetaAccessDiagnosticRow(row as BetaAccessDiagnosticRpcRow) : null;
}

export async function loadBetaAccessAllowlist(): Promise<BetaAccessRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar acceso beta");

  const { data, error } = await supabase.rpc("admin_list_app_access_allowlist");
  if (error) throw error;
  return ((data ?? []) as BetaAccessRpcRow[]).map(mapBetaAccessRow);
}

export async function authorizeBetaAccessEmail(email: string, note: string): Promise<BetaAccessRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar acceso beta");

  const normalizedEmail = normalizeAdminEmailInput(email);
  const { data, error } = await supabase.rpc("admin_authorize_app_access_email", {
    p_email: normalizedEmail,
    p_note: note.trim() || null
  });
  if (error) throw error;
  return ((data ?? []) as BetaAccessRpcRow[]).map(mapBetaAccessRow);
}

export async function revokeBetaAccessEmail(email: string): Promise<BetaAccessRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "administrar acceso beta");

  const { data, error } = await supabase.rpc("admin_revoke_app_access_email", {
    p_email: normalizeAdminEmailInput(email)
  });
  if (error) throw error;
  return ((data ?? []) as BetaAccessRpcRow[]).map(mapBetaAccessRow);
}

export async function loadBetaAccessDiagnostic(userId: string): Promise<BetaAccessRow | null> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  await requireCurrentUserCapability("admin.manage_access", "diagnosticar acceso beta");

  const { data, error } = await supabase.rpc(BETA_ACCESS_DIAGNOSTIC_RPC, {
    p_user_id: userId
  });
  if (error) throw error;
  return mapBetaAccessDiagnosticResponse(data);
}

function normalizeAllowlistStatus(status: string | null | undefined): BetaAccessRow["allowlistStatus"] {
  if (status === "authorized" || status === "revoked") return status;
  return "missing";
}
