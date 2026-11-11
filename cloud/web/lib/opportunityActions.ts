"use client";

import { expectedNetworkingContext, networkingContextFromCycles, readNetworkingCycles } from "./networkingCycles";
import { collectOpportunityPages, opportunityClosureValid, type Opportunity, type OpportunityResult, type OpportunityStage } from "./opportunityModel";
import { supabase } from "./supabaseClient";
import { OpportunityFailure, opportunityFailure, opportunityPhase } from "./opportunityDiagnostics";
import { CALENDAR_VISIBILITY_JOIN, withoutCancelledCalendar } from "./interactionState";

function client() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

async function userId() {
  return opportunityPhase("auth", async () => {
  const { data, error } = await client().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new OpportunityFailure("auth", "rejected", "no_session", null);
  return data.user.id;
  });
}

export type OpportunityInput = {
  id?: string;
  creationRequestId?: string;
  expectedUpdatedAt?: string;
  title: string;
  company: string;
  applicationUrl: string;
  stage: OpportunityStage;
  situation: "active" | "finalized";
  result: OpportunityResult | null;
  resultNote: string;
  contactIds: string[];
  objectiveIds: string[];
  interactionIds: string[];
};

export async function readOpportunities(): Promise<Opportunity[]> {
  const [cycles, owner, context] = await Promise.all([readNetworkingCycles(), userId(), expectedNetworkingContext()]);
  if (networkingContextFromCycles(cycles).token !== context.token) throw new Error("El ciclo cambió. Actualiza la página.");
  const active = cycles.find((cycle) => cycle.status === "active" && cycle.objective_type === "JOB_SEARCH");
  if (!active) return [];
  const rows = await collectOpportunityPages<Omit<Opportunity, "contact_ids" | "objective_ids" | "interaction_ids">>(async (from, to) => {
    const { data, error, count } = await client().from("opportunities")
    .select("id,cycle_id,title,company,application_url,stage,situation,result,result_note,voided_at,updated_at", { count: "exact" })
    .eq("user_id", owner).eq("cycle_id", active.id).is("voided_at", null)
    .order("id").range(from, to);
    if (error) throw error;
    return { rows: data ?? [], total: count };
  });
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [contacts, objectives, interactions] = await Promise.all([
    readLinks("opportunity_contacts", "contact_id", owner, ids),
    readLinks("opportunity_objectives", "objective_id", owner, ids),
    readLinks("opportunity_interactions", "interaction_id", owner, ids)
  ]);
  // Keep technical IDs for later edits; a cancelled source must not inflate the visible counter.
  const interactionIds = [...new Set(interactions.map(link => link.interaction_id))];
  const visibleIds = new Set<string>();
  for (let index = 0; index < interactionIds.length; index += 100) {
    const visible = await collectOpportunityPages<{ id: string }>(async (from, to) => {
      const { data, error, count } = await withoutCancelledCalendar(client().from("interactions")
        .select(`id,${CALENDAR_VISIBILITY_JOIN}`, { count: "exact" }))
        .eq("user_id", owner).in("id", interactionIds.slice(index, index + 100)).order("id").range(from, to);
      if (error) throw error;
      return { rows: data ?? [], total: count };
    });
    visible.forEach(row => visibleIds.add(row.id));
  }
  // Separate paged reads must not combine old fields with newly replaced links.
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await client().from("opportunities").select("id,updated_at")
      .eq("user_id", owner).in("id", ids.slice(index, index + 100));
    if (error) throw error;
    if (data?.length !== ids.slice(index, index + 100).length || data.some((row) =>
      rows.find((original) => original.id === row.id)?.updated_at !== row.updated_at)) {
      throw new Error("Las oportunidades cambiaron. Intenta nuevamente.");
    }
  }
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((row) => ({ ...row,
    contact_ids: contacts.filter((link) => link.opportunity_id === row.id).map((link) => link.contact_id),
    objective_ids: objectives.filter((link) => link.opportunity_id === row.id).map((link) => link.objective_id),
    interaction_ids: interactions.filter((link) => link.opportunity_id === row.id).map((link) => link.interaction_id),
    visible_interaction_count: interactions.filter(link => link.opportunity_id === row.id && visibleIds.has(link.interaction_id)).length
  }));
}

export async function saveOpportunity(input: OpportunityInput) {
  await userId();
  const context = await opportunityPhase("context", expectedNetworkingContext);
  if (!context.cycleId) throw new OpportunityFailure("context", "rejected", "no_active_cycle", null);
  const title = input.title.trim();
  if (!title || title.length > 180 || !opportunityClosureValid(input.stage, input.situation, input.result)) {
    throw new OpportunityFailure("rpc", "rejected", "invalid_input", null);
  }
  return opportunityPhase("rpc", async () => {
  const { data, error, status } = await client().rpc("save_opportunity_v2", {
    p_expected_cycle_id: context.cycleId, p_expected_context: context.token,
    p_opportunity_id: input.id ?? null, p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_creation_request_id: input.creationRequestId ?? null,
    p_title: title, p_company: input.company.trim(),
    p_application_url: input.applicationUrl.trim(), p_stage: input.stage, p_result: input.result,
    p_situation: input.situation,
    p_result_note: input.situation === "finalized" ? input.resultNote.trim() : null,
    p_contact_ids: [...new Set(input.contactIds)], p_objective_ids: [...new Set(input.objectiveIds)],
    p_interaction_ids: [...new Set(input.interactionIds)]
  });
  if (error) throw opportunityFailure("rpc", error, status);
  if (typeof data !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(data)) {
    throw opportunityFailure("rpc", null);
  }
  return data;
  });
}

export async function voidOpportunity(id: string) {
  const context = await expectedNetworkingContext();
  if (!context.cycleId) throw new Error("No hay ciclo activo.");
  const { error } = await client().rpc("void_opportunity_v1", {
    p_expected_cycle_id: context.cycleId, p_expected_context: context.token, p_opportunity_id: id
  });
  if (error) throw error;
}

export async function readOpportunityChoices() {
  const owner = await userId();
  const [contacts, objectives] = await Promise.allSettled([
    readChoiceRows<{ id: string; display_name: string }>("contacts", "id,display_name", owner, "is_active"),
    readObjectiveChoices(owner)
  ]);
  return { contacts, objectives };
}

export async function readEligibleOpportunityInteractions(contactIds: string[]) {
  if (!contactIds.length) return [];
  const owner = await userId();
  const ids = new Set<string>();
  for (let index = 0; index < contactIds.length; index += 100) {
    const part = contactIds.slice(index, index + 100);
    const links = await opportunityPhase("participants", () => collectOpportunityPages<{ id: string; interaction_id: string }>(async (from, to) => {
      const { data, error, count, status } = await client().from("interaction_participants").select("id,interaction_id", { count: "exact" })
        .eq("user_id", owner).in("contact_id", part).order("id").range(from, to);
      if (error) throw opportunityFailure("participants", error, status);
      return { rows: data ?? [], total: count };
    }));
    links.forEach((link) => ids.add(link.interaction_id));
  }
  const interactions: { id: string; subject: string | null; interaction_type: string; occurred_at: string | null }[] = [];
  const candidates = [...ids];
  for (let index = 0; index < candidates.length; index += 100) {
    const part = candidates.slice(index, index + 100);
    interactions.push(...await opportunityPhase("interactions", () => collectOpportunityPages<{
      id: string; subject: string | null; interaction_type: string; occurred_at: string | null
    }>(async (from, to) => {
      const { data, error, count, status } = await client().rpc("read_opportunity_interactions_v1",
        { p_ids: part }, { count: "exact" }).order("id").range(from, to);
      if (error) throw opportunityFailure("interactions", error, status);
      return { rows: data ?? [], total: count };
    })));
  }
  return interactions.sort((a, b) => a.id.localeCompare(b.id));
}

async function readObjectiveChoices(owner: string) {
  const context = await opportunityPhase("context", expectedNetworkingContext);
  if (!context.cycleId) return [];
  return collectOpportunityPages<{ id: string; objective_name: string; objective_type: "COMPANY" | "INDUSTRY" | "ROLE" | "FUNCTION"; priority_level: "HIGH" | "MEDIUM" | "LOW" }>(async (from, to) => {
    const { data, error, count } = await client().from("objectives").select("id,objective_name,objective_type,priority_level", { count: "exact" })
      .eq("user_id", owner).eq("cycle_id", context.cycleId).eq("is_active", true).order("id").range(from, to);
    if (error) throw error;
    return { rows: data ?? [], total: count };
  });
}

async function readLinks<K extends "contact_id" | "objective_id" | "interaction_id">(
  table: string, key: K, owner: string, ids: string[]
): Promise<Array<{ opportunity_id: string } & Record<K, string>>> {
  const links: Array<{ opportunity_id: string } & Record<K, string>> = [];
  for (let index = 0; index < ids.length; index += 100) {
    links.push(...await collectOpportunityPages(async (from, to) => {
      const { data, error, count } = await client().from(table).select(`opportunity_id,${key}`, { count: "exact" }).eq("user_id", owner)
        .in("opportunity_id", ids.slice(index, index + 100)).order("opportunity_id").order(key).range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Array<{ opportunity_id: string } & Record<K, string>>, total: count };
    }));
  }
  return links;
}

async function readChoiceRows<T>(table: "contacts" | "interactions", columns: string, owner: string,
  flag: "is_active" | "is_deleted", value = true): Promise<T[]> {
  return collectOpportunityPages<T>(async (from, to) => {
    const { data, error, count } = await client().from(table).select(columns, { count: "exact" }).eq("user_id", owner)
      .eq(flag, value).order("id").range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as T[], total: count };
  });
}
