import type { InteractionRow, TodoRow } from "./readModel";

export type ParsedState = {
  Estado_CRM?: string;
  networking_status?: string;
};

export type ParsedEvidence = {
  regla?: string;
  motivo?: string;
  interacciones?: string[];
};

export function parseCoachState(value: string | null | undefined): ParsedState {
  return parseJson(value) as ParsedState;
}

export function parseCoachEvidence(value: string | null | undefined): ParsedEvidence {
  const parsed = parseJson(value) as ParsedEvidence;
  return {
    ...parsed,
    interacciones: Array.isArray(parsed.interacciones) ? parsed.interacciones.filter(isString) : []
  };
}

export function buildCoachSummary(todo: Pick<TodoRow, "todo_type" | "summary">, currentStatus: string, suggestedStatus: string) {
  if (currentStatus || suggestedStatus) {
    return { prefix: "Cambia el estado de" };
  }
  return { prefix: todo.summary || readableTodoType(todo.todo_type) };
}

export function buildCoachDetail(
  todo: Pick<TodoRow, "todo_type" | "reason">,
  evidence: ParsedEvidence,
  interaction?: Pick<InteractionRow, "interaction_type" | "occurred_at" | "subject">
) {
  const rule = evidence.regla ?? "";
  const subject = interaction?.subject?.trim() || "esta cita";
  const daysSince = formatDaysSince(interaction?.occurred_at);
  if (rule === "STATUS_MEETING_DONE_FROM_MINUTE") {
    return `La cita "${subject}" ya tiene minuta${daysSince}.`;
  }
  if (rule === "STATUS_MEETING_DONE_FROM_PAST_EVENT") {
    return `La cita "${subject}" paso${daysSince}.`;
  }
  if (rule === "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE") {
    const channel = interaction?.interaction_type === "message" ? "mensaje" : "correo";
    return `Se comunicaron por ${channel}${daysSince}.`;
  }
  return todo.reason || evidence.motivo || readableTodoType(todo.todo_type);
}

export function buildInteractionsByEvidenceId(interactions: InteractionRow[]) {
  const byId = new Map<string, InteractionRow>();
  for (const interaction of interactions) {
    byId.set(interaction.id, interaction);
    if (interaction.legacy_entry_id) byId.set(interaction.legacy_entry_id, interaction);
  }
  return byId;
}

export function findEvidenceInteraction<T extends Pick<InteractionRow, "id" | "legacy_entry_id">>(
  evidence: ParsedEvidence,
  interactionsByEvidenceId: Map<string, T>
) {
  for (const id of evidence.interacciones ?? []) {
    const interaction = interactionsByEvidenceId.get(id);
    if (interaction) return interaction;
  }
  return undefined;
}

export function shortContactName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || value;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

export function compactSummaryName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 3) return parts.join(" ") || value;
  return `${parts.slice(0, 3).join(" ")} ${parts[3].charAt(0)}.`;
}

export function formatCoachDate(value: string | null | undefined) {
  if (!value) return "Hoy";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Hoy";
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function readableTodoType(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDaysSince(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.max(0, Math.floor((todayStart - dateStart) / 86400000));
  return ` hace ${days} ${days === 1 ? "dia" : "dias"}`;
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
