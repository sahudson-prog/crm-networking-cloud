"use client";

import { supabase } from "./supabaseClient";
import {
  expectedNetworkingContext, networkingContextFromCycles, readNetworkingCycles
} from "./networkingCycles";
import type { ContactObjectiveAssignmentRow, ObjectivePriority, ObjectiveRow, ObjectiveType } from "./readModel";

export const OBJECTIVE_TYPES: Array<{ label: string; value: ObjectiveType }> = [
  { label: "Empresas", value: "COMPANY" },
  { label: "Industrias", value: "INDUSTRY" },
  { label: "Cargos", value: "ROLE" },
  { label: "Funciones", value: "FUNCTION" }
];
export const OBJECTIVE_PRIORITIES: Array<{ label: string; value: ObjectivePriority }> = [
  { label: "Alta", value: "HIGH" },
  { label: "Media", value: "MEDIUM" },
  { label: "Baja", value: "LOW" }
];

export type ObjectiveEditorInput = {
  objectiveId?: string;
  objectiveName: string;
  objectiveType: ObjectiveType;
  priorityLevel: ObjectivePriority;
  objectiveDescription: string;
  isActive: boolean;
};
export type ContactObjectiveAssignmentInput = { contactId: string; objectiveIds: string[]; source?: string };
export type BulkContactObjectiveAssignmentInput = { contactIds: string[]; objectiveIds: string[]; source?: string };

function requireClient() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

async function requireUserId() {
  const { data, error } = await requireClient().auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("No hay usuario autenticado.");
  return data.user.id;
}

async function activeCycleForRead() {
  const [expected, cycles] = await Promise.all([expectedNetworkingContext(), readNetworkingCycles()]);
  return expected.token === networkingContextFromCycles(cycles).token ? expected.cycleId : null;
}

async function requireCycleId() {
  const cycleId = await activeCycleForRead();
  if (!cycleId) throw new Error("Comienza un ciclo antes de editar Prioridades.");
  return cycleId;
}

async function requireCycleContext() {
  const context = await expectedNetworkingContext();
  if (!context.cycleId) throw new Error("Comienza un ciclo antes de editar Prioridades.");
  return context;
}

export async function readObjectives(options: { activeOnly?: boolean } = {}): Promise<ObjectiveRow[]> {
  const cycleId = await activeCycleForRead();
  if (!cycleId) return [];
  const userId = await requireUserId();
  let query = requireClient().from("objectives")
    .select("id,objective_name,objective_name_normalized,objective_type,priority_level,objective_description,is_active,created_at,updated_at")
    .eq("user_id", userId).eq("cycle_id", cycleId)
    .order("objective_type", { ascending: true }).order("objective_name", { ascending: true });
  if (options.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ObjectiveRow[];
}

export async function readObjectiveAssignmentsForContacts(contactIds: string[]): Promise<Map<string, ContactObjectiveAssignmentRow[]>> {
  const result = new Map<string, ContactObjectiveAssignmentRow[]>();
  const cycleId = await activeCycleForRead();
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!cycleId || !ids.length) return result;
  const userId = await requireUserId();
  for (const batch of chunk(ids, 120)) {
    const { data, error } = await requireClient().from("contact_objective_assignments")
      .select("id,contact_id,objective_id,assigned_by_actor,assigned_at,objective:objectives!inner(id,cycle_id,objective_name,objective_name_normalized,objective_type,priority_level,objective_description,is_active,created_at,updated_at)")
      .eq("user_id", userId).eq("objective.cycle_id", cycleId).in("contact_id", batch);
    if (error) throw error;
    for (const raw of (data ?? []) as unknown as Array<ContactObjectiveAssignmentRow & { objective?: ObjectiveRow | ObjectiveRow[] | null }>) {
      const objective = Array.isArray(raw.objective) ? raw.objective[0] ?? null : raw.objective ?? null;
      const row = { ...raw, objective };
      result.set(row.contact_id, [...(result.get(row.contact_id) ?? []), row]);
    }
  }
  return result;
}

export async function readContactIdsForObjective(objectiveId: string): Promise<string[]> {
  const cycleId = await requireCycleId();
  const userId = await requireUserId();
  const { data: objective, error: objectiveError } = await requireClient().from("objectives")
    .select("id").eq("id", objectiveId).eq("user_id", userId).eq("cycle_id", cycleId).maybeSingle();
  if (objectiveError) throw objectiveError;
  if (!objective) throw new Error("La Prioridad ya no pertenece al ciclo activo.");
  const { data, error } = await requireClient().from("contact_objective_assignments")
    .select("contact_id").eq("user_id", userId).eq("objective_id", objectiveId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => String(row.contact_id)))];
}

export async function saveObjective(input: ObjectiveEditorInput) {
  const context = await requireCycleContext();
  const cycleId = context.cycleId;
  const name = input.objectiveName.trim();
  if (!name) throw new Error("La Prioridad necesita nombre.");
  const { data, error } = await requireClient().rpc("save_objective_r2b", {
    p_expected_cycle_id: cycleId,
    p_expected_context: context.token,
    p_objective_id: input.objectiveId ?? null,
    p_name: name,
    p_name_normalized: normalizeObjectiveName(name),
    p_type: input.objectiveType,
    p_priority: input.priorityLevel,
    p_description: input.objectiveDescription.trim(),
    p_is_active: input.isActive
  });
  if (error) throw error;
  return { objectiveId: String(data) };
}

export async function deleteObjective(objectiveId: string) {
  const context = await requireCycleContext();
  const cycleId = context.cycleId;
  const { error } = await requireClient().rpc("archive_objective_r2b", {
    p_expected_cycle_id: cycleId, p_expected_context: context.token, p_objective_id: objectiveId
  });
  if (error) throw error;
}

export async function setContactObjectiveAssignments(input: ContactObjectiveAssignmentInput) {
  const objectiveIds = [...new Set(input.objectiveIds.filter(Boolean))];
  const context = await expectedNetworkingContext();
  const cycleId = context.cycleId;
  if (!cycleId) {
    if (objectiveIds.length) throw new Error("Comienza un ciclo antes de asociar Prioridades.");
    return { assignedObjectiveIds: [] };
  }
  const { error } = await requireClient().rpc("replace_contact_objectives_r2b", {
    p_expected_cycle_id: cycleId, p_contact_id: input.contactId,
    p_expected_context: context.token,
    p_objective_ids: objectiveIds, p_actor: input.source ?? "user"
  });
  if (error) throw error;
  return { assignedObjectiveIds: objectiveIds };
}

export async function setObjectiveContactAssignments(input: { objectiveId: string; contactIds: string[] }) {
  const context = await requireCycleContext();
  const cycleId = context.cycleId;
  const contactIds = [...new Set(input.contactIds.filter(Boolean))];
  const { error } = await requireClient().rpc("replace_objective_contacts_r2b", {
    p_expected_cycle_id: cycleId, p_expected_context: context.token,
    p_objective_id: input.objectiveId, p_contact_ids: contactIds
  });
  if (error) throw error;
  return { assignedContactIds: contactIds };
}

export async function addObjectiveAssignmentsToContacts(input: BulkContactObjectiveAssignmentInput) {
  const context = await requireCycleContext();
  const cycleId = context.cycleId;
  const contactIds = [...new Set(input.contactIds.filter(Boolean))];
  const objectiveIds = [...new Set(input.objectiveIds.filter(Boolean))];
  if (!contactIds.length || !objectiveIds.length) {
    return { assignedContactCount: contactIds.length, assignedObjectiveCount: objectiveIds.length, insertedAssignments: 0 };
  }
  const { data, error } = await requireClient().rpc("add_objectives_to_contacts_r2b", {
    p_expected_cycle_id: cycleId, p_contact_ids: contactIds,
    p_expected_context: context.token,
    p_objective_ids: objectiveIds, p_actor: input.source ?? "user"
  });
  if (error) throw error;
  return { assignedContactCount: contactIds.length, assignedObjectiveCount: objectiveIds.length, insertedAssignments: Number(data) || 0 };
}

export function normalizeObjectiveName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
export function objectiveTypeLabel(type: ObjectiveType) {
  return OBJECTIVE_TYPES.find((entry) => entry.value === type)?.label ?? type;
}
export function objectivePriorityLabel(priority: ObjectivePriority) {
  return OBJECTIVE_PRIORITIES.find((entry) => entry.value === priority)?.label ?? priority;
}
function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
