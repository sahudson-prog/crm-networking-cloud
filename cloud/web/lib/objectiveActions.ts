"use client";

import { supabase } from "./supabaseClient";
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

export type ContactObjectiveAssignmentInput = {
  contactId: string;
  objectiveIds: string[];
  source?: string;
};

export type BulkContactObjectiveAssignmentInput = {
  contactIds: string[];
  objectiveIds: string[];
  source?: string;
};

const OBJECTIVE_TABLE_MISSING_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);
const ASSIGNMENT_READ_BATCH_SIZE = 120;
const ASSIGNMENT_ACTORS = new Set(["user", "coach", "system", "import"]);

export async function readObjectives(options: { activeOnly?: boolean } = {}): Promise<ObjectiveRow[]> {
  const client = requireSupabase();
  const userId = await requireUserId();
  let query = client
    .from("objectives")
    .select("id,objective_name,objective_name_normalized,objective_type,priority_level,objective_description,is_active,created_at,updated_at")
    .eq("user_id", userId)
    .order("objective_type", { ascending: true })
    .order("objective_name", { ascending: true });

  if (options.activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (isMissingObjectivesTable(error)) return [];
  if (error) throw error;
  return (data ?? []) as ObjectiveRow[];
}

export async function readObjectiveAssignmentsForContacts(contactIds: string[]): Promise<Map<string, ContactObjectiveAssignmentRow[]>> {
  const result = new Map<string, ContactObjectiveAssignmentRow[]>();
  const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean)));
  if (!uniqueContactIds.length) return result;

  const client = requireSupabase();
  const userId = await requireUserId();
  for (const contactIdBatch of chunk(uniqueContactIds, ASSIGNMENT_READ_BATCH_SIZE)) {
    const { data, error } = await client
      .from("contact_objective_assignments")
      .select(
        "id,contact_id,objective_id,assigned_by_actor,assigned_at,objective:objectives(id,objective_name,objective_name_normalized,objective_type,priority_level,objective_description,is_active,created_at,updated_at)"
      )
      .eq("user_id", userId)
      .in("contact_id", contactIdBatch);

    if (isMissingObjectivesTable(error)) return result;
    if (error) throw error;

    for (const rawRow of (data ?? []) as unknown as Array<ContactObjectiveAssignmentRow & { objective?: ObjectiveRow | ObjectiveRow[] | null }>) {
      const objective = Array.isArray(rawRow.objective) ? rawRow.objective[0] ?? null : rawRow.objective ?? null;
      const row: ContactObjectiveAssignmentRow = { ...rawRow, objective };
      const current = result.get(row.contact_id) ?? [];
      current.push(row);
      result.set(row.contact_id, current);
    }
  }

  for (const rows of result.values()) {
    rows.sort((a, b) => {
      const objectiveA = a.objective;
      const objectiveB = b.objective;
      const typeCompare = (objectiveA?.objective_type ?? "").localeCompare(objectiveB?.objective_type ?? "");
      if (typeCompare) return typeCompare;
      return (objectiveA?.objective_name ?? "").localeCompare(objectiveB?.objective_name ?? "", "es", { sensitivity: "base" });
    });
  }

  return result;
}

export async function readContactIdsForObjective(objectiveId: string): Promise<string[]> {
  const client = requireSupabase();
  const userId = await requireUserId();
  const { data, error } = await client
    .from("contact_objective_assignments")
    .select("contact_id")
    .eq("user_id", userId)
    .eq("objective_id", objectiveId);

  if (error) throw error;
  return Array.from(new Set((data ?? []).map((row) => String(row.contact_id)).filter(Boolean)));
}

export async function saveObjective(input: ObjectiveEditorInput) {
  const client = requireSupabase();
  const userId = await requireUserId();
  const objectiveName = input.objectiveName.trim();
  if (!objectiveName) throw new Error("El objetivo necesita nombre.");

  const row = {
    user_id: userId,
    objective_name: objectiveName,
    objective_name_normalized: normalizeObjectiveName(objectiveName),
    objective_type: input.objectiveType,
    priority_level: input.priorityLevel,
    objective_description: input.objectiveDescription.trim(),
    is_active: input.isActive
  };

  if (input.objectiveId) {
    const { error } = await client
      .from("objectives")
      .update(row)
      .eq("id", input.objectiveId)
      .eq("user_id", userId);
    if (error) throw error;
    return { objectiveId: input.objectiveId };
  }

  const { data, error } = await client
    .from("objectives")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return { objectiveId: data.id as string };
}

export async function deleteObjective(objectiveId: string) {
  const client = requireSupabase();
  const userId = await requireUserId();
  const { error } = await client
    .from("objectives")
    .delete()
    .eq("id", objectiveId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function setContactObjectiveAssignments(input: ContactObjectiveAssignmentInput) {
  const client = requireSupabase();
  const userId = await requireUserId();
  const objectiveIds = Array.from(new Set(input.objectiveIds.filter(Boolean)));

  const { data: existingRows, error: existingError } = await client
    .from("contact_objective_assignments")
    .select("id,objective_id")
    .eq("user_id", userId)
    .eq("contact_id", input.contactId);
  if (existingError) throw existingError;

  const existing = new Map(((existingRows ?? []) as Array<{ id: string; objective_id: string }>).map((row) => [row.objective_id, row.id]));
  const next = new Set(objectiveIds);
  const toDelete = Array.from(existing.entries())
    .filter(([objectiveId]) => !next.has(objectiveId))
    .map(([, assignmentId]) => assignmentId);
  const toInsert = objectiveIds.filter((objectiveId) => !existing.has(objectiveId));

  if (toDelete.length) {
    const { error } = await client
      .from("contact_objective_assignments")
      .delete()
      .eq("user_id", userId)
      .in("id", toDelete);
    if (error) throw error;
  }

  if (toInsert.length) {
    const { error } = await client.from("contact_objective_assignments").insert(
      toInsert.map((objectiveId) => ({
        user_id: userId,
        contact_id: input.contactId,
        objective_id: objectiveId,
        assigned_by_actor: normalizeAssignmentActor(input.source)
      }))
    );
    if (error) throw error;
  }

  return { assignedObjectiveIds: objectiveIds };
}

export async function setObjectiveContactAssignments(input: { objectiveId: string; contactIds: string[] }) {
  const client = requireSupabase();
  const userId = await requireUserId();
  const contactIds = Array.from(new Set(input.contactIds.filter(Boolean)));

  const { data: existingRows, error: existingError } = await client
    .from("contact_objective_assignments")
    .select("id,contact_id")
    .eq("user_id", userId)
    .eq("objective_id", input.objectiveId);
  if (existingError) throw existingError;

  const existing = new Map(((existingRows ?? []) as Array<{ id: string; contact_id: string }>).map((row) => [row.contact_id, row.id]));
  const next = new Set(contactIds);
  const toDelete = Array.from(existing.entries())
    .filter(([contactId]) => !next.has(contactId))
    .map(([, assignmentId]) => assignmentId);
  const toInsert = contactIds.filter((contactId) => !existing.has(contactId));

  if (toDelete.length) {
    const { error } = await client
      .from("contact_objective_assignments")
      .delete()
      .eq("user_id", userId)
      .in("id", toDelete);
    if (error) throw error;
  }

  if (toInsert.length) {
    const { error } = await client.from("contact_objective_assignments").insert(
      toInsert.map((contactId) => ({
        user_id: userId,
        contact_id: contactId,
        objective_id: input.objectiveId,
        assigned_by_actor: normalizeAssignmentActor("user")
      }))
    );
    if (error) throw error;
  }

  return { assignedContactIds: contactIds };
}

export async function addObjectiveAssignmentsToContacts(input: BulkContactObjectiveAssignmentInput) {
  const client = requireSupabase();
  const userId = await requireUserId();
  const contactIds = Array.from(new Set(input.contactIds.filter(Boolean)));
  const objectiveIds = Array.from(new Set(input.objectiveIds.filter(Boolean)));
  if (!contactIds.length || !objectiveIds.length) {
    return { assignedContactCount: 0, assignedObjectiveCount: 0, insertedAssignments: 0 };
  }

  const { data: objectiveRows, error: objectiveError } = await client
    .from("objectives")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("id", objectiveIds);
  if (objectiveError) throw objectiveError;

  const validObjectiveIds = Array.from(new Set((objectiveRows ?? []).map((row) => String(row.id))));
  if (!validObjectiveIds.length) {
    return { assignedContactCount: contactIds.length, assignedObjectiveCount: 0, insertedAssignments: 0 };
  }

  const existingKeys = new Set<string>();
  for (const contactIdBatch of chunk(contactIds, ASSIGNMENT_READ_BATCH_SIZE)) {
    const { data: existingRows, error: existingError } = await client
      .from("contact_objective_assignments")
      .select("contact_id,objective_id")
      .eq("user_id", userId)
      .in("contact_id", contactIdBatch)
      .in("objective_id", validObjectiveIds);
    if (existingError) throw existingError;

    for (const row of (existingRows ?? []) as Array<{ contact_id: string; objective_id: string }>) {
      existingKeys.add(`${row.contact_id}:${row.objective_id}`);
    }
  }

  const rowsToInsert = contactIds.flatMap((contactId) =>
    validObjectiveIds
      .filter((objectiveId) => !existingKeys.has(`${contactId}:${objectiveId}`))
      .map((objectiveId) => ({
        user_id: userId,
        contact_id: contactId,
        objective_id: objectiveId,
        assigned_by_actor: normalizeAssignmentActor(input.source)
      }))
  );

  let insertedAssignments = 0;
  for (const rowBatch of chunk(rowsToInsert, 400)) {
    const { error } = await client.from("contact_objective_assignments").insert(rowBatch);
    if (error) throw error;
    insertedAssignments += rowBatch.length;
  }

  return {
    assignedContactCount: contactIds.length,
    assignedObjectiveCount: validObjectiveIds.length,
    insertedAssignments
  };
}

export function normalizeObjectiveName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function objectiveTypeLabel(type: ObjectiveType) {
  return OBJECTIVE_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function objectivePriorityLabel(priority: ObjectivePriority) {
  return OBJECTIVE_PRIORITIES.find((item) => item.value === priority)?.label ?? priority;
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function requireUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");
  return userId;
}

function isMissingObjectivesTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return OBJECTIVE_TABLE_MISSING_CODES.has(code) || message.includes("objectives") && message.includes("schema cache");
}

function normalizeAssignmentActor(source: string | undefined) {
  const cleanSource = (source || "user").trim();
  return ASSIGNMENT_ACTORS.has(cleanSource) ? cleanSource : "user";
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
