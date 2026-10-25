export type Invitation = {
  id: string;
  email: string | null;
  status: "pending" | "registered";
  authorized_at: string;
  expires_at: string | null;
  registered_at: string | null;
};

export type InvitationState = {
  personal_limit: number;
  used_slots: number;
  available_slots: number;
  next_expiry_at: string | null;
  global_capacity: number;
  used_capacity: number;
  invitations_enabled: boolean;
  registrations_enabled: boolean;
  invitations: Invitation[];
};

export type InvitationAdminState = {
  invitations_enabled: boolean;
  registrations_enabled: boolean;
  global_capacity: number;
  pending_reservations: number;
  registered_users: number;
  used_capacity: number;
  available_capacity: number;
  updated_at: string;
};

export type InvitationRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message?: string; code?: string } | null;
  }>;
};

export class InvitationError extends Error {
  uncertain: boolean;
  denied: boolean;
  constructor(message: string, uncertain = false, denied = false) {
    super(message);
    this.uncertain = uncertain;
    this.denied = denied;
  }
}

const messages: Record<string, string> = {
  invalid_email: "Introduce un email válido.",
  cannot_invite_self: "No podemos autorizar este email.",
  invitation_email_blocked: "No podemos autorizar este email.",
  invitation_email_unavailable: "No podemos autorizar este email.",
  invitation_capability_required: "Las invitaciones no están disponibles para tu cuenta.",
  invitations_paused: "Estamos en pausa por ahora. Más adelante podrás volver a invitar.",
  personal_invitation_limit_reached: "No quedan cupos disponibles.",
  invitation_capacity_reached: "Estamos en pausa por ahora. Podrás volver a invitar cuando haya lugares.",
  admin_manage_access_required: "No tienes permiso para gestionar invitaciones.",
  invalid_global_capacity: "Revisa la capacidad indicada.",
  only_pending_invitations_can_be_cancelled: "Solo puedes cancelar invitaciones pendientes.",
  invitation_not_found: "No se encontró una invitación pendiente.",
  invitation_block_not_found: "No se encontró un bloqueo que puedas levantar.",
  cancellation_reason_required: "Indica el motivo de cancelación.",
  unblock_reason_required: "Indica la justificación del levantamiento."
};

export async function invitationRpc(client: InvitationRpcClient, name: string, args?: Record<string, unknown>, mutation = false) {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const known = messages[error.message ?? ""];
      throw new InvitationError(known ?? (mutation
        ? "No pudimos confirmar el resultado. Revisa el estado antes de intentar nuevamente."
        : "No pudimos cargar las invitaciones. Intenta nuevamente."), mutation && !known,
      error.message === "invitation_capability_required" || error.message === "admin_manage_access_required");
    }
    return data;
  } catch (error) {
    if (error instanceof InvitationError) throw error;
    throw new InvitationError(mutation
      ? "No pudimos confirmar el resultado. Revisa el estado antes de intentar nuevamente."
      : "No pudimos cargar las invitaciones. Intenta nuevamente.", mutation);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dateOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

export function parseInvitationState(value: unknown): InvitationState {
  if (!record(value)
    || !["personal_limit", "used_slots", "available_slots", "global_capacity", "used_capacity"].every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    || typeof value.invitations_enabled !== "boolean" || typeof value.registrations_enabled !== "boolean"
    || !dateOrNull(value.next_expiry_at) || !Array.isArray(value.invitations)
    || !value.invitations.every((row) => record(row) && typeof row.id === "string"
      && (row.email === null || typeof row.email === "string")
      && ["pending", "registered"].includes(String(row.status))
      && typeof row.authorized_at === "string" && dateOrNull(row.authorized_at)
      && dateOrNull(row.registered_at) && dateOrNull(row.expires_at)
      && (row.status !== "pending" || typeof row.expires_at === "string"))) {
    throw new InvitationError("No pudimos confirmar el estado de las invitaciones.");
  }
  return value as InvitationState;
}

export async function loadInvitations(client: InvitationRpcClient): Promise<InvitationState> {
  return parseInvitationState(await invitationRpc(client, "current_user_invitation_state_v1"));
}

export function parseInvitationAdminState(value: unknown): InvitationAdminState {
  const countKeys = [
    "global_capacity", "pending_reservations", "registered_users",
    "used_capacity", "available_capacity"
  ];
  const expectedKeys = [
    "available_capacity", "global_capacity", "invitations_enabled",
    "pending_reservations", "registered_users", "registrations_enabled",
    "updated_at", "used_capacity"
  ];
  if (!record(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
    || !countKeys.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    || typeof value.invitations_enabled !== "boolean"
    || typeof value.registrations_enabled !== "boolean"
    || typeof value.updated_at !== "string"
    || !Number.isFinite(Date.parse(value.updated_at))
    || value.used_capacity !== (value.pending_reservations as number) + (value.registered_users as number)
    || value.available_capacity !== Math.max(0, (value.global_capacity as number) - (value.used_capacity as number))) {
    throw new InvitationError("No pudimos confirmar el estado administrativo de las invitaciones.");
  }
  return value as InvitationAdminState;
}

export async function loadInvitationAdminState(client: InvitationRpcClient): Promise<InvitationAdminState> {
  return parseInvitationAdminState(await invitationRpc(client, "admin_invitation_program_state_v1"));
}

export async function authorizeInvitation(client: InvitationRpcClient, email: string) {
  const data = await invitationRpc(client, "authorize_current_user_invitation_v1", { p_email: email.trim().toLowerCase() }, true);
  try {
    const state = parseInvitationState(data);
    if (!record(data) || !["authorized", "existing"].includes(String(data.result))) throw new Error();
    const invitation = state.invitations.find((row) => row.id === data.invitation_id);
    if (!invitation || invitation.status !== "pending" || !invitation.email) throw new Error();
    return { state, invitation, existing: data.result === "existing" };
  } catch {
    throw new InvitationError("No pudimos confirmar el resultado. Revisa el estado antes de intentar nuevamente.", true);
  }
}

export function invitationRestriction(state: InvitationState): string {
  if (!state.invitations_enabled) return messages.invitations_paused;
  if (state.used_capacity >= state.global_capacity) return messages.invitation_capacity_reached;
  if (state.available_slots === 0) return state.next_expiry_at
    ? "No quedan cupos. Podrías recuperar uno cuando venza una invitación pendiente."
    : "No quedan cupos disponibles.";
  if (!state.registrations_enabled) return "Estamos en pausa por ahora. Puedes autorizar invitaciones; los registros deberán esperar.";
  return "";
}

export function canAuthorizeInvitation(state: InvitationState) {
  return state.invitations_enabled && state.available_slots > 0 && state.used_capacity < state.global_capacity;
}

export function invitationExpiryLabel(expires: string, now = Date.now()) {
  const minutes = Math.ceil((Date.parse(expires) - now) / 60000);
  if (minutes <= 0) return "Vencimiento alcanzado · actualizar";
  if (minutes < 60) return `vence en ${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `vence en ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `vence en ${days} ${days === 1 ? "día" : "días"}`;
}

export function invitationShareData(origin: string) {
  const url = new URL("/", origin).href;
  return { title: "Te invito a Coffeecito", text: "Te invito a Coffeecito. Ingresa con Google usando el email de tu invitación.", url };
}

export function invitationShareLinks(email: string, origin: string) {
  const data = invitationShareData(origin);
  const body = `${data.text}\n${data.url}`;
  return {
    mail: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(data.title)}&body=${encodeURIComponent(body)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(body)}`,
    url: data.url
  };
}

// Called directly from a fresh click, never after awaiting authorization.
export async function shareInvitationNatively(nav: Pick<Navigator, "share" | "canShare" | "userActivation">, origin: string) {
  const data = invitationShareData(origin);
  if (!nav.share || nav.userActivation?.isActive === false) return "fallback" as const;
  try {
    if (nav.canShare && !nav.canShare(data)) return "fallback" as const;
    await nav.share(data);
    return "shared" as const;
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "cancelled" as const : "fallback" as const;
  }
}
