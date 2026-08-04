import { supabase } from "./supabaseClient.ts";
import type { TodoRow } from "./readModel.ts";

type ParsedState = {
  Estado_CRM?: string;
  networking_status?: string;
};

export type CoachExecutionResult = {
  executed: number;
  unsupported: number;
  errors: string[];
};

export type CoachDismissResult = {
  dismissed: number;
  errors: string[];
};

const OFFICIAL_STATUSES = new Set([
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
]);

export async function executeCoachTodos(todos: TodoRow[]): Promise<CoachExecutionResult> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  let executed = 0;
  let unsupported = 0;
  const errors: string[] = [];

  for (const todo of todos) {
    try {
      const result = await executeNetworkingStatusTodo({
        todo,
        userId,
        actorType: "user",
        requiresConfirmation: true
      });
      if (result === "unsupported") {
        unsupported += 1;
        continue;
      }
      executed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al ejecutar una sugerencia.";
      errors.push(message);
    }
  }

  return { executed, unsupported, errors };
}

export async function executeNetworkingStatusTodo({
  todo,
  userId,
  actorType,
  requiresConfirmation
}: {
  todo: TodoRow;
  userId: string;
  actorType: "user" | "rule" | "ai" | "system";
  requiresConfirmation: boolean;
}): Promise<"executed" | "unsupported"> {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  if (todo.todo_type !== "NETWORKING_STATUS_CHANGE") return "unsupported";

  const contactId = todo.object_id;
  const suggestedStatus = suggestedNetworkingStatus(todo);
  if (!contactId || !suggestedStatus || !OFFICIAL_STATUSES.has(suggestedStatus)) return "unsupported";

  let invocationId: string | null = null;

  try {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id,networking_status")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (contactError) throw contactError;
    if (!contact) throw new Error(`No encontre el contacto asociado a la sugerencia ${todo.id}.`);

    const now = new Date().toISOString();
    const invocationInput = {
      todo_id: todo.id,
      current_status: contact.networking_status,
      suggested_status: suggestedStatus
    };

    const { data: invocation, error: invocationError } = await supabase
      .from("action_invocations")
      .insert({
        user_id: userId,
        action_name: "contact.update_networking_status",
        actor_type: actorType,
        status: requiresConfirmation ? "confirmed" : "requested",
        source_todo_id: todo.id,
        object_type: "contact",
        object_id: contactId,
        input_json: invocationInput,
        requires_confirmation: requiresConfirmation,
        confirmed_at: requiresConfirmation ? now : null
      })
      .select("id")
      .single();
    if (invocationError) throw invocationError;
    invocationId = invocation.id;

    const { error: updateContactError } = await supabase
      .from("contacts")
      .update({ networking_status: suggestedStatus })
      .eq("id", contactId)
      .eq("user_id", userId);
    if (updateContactError) throw updateContactError;

    const { error: updateTodoError } = await supabase
      .from("todos")
      .update({ status: "done", resolved_at: now })
      .eq("id", todo.id)
      .eq("user_id", userId);
    if (updateTodoError) throw updateTodoError;

    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: actorType,
      action: "contact.update_networking_status",
      object_type: "contact",
      object_id: contactId,
      before_json: { networking_status: contact.networking_status },
      after_json: { networking_status: suggestedStatus }
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        output_json: { contact_id: contactId, networking_status: suggestedStatus },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return "executed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al ejecutar una sugerencia.";
    if (invocationId) {
      await supabase
        .from("action_invocations")
        .update({ status: "failed", error_message: message })
        .eq("id", invocationId)
        .eq("user_id", userId);
    }
    throw error;
  }
}

export async function dismissCoachTodos(todos: TodoRow[]): Promise<CoachDismissResult> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  let dismissed = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const todo of todos) {
    let invocationId: string | null = null;
    try {
      const { data: invocation, error: invocationError } = await supabase
        .from("action_invocations")
        .insert({
          user_id: userId,
          action_name: "todo.dismiss",
          actor_type: "user",
          status: "confirmed",
          source_todo_id: todo.id,
          object_type: todo.object_type,
          object_id: todo.object_id,
          input_json: { todo_id: todo.id, todo_type: todo.todo_type },
          requires_confirmation: true,
          confirmed_at: now
        })
        .select("id")
        .single();
      if (invocationError) throw invocationError;
      invocationId = invocation.id;

      const { error: updateTodoError } = await supabase
        .from("todos")
        .update({ status: "dismissed", resolved_at: now })
        .eq("id", todo.id)
        .eq("user_id", userId);
      if (updateTodoError) throw updateTodoError;

      await supabase.from("audit_log").insert({
        user_id: userId,
        actor: "user",
        action: "todo.dismiss",
        object_type: "todo",
        object_id: todo.id,
        before_json: { status: todo.status },
        after_json: { status: "dismissed" }
      });

      const { error: invocationDoneError } = await supabase
        .from("action_invocations")
        .update({
          status: "executed",
          output_json: { todo_id: todo.id, status: "dismissed" },
          executed_at: now
        })
        .eq("id", invocation.id)
        .eq("user_id", userId);
      if (invocationDoneError) throw invocationDoneError;

      dismissed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al descartar una sugerencia.";
      if (invocationId) {
        await supabase
          .from("action_invocations")
          .update({ status: "failed", error_message: message })
          .eq("id", invocationId)
          .eq("user_id", userId);
      }
      errors.push(message);
    }
  }

  return { dismissed, errors };
}

function suggestedNetworkingStatus(todo: TodoRow) {
  const suggested = parseState(todo.suggested_state);
  return suggested.Estado_CRM ?? suggested.networking_status ?? "";
}

function parseState(value: string | null | undefined): ParsedState {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
