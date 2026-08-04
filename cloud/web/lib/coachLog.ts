import type { InteractionRow } from "./readModel";
import { buildInteractionsByEvidenceId, parseCoachEvidence, parseCoachState } from "./coachText";
import { supabase } from "./supabaseClient.ts";

type RawTodoHistory = {
  id: string;
  todo_type: string;
  engine_type: "RULE" | "HYBRID" | "AI";
  status: "done" | "dismissed" | "expired" | "auto_resolved";
  object_type: string | null;
  object_id: string | null;
  current_state: string | null;
  suggested_state: string | null;
  summary: string;
  reason: string;
  evidence: string | null;
  dedup_key: string | null;
  supersedes_todo_id: string | null;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
};

type RawInteraction = {
  id: string;
  legacy_entry_id: string | null;
  interaction_type: "email" | "calendar" | "call" | "message" | "manual";
  occurred_at: string | null;
  subject: string | null;
};

type RawActionActor = {
  source_todo_id: string;
  actor_type: "user" | "rule" | "ai" | "system";
  status: string;
  created_at: string;
  executed_at: string | null;
};

export type CoachHistoryStatus = "done" | "dismissed" | "expired" | "auto_resolved";
export type CoachHistoryActor = "user" | "rule" | "ai" | "system";

export type CoachActionLogRow = {
  id: string;
  todoType: string;
  engineType: "RULE" | "HYBRID" | "AI";
  status: CoachHistoryStatus;
  actorType: CoachHistoryActor;
  contactId: string | null;
  contactName: string;
  currentStatus: string;
  suggestedStatus: string;
  summary: string;
  reason: string;
  ruleName: string;
  evidenceDetail: string;
  eventAt: string;
  createdAt: string;
  interaction?: InteractionRow;
};

export async function readCoachActionLog(input: { limit?: number; contactId?: string } = {}): Promise<CoachActionLogRow[]> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const limit = input.limit ?? 60;
  let query = supabase
    .from("todos")
    .select("id,todo_type,engine_type,status,object_type,object_id,current_state,suggested_state,summary,reason,evidence,dedup_key,supersedes_todo_id,created_at,resolved_at,updated_at")
    .eq("user_id", userId)
    .neq("status", "active")
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (input.contactId) {
    query = query.eq("object_id", input.contactId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const todos = (data ?? []) as RawTodoHistory[];
  const todoIds = todos.map((row) => row.id);
  const contactIds = Array.from(new Set(todos.map((row) => row.object_id).filter((id): id is string => Boolean(id))));
  const evidenceIds = Array.from(
    new Set(todos.flatMap((row) => parseCoachEvidence(row.evidence).interacciones ?? []).filter(Boolean))
  );

  const [contactsById, interactionsByEvidenceId, actorsByTodoId] = await Promise.all([
    readContactNames(contactIds, userId),
    readInteractionsByEvidenceIds(evidenceIds, userId),
    readActorsByTodoId(todoIds, userId)
  ]);

  return todos
    .map((row) => mapTodo(row, contactsById, interactionsByEvidenceId, actorsByTodoId))
    .sort((a, b) => timestamp(b.eventAt) - timestamp(a.eventAt));
}

async function readContactNames(contactIds: string[], userId: string) {
  if (!supabase || !contactIds.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from("contacts")
    .select("id,display_name")
    .eq("user_id", userId)
    .in("id", contactIds);
  if (error) throw error;
  return new Map(((data ?? []) as Array<{ id: string; display_name: string }>).map((row) => [row.id, row.display_name]));
}

async function readInteractionsByEvidenceIds(evidenceIds: string[], userId: string) {
  if (!supabase || !evidenceIds.length) return new Map<string, InteractionRow>();

  const uuidIds = evidenceIds.filter(isUuid);
  const queries = [];
  if (uuidIds.length) {
    queries.push(
      supabase
        .from("interactions")
        .select("id,legacy_entry_id,interaction_type,occurred_at,subject")
        .eq("user_id", userId)
        .in("id", uuidIds)
    );
  }
  queries.push(
    supabase
      .from("interactions")
      .select("id,legacy_entry_id,interaction_type,occurred_at,subject")
      .eq("user_id", userId)
      .in("legacy_entry_id", evidenceIds)
  );

  const results = await Promise.all(queries);
  const interactions: InteractionRow[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    interactions.push(...((result.data ?? []) as RawInteraction[]).map(mapInteraction));
  }
  return buildInteractionsByEvidenceId(interactions);
}

async function readActorsByTodoId(todoIds: string[], userId: string) {
  if (!supabase || !todoIds.length) return new Map<string, CoachHistoryActor>();
  const { data, error } = await supabase
    .from("action_invocations")
    .select("source_todo_id,actor_type,status,created_at,executed_at")
    .eq("user_id", userId)
    .in("source_todo_id", todoIds)
    .order("executed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const actorsByTodoId = new Map<string, CoachHistoryActor>();
  for (const row of (data ?? []) as RawActionActor[]) {
    if (!row.source_todo_id || actorsByTodoId.has(row.source_todo_id)) continue;
    actorsByTodoId.set(row.source_todo_id, row.actor_type);
  }
  return actorsByTodoId;
}

function mapTodo(
  row: RawTodoHistory,
  contactsById: Map<string, string>,
  interactionsByEvidenceId: Map<string, InteractionRow>,
  actorsByTodoId: Map<string, CoachHistoryActor>
): CoachActionLogRow {
  const current = parseCoachState(row.current_state);
  const suggested = parseCoachState(row.suggested_state);
  const evidence = parseCoachEvidence(row.evidence);
  const fallbackName = row.summary || "Contacto";
  const contactName = row.object_id ? contactsById.get(row.object_id) ?? fallbackName : fallbackName;
  const interaction = evidence.interacciones?.map((id) => interactionsByEvidenceId.get(id)).find(Boolean);
  const evidenceDetail = buildEvidenceDetail(evidence.motivo, interaction);

  return {
    id: row.id,
    todoType: row.todo_type,
    engineType: row.engine_type,
    status: row.status,
    actorType: actorsByTodoId.get(row.id) ?? fallbackActor(row.status),
    contactId: row.object_id,
    contactName,
    currentStatus: textValue(current.Estado_CRM || current.networking_status),
    suggestedStatus: textValue(suggested.Estado_CRM || suggested.networking_status),
    summary: row.summary || contactName,
    reason: row.reason,
    ruleName: textValue(evidence.regla),
    evidenceDetail,
    eventAt: row.resolved_at ?? row.updated_at ?? row.created_at,
    createdAt: row.created_at,
    interaction
  };
}

function fallbackActor(status: CoachHistoryStatus): CoachHistoryActor {
  if (status === "expired" || status === "auto_resolved") return "system";
  return "user";
}

function mapInteraction(row: RawInteraction): InteractionRow {
  return {
    id: row.id,
    legacy_entry_id: row.legacy_entry_id,
    interaction_type: row.interaction_type,
    direction: null,
    occurred_at: row.occurred_at,
    subject: row.subject
  };
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function buildEvidenceDetail(motive: string | undefined, interaction: InteractionRow | undefined) {
  if (interaction) {
    const subject = interaction.subject?.trim() || "sin asunto";
    const date = formatShortDate(interaction.occurred_at);
    return `${readableInteractionType(interaction.interaction_type)}: ${date} - ${subject}`;
  }
  return motive ?? "";
}

function readableInteractionType(value: InteractionRow["interaction_type"]) {
  if (value === "calendar") return "Cita";
  if (value === "email") return "Correo";
  if (value === "message") return "Mensaje";
  if (value === "call") return "Llamada";
  return "Interaccion";
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
