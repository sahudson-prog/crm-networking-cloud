import { readTodoConfigs, todoConfigCanAutoApply, type TodoConfigRow } from "./coachConfig.ts";
import { executeCoachTodo } from "./coachActions.ts";
import { readHeadhunterCompanyMaster } from "./headhunterCompanyActions.ts";
import {
  normalizeHeadhunterCompanyName,
  resolveHeadhunterCompany,
  type HeadhunterCompanyMasterRow
} from "./headhunterCompanyMaster.ts";
import { activeInteractions } from "./interactionState.ts";
import type { ContactRow, InteractionParticipantRow, InteractionRow } from "./readModel.ts";
import { supabase } from "./supabaseClient.ts";

type RuleId =
  | "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE"
  | "STATUS_MEETING_DONE_FROM_MINUTE"
  | "STATUS_MEETING_DONE_FROM_PAST_EVENT"
  | "STATUS_SCHEDULED_FROM_FUTURE_EVENT"
  | "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE"
  | "HEADHUNTER_COMPANY_DETECTED";

type RuleCandidate = {
  ruleId: RuleId;
  configType: string;
  processorId: string;
  todoType: string;
  contact: ContactReviewRow;
  currentStatus: string;
  suggestedStatus: string;
  currentState: Record<string, string>;
  suggestedState: Record<string, string>;
  evidenceIds: string[];
  evidenceExtra?: Record<string, unknown>;
  reason: string;
  priority: number;
  action: {
    action: string;
    label: string;
    input: Record<string, unknown>;
  };
  sourceFingerprint: string;
  dedupKey: string;
};

type ContactReviewRow = Pick<
  ContactRow,
  | "id"
  | "display_name"
  | "company"
  | "networking_status"
  | "networking_focus"
  | "is_headhunter"
  | "headhunter_domains"
  | "is_active"
  | "updated_at"
  | "contact_emails"
>;

type InteractionReviewRow = InteractionRow & {
  updated_at: string | null;
};

type ActiveTodoReviewRow = {
  id: string;
  todo_type: string;
  engine_type: "RULE" | "HYBRID" | "AI";
  status: string;
  object_type: string | null;
  object_id: string | null;
  current_state: string | null;
  suggested_state: string | null;
  evidence: string | null;
  dedup_key: string | null;
  source_fingerprint: string | null;
};

export type CoachRuleReviewResult = {
  created: number;
  kept: number;
  closed: number;
  skipped: number;
  autoExecutable: number;
  autoExecuted: number;
  errors: string[];
};

export type CoachRuleReviewInput = {
  contactIds?: string[];
  source?: string;
};

const STATUS_PROCESSOR_ID = "NETWORKING_STATUS_RULES_V0_1";
const HEADHUNTER_COMPANY_PROCESSOR_ID = "HEADHUNTER_COMPANY_RULES_V0_1";
const MAX_ROWS = 3000;

const RULE_TO_CONFIG: Record<RuleId, string> = {
  STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE: "RULE_STATUS_TO_CONTACTED",
  STATUS_SCHEDULED_FROM_FUTURE_EVENT: "RULE_STATUS_TO_SCHEDULED",
  STATUS_MEETING_DONE_FROM_PAST_EVENT: "RULE_STATUS_TO_MEETING_DONE",
  STATUS_MEETING_DONE_FROM_MINUTE: "RULE_STATUS_TO_MEETING_DONE",
  STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE: "RULE_STATUS_TO_THANK_YOU",
  HEADHUNTER_COMPANY_DETECTED: "HEADHUNTER_COMPANY_DETECTED"
};

const RULE_PRIORITY: Record<RuleId, number> = {
  STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE: 10,
  STATUS_MEETING_DONE_FROM_MINUTE: 20,
  STATUS_MEETING_DONE_FROM_PAST_EVENT: 30,
  STATUS_SCHEDULED_FROM_FUTURE_EVENT: 40,
  STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE: 50,
  HEADHUNTER_COMPANY_DETECTED: 60
};

const STATUS_RANK = new Map([
  ["Pendiente", 1],
  ["Contactado", 2],
  ["Agendado", 3],
  ["Cita concretada", 4],
  ["Agradecimiento enviado", 5]
]);

export async function reviewNetworkingStatusSuggestions(input: CoachRuleReviewInput = {}): Promise<CoachRuleReviewResult> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const contactIds = normalizeContactIds(input.contactIds);
  const [contacts, participants, activeTodos, configs, headhunterMaster] = await Promise.all([
    readContactsForRuleReview(contactIds),
    readParticipantsForRuleReview(contactIds),
    readActiveRuleTodos(contactIds),
    readTodoConfigs(),
    readHeadhunterCompanyMaster()
  ]);
  const scopedInteractionIds = contactIds ? unique(participants.map((participant) => participant.interaction_id)) : undefined;
  const interactions = await readInteractionsForRuleReview(scopedInteractionIds);

  const now = new Date();
  const configByType = new Map(configs.map((config) => [config.todo_type, config]));
  const interactionsByContact = groupInteractionsByContact(interactions, participants);
  const candidates = [
    ...contacts
      .map((contact) => choosePreferredCandidate(contact, interactionsByContact.get(contact.id) ?? [], now))
      .filter((candidate): candidate is RuleCandidate => Boolean(candidate)),
    ...contacts
      .map((contact) => chooseHeadhunterCompanyCandidate(contact, headhunterMaster))
      .filter((candidate): candidate is RuleCandidate => Boolean(candidate))
  ].filter((candidate) => configAllowsSuggestion(configByType.get(candidate.configType)));

  const candidateByObjectAndType = new Map(
    candidates.map((candidate) => [candidateKey(candidate.contact.id, candidate.todoType), candidate])
  );
  const candidateDedupKeys = candidates.map((candidate) => candidate.dedupKey);
  const candidateDedupSet = new Set(candidateDedupKeys);
  const existingTodosByDedup = await readTodosByDedupKeys(candidateDedupKeys);

  const result: CoachRuleReviewResult = {
    created: 0,
    kept: 0,
    closed: 0,
    skipped: 0,
    autoExecutable: 0,
    autoExecuted: 0,
    errors: []
  };

  const activeTodosById = new Map(activeTodos.map((todo) => [todo.id, todo]));

  for (const todo of activeTodos) {
    if (todo.object_type !== "contact" || !todo.object_id) continue;
    const candidate = candidateByObjectAndType.get(candidateKey(todo.object_id, todo.todo_type));
    if (todo.dedup_key && candidateDedupSet.has(todo.dedup_key)) continue;

    try {
      const contact = contacts.find((row) => row.id === todo.object_id);
      const closeStatus = shouldCloseAsAutoResolved(todo, contact) ? "auto_resolved" : "expired";
      const closeReason = candidate
        ? "Cerrada por revision de reglas: existe una sugerencia de mayor prelacion."
        : "Cerrada por revision de reglas: la condicion booleana ya no se cumple.";
      const { error } = await supabase
        .from("todos")
        .update({
          status: closeStatus,
          resolved_at: now.toISOString(),
          reason: closeReason
        })
        .eq("id", todo.id)
        .eq("user_id", userId);
      if (error) throw error;
      result.closed += 1;
    } catch (error) {
      result.errors.push(readError(error));
    }
  }

  for (const candidate of candidates) {
    const existing = existingTodosByDedup.get(candidate.dedupKey);
    const config = configByType.get(candidate.configType);
    const shouldAutoExecute = Boolean(
      config && todoConfigCanAutoApply(config) && config.user_mode === "execute_without_asking"
    );
    if (shouldAutoExecute) result.autoExecutable += 1;

    try {
      if (existing?.status === "done" || existing?.status === "dismissed") {
        result.skipped += 1;
        await upsertReviewState(userId, candidate, now, "skipped_closed_todo_exists");
        continue;
      }

      const payload = todoPayload(userId, candidate);
      let todoForAction: ActiveTodoReviewRow | null = null;
      if (existing?.id) {
        const { data, error } = await supabase
          .from("todos")
          .update({
            ...payload,
            supersedes_todo_id:
              activeTodos.find(
                (todo) => todo.object_id === candidate.contact.id && todo.todo_type === candidate.todoType && todo.id !== existing.id
              )?.id ?? null
          })
          .eq("id", existing.id)
          .eq("user_id", userId)
          .select("id,todo_type,engine_type,status,object_type,object_id,current_state,suggested_state,evidence,dedup_key,source_fingerprint")
          .single();
        if (error) throw error;
        todoForAction = data as ActiveTodoReviewRow;
        result.kept += existing.status === "active" ? 1 : 0;
        result.created += existing.status === "active" ? 0 : 1;
      } else {
        const { data, error } = await supabase
          .from("todos")
          .insert({
            ...payload,
            supersedes_todo_id:
              activeTodos.find(
                (todo) =>
                  todo.object_id === candidate.contact.id &&
                  todo.todo_type === candidate.todoType &&
                  todo.dedup_key !== candidate.dedupKey
              )?.id ?? null
          })
          .select("id,todo_type,engine_type,status,object_type,object_id,current_state,suggested_state,evidence,dedup_key,source_fingerprint")
          .single();
        if (error) throw error;
        todoForAction = data as ActiveTodoReviewRow;
        result.created += 1;
      }
      await upsertReviewState(userId, candidate, now, "reviewed");
      if (shouldAutoExecute && todoForAction) {
        const actionResult = await executeCoachTodo({
          todo: {
            id: todoForAction.id,
            todo_type: todoForAction.todo_type,
            engine_type: todoForAction.engine_type,
            status: todoForAction.status,
            summary: candidate.contact.display_name,
            reason: candidate.reason,
            created_at: now.toISOString(),
            object_type: todoForAction.object_type,
            object_id: todoForAction.object_id,
            current_state: todoForAction.current_state,
            suggested_state: todoForAction.suggested_state,
            evidence: todoForAction.evidence
          },
          userId,
          actorType: "rule",
          requiresConfirmation: false
        });
        if (actionResult === "executed") result.autoExecuted += 1;
      }
    } catch (error) {
      result.errors.push(readError(error));
    }
  }

  for (const todo of activeTodosById.values()) {
    const candidate = todo.object_id ? candidateByObjectAndType.get(candidateKey(todo.object_id, todo.todo_type)) : null;
    if (!candidate || todo.dedup_key !== candidate.dedupKey) continue;
    if (todo.source_fingerprint === candidate.sourceFingerprint) {
      await upsertReviewState(userId, candidate, now, "reviewed_without_changes");
    }
  }

  return result;
}

export function evaluateNetworkingStatusCandidate(
  contact: ContactReviewRow,
  interactions: InteractionReviewRow[],
  now = new Date()
) {
  return choosePreferredCandidate(contact, interactions, now);
}

export function evaluateHeadhunterCompanyCandidate(
  contact: ContactReviewRow,
  masterRows: HeadhunterCompanyMasterRow[]
) {
  return chooseHeadhunterCompanyCandidate(contact, masterRows);
}

function choosePreferredCandidate(
  contact: ContactReviewRow,
  interactions: InteractionReviewRow[],
  now: Date
): RuleCandidate | null {
  if (!contact.id || !contact.is_active || !contact.networking_focus) return null;

  const currentStatus = normalizeStatus(contact.networking_status);
  const pastMeetings = interactions
    .filter((interaction) => isCalendarInteraction(interaction) && isAtOrBefore(interaction.occurred_at, now))
    .sort(descendingOccurredAt);
  const futureMeetings = interactions
    .filter((interaction) => isCalendarInteraction(interaction) && isAfter(interaction.occurred_at, now))
    .sort(ascendingOccurredAt);
  const outboundMessages = interactions
    .filter((interaction) => isOutboundMessage(interaction))
    .sort(descendingOccurredAt);

  const latestPastMeeting = pastMeetings[0];
  const outboundAfterPastMeeting = latestPastMeeting
    ? outboundMessages.filter((interaction) => timestamp(interaction.occurred_at) >= timestamp(latestPastMeeting.occurred_at))
    : [];

  const options: Array<{
    ruleId: Exclude<RuleId, "HEADHUNTER_COMPANY_DETECTED">;
    suggestedStatus: string;
    evidenceIds: string[];
    reason: string;
  }> = [];

  if (
    rank(currentStatus) >= rank("Cita concretada") &&
    rank(currentStatus) < rank("Agradecimiento enviado") &&
    latestPastMeeting &&
    outboundAfterPastMeeting.length
  ) {
    options.push({
      ruleId: "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE",
      suggestedStatus: "Agradecimiento enviado",
      evidenceIds: [latestPastMeeting.id, ...outboundAfterPastMeeting.slice(0, 3).map((interaction) => interaction.id)],
      reason: "Hay un mensaje posterior a una cita concretada."
    });
  }

  const pastMeetingsWithMinute = pastMeetings.filter((interaction) => Boolean(interaction.user_notes_raw?.trim()));
  if (rank(currentStatus) < rank("Cita concretada") && pastMeetingsWithMinute.length) {
    options.push({
      ruleId: "STATUS_MEETING_DONE_FROM_MINUTE",
      suggestedStatus: "Cita concretada",
      evidenceIds: pastMeetingsWithMinute.slice(0, 3).map((interaction) => interaction.id),
      reason: "Hay una cita pasada con minuta cargada."
    });
  }

  if (rank(currentStatus) < rank("Cita concretada") && pastMeetings.length) {
    options.push({
      ruleId: "STATUS_MEETING_DONE_FROM_PAST_EVENT",
      suggestedStatus: "Cita concretada",
      evidenceIds: pastMeetings.slice(0, 3).map((interaction) => interaction.id),
      reason: "Hay una cita de calendario cuya fecha ya paso."
    });
  }

  if (rank(currentStatus) < rank("Agendado") && futureMeetings.length) {
    options.push({
      ruleId: "STATUS_SCHEDULED_FROM_FUTURE_EVENT",
      suggestedStatus: "Agendado",
      evidenceIds: futureMeetings.slice(0, 3).map((interaction) => interaction.id),
      reason: "Hay una cita futura con el contacto."
    });
  }

  if (rank(currentStatus) < rank("Contactado") && outboundMessages.length) {
    options.push({
      ruleId: "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE",
      suggestedStatus: "Contactado",
      evidenceIds: outboundMessages.slice(0, 3).map((interaction) => interaction.id),
      reason: "Hay un correo o mensaje saliente hacia el contacto."
    });
  }

  const selected = options.sort((a, b) => RULE_PRIORITY[a.ruleId] - RULE_PRIORITY[b.ruleId])[0];
  if (!selected) return null;

  const configType = RULE_TO_CONFIG[selected.ruleId];
  const dedupKey = `NETWORKING_STATUS_CHANGE|${selected.ruleId}|${contact.id}|${selected.suggestedStatus}`;
  const fingerprint = JSON.stringify({
    contact: contact.updated_at,
    currentStatus,
    rule: selected.ruleId,
    suggestedStatus: selected.suggestedStatus,
    evidence: selected.evidenceIds,
    evidenceUpdatedAt: maxUpdatedAt(interactions.filter((interaction) => selected.evidenceIds.includes(interaction.id))),
    today: now.toISOString().slice(0, 10)
  });

  return {
    ...selected,
    contact,
    currentStatus,
    configType,
    processorId: STATUS_PROCESSOR_ID,
    todoType: "NETWORKING_STATUS_CHANGE",
    currentState: { Estado_CRM: currentStatus },
    suggestedState: { Estado_CRM: selected.suggestedStatus },
    action: {
      action: "contact.update_networking_status",
      label: "Cambiar estado",
      input: {
        contact_id: contact.id,
        from: currentStatus,
        to: selected.suggestedStatus
      }
    },
    priority: 2,
    sourceFingerprint: fingerprint,
    dedupKey
  };
}

function chooseHeadhunterCompanyCandidate(
  contact: ContactReviewRow,
  masterRows: HeadhunterCompanyMasterRow[]
): RuleCandidate | null {
  if (!contact.id || !contact.is_active || !contact.is_headhunter) return null;
  const currentCompany = contact.company?.trim() ?? "";
  if (currentCompany) return null;

  const resolution = resolveHeadhunterCompany(contact, masterRows);
  if (resolution.status !== "matched_domain") return null;

  const suggestedCompany = resolution.suggestedCompany.trim();
  if (!suggestedCompany) return null;

  const domain = resolution.domain || "";
  const dedupKey = `HEADHUNTER_COMPANY_DETECTED|${contact.id}|${resolution.company.id}|${domain}`;
  const fingerprint = JSON.stringify({
    contact: contact.updated_at,
    rule: "HEADHUNTER_COMPANY_DETECTED",
    currentCompany,
    suggestedCompany,
    companyId: resolution.company.id,
    domain
  });

  return {
    ruleId: "HEADHUNTER_COMPANY_DETECTED",
    configType: RULE_TO_CONFIG.HEADHUNTER_COMPANY_DETECTED,
    processorId: HEADHUNTER_COMPANY_PROCESSOR_ID,
    todoType: "HEADHUNTER_COMPANY_DETECTED",
    contact,
    currentStatus: "",
    suggestedStatus: "",
    currentState: { Empresa: currentCompany },
    suggestedState: { Empresa: suggestedCompany },
    evidenceIds: [],
    evidenceExtra: {
      dominio: domain,
      empresa: suggestedCompany,
      empresa_headhunter_id: resolution.company.id
    },
    reason: `Empresa Headhunter detectada: ${suggestedCompany}`,
    priority: 3,
    action: {
      action: "contact.update_company",
      label: "Completar empresa",
      input: {
        contact_id: contact.id,
        from: currentCompany,
        to: suggestedCompany,
        domain
      }
    },
    sourceFingerprint: fingerprint,
    dedupKey
  };
}

async function readContactsForRuleReview(contactIds?: string[]): Promise<ContactReviewRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from("contacts")
    .select(
      "id,display_name,company,networking_status,networking_focus,is_headhunter,headhunter_domains,is_active,updated_at,contact_emails(email,domain)"
    )
    .limit(MAX_ROWS);
  if (contactIds?.length) query = query.in("id", contactIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ContactReviewRow[];
}

async function readInteractionsForRuleReview(interactionIds?: string[]): Promise<InteractionReviewRow[]> {
  if (!supabase) return [];
  if (interactionIds && !interactionIds.length) return [];
  let query = supabase
    .from("interactions")
    .select("id,interaction_type,direction,occurred_at,subject,user_notes_raw,metadata,updated_at")
    .limit(MAX_ROWS);
  if (interactionIds?.length) query = query.in("id", interactionIds);
  const { data, error } = await query;
  if (error) throw error;
  return activeInteractions((data ?? []) as InteractionReviewRow[]);
}

async function readParticipantsForRuleReview(contactIds?: string[]): Promise<InteractionParticipantRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from("interaction_participants")
    .select("interaction_id,contact_id,email_identity,role")
    .limit(MAX_ROWS * 3);
  if (contactIds?.length) query = query.in("contact_id", contactIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as InteractionParticipantRow[];
}

async function readActiveRuleTodos(contactIds?: string[]): Promise<ActiveTodoReviewRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from("todos")
    .select("id,todo_type,engine_type,status,object_type,object_id,current_state,suggested_state,evidence,dedup_key,source_fingerprint")
    .eq("status", "active")
    .eq("engine_type", "RULE")
    .in("todo_type", ["NETWORKING_STATUS_CHANGE", "HEADHUNTER_COMPANY_DETECTED"])
    .limit(MAX_ROWS);
  if (contactIds?.length) query = query.in("object_id", contactIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ActiveTodoReviewRow[];
}

async function readTodosByDedupKeys(dedupKeys: string[]): Promise<Map<string, ActiveTodoReviewRow>> {
  if (!supabase || !dedupKeys.length) return new Map();
  const { data, error } = await supabase
    .from("todos")
    .select("id,todo_type,engine_type,status,object_type,object_id,current_state,suggested_state,evidence,dedup_key,source_fingerprint")
    .in("dedup_key", dedupKeys)
    .limit(MAX_ROWS);
  if (error) throw error;
  return new Map(((data ?? []) as ActiveTodoReviewRow[]).filter((todo) => todo.dedup_key).map((todo) => [todo.dedup_key as string, todo]));
}

function todoPayload(userId: string, candidate: RuleCandidate) {
  return {
    user_id: userId,
    todo_type: candidate.todoType,
    engine_type: "RULE",
    status: "active",
    priority: candidate.priority,
    object_type: "contact",
    object_id: candidate.contact.id,
    current_state: JSON.stringify(candidate.currentState),
    suggested_state: JSON.stringify(candidate.suggestedState),
    summary: candidate.contact.display_name || "Contacto sin nombre",
    reason: candidate.reason,
    evidence: JSON.stringify({
      regla: candidate.ruleId,
      motivo: candidate.reason,
      interacciones: candidate.evidenceIds,
      ...(candidate.evidenceExtra ?? {})
    }),
    actions_json: [candidate.action],
    dedup_key: candidate.dedupKey,
    source_fingerprint: candidate.sourceFingerprint
  };
}

async function upsertReviewState(userId: string, candidate: RuleCandidate, now: Date, status: string) {
  if (!supabase) return;
  await supabase.from("object_review_state").upsert(
    {
      user_id: userId,
      processor_id: candidate.processorId,
      processor_type: "RULE",
      object_type: "contact",
      object_id: candidate.contact.id,
      object_updated_at: candidate.contact.updated_at,
      last_reviewed_at: now.toISOString(),
      last_fingerprint: candidate.sourceFingerprint,
      result_json: {
        status,
        rule_id: candidate.ruleId,
        dedup_key: candidate.dedupKey,
        evidence_ids: candidate.evidenceIds
      }
    },
    { onConflict: "user_id,processor_id,object_type,object_id" }
  );
}

function groupInteractionsByContact(interactions: InteractionReviewRow[], participants: InteractionParticipantRow[]) {
  const interactionsById = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const grouped = new Map<string, InteractionReviewRow[]>();
  for (const participant of participants) {
    if (!participant.contact_id) continue;
    const interaction = interactionsById.get(participant.interaction_id);
    if (!interaction) continue;
    if (!grouped.has(participant.contact_id)) grouped.set(participant.contact_id, []);
    grouped.get(participant.contact_id)?.push(interaction);
  }
  return grouped;
}

function configAllowsSuggestion(config: TodoConfigRow | undefined) {
  if (!config) return true;
  return config.enabled && config.user_mode !== "do_not_suggest";
}

function shouldCloseAsAutoResolved(todo: ActiveTodoReviewRow, contact: ContactReviewRow | undefined) {
  if (todo.todo_type === "HEADHUNTER_COMPANY_DETECTED") {
    const suggestedCompany = parseState(todo.suggested_state).Empresa ?? "";
    return Boolean(
      contact &&
        suggestedCompany &&
        normalizeHeadhunterCompanyName(contact.company) === normalizeHeadhunterCompanyName(suggestedCompany)
    );
  }
  const suggestedStatus = parseState(todo.suggested_state).Estado_CRM ?? "";
  return Boolean(contact && rank(normalizeStatus(contact.networking_status)) >= rank(suggestedStatus));
}

function parseState(value: string | null | undefined): { Estado_CRM?: string; Empresa?: string } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function candidateKey(contactId: string, todoType: string) {
  return `${contactId}|${todoType}`;
}

function normalizeStatus(status: string | null | undefined) {
  const clean = (status ?? "").trim();
  return STATUS_RANK.has(clean) ? clean : "Pendiente";
}

function rank(status: string | null | undefined) {
  return STATUS_RANK.get(normalizeStatus(status)) ?? 0;
}

function isCalendarInteraction(interaction: InteractionReviewRow) {
  return interaction.interaction_type === "calendar";
}

function isOutboundMessage(interaction: InteractionReviewRow) {
  return (interaction.interaction_type === "email" || interaction.interaction_type === "message") && interaction.direction === "outbound";
}

function isAtOrBefore(value: string | null | undefined, reference: Date) {
  const time = timestamp(value);
  return time > 0 && time <= reference.getTime();
}

function isAfter(value: string | null | undefined, reference: Date) {
  const time = timestamp(value);
  return time > 0 && time > reference.getTime();
}

function ascendingOccurredAt(a: InteractionReviewRow, b: InteractionReviewRow) {
  return timestamp(a.occurred_at) - timestamp(b.occurred_at);
}

function descendingOccurredAt(a: InteractionReviewRow, b: InteractionReviewRow) {
  return timestamp(b.occurred_at) - timestamp(a.occurred_at);
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function maxUpdatedAt(interactions: InteractionReviewRow[]) {
  return interactions.reduce((latest, interaction) => {
    const value = timestamp(interaction.updated_at);
    return value > latest ? value : latest;
  }, 0);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Error al revisar reglas.";
}

function normalizeContactIds(contactIds: string[] | undefined) {
  if (!contactIds) return undefined;
  const uniqueIds = unique(contactIds.map((contactId) => contactId.trim()).filter(Boolean));
  return uniqueIds.length ? uniqueIds : undefined;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
