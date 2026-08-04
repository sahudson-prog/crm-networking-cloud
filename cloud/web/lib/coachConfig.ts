import { supabase } from "./supabaseClient.ts";

export type TodoConfigMode = "do_not_suggest" | "confirm_always" | "execute_without_asking";
export type TodoConfigEngine = "RULE" | "HYBRID" | "AI";
export type TodoConfigActionScope = "in_app" | "external_action";

export type TodoConfigRow = {
  id: string;
  todo_type: string;
  engine_type: TodoConfigEngine;
  action_scope: TodoConfigActionScope;
  user_mode: TodoConfigMode;
  enabled: boolean;
  display_name: string;
  description: string;
  rule_json: Record<string, string>;
};

const EXTERNAL_ACTION_TYPES = new Set(["EMAIL_DRAFT", "WHATSAPP_MESSAGE", "CALENDAR_ACTION", "CONTACT_CREATE"]);

const TODO_LABELS: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: 'Cambiar estado a "Contactado"',
  RULE_STATUS_TO_SCHEDULED: 'Cambiar estado a "Agendado"',
  RULE_STATUS_TO_MEETING_DONE: 'Cambiar estado a "Cita concretada"',
  RULE_STATUS_TO_THANK_YOU: 'Cambiar estado a "Agradecimiento enviado"',
  CONTACT_ADD_EMAIL: "Agregar correo a un contacto",
  CALENDAR_ACTION: "Revisar o crear una cita",
  FOLLOW_UP_REMINDER: "Recordar seguimiento",
  HH_DOMAIN_REVIEW: "Revisar marca headhunter",
  DATA_CONFLICT_REVIEW: "Revisar conflicto de datos",
  SYNC_REVIEW: "Revisar cambios de sincronizacion",
  FOCUS_CHANGE: "Cambiar foco networking",
  CONTACT_UPDATE_FIELD: "Actualizar dato de contacto",
  CONTACT_MERGE_REVIEW: "Consolidar contactos",
  CONTACT_CREATE: "Crear contacto sugerido",
  EMAIL_DRAFT: "Redactar correo sugerido",
  WHATSAPP_MESSAGE: "Redactar mensaje sugerido",
  REFERRAL_REVIEW: "Revisar referido sugerido"
};

const TODO_EXAMPLES: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: 'Cambia el estado de Ana P. de Pendiente a Contactado.',
  RULE_STATUS_TO_SCHEDULED: 'Cambia el estado de Ana P. de Contactado a Agendado.',
  RULE_STATUS_TO_MEETING_DONE: 'Cambia el estado de Ana P. de Agendado a Cita concretada.',
  RULE_STATUS_TO_THANK_YOU: 'Cambia el estado de Ana P. de Cita concretada a Agradecimiento enviado.',
  CONTACT_ADD_EMAIL: "Sugiere agregar un correo nuevo a Ana P.",
  CALENDAR_ACTION: "Sugiere revisar o crear una cita con Ana P.",
  FOLLOW_UP_REMINDER: "Sugiere retomar contacto con Ana P.",
  HH_DOMAIN_REVIEW: "Sugiere revisar si Ana P. o su empresa son headhunter.",
  DATA_CONFLICT_REVIEW: "Sugiere revisar un dato que no calza entre fuentes.",
  SYNC_REVIEW: "Sugiere revisar un cambio detectado al sincronizar.",
  FOCUS_CHANGE: "Sugiere cambiar si Ana P. esta en foco de networking.",
  CONTACT_UPDATE_FIELD: "Sugiere actualizar un dato de Ana P.",
  CONTACT_MERGE_REVIEW: "Sugiere fusionar o consolidar contactos duplicados.",
  CONTACT_CREATE: "Sugiere crear un contacto mencionado en una minuta.",
  EMAIL_DRAFT: "Sugiere redactar un correo para Ana P.",
  WHATSAPP_MESSAGE: "Sugiere redactar un mensaje para Ana P.",
  REFERRAL_REVIEW: "Sugiere revisar un referido mencionado por Ana P."
};

const TODO_CONDITIONS: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: "Cuando existe correo o mensaje saliente hacia un contacto pendiente.",
  RULE_STATUS_TO_SCHEDULED: "Cuando existe una cita futura con el contacto.",
  RULE_STATUS_TO_MEETING_DONE: "Cuando una cita ya paso o ya tiene minuta.",
  RULE_STATUS_TO_THANK_YOU: "Cuando existe un mensaje posterior a una cita concretada.",
  CONTACT_ADD_EMAIL: "Cuando aparece un email asociado a un contacto sin ese correo registrado.",
  CALENDAR_ACTION: "Cuando una cita necesita revision o accion manual.",
  FOLLOW_UP_REMINDER: "Cuando el contacto lleva demasiado tiempo sin interaccion.",
  HH_DOMAIN_REVIEW: "Cuando la marca headhunter o empresa necesita revision.",
  DATA_CONFLICT_REVIEW: "Cuando hay datos contradictorios entre fuentes.",
  SYNC_REVIEW: "Cuando la sincronizacion detecta cambios que requieren aprobacion.",
  FOCUS_CHANGE: "Cuando el foco networking podria cambiar segun contexto.",
  CONTACT_UPDATE_FIELD: "Cuando hay datos de contacto a completar o corregir.",
  CONTACT_MERGE_REVIEW: "Cuando hay senales de duplicidad o cambio de ID.",
  CONTACT_CREATE: "Cuando una minuta o referido menciona una persona nueva.",
  EMAIL_DRAFT: "Cuando el siguiente paso natural es escribir un correo.",
  WHATSAPP_MESSAGE: "Cuando el siguiente paso natural es escribir un mensaje.",
  REFERRAL_REVIEW: "Cuando hay un referido pendiente de revisar o vincular."
};

const TODO_ORDER = [
  "RULE_STATUS_TO_CONTACTED",
  "RULE_STATUS_TO_SCHEDULED",
  "RULE_STATUS_TO_MEETING_DONE",
  "RULE_STATUS_TO_THANK_YOU",
  "CONTACT_ADD_EMAIL",
  "HH_DOMAIN_REVIEW",
  "DATA_CONFLICT_REVIEW",
  "SYNC_REVIEW",
  "FOLLOW_UP_REMINDER",
  "CALENDAR_ACTION",
  "FOCUS_CHANGE",
  "CONTACT_UPDATE_FIELD",
  "CONTACT_MERGE_REVIEW",
  "CONTACT_CREATE",
  "REFERRAL_REVIEW",
  "EMAIL_DRAFT",
  "WHATSAPP_MESSAGE"
];

export const TODO_CONFIG_MODES: Array<{ value: TodoConfigMode; label: string }> = [
  { value: "confirm_always", label: "Pedir confirmacion siempre" },
  { value: "execute_without_asking", label: "Ejecutar sin preguntar" },
  { value: "do_not_suggest", label: "No volver a sugerir" }
];

export async function readTodoConfigs(): Promise<TodoConfigRow[]> {
  const client = requireSupabase();

  const { data, error } = await client
    .from("todo_configs")
    .select("id,todo_type,engine_type,action_scope,user_mode,enabled,display_name,description,rule_json")
    .order("engine_type", { ascending: true })
    .order("todo_type", { ascending: true });

  if (error) throw error;
  return sortTodoConfigs((data ?? []) as TodoConfigRow[]);
}

export async function saveTodoConfigModes(configs: TodoConfigRow[], modes: Record<string, TodoConfigMode>) {
  const client = requireSupabase();

  const updates = configs
    .map((config) => {
      const mode = modes[config.id];
      if (!mode || mode === config.user_mode) return null;
      return client
        .from("todo_configs")
        .update({
          user_mode: mode,
          enabled: mode !== "do_not_suggest"
        })
        .eq("id", config.id);
    })
    .filter(Boolean);

  const results = await Promise.all(updates);
  const error = results.find((result) => result?.error)?.error;
  if (error) throw error;
}

export function sortTodoConfigs(configs: TodoConfigRow[]) {
  return [...configs].sort((a, b) => {
    const byEngine = engineOrder(a.engine_type) - engineOrder(b.engine_type);
    if (byEngine) return byEngine;
    const byScope = actionScopeOrder(a) - actionScopeOrder(b);
    if (byScope) return byScope;
    const byTodo = todoOrder(a.todo_type) - todoOrder(b.todo_type);
    if (byTodo) return byTodo;
    return todoConfigLabel(a).localeCompare(todoConfigLabel(b), "es");
  });
}

export function todoConfigLabel(config: TodoConfigRow) {
  return TODO_LABELS[config.todo_type] || config.display_name || config.description || config.todo_type;
}

export function todoConfigExample(config: TodoConfigRow) {
  return TODO_EXAMPLES[config.todo_type] || config.description || "El Coach puede proponer esta accion.";
}

export function todoConfigCondition(config: TodoConfigRow) {
  return TODO_CONDITIONS[config.todo_type] || config.description || "Cuando se cumpla la regla asociada.";
}

export function todoConfigScope(config: TodoConfigRow): TodoConfigActionScope {
  if (config.action_scope === "external_action" || EXTERNAL_ACTION_TYPES.has(config.todo_type)) return "external_action";
  return "in_app";
}

export function todoConfigCanAutoApply(config: TodoConfigRow) {
  const raw = config.rule_json?.Permite_Auto_Aplicar ?? "";
  return raw.toUpperCase() === "TRUE" && todoConfigScope(config) === "in_app";
}

function engineOrder(engine: TodoConfigEngine) {
  return { RULE: 1, HYBRID: 2, AI: 3 }[engine] ?? 99;
}

function actionScopeOrder(config: TodoConfigRow) {
  return todoConfigScope(config) === "in_app" ? 1 : 2;
}

function todoOrder(todoType: string) {
  const index = TODO_ORDER.indexOf(todoType);
  return index >= 0 ? index : 999;
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}
