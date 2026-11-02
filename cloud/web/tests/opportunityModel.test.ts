import assert from "node:assert/strict";
import test from "node:test";
import { OPPORTUNITY_STAGES, opportunityResultsForStage, opportunityClosureValid, collectOpportunityPages, opportunityCounts, opportunityMoveIntent,
  type Opportunity } from "../lib/opportunityModel.ts";

const row = (stage: Opportunity["stage"], result: Opportunity["result"] = null, voided = false): Opportunity => ({
  id: crypto.randomUUID(), cycle_id: "cycle", title: "Synthetic", company: null, application_url: null,
  stage, situation: voided ? "voided" : result ? "finalized" : "active", result, result_note: null, voided_at: voided ? "2026-01-01T00:00:00Z" : null,
  updated_at: "2026-01-01T00:00:00Z",
  contact_ids: [], objective_ids: [], interaction_ids: []
});

test("four stages have the exact approved stage-specific outcomes", () => {
  assert.equal(OPPORTUNITY_STAGES.length, 4);
  assert.deepEqual(OPPORTUNITY_STAGES.map(([value]) => value),
    ["identified", "applied", "in_process", "offer_received"]);
  const expected = [
    ["Descartada por mí", "Plazo de postulación vencido", "Vacante cancelada", "Otro"],
    ["No seleccionado", "Postulación retirada por mí", "Vacante cancelada", "Sin respuesta", "Otro"],
    ["No seleccionado", "Proceso retirado por mí", "Vacante cancelada", "Sin respuesta", "Otro"],
    ["Oferta aceptada", "Oferta declinada", "Oferta expirada", "Otro"]
  ];
  OPPORTUNITY_STAGES.forEach(([stage], index) => {
    assert.deepEqual(opportunityResultsForStage(stage).map(([, label]) => label), expected[index]);
    for (const [result] of opportunityResultsForStage(stage)) {
      assert.equal(opportunityClosureValid(stage, "finalized", result), true);
      assert.equal(opportunityClosureValid(stage, "active", result), false);
    }
    assert.equal(opportunityClosureValid(stage, "finalized", null), false);
    assert.equal(opportunityClosureValid(stage, "active", null), true);
    assert.equal(opportunityClosureValid(stage, "voided", null), false);
  });
});

test("current stage and result, not historical visits, drive offers", () => {
  const onceOfferedNowApplied = row("applied");
  const currentOffer = row("offer_received");
  const accepted = row("offer_received", "offer_accepted");
  const declined = row("offer_received", "offer_declined");
  const expired = row("offer_received", "offer_expired");
  const otherOffer = row("offer_received", "other");
  const noOffer = row("in_process", "not_selected");
  const voided = row("offer_received", "offer_accepted", true);
  assert.deepEqual(opportunityCounts([onceOfferedNowApplied,currentOffer,accepted,declined,expired,otherOffer,noOffer,voided]),
    { opportunities: 7, offers: 5, successfulOffers: 1 });
  assert.deepEqual(opportunityCounts([row("offer_received"),row("applied")]),
    { opportunities: 2, offers: 1, successfulOffers: 0 });
});

test("stage movement remains independent of closure", () => {
  assert.equal(opportunityMoveIntent("applied", "identified"), "save_without_result");
  assert.equal(opportunityMoveIntent("offer_received", "identified"), "save_without_result");
  assert.equal(opportunityMoveIntent("identified", "identified"), "unchanged");
});

test("paged relations are complete beyond a server page, including an exact page boundary", async () => {
  for (const count of [0, 200, 1257]) {
    const source = Array.from({ length: count }, (_, id) => id);
    assert.deepEqual(await collectOpportunityPages(async (from, to) => ({ rows: source.slice(from, to + 1), total: count })), source);
  }
});

test("a failed page never yields a partial set that could overwrite persisted links", async () => {
  await assert.rejects(collectOpportunityPages(async (from) => {
    if (from) throw new Error("read failed");
    return { rows: Array.from({ length: 200 }, (_, id) => id), total: 401 };
  }), /read failed/);
});

test("server cap below requested size does not truncate 401 rows", async () => {
  const source = Array.from({ length: 401 }, (_, id) => id);
  assert.deepEqual(await collectOpportunityPages(async (from, to) => ({
    rows: source.slice(from, Math.min(to + 1, from + 100)), total: source.length
  })), source);
});

test("missing/changing totals, duplicates and empty partial pages fail closed", async () => {
  for (const read of [
    async () => ({ rows: [1], total: null }),
    async (from: number) => ({ rows: [from], total: from ? 3 : 2 }),
    async () => ({ rows: [1], total: 2 }),
    async (from: number) => ({ rows: from ? [] : [1], total: 2 })
  ]) await assert.rejects(collectOpportunityPages(read), /opportunity_read_incomplete/);
});
