import test from "node:test";
import assert from "node:assert/strict";

import { buildObjectiveMetrics } from "../lib/objectiveMetrics.ts";
import type { ContactRow, InteractionParticipantRow, InteractionRow, ObjectiveRow } from "../lib/readModel.ts";

function objective(overrides: Partial<ObjectiveRow> & { id: string; objective_name: string }): ObjectiveRow {
  const { id, objective_name, ...rest } = overrides;
  return {
    id,
    objective_name,
    objective_name_normalized: objective_name.toLowerCase(),
    objective_type: overrides.objective_type ?? "COMPANY",
    priority_level: overrides.priority_level ?? "MEDIUM",
    objective_description: "",
    is_active: true,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...rest
  };
}

function contact(overrides: Partial<ContactRow> & { id: string; objectiveIds?: string[] }): ContactRow {
  const { id, objectiveIds = [], ...rest } = overrides;
  return {
    id,
    display_name: overrides.display_name ?? id,
    company: "",
    role: "",
    networking_status: overrides.networking_status ?? "Pendiente",
    networking_focus: overrides.networking_focus ?? true,
    is_headhunter: false,
    headhunter_domains: [],
    is_active: true,
    updated_at: "2026-08-01T00:00:00Z",
    contact_emails: [],
    contact_phones: [],
    contact_objective_assignments: objectiveIds.map((objectiveId, index) => ({
      id: `${id}-${objectiveId}-${index}`,
      contact_id: id,
      objective_id: objectiveId,
      assigned_by_actor: "user",
      assigned_at: "2026-08-01T00:00:00Z"
    })),
    ...rest
  };
}

function interaction(id: string, occurred_at: string): InteractionRow {
  return {
    id,
    interaction_type: "email",
    direction: "unknown",
    occurred_at,
    subject: "",
    metadata: null
  };
}

function participant(interaction_id: string, contact_id: string): InteractionParticipantRow {
  return {
    interaction_id,
    contact_id,
    email_identity: null,
    role: "TO"
  };
}

test("incluye objetivos activos sin contactos y ordena por prioridad", () => {
  const rows = buildObjectiveMetrics({
    objectives: [
      objective({ id: "medium", objective_name: "Amazon", priority_level: "MEDIUM" }),
      objective({ id: "high", objective_name: "Nubank", priority_level: "HIGH" })
    ],
    contacts: [],
    interactions: [],
    participants: [],
    today: new Date("2026-08-20T00:00:00Z")
  });

  assert.deepEqual(rows.map((row) => row.objectiveName), ["Nubank", "Amazon"]);
  assert.equal(rows[0].contactCount, 0);
  assert.equal(rows[0].coffeeCount, 0);
  assert.equal(rows[0].lastInteractionAt, null);
});

test("cuenta contactos e interacciones unicas por objetivo", () => {
  const rows = buildObjectiveMetrics({
    objectives: [
      objective({ id: "fintech", objective_name: "Fintech", objective_type: "INDUSTRY", priority_level: "HIGH" }),
      objective({ id: "strategy", objective_name: "Strategy", objective_type: "FUNCTION", priority_level: "HIGH" })
    ],
    contacts: [
      contact({ id: "c1", objectiveIds: ["fintech", "strategy"], networking_status: "Contactado" }),
      contact({ id: "c2", objectiveIds: ["fintech"], networking_status: "Agradecimiento enviado", networking_focus: false })
    ],
    interactions: [
      { ...interaction("shared", "2026-08-10T00:00:00Z"), interaction_type: "calendar" },
      { ...interaction("only-c1", "2026-08-15T00:00:00Z"), interaction_type: "call" }
    ],
    participants: [
      participant("shared", "c1"),
      participant("shared", "c2"),
      participant("only-c1", "c1")
    ],
    today: new Date("2026-08-20T00:00:00Z")
  });

  const fintech = rows.find((row) => row.objectiveId === "fintech");
  const strategy = rows.find((row) => row.objectiveId === "strategy");
  assert.ok(fintech);
  assert.ok(strategy);
  assert.equal(fintech.contactCount, 2);
  assert.equal(fintech.focusContactCount, 1);
  assert.equal(fintech.coffeeCount, 2);
  assert.equal(fintech.networkingStatus, "Agradecimiento enviado");
  assert.equal(strategy.contactCount, 1);
  assert.equal(strategy.coffeeCount, 2);
  assert.equal(strategy.daysSinceLastInteraction, 5);
});

test("cuenta solo llamadas y calendario desde la fecha de inicio de networking", () => {
  const rows = buildObjectiveMetrics({
    objectives: [objective({ id: "nubank", objective_name: "Nubank", priority_level: "HIGH" })],
    contacts: [contact({ id: "c1", objectiveIds: ["nubank"] })],
    interactions: [
      { ...interaction("old-call", "2026-01-01T00:00:00Z"), interaction_type: "call" },
      { ...interaction("new-mail", "2026-08-11T00:00:00Z"), interaction_type: "email" },
      { ...interaction("new-calendar", "2026-08-12T00:00:00Z"), interaction_type: "calendar" }
    ],
    participants: [
      participant("old-call", "c1"),
      participant("new-mail", "c1"),
      participant("new-calendar", "c1")
    ],
    networkingStartDate: new Date("2026-08-01T00:00:00Z"),
    today: new Date("2026-08-20T00:00:00Z")
  });

  assert.equal(rows[0].coffeeCount, 1);
  assert.equal(rows[0].lastInteractionAt, "2026-08-12T00:00:00Z");
});
