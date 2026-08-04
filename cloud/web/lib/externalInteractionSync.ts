import { supabase } from "./supabaseClient";
import type { InteractionRow } from "./readModel";

const INTERACTION_TYPES = new Set(["email", "calendar", "call", "message", "manual"]);
const DIRECTIONS = new Set(["inbound", "outbound", "internal", "unknown"]);
const PROCESSOR_TYPES = new Set(["RULE", "HYBRID", "AI"]);

export type ExternalInteractionParticipantInput = {
  contactId?: string | null;
  email?: string | null;
  role?: string | null;
};

export type ExternalInteractionInput = {
  provider: string;
  sourceService: string;
  externalObjectType: string;
  externalId: string;
  externalThreadId?: string | null;
  externalUrl?: string | null;
  connectedAccountId?: string | null;
  interactionType: InteractionRow["interaction_type"];
  direction?: InteractionRow["direction"];
  occurredAt?: string | null;
  subject?: string | null;
  sourceDetail?: string | null;
  participants?: ExternalInteractionParticipantInput[];
  metadata?: Record<string, unknown>;
  source?: string;
};

export type ExternalInteractionSyncResult = {
  status: "created" | "updated" | "skipped_prevent_reimport";
  interactionId?: string;
  externalSourceId?: string;
  participantsInserted?: number;
};

export type InteractionReviewStateInput = {
  interactionId: string;
  processorId: string;
  processorType: "RULE" | "HYBRID" | "AI";
  objectUpdatedAt?: string | null;
  fingerprint: string;
  result?: Record<string, unknown>;
};

export async function syncExternalInteraction(input: ExternalInteractionInput): Promise<ExternalInteractionSyncResult> {
  if (!supabase) throw new Error("Supabase no esta configurado.");

  const normalized = await normalizeExternalInteractionInput(input);
  const userId = await currentUserId();
  const now = new Date().toISOString();
  const existingSource = await readExternalSource(userId, normalized);

  if (existingSource?.prevent_reimport) {
    return {
      status: "skipped_prevent_reimport",
      interactionId: existingSource.interaction_id,
      externalSourceId: existingSource.id
    };
  }

  const interactionId = existingSource?.interaction_id || await findOrCreateInteraction(userId, normalized);
  if (existingSource?.interaction_id) {
    await updateInteractionFromExternalSource(userId, existingSource.interaction_id, normalized);
  }

  const externalSourceId = await upsertExternalInteractionSource(userId, interactionId, normalized, now);
  const participantsInserted = await addMissingParticipants(userId, interactionId, normalized.participants);

  await writeSyncAudit(userId, {
    action: "interaction.sync_external",
    objectId: interactionId,
    input: normalized,
    output: { interaction_id: interactionId, external_source_id: externalSourceId, participants_inserted: participantsInserted }
  });

  return {
    status: existingSource ? "updated" : "created",
    interactionId,
    externalSourceId,
    participantsInserted
  };
}

export async function buildInteractionReviewFingerprint(input: {
  subject?: string | null;
  occurredAt?: string | null;
  userNotesRaw?: string | null;
}) {
  return sha256([input.subject || "", input.occurredAt || "", input.userNotesRaw || ""].join("\n"));
}

export function shouldReviewInteraction(input: {
  objectUpdatedAt?: string | null;
  lastReviewedAt?: string | null;
  currentFingerprint: string;
  lastFingerprint?: string | null;
}) {
  if (!input.lastReviewedAt) return true;
  if (input.lastFingerprint !== input.currentFingerprint) return true;
  if (!input.objectUpdatedAt) return false;
  return new Date(input.objectUpdatedAt).getTime() > new Date(input.lastReviewedAt).getTime();
}

export async function markInteractionReviewed(input: InteractionReviewStateInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  if (!input.interactionId) throw new Error("Debe existir una interaccion.");
  if (!input.processorId.trim()) throw new Error("Debe existir un processor_id.");
  if (!PROCESSOR_TYPES.has(input.processorType)) throw new Error("Tipo de procesador no valido.");

  const userId = await currentUserId();
  const now = new Date().toISOString();
  const { error } = await supabase.from("object_review_state").upsert(
    {
      user_id: userId,
      processor_id: input.processorId,
      processor_type: input.processorType,
      object_type: "interaction",
      object_id: input.interactionId,
      object_updated_at: input.objectUpdatedAt || null,
      last_reviewed_at: now,
      last_fingerprint: input.fingerprint,
      result_json: input.result || {},
      updated_at: now
    },
    { onConflict: "user_id,processor_id,object_type,object_id" }
  );
  if (error) throw error;
}

async function normalizeExternalInteractionInput(input: ExternalInteractionInput) {
  const normalized = {
    provider: normalizeRequired(input.provider, "Proveedor"),
    sourceService: normalizeRequired(input.sourceService, "Servicio de origen"),
    externalObjectType: normalizeRequired(input.externalObjectType, "Tipo de objeto externo"),
    externalId: normalizeRequired(input.externalId, "ID externo"),
    externalThreadId: cleanOptional(input.externalThreadId),
    externalUrl: cleanOptional(input.externalUrl),
    connectedAccountId: cleanOptional(input.connectedAccountId),
    interactionType: input.interactionType,
    direction: input.direction || "unknown",
    occurredAt: normalizeDateTime(input.occurredAt),
    subject: cleanOptional(input.subject),
    sourceDetail: cleanOptional(input.sourceDetail),
    participants: normalizeParticipants(input.participants ?? []),
    metadata: input.metadata || {},
    source: input.source || "external_interaction_sync",
    contentHash: await sha256([input.subject || "", input.sourceDetail || ""].join("\n"))
  };

  if (!INTERACTION_TYPES.has(normalized.interactionType)) throw new Error("Tipo de interaccion no valido.");
  if (normalized.direction && !DIRECTIONS.has(normalized.direction)) throw new Error("Direccion no valida.");
  return normalized;
}

async function currentUserId() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");
  return userId;
}

async function readExternalSource(userId: string, input: Awaited<ReturnType<typeof normalizeExternalInteractionInput>>) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase
    .from("external_interaction_sources")
    .select("id,interaction_id,prevent_reimport")
    .eq("user_id", userId)
    .eq("provider", input.provider)
    .eq("source_service", input.sourceService)
    .eq("external_id", input.externalId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; interaction_id: string; prevent_reimport: boolean } | null;
}

async function findOrCreateInteraction(userId: string, input: Awaited<ReturnType<typeof normalizeExternalInteractionInput>>) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const existing = await supabase
    .from("interactions")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", input.provider)
    .eq("provider_event_id", input.externalId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    await updateInteractionFromExternalSource(userId, existing.data.id, input);
    return existing.data.id as string;
  }

  const created = await supabase
    .from("interactions")
    .insert({
      user_id: userId,
      provider: input.provider,
      provider_event_id: input.externalId,
      provider_thread_id: input.externalThreadId,
      interaction_type: input.interactionType,
      direction: input.direction,
      occurred_at: input.occurredAt,
      subject: input.subject,
      source_detail: input.sourceDetail,
      user_notes_raw: input.sourceDetail || "",
      metadata: {
        source: input.source,
        external_provider: input.provider,
        external_source_service: input.sourceService
      }
    })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function updateInteractionFromExternalSource(userId: string, interactionId: string, input: Awaited<ReturnType<typeof normalizeExternalInteractionInput>>) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { error } = await supabase
    .from("interactions")
    .update({
      provider: input.provider,
      provider_event_id: input.externalId,
      provider_thread_id: input.externalThreadId,
      interaction_type: input.interactionType,
      direction: input.direction,
      occurred_at: input.occurredAt,
      subject: input.subject,
      source_detail: input.sourceDetail
    })
    .eq("id", interactionId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function upsertExternalInteractionSource(
  userId: string,
  interactionId: string,
  input: Awaited<ReturnType<typeof normalizeExternalInteractionInput>>,
  now: string
) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const payload = {
    interaction_id: interactionId,
    connected_account_id: input.connectedAccountId,
    external_object_type: input.externalObjectType,
    external_thread_id: input.externalThreadId,
    external_url: input.externalUrl,
    source_subject: input.subject,
    source_detail: input.sourceDetail,
    content_hash: input.contentHash,
    sync_status: "synced",
    is_active: true,
    last_seen_at: input.occurredAt,
    last_synced_at: now,
    metadata: input.metadata
  };

  const existing = await supabase
    .from("external_interaction_sources")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", input.provider)
    .eq("source_service", input.sourceService)
    .eq("external_id", input.externalId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const updated = await supabase
      .from("external_interaction_sources")
      .update(payload)
      .eq("id", existing.data.id)
      .eq("user_id", userId)
      .select("id")
      .single();
    if (updated.error) throw updated.error;
    return updated.data.id as string;
  }

  const inserted = await supabase
    .from("external_interaction_sources")
    .insert({
        user_id: userId,
        provider: input.provider,
        source_service: input.sourceService,
        external_id: input.externalId,
        ...payload
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id as string;
}

async function addMissingParticipants(
  userId: string,
  interactionId: string,
  participants: ReturnType<typeof normalizeParticipants>
) {
  if (!supabase || !participants.length) return 0;
  const { data, error } = await supabase
    .from("interaction_participants")
    .select("contact_id,email_identity,role")
    .eq("user_id", userId)
    .eq("interaction_id", interactionId);
  if (error) throw error;

  const existingKeys = new Set(
    ((data ?? []) as Array<{ contact_id: string | null; email_identity: string | null; role: string | null }>).map(participantKey)
  );
  const rows = participants
    .filter((participant) => !existingKeys.has(participantKey({
      contact_id: participant.contactId,
      email_identity: participant.email,
      role: participant.role
    })))
    .map((participant) => ({
      user_id: userId,
      interaction_id: interactionId,
      contact_id: participant.contactId,
      email_identity: participant.email,
      role: participant.role
    }));

  if (!rows.length) return 0;
  const inserted = await supabase.from("interaction_participants").insert(rows);
  if (inserted.error) throw inserted.error;
  return rows.length;
}

async function writeSyncAudit(userId: string, input: {
  action: string;
  objectId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const now = new Date().toISOString();
  await supabase.from("action_invocations").insert({
    user_id: userId,
    action_name: input.action,
    actor_type: "system",
    status: "executed",
    object_type: "interaction",
    object_id: input.objectId,
    input_json: input.input,
    output_json: input.output,
    requires_confirmation: false,
    executed_at: now
  });
}

function normalizeRequired(value: string | null | undefined, label: string) {
  const clean = cleanOptional(value);
  if (!clean) throw new Error(`${label} es obligatorio.`);
  return clean.toLowerCase();
}

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeDateTime(value: string | null | undefined) {
  const clean = value?.trim();
  if (!clean) return null;
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeParticipants(participants: ExternalInteractionParticipantInput[]) {
  const seen = new Set<string>();
  return participants
    .map((participant) => ({
      contactId: participant.contactId || null,
      email: participant.email?.trim().toLowerCase() || null,
      role: participant.role?.trim().toUpperCase() || null
    }))
    .filter((participant) => participant.contactId || participant.email)
    .filter((participant) => {
      const key = participantKey({
        contact_id: participant.contactId,
        email_identity: participant.email,
        role: participant.role
      });
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function participantKey(participant: { contact_id: string | null; email_identity: string | null; role: string | null }) {
  return [
    participant.contact_id || "",
    (participant.email_identity || "").toLowerCase(),
    (participant.role || "").toUpperCase()
  ].join("|");
}

async function sha256(value: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(value);
  const buffer = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return `fallback-${Math.abs(hash).toString(16)}`;
}
