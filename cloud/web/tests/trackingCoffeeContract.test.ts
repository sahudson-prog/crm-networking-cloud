import test from "node:test";
import assert from "node:assert/strict";
import { buildTracking, defaultTrackingFilters, futureHorizonEnd, trackingPeriods, type TrackingSnapshot } from "../lib/trackingModel.ts";
import { localDateTimeValue } from "../lib/networkingCycleTime.ts";
import { coffee, trackingFixture } from "./trackingFixtures.ts";

function ready(snapshot: TrackingSnapshot) {
  const model = buildTracking(snapshot);
  assert.equal(model.state, "ready");
  if (model.state !== "ready") throw Error("fixture");
  return model;
}
function pending(snapshot: TrackingSnapshot) {
  snapshot.contacts[0].networking_status = "Pendiente";
  snapshot.transitions = [];
}
function total(model: ReturnType<typeof ready>, mode: "weekly" | "monthly", color: "blue" | "green") {
  return trackingPeriods(model, mode).periods.reduce((sum, period) => sum + (period?.[color] ?? 0), 0);
}
function entry(snapshot: TrackingSnapshot, id: string, previous: string, next: string, changedAt: string) {
  snapshot.transitions.push({ id, contact_id: "a", previous_status: previous, next_status: next, changed_at: changedAt });
  snapshot.contacts[0].networking_status = next;
}

test("pending with past calendar or calls never becomes a coffee; future calendar counts once", () => {
  const s = trackingFixture(); pending(s);
  coffee(s, "past", "2026-10-01T12:00:00Z");
  coffee(s, "call", "2026-10-02T12:00:00Z", "a", "call");
  assert.deepEqual([ready(s).counts[1], ready(s).blue.size, total(ready(s), "weekly", "green")], [0, 0, 0]);
  coffee(s, "future-later", "2026-11-04T12:00:00Z");
  coffee(s, "future-first", "2026-11-01T12:00:00Z");
  const m = ready(s);
  assert.equal(m.counts[1], 0); assert.equal(m.blue.size, 0);
  assert.equal(m.green.get("person:a"), Date.parse("2026-11-01T12:00:00Z"));
  assert.equal(total(m, "weekly", "green"), 1);
  assert.equal(trackingPeriods(m, "weekly").periods.find(p => p?.key === "2026-10-26")?.green, 1);
});

test("current eligible state uses oldest valid past calendar, never a call or a future appointment", () => {
  const s = trackingFixture();
  coffee(s, "late", "2026-10-28T12:00:00Z");
  coffee(s, "first", "2026-10-01T12:00:00Z");
  coffee(s, "call", "2026-08-01T12:00:00Z", "a", "call");
  coffee(s, "future", "2026-11-01T12:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-10-01T12:00:00Z"));
  assert.equal(ready(s).green.size, 0);
  s.interactions = s.interactions.filter(i => i.occurred_at && Date.parse(i.occurred_at) >= Date.parse(s.as_of));
  const fallback = ready(s);
  assert.equal(fallback.counts[1], 1);
  assert.equal(fallback.blue.get("person:a"), Date.parse(s.transitions[0].changed_at));
  assert.equal(fallback.green.size, 0);
});

test("five-layer pyramid retains received offers between processes and accepted offers", () => {
  const s = trackingFixture();
  s.transitions = [];
  s.contacts[1].networking_status = "Contactado";
  assert.deepEqual(ready(s).counts, [2, 1, 2, 2, 1]);
  assert.deepEqual(ready(s).ratios, [50, 200, 100, 50]);
  s.opportunities[0].stage = "identified";
  s.opportunities[1].stage = "applied";
  s.opportunities[1].result = "not_selected";
  assert.deepEqual(ready(s).counts, [2, 1, 0, 0, 0]);
  assert.equal(ready(s).ratios[2], null);
  s.opportunities[0].stage = "in_process";
  assert.equal(ready(s).counts[2], 1);
  assert.equal(ready(s).counts[3], 0);
});

test("past meeting and status fallback partition accredited blue without changing totals", () => {
  const s = trackingFixture();
  coffee(s, "past", "2026-10-01T12:00:00Z");
  s.contacts[1].networking_status = "Agradecimiento enviado";
  s.transitions.push({ id: "b-entry", contact_id: "b", previous_status: "Pendiente",
    next_status: "Agradecimiento enviado", changed_at: "2026-10-02T12:00:00Z" });
  const m = ready(s);
  assert.equal(m.blueActual.size, 1);
  assert.equal(m.blueEstimated.size, 1);
  assert.equal(m.blueActual.size + m.blueEstimated.size, m.blue.size);
  const periods = trackingPeriods(m, "monthly").periods.filter((p): p is NonNullable<typeof p> => p !== null);
  assert.equal(periods.reduce((n, p) => n + p.blueActual + p.blueEstimated, 0),
    periods.reduce((n, p) => n + p.blue, 0));
  assert.equal(periods.find(p => p.key === "2026-10-01")?.blue, 2);
});

test("eligible sequence retains first entry through thanks; leaving and re-entering resets its date", () => {
  const s = trackingFixture(); s.transitions = [];
  entry(s, "1", "Pendiente", "Cita concretada", "2026-09-01T12:00:00Z");
  entry(s, "2", "Cita concretada", "Agradecimiento enviado", "2026-09-03T12:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-09-01T12:00:00Z"));
  entry(s, "3", "Agradecimiento enviado", "Contactado", "2026-09-05T12:00:00Z");
  assert.equal(ready(s).counts[1], 0);
  entry(s, "4", "Contactado", "Agradecimiento enviado", "2026-10-05T12:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-10-05T12:00:00Z"));
});

test("transition order follows instants, not textual timezone offsets", () => {
  const s = trackingFixture(); s.transitions = [];
  entry(s, "1", "Pendiente", "Cita concretada", "2026-10-01T10:00:00-03:00");
  entry(s, "2", "Cita concretada", "Contactado", "2026-10-01T12:00:00Z");
  entry(s, "3", "Cita concretada", "Agradecimiento enviado", "2026-10-02T10:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-10-01T10:00:00-03:00"));
});

test("eligible without usable timestamp remains in pyramid and is reported without invented blue date", () => {
  const s = trackingFixture(); s.transitions = [];
  coffee(s, "future", "2026-11-01T12:00:00Z");
  coffee(s, "call", "2026-10-01T12:00:00Z", "a", "call");
  const m = ready(s);
  assert.equal(m.counts[1], 1); assert.equal(m.blue.size, 0);
  assert.equal(m.unattributedCoffeeCount, 1); assert.equal(m.green.size, 0);
  assert.equal(total(m, "weekly", "blue"), 0);
});

test("calendar lifecycle, duplicate participants and source rows never create duplicate or invalid evidence", () => {
  const s = trackingFixture(); s.transitions = [];
  coffee(s, "cancel", "2026-09-01T12:00:00Z"); s.interactions[0].metadata.ics_import!.status = "CANCELLED";
  coffee(s, "dismiss", "2026-09-02T12:00:00Z"); s.interactions[1].metadata.dismissed = true;
  coffee(s, "soft", "2026-09-03T12:00:00Z"); s.interactions[2].is_deleted = true;
  coffee(s, "source", "2026-09-04T12:00:00Z"); s.sources[3].sync_status = "deleted_at_source";
  coffee(s, "valid", "2026-07-01T12:00:00Z");
  s.participants.push({ interaction_id: "valid", contact_id: "a" });
  s.sources.push({ ...s.sources[4] });
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-07-01T12:00:00Z"));
  assert.equal(total(ready(s), "weekly", "blue"), 0);
  assert.equal(total(ready(s), "monthly", "blue"), 1);
});

test("weekly horizon is 14 local calendar days exclusive; monthly ends at third next month", () => {
  const s = trackingFixture(); pending(s);
  const now = Date.parse(s.as_of);
  const weeklyEnd = futureHorizonEnd(now, s.cycle!.timezone_name!, "weekly");
  const monthlyEnd = futureHorizonEnd(now, s.cycle!.timezone_name!, "monthly");
  assert.equal(localDateTimeValue(new Date(weeklyEnd), "America/Santiago"), "2026-11-13T13:00:00");
  assert.equal(localDateTimeValue(new Date(monthlyEnd), "America/Santiago"), "2027-01-01T00:00:00");
  coffee(s, "weekly-last", new Date(weeklyEnd - 1).toISOString());
  coffee(s, "weekly-excluded", new Date(weeklyEnd).toISOString(), "b");
  coffee(s, "december", "2026-12-25T12:00:00Z", "c");
  const m = ready(s);
  assert.equal(total(m, "weekly", "green"), 1);
  assert.equal(total(m, "monthly", "green"), 3);
  s.interactions.find(i => i.id === "weekly-last")!.metadata.dismissed = true;
  assert.equal(total(ready(s), "weekly", "green"), 0);
  assert.equal(total(ready(s), "monthly", "green"), 2);
  coffee(s, "january", new Date(monthlyEnd).toISOString(), "a");
  assert.equal(total(ready(s), "monthly", "green"), 2);
});

test("DST changes local 14-day endpoint without changing Monday/month bucketing", () => {
  const at = Date.parse("2026-08-30T12:00:00Z");
  const end = futureHorizonEnd(at, "America/Santiago", "weekly");
  assert.equal(localDateTimeValue(new Date(end), "America/Santiago"), "2026-09-13T08:00:00");
  assert.notEqual(end - at, 14 * 86_400_000);
  const s = trackingFixture(); pending(s); s.as_of = new Date(at).toISOString();
  s.cycle!.started_at = "2026-08-01T12:00:00Z";
  coffee(s, "inside", new Date(end - 1).toISOString());
  coffee(s, "outside", new Date(end).toISOString(), "b");
  assert.equal(total(ready(s), "weekly", "green"), 1);
});

test("all-cycle accredited total is independent of visible 12 slots; zero-blue mismatch is explicit", () => {
  const s = trackingFixture();
  coffee(s, "old", "2025-02-01T12:00:00Z");
  const m = ready(s);
  assert.equal(m.blue.size + m.unattributedCoffeeCount, m.counts[1]);
  assert.equal(m.blue.size, 1);
  assert.equal(total(m, "weekly", "blue"), 0);
  assert.equal(trackingPeriods(m, "monthly").periods.length, 12);
  assert.equal(trackingPeriods(m, "monthly").periods[9]?.key, "2026-10-01");
});

test("HH and priority filters retain one unit per group and never convert pending meetings into coffees", () => {
  const s = trackingFixture();
  s.companies = [{ id: "hh", displayName: "HH", normalizedName: "hh", domains: ["@hh.invalid"] }];
  for (const c of s.contacts) { c.is_headhunter = true; c.company = "HH"; }
  coffee(s, "past-b", "2026-10-01T12:00:00Z", "b");
  coffee(s, "future-b", "2026-11-01T12:00:00Z", "b");
  const m = buildTracking(s, { ...defaultTrackingFilters, headhunters: "only", groupHeadhunters: true, priorityIds: ["p", "q"] });
  assert.equal(m.state, "ready");
  if (m.state !== "ready") throw Error("fixture");
  assert.equal(m.counts[1], 1); assert.equal(m.blue.size, 1);
  assert.equal(total(m, "weekly", "green"), 1);
  assert.deepEqual(m.priorities.map(p => p.coffeeCount), [1, 1]);
});
