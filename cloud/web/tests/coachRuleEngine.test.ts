import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNetworkingStatusCandidate } from "../lib/coachRuleEngine.ts";

type TestContact = {
  id: string;
  display_name: string;
  networking_status: string;
  networking_focus: boolean;
  is_active: boolean;
  updated_at: string;
};

type TestInteraction = {
  id: string;
  legacy_entry_id: string | null;
  interaction_type: "email" | "calendar" | "call" | "message" | "manual";
  direction: "inbound" | "outbound" | "internal" | "unknown";
  occurred_at: string;
  subject: string;
  user_notes_raw: string;
  updated_at: string;
  metadata: null;
};

const baseContact: TestContact = {
  id: "contact-1",
  display_name: "Ana Pereira",
  networking_status: "Pendiente",
  networking_focus: true,
  is_active: true,
  updated_at: "2026-07-28T10:00:00Z"
};

function interaction(overrides: Partial<TestInteraction> = {}): TestInteraction {
  return {
    id: "interaction-1",
    legacy_entry_id: null,
    interaction_type: "email",
    direction: "outbound",
    occurred_at: "2026-07-20T10:00:00Z",
    subject: "Seguimiento",
    user_notes_raw: "",
    updated_at: "2026-07-20T10:00:00Z",
    metadata: null,
    ...overrides
  };
}

test("contacto pendiente con mensaje saliente sugiere Contactado", () => {
  const candidate = evaluateNetworkingStatusCandidate(baseContact, [interaction()], new Date("2026-07-28T12:00:00Z"));

  assert.equal(candidate?.ruleId, "STATUS_CONTACTED_FROM_OUTBOUND_MESSAGE");
  assert.equal(candidate?.suggestedStatus, "Contactado");
});

test("cita futura tiene mayor prelacion que mensaje saliente", () => {
  const candidate = evaluateNetworkingStatusCandidate(
    baseContact,
    [
      interaction(),
      interaction({
        id: "meeting-1",
        interaction_type: "calendar",
        direction: "unknown",
        occurred_at: "2026-08-04T14:00:00Z",
        subject: "Cafe"
      })
    ],
    new Date("2026-07-28T12:00:00Z")
  );

  assert.equal(candidate?.ruleId, "STATUS_SCHEDULED_FROM_FUTURE_EVENT");
  assert.equal(candidate?.suggestedStatus, "Agendado");
});

test("cita pasada con minuta gana sobre cita pasada sin minuta", () => {
  const candidate = evaluateNetworkingStatusCandidate(
    baseContact,
    [
      interaction({
        id: "meeting-1",
        interaction_type: "calendar",
        direction: "unknown",
        occurred_at: "2026-07-10T14:00:00Z",
        subject: "Cafe",
        user_notes_raw: "Conversamos proximo paso."
      })
    ],
    new Date("2026-07-28T12:00:00Z")
  );

  assert.equal(candidate?.ruleId, "STATUS_MEETING_DONE_FROM_MINUTE");
  assert.equal(candidate?.suggestedStatus, "Cita concretada");
});

test("mensaje posterior a cita concretada sugiere agradecimiento", () => {
  const candidate = evaluateNetworkingStatusCandidate(
    { ...baseContact, networking_status: "Cita concretada" },
    [
      interaction({
        id: "meeting-1",
        interaction_type: "calendar",
        direction: "unknown",
        occurred_at: "2026-07-10T14:00:00Z",
        subject: "Cafe"
      }),
      interaction({
        id: "email-1",
        interaction_type: "email",
        direction: "outbound",
        occurred_at: "2026-07-11T09:00:00Z",
        subject: "Gracias"
      })
    ],
    new Date("2026-07-28T12:00:00Z")
  );

  assert.equal(candidate?.ruleId, "STATUS_THANK_YOU_FROM_POST_MEETING_MESSAGE");
  assert.equal(candidate?.suggestedStatus, "Agradecimiento enviado");
});

test("contacto fuera de foco no genera sugerencia", () => {
  const candidate = evaluateNetworkingStatusCandidate(
    { ...baseContact, networking_focus: false },
    [interaction()],
    new Date("2026-07-28T12:00:00Z")
  );

  assert.equal(candidate, null);
});
