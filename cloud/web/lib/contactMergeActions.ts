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

export async function mergeContactsDeep(input: ContactDeepMergeInput) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const normalized = normalizeContactDeepMergeInput(input);

  const { data, error } = await supabase.rpc("merge_contacts_deep", {
    p_result: normalized.result,
    p_source: normalized.source || "contact_merge",
    p_source_contact_ids: normalized.sourceContactIds,
    p_target_contact_id: normalized.targetContactId
  });
  if (error) throw error;
  return normalizeContactDeepMergeResult(data);
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
