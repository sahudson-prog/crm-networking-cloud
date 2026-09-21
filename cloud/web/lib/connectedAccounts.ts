import {
  canUseGoogleDataToken,
  currentGoogleProviderTokenFingerprint,
  finalizeRememberedGoogleDataConnection,
  readActiveGoogleDataTokenFingerprint,
  selectCurrentGoogleConnectedAccount
} from "./googleAuthSession";
import {
  hasGoogleDataCapability,
  type GoogleDataCapabilityKey
} from "./googleConnectedAccountVerification.ts";
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
  const providerToken = session?.provider_token ?? "";
  if (options.registerRememberedScopes) {
    await finalizeRememberedGoogleDataConnection(providerToken, session?.access_token ?? "");
  }

  const connectedAccounts = await readConnectedAccounts("google");
  const sessionEmail = session?.user.email ?? "";
  const account = selectCurrentGoogleConnectedAccount(connectedAccounts, sessionEmail);
  const currentProviderTokenFingerprint = await currentGoogleProviderTokenFingerprint(providerToken);
  const permissionActive = Boolean(account && canUseGoogleDataToken({
    accountEmail: account.accountEmail,
    activeDataTokenFingerprint: readActiveGoogleDataTokenFingerprint(),
    currentProviderTokenFingerprint,
    sessionEmail
  }));

  return {
    accessToken: permissionActive ? providerToken : "",
    account,
    connected: Boolean(account),
    permissionActive,
    userEmail: sessionEmail
  };
}

export async function disconnectConnectedAccount(accountId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error: updateError } = await supabase.rpc("disconnect_current_user_google_connected_account", {
    p_account_id: accountId
  });
  if (updateError) throw updateError;
}

export function googleConnectionHasCapability(
  googleConnection: GoogleConnectionState,
  capability: GoogleDataCapabilityKey
) {
  return Boolean(
    googleConnection.permissionActive &&
    hasGoogleDataCapability(googleConnection.account?.capabilities, capability)
  );
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
