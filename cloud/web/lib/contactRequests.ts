export const CONTACT_REQUEST_REASONS = ["support", "privacy", "problem", "other"] as const;
export const CONTACT_REQUEST_PRIVACY_SUBREASONS = [
  "access",
  "rectification",
  "erasure",
  "objection",
  "portability",
  "blocking",
  "other"
] as const;
export const CONTACT_REQUEST_STATUSES = ["received", "in_review", "waiting_user", "resolved", "closed"] as const;
export const CONTACT_REQUEST_IDENTITY_STATUSES = ["not_required", "pending", "verified", "rejected"] as const;

export type ContactRequestReason = (typeof CONTACT_REQUEST_REASONS)[number];
export type ContactRequestPrivacySubreason = (typeof CONTACT_REQUEST_PRIVACY_SUBREASONS)[number];
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];
export type ContactRequestIdentityStatus = (typeof CONTACT_REQUEST_IDENTITY_STATUSES)[number];

export type ContactRequestInput = {
  email: string;
  message: string;
  name?: string;
  privacySubreason?: string;
  reason: string;
};

export type ValidContactRequestInput = {
  email: string;
  message: string;
  name: string | null;
  privacySubreason: ContactRequestPrivacySubreason | null;
  reason: ContactRequestReason;
};

export type ContactRequestRow = {
  created_at: string;
  id: string;
  identity_verification_status: ContactRequestIdentityStatus;
  message: string;
  privacy_subreason: ContactRequestPrivacySubreason | null;
  reason: ContactRequestReason;
  requester_email: string;
  requester_name: string | null;
  status: ContactRequestStatus;
  updated_at: string;
  user_id: string | null;
};

export const CONTACT_REQUEST_REASON_LABELS: Record<ContactRequestReason, string> = {
  other: "Otro",
  privacy: "Privacidad y datos personales",
  problem: "Reportar un problema",
  support: "Consulta o soporte"
};

export const CONTACT_REQUEST_PRIVACY_SUBREASON_LABELS: Record<ContactRequestPrivacySubreason, string> = {
  access: "Acceso",
  blocking: "Bloqueo",
  erasure: "Supresión",
  objection: "Oposición",
  other: "Otro",
  portability: "Portabilidad",
  rectification: "Rectificación"
};

export const CONTACT_REQUEST_STATUS_LABELS: Record<ContactRequestStatus, string> = {
  closed: "Cerrada",
  in_review: "En revisión",
  received: "Recibida",
  resolved: "Resuelta",
  waiting_user: "Esperando al usuario"
};

export const CONTACT_REQUEST_IDENTITY_STATUS_LABELS: Record<ContactRequestIdentityStatus, string> = {
  not_required: "No aplica",
  pending: "Pendiente",
  rejected: "No verificada",
  verified: "Verificada"
};

export function validateContactRequestInput(input: unknown):
  | { ok: true; value: ValidContactRequestInput }
  | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { message: "Completa los campos obligatorios.", ok: false };
  }

  const candidate = input as Record<string, unknown>;
  const name = cleanString(candidate.name);
  const email = cleanString(candidate.email).toLowerCase();
  const reason = cleanString(candidate.reason);
  const privacySubreason = cleanString(candidate.privacySubreason);
  const message = cleanString(candidate.message);

  if (name.length > 120) return { message: "El nombre es demasiado largo.", ok: false };
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Ingresa un email válido.", ok: false };
  }
  if (!isOneOf(reason, CONTACT_REQUEST_REASONS)) {
    return { message: "Selecciona un motivo.", ok: false };
  }
  if (!message) return { message: "Escribe un mensaje.", ok: false };
  if (message.length > 5000) return { message: "El mensaje supera el máximo de 5.000 caracteres.", ok: false };

  if (reason === "privacy") {
    if (privacySubreason && !isOneOf(privacySubreason, CONTACT_REQUEST_PRIVACY_SUBREASONS)) {
      return { message: "Selecciona un submotivo válido.", ok: false };
    }
  } else if (privacySubreason) {
    return { message: "El submotivo solo corresponde a solicitudes de privacidad.", ok: false };
  }

  return {
    ok: true,
    value: {
      email,
      message,
      name: name || null,
      privacySubreason: reason === "privacy" && privacySubreason
        ? privacySubreason as ContactRequestPrivacySubreason
        : null,
      reason: reason as ContactRequestReason
    }
  };
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isOneOf<T extends string>(value: string, values: readonly T[]): value is T {
  return values.includes(value as T);
}
