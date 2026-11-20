export type PublicRegistrationState = { enabled: boolean };
export type PublicRegistrationAdminState = PublicRegistrationState & { revision: number };
export type PublicRegistrationAvailability =
  | { status: "checking" | "unavailable"; enabled: false }
  | { status: "ready"; enabled: boolean };

export type PublicRegistrationClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
type CheckPermission = (capability: "admin.manage_access") => Promise<{
  allowed: boolean; status?: "allowed" | "denied" | "no_session" | "missing_model" | "error";
}>;

export type PublicRegistrationUncertainty = { revision: number; pending: { settled: boolean } };

class PublicRegistrationTimeout extends Error {
  readonly pending = { settled: false };
  constructor(request: Promise<unknown>) {
    super("public_registration_timeout");
    void request.then(() => { this.pending.settled = true; }, () => { this.pending.settled = true; });
  }
}

export class PublicRegistrationError extends Error {
  constructor(public readonly kind: "denied" | "unavailable") {
    super(kind === "denied"
      ? "No tienes permiso para administrar el registro libre."
      : "No pudimos confirmar el estado del registro libre.");
  }
}

function parseState(value: unknown): PublicRegistrationState {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof (value as PublicRegistrationState).enabled !== "boolean") {
    throw new PublicRegistrationError("unavailable");
  }
  return { enabled: (value as PublicRegistrationState).enabled };
}

function parseAdminState(value: unknown): PublicRegistrationAdminState {
  const state = parseState(value);
  const revision = (value as PublicRegistrationAdminState).revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new PublicRegistrationError("unavailable");
  return { ...state, revision };
}

async function rpc(client: PublicRegistrationClient, name: string, args: Record<string, unknown> | undefined, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve().then(() => client.rpc(name, args));
  try {
    const result = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PublicRegistrationTimeout(request)), timeoutMs);
      })
    ]);
    if (result.error) throw new PublicRegistrationError("unavailable");
    return result.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadPublicRegistrationStatus(
  client: PublicRegistrationClient | null, timeoutMs = 10000
): Promise<PublicRegistrationAvailability> {
  try {
    if (!client) throw new PublicRegistrationError("unavailable");
    return { status: "ready", ...parseState(await rpc(client, "public_registration_status_v1", undefined, timeoutMs)) };
  } catch {
    return { status: "unavailable", enabled: false };
  }
}

async function requirePermission(check: CheckPermission) {
  try {
    const permission = await check("admin.manage_access");
    if (!permission.allowed) throw new PublicRegistrationError(
      permission.status === "error" || permission.status === "missing_model" ? "unavailable" : "denied"
    );
  } catch (error) {
    if (error instanceof PublicRegistrationError) throw error;
    throw new PublicRegistrationError("unavailable");
  }
}

export async function loadPublicRegistrationAdminState(
  client: PublicRegistrationClient, check: CheckPermission, timeoutMs = 10000
): Promise<PublicRegistrationAdminState> {
  await requirePermission(check);
  return parseAdminState(await rpc(client, "admin_public_registration_state_v1", undefined, timeoutMs));
}

export type PublicRegistrationSaveResult = {
  outcome: "saved" | "reconciled" | "pending" | "unavailable" | "denied";
  state: PublicRegistrationAdminState | null;
  uncertainty?: PublicRegistrationUncertainty;
};

export async function reconcilePublicRegistration(
  client: PublicRegistrationClient, check: CheckPermission,
  uncertainty?: PublicRegistrationUncertainty, timeoutMs = 10000
): Promise<PublicRegistrationSaveResult> {
  // A read started before the write settles cannot establish its final result at the same revision.
  const settledBeforeRead = !uncertainty || uncertainty.pending.settled;
  try {
    const state = await loadPublicRegistrationAdminState(client, check, timeoutMs);
    if (uncertainty && !settledBeforeRead && state.revision <= uncertainty.revision) {
      return { outcome: "pending", state: null, uncertainty };
    }
    return { outcome: "reconciled", state };
  } catch (error) {
    return {
      outcome: error instanceof PublicRegistrationError && error.kind === "denied" ? "denied" : "unavailable",
      state: null, ...(uncertainty ? { uncertainty } : {})
    };
  }
}

export async function setPublicRegistration(
  client: PublicRegistrationClient, check: CheckPermission,
  current: PublicRegistrationAdminState, enabled: boolean, timeoutMs = 10000
): Promise<PublicRegistrationSaveResult> {
  try {
    parseAdminState(current);
    if (typeof enabled !== "boolean") throw new PublicRegistrationError("unavailable");
    await requirePermission(check);
  } catch (error) {
    return { outcome: error instanceof PublicRegistrationError && error.kind === "denied" ? "denied" : "unavailable", state: null };
  }
  try {
    const state = parseAdminState(await rpc(client, "admin_set_public_registration_v1", {
      p_enabled: enabled, p_expected_revision: current.revision
    }, timeoutMs));
    if (state.enabled !== enabled || state.revision <= current.revision) throw new PublicRegistrationError("unavailable");
    return { outcome: "saved", state };
  } catch (error) {
    // A failed response may hide a committed write. Never retry that write automatically.
    const uncertainty = error instanceof PublicRegistrationTimeout
      ? { revision: current.revision, pending: error.pending } : undefined;
    return reconcilePublicRegistration(client, check, uncertainty, timeoutMs);
  }
}

export function publicRegistrationLoginMessage(state: PublicRegistrationAvailability) {
  if (state.status === "checking") return "Consultando disponibilidad del registro. Si ya tienes acceso, puedes iniciar sesión.";
  if (state.status === "unavailable") return "No pudimos confirmar si el registro libre está disponible. Si ya tienes acceso, puedes iniciar sesión.";
  return state.enabled
    ? "El registro libre está disponible. Puedes crear tu cuenta o iniciar sesión si ya tienes acceso."
    : "El registro libre está cerrado. Si ya tienes acceso o una invitación vigente, puedes continuar.";
}
