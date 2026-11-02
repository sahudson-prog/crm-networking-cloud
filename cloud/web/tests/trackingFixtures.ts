import type { TrackingSnapshot } from "../lib/trackingModel.ts";
export function trackingFixture(): TrackingSnapshot {
  return {
    version: 1, as_of: "2026-10-30T16:00:00Z",
    cycle: { id: "cycle", started_at: "2025-01-15T15:00:00Z", timezone_name: "America/Santiago" },
    contacts: ["a", "b", "c"].map(id => ({ id, company: "", networking_status: id === "a" ? "Cita concretada" : "Pendiente",
      networking_focus: true, is_headhunter: false, headhunter_domains: [], contact_emails: [] })),
    transitions: [{ id: "t0", contact_id: "a", previous_status: "Pendiente", next_status: "Cita concretada", changed_at: "2026-09-01T14:00:00Z" }],
    interactions: [], participants: [], sources: [], companies: [],
    priorities: ["p", "q"].map(id => ({ id, objective_name: id === "p" ? "Tecnología" : "Consultoría", objective_type: "INDUSTRY", priority_level: "HIGH" })),
    assignments: [{ contact_id: "a", objective_id: "p" }, { contact_id: "a", objective_id: "q" }, { contact_id: "b", objective_id: "q" }],
    opportunities: [
      { id: "o", stage: "offer_received", situation: "active", result: null, contact_ids: ["a"], objective_ids: ["p", "q"] },
      { id: "o2", stage: "offer_received", situation: "finalized", result: "offer_accepted", contact_ids: [], objective_ids: ["q"] },
      { id: "o3", stage: "applied", situation: "finalized", result: "not_selected", contact_ids: [], objective_ids: [] },
      { id: "o4", stage: "offer_received", situation: "voided", result: "offer_accepted", contact_ids: ["a"], objective_ids: ["p"] }
    ]
  };
}
export function coffee(s: TrackingSnapshot, id: string, at: string, contact = "a", type = "calendar") {
  s.interactions.push({ id, interaction_type: type, occurred_at: at, metadata: { ics_import: { version: 1, status: "CONFIRMED", method: "PUBLISH" } } });
  s.participants.push({ interaction_id: id, contact_id: contact });
  s.sources.push({ interaction_id: id, provider: "ics", source_service: "ics_import", sync_status: "imported", is_active: true });
}
