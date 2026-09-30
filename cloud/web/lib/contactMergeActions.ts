import type { ContactMergeResult } from "./contactMerge.ts";
import { supabase } from "./supabaseClient.ts";

export type ContactDeepMergeInput = {
  targetContactId: string;
  sourceContactIds: string[];
  result: ContactMergeResult;
  source?: string;
};

export type ContactDeepMergeResult = {
  targetContactId: string;
  sourceContactIds: string[];
  externalIdsMoved: number;
  participantsMoved: number;
  participantsDeduped: number;
  referralsReferredByMoved: number;
  referralsLinkedMoved: number;
  todosMoved: number;
  reviewStatesDeleted: number;
  reviewStatesMoved: number;
};

export type ContactMergeErrorDiagnostic = {
  code: string;
  details: string;
  hint: string;
  message: string;
  name: string;
};

export async function mergeContactsDeep(input: ContactDeepMergeInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const normalized = normalizeContactDeepMergeInput(input);

  const { data, error } = await supabase.rpc("merge_contacts_deep", {
    p_result: normalized.result,
    p_source: normalized.source || "contact_merge",
    p_source_contact_ids: normalized.sourceContactIds,
    p_target_contact_id: normalized.targetContactId
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Coffeecito contact merge RPC failed", contactMergeErrorDiagnostic(error));
    }
    throw error;
  }
  return normalizeContactDeepMergeResult(data);
}

export function contactMergeErrorDiagnostic(error: unknown): ContactMergeErrorDiagnostic {
  const value = error && typeof error === "object" && !Array.isArray(error)
    ? error as Record<string, unknown>
    : {};
  return {
    code: safeDiagnosticText(value.code),
    details: safeDiagnosticText(value.details),
    hint: safeDiagnosticText(value.hint),
    message: safeDiagnosticText(value.message ?? (error instanceof Error ? error.message : "")),
    name: safeDiagnosticText(value.name ?? (error instanceof Error ? error.name : ""))
  };
}

export function normalizeContactDeepMergeInput(input: ContactDeepMergeInput): ContactDeepMergeInput {
  const targetContactId = input.targetContactId.trim();
  const sourceContactIds = uniqueClean(input.sourceContactIds).filter((id) => id !== targetContactId);
  if (!targetContactId) throw new Error("Debe existir un contacto resultante.");
  if (!sourceContactIds.length) throw new Error("Debes elegir al menos un contacto origen para fusionar.");
  if (sourceContactIds.length > 2) throw new Error("Fusionar contactos acepta maximo 3 contactos en total.");
  if (!input.result.name.trim()) throw new Error("El nombre del contacto resultante es obligatorio.");

  return {
    result: {
      company: input.result.company.trim(),
      emails: uniqueClean(input.result.emails.map((email) => email.toLowerCase())),
      focus: input.result.focus,
      headhunter: input.result.headhunter,
      name: input.result.name.trim(),
      networkingStatus: input.result.networkingStatus || "Pendiente",
      phones: uniqueClean(input.result.phones),
      role: input.result.role.trim()
    },
    source: input.source,
    sourceContactIds,
    targetContactId
  };
}

function normalizeContactDeepMergeResult(value: unknown): ContactDeepMergeResult {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    externalIdsMoved: numberValue(result.externalIdsMoved),
    participantsDeduped: numberValue(result.participantsDeduped),
    participantsMoved: numberValue(result.participantsMoved),
    referralsLinkedMoved: numberValue(result.referralsLinkedMoved),
    referralsReferredByMoved: numberValue(result.referralsReferredByMoved),
    reviewStatesDeleted: numberValue(result.reviewStatesDeleted),
    reviewStatesMoved: numberValue(result.reviewStatesMoved),
    sourceContactIds: Array.isArray(result.sourceContactIds)
      ? result.sourceContactIds.filter((id): id is string => typeof id === "string")
      : [],
    targetContactId: typeof result.targetContactId === "string" ? result.targetContactId : "",
    todosMoved: numberValue(result.todosMoved)
  };
}

function uniqueClean(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeDiagnosticText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 800)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?[0-9][0-9\s().-]{6,}[0-9]/g, "[phone]");
}
