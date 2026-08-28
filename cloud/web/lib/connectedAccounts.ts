import {
  clearRememberedGoogleRequestedScopes,
  normalizeGoogleScopeList,
  readRememberedGoogleRequestedScopes
} from "./googleAuthSession";
import { supabase } from "./supabaseClient";

export type ConnectedAccountProvider = "google" | "apple" | "microsoft";
export type ConnectedAccountStatus = "active" | "revoked" | "error" | "paused";

export type ConnectedAccountRecord = {
  accountEmail: string;
  capabilities: Record<string, unknown>;
  connectedAt: string;
  id: string;
  provider: ConnectedAccountProvider;
  revokedAt: string;
  scopes: string[];
  status: ConnectedAccountStatus;
  updatedAt: string;
};

export type GoogleConnectionState = {
  accessToken: string;
  account: ConnectedAccountRecord | null;
  connected: boolean;
  permissionActive: boolean;
  userEmail: string;
};

export async function readConnectedAccounts(provider?: ConnectedAccountProvider): Promise<ConnectedAccountRecord[]> {
  if (!supabase) return [];
  let request = supabase
    .from("connected_accounts")
    .select("id,provider,account_email,scopes,capabilities,status,connected_at,revoked_at,updated_at")
    .order("updated_at", { ascending: false });

  if (provider) request = request.eq("provider", provider);

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []).map(mapConnectedAccountRow);
}

export async function readCurrentGoogleConnectionState(options: { registerRememberedScopes?: boolean } = {}): Promise<GoogleConnectionState> {
  if (!supabase) return emptyGoogleConnectionState();

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  const rememberedScopes = options.registerRememberedScopes ? readRememberedGoogleRequestedScopes() : [];
  if (session?.provider_token && rememberedScopes.length) {
    await markCurrentGoogleSessionConnected(rememberedScopes);
    clearRememberedGoogleRequestedScopes();
  }

  const connectedAccounts = await readConnectedAccounts("google");
  const account = connectedAccounts.find((connectedAccount) => (
    connectedAccount.provider === "google" && connectedAccount.status === "active"
  )) ?? null;
  const accessToken = account ? session?.provider_token ?? "" : "";

  return {
    accessToken,
    account,
    connected: Boolean(account),
    permissionActive: Boolean(account && accessToken),
    userEmail: session?.user.email ?? ""
  };
}

export async function markCurrentGoogleSessionConnected(scopes: string[]): Promise<ConnectedAccountRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session?.user || !session.provider_token) return null;

  const accountEmail = session.user.email ?? "";
  const userId = session.user.id;
  const existing = await readLatestConnectedAccount("google", accountEmail);
  const combinedScopes = normalizeGoogleScopeList([
    ...(existing?.scopes ?? []),
    ...scopes
  ]);
  const payload = {
    account_email: accountEmail,
    capabilities: {
      contacts_read: combinedScopes.some((scope) => scope.includes("contacts")),
      calendar_read: combinedScopes.some((scope) => scope.includes("calendar")),
      gmail_read: combinedScopes.some((scope) => scope.includes("gmail"))
    },
    provider: "google",
    revoked_at: null,
    scopes: combinedScopes,
    status: "active",
    user_id: userId
  };

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from("connected_accounts")
      .update(payload)
      .eq("id", existing.id)
      .select("id,provider,account_email,scopes,capabilities,status,connected_at,revoked_at,updated_at")
      .single();
    if (updateError) throw updateError;
    return mapConnectedAccountRow(updated);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("connected_accounts")
    .insert(payload)
    .select("id,provider,account_email,scopes,capabilities,status,connected_at,revoked_at,updated_at")
    .single();
  if (insertError) throw insertError;
  return mapConnectedAccountRow(inserted);
}

export async function disconnectConnectedAccount(accountId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id;
  if (!userId) throw new Error("No hay sesion activa.");

  const { error: updateError } = await supabase
    .from("connected_accounts")
    .update({
      revoked_at: new Date().toISOString(),
      status: "revoked"
    })
    .eq("id", accountId)
    .eq("user_id", userId);
  if (updateError) throw updateError;
}

async function readLatestConnectedAccount(provider: ConnectedAccountProvider, accountEmail: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id,scopes")
    .eq("provider", provider)
    .eq("account_email", accountEmail)
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; scopes: string[] | null } | null;
}

function mapConnectedAccountRow(row: any): ConnectedAccountRecord {
  return {
    accountEmail: row.account_email ?? "",
    capabilities: row.capabilities ?? {},
    connectedAt: row.connected_at ?? "",
    id: row.id,
    provider: row.provider,
    revokedAt: row.revoked_at ?? "",
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    status: row.status ?? "error",
    updatedAt: row.updated_at ?? ""
  };
}

function emptyGoogleConnectionState(): GoogleConnectionState {
  return {
    accessToken: "",
    account: null,
    connected: false,
    permissionActive: false,
    userEmail: ""
  };
}
