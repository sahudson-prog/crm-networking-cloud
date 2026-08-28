import { supabase } from "./supabaseClient.ts";

export type TodoConfigMode = "do_not_suggest" | "confirm_always" | "execute_without_asking";
export type TodoConfigEngine = "RULE" | "HYBRID" | "AI";
export type TodoConfigActionScope = "in_app" | "external_action";
export type TodoConfigFamily = "contact.networking_status" | "contact.company_from_headhunter_master";

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

type DefaultTodoConfig = Omit<TodoConfigRow, "id" | "user_mode" | "enabled">;

const AUTO_APPLY_ALLOWED_TYPES = new Set([
  "RULE_STATUS_TO_CONTACTED",
  "RULE_STATUS_TO_SCHEDULED",
  "RULE_STATUS_TO_MEETING_DONE",
  "RULE_STATUS_TO_THANK_YOU",
  "HEADHUNTER_COMPANY_DETECTED"
]);

const TODO_LABELS: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: 'Cambiar estado a "Contactado"',
  RULE_STATUS_TO_SCHEDULED: 'Cambiar estado a "Agendado"',
  RULE_STATUS_TO_MEETING_DONE: 'Cambiar estado a "Cita concretada"',
  RULE_STATUS_TO_THANK_YOU: 'Cambiar estado a "Agradecimiento enviado"',
  HEADHUNTER_COMPANY_DETECTED: "Registrar headhunter en empresa detectada"
};

const TODO_EXAMPLES: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: 'Cambia el estado de Ana P. de Pendiente a Contactado.',
  RULE_STATUS_TO_SCHEDULED: 'Cambia el estado de Ana P. de Contactado a Agendado.',
  RULE_STATUS_TO_MEETING_DONE: 'Cambia el estado de Ana P. de Agendado a Cita concretada.',
  RULE_STATUS_TO_THANK_YOU: 'Cambia el estado de Ana P. de Cita concretada a Agradecimiento enviado.',
  HEADHUNTER_COMPANY_DETECTED: "Registra a Ana P. como headhunter, en Intertrust."
};

const TODO_CONDITIONS: Record<string, string> = {
  RULE_STATUS_TO_CONTACTED: "Cuando existe correo o mensaje saliente hacia un contacto pendiente.",
  RULE_STATUS_TO_SCHEDULED: "Cuando existe una cita futura con el contacto.",
  RULE_STATUS_TO_MEETING_DONE: "Cuando una cita ya paso o ya tiene minuta.",
  RULE_STATUS_TO_THANK_YOU: "Cuando existe un mensaje posterior a una cita concretada.",
  HEADHUNTER_COMPANY_DETECTED:
    "Cuando un contacto marcado como headhunter no tiene empresa y su dominio coincide con una unica empresa del maestro."
};

const TODO_ORDER = [
  "RULE_STATUS_TO_CONTACTED",
  "RULE_STATUS_TO_SCHEDULED",
  "RULE_STATUS_TO_MEETING_DONE",
  "RULE_STATUS_TO_THANK_YOU",
  "HEADHUNTER_COMPANY_DETECTED"
];
const APPROVED_TODO_CONFIG_TYPES = new Set(TODO_ORDER);

const TODO_FAMILIES: Record<string, TodoConfigFamily> = {
  RULE_STATUS_TO_CONTACTED: "contact.networking_status",
  RULE_STATUS_TO_SCHEDULED: "contact.networking_status",
  RULE_STATUS_TO_MEETING_DONE: "contact.networking_status",
  RULE_STATUS_TO_THANK_YOU: "contact.networking_status",
  HEADHUNTER_COMPANY_DETECTED: "contact.company_from_headhunter_master"
};

const FAMILY_ORDER: TodoConfigFamily[] = ["contact.networking_status", "contact.company_from_headhunter_master"];

const DEFAULT_TODO_CONFIGS: DefaultTodoConfig[] = TODO_ORDER.map((todoType) => ({
  todo_type: todoType,
  engine_type: "RULE",
  action_scope: "in_app",
  display_name: TODO_LABELS[todoType] ?? todoType,
  description: TODO_CONDITIONS[todoType] ?? "",
  rule_json: {
    Permite_Auto_Aplicar: AUTO_APPLY_ALLOWED_TYPES.has(todoType) ? "TRUE" : "FALSE"
  }
}));

export const TODO_CONFIG_MODES: Array<{ value: TodoConfigMode; label: string }> = [
  { value: "confirm_always", label: "Pedir confirmacion siempre" },
  { value: "execute_without_asking", label: "Ejecutar sin preguntar" },
  { value: "do_not_suggest", label: "No volver a sugerir" }
];

export async function readTodoConfigs(): Promise<TodoConfigRow[]> {
  const client = requireSupabase();
  await ensureDefaultTodoConfigs();

  const { data, error } = await client
    .from("todo_configs")
    .select("id,todo_type,engine_type,action_scope,user_mode,enabled,display_name,description,rule_json")
    .order("engine_type", { ascending: true })
    .order("todo_type", { ascending: true });

  if (error) throw error;
  return sortTodoConfigs(((data ?? []) as TodoConfigRow[]).filter((config) => APPROVED_TODO_CONFIG_TYPES.has(config.todo_type)));
}

async function ensureDefaultTodoConfigs() {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const { data: existing, error: existingError } = await client
    .from("todo_configs")
    .select("todo_type")
    .eq("user_id", userId);
  if (existingError) throw existingError;

  const existingTypes = new Set((existing ?? []).map((row) => row.todo_type));
  const missingConfigs = DEFAULT_TODO_CONFIGS.filter((config) => !existingTypes.has(config.todo_type));
  if (!missingConfigs.length) return;

  const { error: insertError } = await client.from("todo_configs").insert(
    missingConfigs.map((config) => ({
      user_id: userId,
      ...config,
      enabled: true,
      user_mode: "confirm_always"
    }))
  );
  if (insertError) throw insertError;
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
  if (config.action_scope === "external_action") return "external_action";
  return "in_app";
}

export function todoConfigFamily(config: Pick<TodoConfigRow, "todo_type">): TodoConfigFamily {
  return TODO_FAMILIES[config.todo_type] ?? "contact.networking_status";
}

export function todoConfigFamilyLabel(family: TodoConfigFamily) {
  return {
    "contact.networking_status": "Estado networking",
    "contact.company_from_headhunter_master": "Empresa headhunter"
  }[family];
}

export function todoConfigFamilyDescription(family: TodoConfigFamily) {
  return {
    "contact.networking_status": "Reglas que proponen cambiar el estado oficial del contacto.",
    "contact.company_from_headhunter_master": "Reglas que completan la empresa del contacto desde el maestro headhunter."
  }[family];
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

export function todoConfigFamilyOrder(family: TodoConfigFamily) {
  const index = FAMILY_ORDER.indexOf(family);
  return index >= 0 ? index : 999;
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}
