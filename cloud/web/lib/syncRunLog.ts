import { supabase } from "./supabaseClient.ts";

export type SyncRunLogStatus = "info" | "running" | "success" | "warning" | "error";

export type SyncRunLogStepInput = {
  detail?: string | null;
  metadata?: Record<string, unknown>;
  operation: string;
  provider: string;
  resourceType: string;
  runId: string;
  scopeLabel?: string | null;
  status?: SyncRunLogStatus;
  step: string;
  stepOrder: number;
};

export function createSyncRunId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function writeSyncRunLogStep(input: SyncRunLogStepInput) {
  if (!supabase) return;
  try {
    const { data, error: authError } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (authError || !userId) return;
    const { error } = await supabase.from("sync_run_logs").insert({
      detail: sanitizeLogDetail(input.detail ?? null),
      metadata: sanitizeLogMetadata(input.metadata ?? {}),
      operation: input.operation,
      provider: input.provider,
      resource_type: input.resourceType,
      run_id: input.runId,
      scope_label: input.scopeLabel ?? null,
      status: input.status ?? "info",
      step: input.step,
      step_order: input.stepOrder,
      user_id: userId
    });
    if (error) {
      // El log no debe bloquear una importacion real.
      console.warn("No pude guardar log de sincronizacion.", error.message);
    }
  } catch (error) {
    console.warn("No pude guardar log de sincronizacion.", error);
  }
}

export function sanitizeLogDetail(detail: string | null) {
  if (!detail) return null;
  const sanitized = redactSensitiveText(detail).trim();
  return sanitized.length > 280 ? `${sanitized.slice(0, 277)}...` : sanitized;
}

export function sanitizeLogMetadata(metadata: Record<string, unknown>) {
  return sanitizeMetadataValue(metadata) as Record<string, unknown>;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeMetadataValue);
  if (!isPlainRecord(value)) return null;

  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (isSensitiveMetadataKey(key)) {
      result[key] = "[oculto]";
      continue;
    }
    result[key] = sanitizeMetadataValue(entryValue);
  }
  return result;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[correo]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) => (
      digitCount(match) >= 8 ? "[telefono]" : match
    ))
    .replace(/\b(?:ya29|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/g, "[token]");
}

function isSensitiveMetadataKey(key: string) {
  return /token|secret|authorization|cookie|credential|raw_payload|body|source_detail|user_notes/i.test(key);
}

function digitCount(value: string) {
  return (value.match(/\d/g) ?? []).length;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
