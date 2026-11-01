import test from "node:test";
import assert from "node:assert/strict";
import { buildTracking, defaultTrackingFilters as defaults, futureHorizonEnd, nextTrackingPeriodBoundary, periodKey, trackingPeriods, validateTrackingSnapshot, type TrackingFilters } from "../lib/trackingModel.ts";
import { trackingFixture, coffee } from "./trackingFixtures.ts";
import { readCompletePages } from "../lib/completeRead.ts";
function ready(s = trackingFixture(), filters: TrackingFilters = defaults) {
  const m = buildTracking(s, filters); assert.equal(m.state, "ready");
  if (m.state !== "ready") throw Error("fixture"); return m;
}
test("no cycle and unknown legacy start are not invented", () => {
  const s = trackingFixture(); s.cycle = null; assert.equal(buildTracking(s).state, "no_cycle");
  s.cycle = { id: "legacy", started_at: null, timezone_name: null };
  assert.equal(buildTracking(s).state, "unknown_start");
});
test("snapshot rejects missing sources, malformed lifecycle/links and duplicates, never partial valid totals", () => {
  assert.equal(validateTrackingSnapshot(trackingFixture()).version, 1);
  for (const change of [
    s => { delete s.sources; }, s => { delete s.cycle.started_at; }, s => { s.contacts[0].networking_focus = "true"; },
    s => { s.contacts.push(s.contacts[0]); }, s => { delete s.opportunities[0].objective_ids; }
  ] as Array<(s: any) => void>) {
    const s = trackingFixture(); change(s); assert.throws(() => validateTrackingSnapshot(s), /incomplete/);
  }
});
test("current focus filters the eligible status; missing transitions do not invent a blue date", () => {
  const s = trackingFixture(); coffee(s, "i", "2026-10-01T12:00:00Z");
  assert.deepEqual(ready(s).counts.slice(0, 2), [1, 1]);
  s.contacts[0].networking_focus = false;
  assert.deepEqual(ready(s).counts.slice(0, 3), [0, 0, 2]);
  s.contacts[0].networking_focus = true; assert.equal(ready(s).counts[1], 1);
  s.transitions = []; assert.equal(ready(s).counts[0], 1);
  assert.equal(ready(s).counts[1], 1);
});
test("three meetings and duplicate participants/sources count once; first date wins", () => {
  const s = trackingFixture(); for (let i = 1; i <= 3; i++) coffee(s, String(i), `2026-10-0${i}T12:00:00Z`);
  s.participants.push(s.participants[0]); s.sources.push(s.sources[0]);
  assert.equal(ready(s).counts[1], 1); assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-10-01T12:00:00Z"));
});
test("transition alone accredits coffee; event and late import relocate without duplicates", () => {
  const s = trackingFixture(); s.transitions[0].next_status = "Cita concretada";
  assert.equal(ready(s).counts[1], 1);
  coffee(s, "late", "2026-08-01T12:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-08-01T12:00:00Z"));
  coffee(s, "earlier", "2026-07-01T12:00:00Z");
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-07-01T12:00:00Z"));
});
test("pending person with past and future calendars has green only; future calls do not count", () => {
  const s = trackingFixture(); s.transitions = []; s.contacts[0].networking_status = "Pendiente";
  coffee(s, "f1", "2026-11-01T12:00:00Z"); coffee(s, "f2", "2026-11-02T12:00:00Z");
  coffee(s, "call-future", "2026-11-01T12:00:00Z", "b", "call");
  coffee(s, "past", "2026-10-01T12:00:00Z");
  const m = ready(s); assert.equal(m.green.size, 1); assert.equal(m.blue.size, 0);
  assert.equal(m.counts[1], 0); assert.equal(m.counts[0], 0);
  assert.equal(trackingPeriods(m, "weekly").periods.reduce((n, p) => n + (p?.green ?? 0), 0), 1);
});
test("cancellation, dismissal, optional soft-delete and source deletion fall back to next evidence", () => {
  for (const kind of ["cancel", "dismiss", "deleted", "soft", "source"]) {
    const s = trackingFixture(); coffee(s, "1", "2026-09-01T12:00:00Z"); coffee(s, "2", "2026-10-01T12:00:00Z");
    if (kind === "cancel") s.interactions[0].metadata.ics_import!.status = "CANCELLED";
    if (kind === "dismiss") s.interactions[0].metadata.dismissed = true;
    if (kind === "deleted") s.interactions[0].metadata.deleted = true;
    if (kind === "soft") s.interactions[0].is_deleted = true;
    if (kind === "source") s.sources[0].sync_status = "deleted_at_source";
    assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-10-01T12:00:00Z"), kind);
  }
});
test("local past/future calendar without external status or provenance counts; no date/contact excluded", () => {
  const s = trackingFixture(); coffee(s, "g", "2026-10-01T12:00:00Z");
  s.interactions[0].metadata = {}; s.sources[0].source_service = "calendar";
  assert.equal(ready(s).counts[1], 1);
  coffee(s, "future", "2026-11-01T12:00:00Z", "b");
  s.interactions[1].metadata = {}; s.sources = [];
  assert.equal(ready(s).green.size, 1);
  assert.equal("unknownCalendar" in ready(s), false);
  coffee(s, "call", "2026-10-02T12:00:00Z", "c", "call");
  coffee(s, "orphan", "2026-10-01T12:00:00Z", "absent");
  coffee(s, "nodate", "", "c"); assert.equal(ready(s).counts[1], 1);
});

test("local cancellation after counting updates the shared first date; a transition remains evidence", () => {
  const s = trackingFixture(); s.transitions = [];
  coffee(s, "first", "2026-08-01T12:00:00Z");
  coffee(s, "remaining", "2026-09-01T12:00:00Z");
  s.interactions[0].metadata = {}; s.interactions[1].metadata = {};
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-08-01T12:00:00Z"));
  s.interactions[0].metadata = { ics_import: { status: "CANCELLED" } };
  assert.equal(ready(s).blue.get("person:a"), Date.parse("2026-09-01T12:00:00Z"));
  s.interactions[1].metadata.dismissed = true;
  assert.equal(ready(s).counts[1], 1);
  assert.equal(ready(s).blue.size, 0);
  s.transitions.push({ id: "entry", contact_id: "a", previous_status: "Pendiente", next_status: "Cita concretada", changed_at: "2026-09-15T12:00:00Z" });
  const m = ready(s);
  assert.equal(m.blue.get("person:a"), Date.parse(s.transitions[0].changed_at));
  assert.deepEqual(m.priorities.map(p => p.coffeeCount), [1, 1]);
  assert.equal(trackingPeriods(m, "monthly").periods.reduce((n, p) => n + (p?.blue ?? 0), 0), m.counts[1]);
});

test("PostgreSQL microsecond boundaries preserve exact cycle admission and past/future classification", () => {
  const s = trackingFixture(); s.transitions = []; s.cycle!.started_at = "2026-10-30T15:00:00.000500Z";
  s.as_of = "2026-10-30T16:00:00.000500Z";
  coffee(s, "before", "2026-10-30T15:00:00.000499Z");
  assert.equal(ready(s).counts[1], 1); assert.equal(ready(s).blue.size, 0);
  coffee(s, "edge", s.cycle!.started_at);
  coffee(s, "next", "2026-10-30T16:00:00.000501Z", "b");
  assert.deepEqual(ready(s).counts.slice(0, 2), [1, 1]);
  assert.equal(ready(s).green.size, 1);
  s.interactions[2].occurred_at = s.as_of;
  assert.equal(ready(s).counts[1], 1);
  assert.equal(ready(s).green.size, 1);
});
test("new cycle exact lower bound excludes global history and future events before start", () => {
  const s = trackingFixture(); s.cycle!.started_at = "2026-10-30T15:00:00Z";
  coffee(s, "old", "2026-10-30T14:59:59Z"); coffee(s, "edge", "2026-10-30T15:00:00Z", "b", "call");
  assert.deepEqual(ready(s).counts.slice(0, 2), [1, 1]);
});
test("canonical HH grouping after filters, multidomain once; ambiguous remains individual", () => {
  const s = trackingFixture();
  s.companies = [{ id: "h", displayName: "HH", normalizedName: "hh", domains: ["@hh.invalid", "@second.invalid"] }];
  for (const c of s.contacts) { c.is_headhunter = true; c.networking_status = "Cita concretada"; c.headhunter_domains = ["@hh.invalid", "@second.invalid"]; }
  coffee(s, "a", "2026-10-01T12:00:00Z"); coffee(s, "b", "2026-09-01T12:00:00Z", "b");
  coffee(s, "c", "2026-10-01T12:00:00Z", "c");
  const f = { ...defaults, groupHeadhunters: true };
  assert.equal(ready(s, f).counts[1], 1);
  assert.equal(ready(s, f).blue.get("hh:h"), Date.parse("2026-09-01T12:00:00Z"));
  assert.equal(ready(s, { ...f, priorityIds: ["p"] }).blue.get("hh:h"), Date.parse("2026-10-01T12:00:00Z"));
  s.companies.push({ id: "h2", displayName: "Other", normalizedName: "other", domains: ["@second.invalid"] });
  assert.equal(ready(s, f).counts[1], 3);
});
test("HH opportunity filtering uses linked focused HH only, not company, grouping or non-HH", () => {
  const s = trackingFixture(); s.contacts[0].is_headhunter = true; s.opportunities[0].contact_ids.push("b");
  assert.equal(ready(s, { ...defaults, headhunters: "only", groupHeadhunters: true }).counts[2], 1);
  assert.equal(ready(s, { ...defaults, headhunters: "exclude" }).counts[2], 1);
  s.contacts[0].networking_focus = false;
  assert.equal(ready(s, { ...defaults, headhunters: "only" }).counts[2], 0);
  assert.equal(ready(s, { ...defaults, headhunters: "exclude" }).counts[2], 2);
});
test("priority union and table share eligibility; active per-row counts cannot be summed globally", () => {
  const s = trackingFixture(); coffee(s, "x", "2026-10-01T12:00:00Z");
  const m = ready(s, { ...defaults, priorityIds: ["p", "q"] });
  assert.deepEqual(m.counts, [1, 1, 2, 2, 1]);
  assert.deepEqual(m.priorities.map(p => [p.opportunityCount, p.coffeeCount]), [[1, 1], [1, 1]]);
  assert.equal(ready(s, { ...defaults, priorityIds: ["p"] }).counts[2], 1);
});
test("current stages/results, finalized and voided; reopening/correction does not use history", () => {
  const s = trackingFixture(); assert.deepEqual(ready(s).counts.slice(2), [2, 2, 1]);
  s.opportunities[1] = { ...s.opportunities[1], stage: "applied", situation: "active", result: null };
  assert.deepEqual(ready(s).counts.slice(2), [1, 1, 0]);
});
test("ratios preserve null denominator and values above 100 percent", () => {
  const s = trackingFixture(); s.contacts[0].networking_status = "Pendiente"; s.transitions = [];
  assert.equal(ready(s).ratios[1], null);
  s.contacts[0].networking_status = "Cita concretada";
  coffee(s, "x", "2026-10-01T12:00:00Z"); assert.equal(ready(s).ratios[1], 200);
});
test("weekly Monday and monthly day one respect IANA, DST and UTC date boundary", () => {
  assert.equal(periodKey(Date.parse("2026-11-02T01:00:00Z"), "America/Santiago", "weekly"), "2026-10-26");
  assert.equal(periodKey(Date.parse("2026-11-02T04:00:00Z"), "America/Santiago", "weekly"), "2026-11-02");
  assert.equal(periodKey(Date.parse("2026-11-01T01:00:00Z"), "America/Santiago", "monthly"), "2026-10-01");
  assert.equal(periodKey(Date.parse("2026-09-06T04:00:00Z"), "America/Santiago", "weekly"), "2026-08-31");
  for (const mode of ["weekly", "monthly"] as const) {
    const now = Date.parse("2026-10-30T16:00:00Z");
    const next = nextTrackingPeriodBoundary(now, "America/Santiago", mode);
    assert.equal(periodKey(next - 1, "America/Santiago", mode), periodKey(now, "America/Santiago", mode));
    assert.notEqual(periodKey(next, "America/Santiago", mode), periodKey(now, "America/Santiago", mode));
  }
});
test("9 previous/current/2 future; long cycle total not clipped to window; exact blue equality", () => {
  const s = trackingFixture(); coffee(s, "old", "2025-02-01T12:00:00Z"); coffee(s, "new", "2026-10-01T12:00:00Z", "b");
  for (const mode of ["weekly", "monthly"] as const) {
    const m = ready(s), window = trackingPeriods(m, mode);
    assert.equal(window.periods.length, 12); assert.equal(window.periods[9]?.key, window.current);
    assert.equal(m.blue.size, m.counts[1]); assert.ok(window.periods.reduce((sum, p) => sum + (p?.blue ?? 0), 0) < m.blue.size);
  }
});
test("recent partial cycle has 12 fixed slots, nine empty and three eligible periods", () => {
  const s = trackingFixture(); s.cycle!.started_at = "2026-10-28T13:00:00Z";
  for (const mode of ["weekly", "monthly"] as const) {
    const w = trackingPeriods(ready(s), mode); assert.equal(w.periods.length, 12);
    assert.ok(w.periods.slice(0, 9).every(p => p === null));
    assert.ok(w.periods[9]?.partial);
    assert.equal(w.periods.filter(Boolean).length, 3);
  }
});

test("current is always slot ten; week/month rollover advances dates without changing geometry", () => {
  const s = trackingFixture(); s.cycle!.started_at = "2026-10-26T03:00:00Z";
  const m = ready(s);
  const weekly = trackingPeriods(m, "weekly");
  assert.deepEqual(weekly.periods.map(p => p?.key ?? null), [
    ...Array(9).fill(null), "2026-10-26", "2026-11-02", "2026-11-09"
  ]);
  const nextWeek = trackingPeriods(m, "weekly", Date.parse("2026-11-02T04:00:00Z"));
  assert.equal(nextWeek.periods[8]?.key, "2026-10-26");
  assert.equal(nextWeek.periods[9]?.key, "2026-11-02");
  assert.equal(nextWeek.periods.length, 12);
  const monthly = trackingPeriods(m, "monthly");
  assert.deepEqual(monthly.periods.map(p => p?.key ?? null), [...Array(9).fill(null), "2026-10-01", "2026-11-01", "2026-12-01"]);
  const nextMonth = trackingPeriods(m, "monthly", Date.parse("2026-11-02T04:00:00Z"));
  assert.equal(nextMonth.periods[8]?.key, "2026-10-01");
  assert.equal(nextMonth.periods[9]?.key, "2026-11-01");
});

test("first period is full only at the exact local Monday/month boundary, not later", () => {
  const s = trackingFixture();
  for (const [mode, start] of [["weekly", "2026-10-26T03:00:00Z"], ["monthly", "2026-10-01T03:00:00Z"]] as const) {
    s.cycle!.started_at = start;
    assert.equal(trackingPeriods(ready(s), mode).periods[9]?.partial, false);
    s.cycle!.started_at = start.replace("00Z", "00.000001Z");
    assert.equal(trackingPeriods(ready(s), mode).periods[9]?.partial, true);
  }
});
test("future cancellation/date edits recalculate earliest green without preserving old forecasts", () => {
  const s = trackingFixture(); s.contacts[0].networking_status = "Pendiente"; s.transitions = [];
  coffee(s, "f1", "2026-11-01T12:00:00Z"); coffee(s, "f2", "2026-11-02T12:00:00Z");
  assert.equal(ready(s).green.get("person:a"), Date.parse("2026-11-01T12:00:00Z"));
  s.interactions[0].metadata.ics_import!.method = "CANCEL";
  assert.equal(ready(s).green.get("person:a"), Date.parse("2026-11-02T12:00:00Z"));
  s.interactions[1].occurred_at = "2026-12-01T12:00:00Z";
  assert.equal(ready(s).green.get("person:a"), Date.parse("2026-12-01T12:00:00Z"));
});
test("combined priority/HH/focus filters group each evidence level before blue/green buckets", () => {
  const s = trackingFixture();
  s.companies = [{ id: "hh", displayName: "HH", normalizedName: "hh", domains: ["@hh.invalid"] }];
  for (const c of s.contacts) { c.is_headhunter = true; c.company = "HH"; }
  s.transitions.push({ id: "tb", contact_id: "b", previous_status: "Pendiente", next_status: "Contactado", changed_at: "2026-09-02T12:00:00Z" });
  coffee(s, "a", "2026-10-01T12:00:00Z"); coffee(s, "b", "2026-10-02T12:00:00Z", "b");
  coffee(s, "af", "2026-11-02T12:00:00Z"); coffee(s, "bf", "2026-11-01T12:00:00Z", "b");
  const filters: TrackingFilters = { priorityIds: ["p", "q"], headhunters: "only", groupHeadhunters: true };
  const m = ready(s, filters); assert.deepEqual(m.counts.slice(0, 2), [1, 1]);
  assert.equal(m.green.size, 1); assert.equal(m.green.get("hh:hh"), Date.parse("2026-11-01T12:00:00Z"));
  assert.equal(m.priorities[1].coffeeCount, 1);
  assert.equal(trackingPeriods(m, "weekly").periods.reduce((n, p) => n + (p?.blue ?? 0), 0), m.counts[1]);
  s.contacts[1].networking_focus = false;
  assert.equal(ready(s, filters).green.size, 0);
});
test("more than 2500 records with server cap 100 despite requested 200, complete and unique", async () => {
  const data = Array.from({ length: 2601 }, (_, i) => ({ id: String(i) }));
  const rows = await readCompletePages(async from => ({ data: data.slice(from, from + 100), count: data.length, error: null }));
  assert.equal(rows.length, 2601);
});
test("incomplete, count drift, duplicate and failed pages reject rather than return partial totals", async () => {
  await assert.rejects(readCompletePages(async () => ({ data: [], count: 2, error: null })), /incomplete/);
  await assert.rejects(readCompletePages(async from => ({ data: [{ id: String(from) }], count: from ? 3 : 2, error: null })), /changed/);
  await assert.rejects(readCompletePages(async () => ({ data: [{ id: "same" }], count: 2, error: null })), /duplicate/);
  await assert.rejects(readCompletePages(async () => ({ data: null, count: null, error: Error("synthetic") })), /failed/);
});
