import { supabase } from "./supabaseClient";
import { withDismissedInteractionMetadata } from "./interactionState";
import type { InteractionRow } from "./readModel";

const INTERACTION_TYPES = new Set(["email", "calendar", "call", "message", "manual"]);
const DIRECTIONS = new Set(["inbound", "outbound", "internal", "unknown"]);

export type InteractionEditorInput = {
  interactionId?: string;
  contactId: string;
  interactionType: InteractionRow["interaction_type"];
  direction: InteractionRow["direction"];
  occurredAt: string;
  subject: string;
  userNotesRaw: string;
  source?: string;
};

export async function saveInteractionFromEditor(input: InteractionEditorInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const normalized = normalizeInteractionInput(input);
  if (!normalized.contactId) throw new Error("Debe existir un contacto asociado.");
  if (!INTERACTION_TYPES.has(normalized.interactionType)) throw new Error("Tipo de interaccion no valido.");
  if (normalized.direction && !DIRECTIONS.has(normalized.direction)) throw new Error("Direccion no valida.");
  if (!normalized.occurredAt) throw new Error("La fecha de la interaccion es obligatoria.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  await assertContactBelongsToUser(userId, normalized.contactId);

  const isCreate = !normalized.interactionId;
  const now = new Date().toISOString();
  const actionName = isCreate ? "interaction.create_manual" : "interaction.update_user_notes";
  const before = isCreate ? null : await readInteractionSnapshot(userId, normalized.interactionId);

  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: actionName,
      actor_type: "user",
      status: "confirmed",
      object_type: "interaction",
      object_id: normalized.interactionId || null,
      input_json: {
        ...normalized,
        source: normalized.source || "interaction_editor"
      },
      requires_confirmation: false,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    let interactionId = normalized.interactionId;
    const payload = {
      interaction_type: normalized.interactionType,
      direction: normalized.direction || "unknown",
      occurred_at: normalized.occurredAt,
      subject: normalized.subject,
      user_notes_raw: normalized.userNotesRaw,
      provider: isCreate ? "app" : before?.provider ?? undefined,
      metadata: isCreate ? { source: "manual" } : undefined
    };

    if (isCreate) {
      const { data: created, error: createError } = await supabase
        .from("interactions")
        .insert({
          user_id: userId,
          ...payload
        })
        .select("id")
        .single();
      if (createError) throw createError;
      interactionId = created.id;

      const { error: participantError } = await supabase.from("interaction_participants").insert({
        user_id: userId,
        interaction_id: interactionId,
        contact_id: normalized.contactId,
        role: roleFromDirection(normalized.direction)
      });
      if (participantError) throw participantError;
    } else {
      const { error: updateError } = await supabase
        .from("interactions")
        .update(payload)
        .eq("id", interactionId)
        .eq("user_id", userId);
      if (updateError) throw updateError;
    }

    if (!interactionId) throw new Error("No pude determinar el ID de la interaccion.");
    const after = await readInteractionSnapshot(userId, interactionId);
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: actionName,
      object_type: "interaction",
      object_id: interactionId,
      before_json: before,
      after_json: after
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        object_id: interactionId,
        output_json: { interaction_id: interactionId },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return { interactionId };
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al guardar interaccion."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }
}

export async function dismissInteraction(interactionId: string, input: {
  source?: string;
  preventReimport?: boolean;
  reason?: string;
} = {}) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  if (!interactionId) throw new Error("Debe existir una interaccion para eliminar.");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");

  const now = new Date().toISOString();
  const actionName = "interaction.dismiss";
  const before = await readInteractionSnapshot(userId, interactionId);
  const nextMetadata = withDismissedInteractionMetadata(asRecord(before?.metadata), {
    deletedAt: now,
    deletedBy: "user",
    deleteReason: input.reason || "user_deleted_from_interaction_editor",
    preventReimport: input.preventReimport
  });

  const { data: invocation, error: invocationError } = await supabase
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: actionName,
      actor_type: "user",
      status: "confirmed",
      object_type: "interaction",
      object_id: interactionId,
      input_json: {
        interactionId,
        source: input.source || "interaction_editor",
        preventReimport: Boolean(input.preventReimport)
      },
      requires_confirmation: true,
      confirmed_at: now
    })
    .select("id")
    .single();
  if (invocationError) throw invocationError;

  try {
    await updateInteractionDismissal(userId, interactionId, {
      metadata: nextMetadata,
      deletedAt: now,
      deletedBy: "user",
      deleteReason: input.reason || "user_deleted_from_interaction_editor",
      preventReimport: Boolean(input.preventReimport)
    });

    const after = await readInteractionSnapshot(userId, interactionId);
    await supabase.from("audit_log").insert({
      user_id: userId,
      actor: "user",
      action: actionName,
      object_type: "interaction",
      object_id: interactionId,
      before_json: before,
      after_json: after
    });

    const { error: invocationDoneError } = await supabase
      .from("action_invocations")
      .update({
        status: "executed",
        output_json: { interaction_id: interactionId, dismissed: true },
        executed_at: now
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    if (invocationDoneError) throw invocationDoneError;

    return { interactionId };
  } catch (error) {
    await supabase
      .from("action_invocations")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Error al eliminar interaccion."
      })
      .eq("id", invocation.id)
      .eq("user_id", userId);
    throw error;
  }
}

function normalizeInteractionInput(input: InteractionEditorInput): InteractionEditorInput {
  return {
    interactionId: input.interactionId || undefined,
    contactId: input.contactId,
    interactionType: input.interactionType,
    direction: input.direction || "unknown",
    occurredAt: normalizeDateTime(input.occurredAt),
    subject: input.subject.trim(),
    userNotesRaw: input.userNotesRaw.trim(),
    source: input.source
  };
}

function normalizeDateTime(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function assertContactBelongsToUser(userId: string, contactId: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No encontre el contacto.");
}

async function readInteractionSnapshot(userId: string, interactionId: string | undefined): Promise<Record<string, unknown> | null> {
  if (!interactionId || !supabase) return null;
  const { data, error } = await supabase
    .from("interactions")
    .select("id,provider,interaction_type,direction,occurred_at,subject,source_detail,user_notes_raw,metadata,updated_at")
    .eq("id", interactionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No encontre la interaccion.");
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function updateInteractionDismissal(userId: string, interactionId: string, input: {
  metadata: Record<string, unknown>;
  deletedAt: string;
  deletedBy: string;
  deleteReason: string;
  preventReimport: boolean;
}) {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const payloadWithColumns = {
    metadata: input.metadata,
    is_deleted: true,
    deleted_at: input.deletedAt,
    deleted_by: input.deletedBy,
    delete_reason: input.deleteReason,
    prevent_reimport: input.preventReimport
  };

  const firstAttempt = await supabase
    .from("interactions")
    .update(payloadWithColumns)
    .eq("id", interactionId)
    .eq("user_id", userId);

  if (!firstAttempt.error) return;
  if (!looksLikeMissingSoftDeleteColumns(firstAttempt.error)) throw firstAttempt.error;

  const fallback = await supabase
    .from("interactions")
    .update({ metadata: input.metadata })
    .eq("id", interactionId)
    .eq("user_id", userId);
  if (fallback.error) throw fallback.error;
}

function looksLikeMissingSoftDeleteColumns(error: { code?: string; message?: string }) {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return text.includes("is_deleted") || text.includes("deleted_at") || text.includes("prevent_reimport") || text.includes("schema cache");
}

function roleFromDirection(direction: InteractionRow["direction"]) {
  if (direction === "outbound") return "TO";
  if (direction === "inbound") return "FROM";
  if (direction === "internal") return "MANUAL";
  return "UNKNOWN";
}
