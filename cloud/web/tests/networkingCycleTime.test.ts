import assert from "node:assert/strict";
import test from "node:test";
import {
  cycleDateError, cycleInputMax, cycleStartFromDate, cycleCloseInputMin, firstSelectableStartInstant, localDateTimeCandidates, localDateTimeToIso, localDateTimeValue,
  startInputMin, startIsOnOrAfterClose, timezoneOffsetLabel
} from "../lib/networkingCycleTime.ts";
import { networkingContextFromCycles, type NetworkingCycle } from "../lib/networkingCycles.ts";

test("date-only start selects the first valid instant and roundtrips through the existing RPC adapter", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const start = cycleStartFromDate("2026-11-04", "America/Santiago", null, now);
  assert.equal(start.startedAt, "2026-11-04T03:00:00.000Z");
  assert.equal(localDateTimeToIso(start.localStart, "America/Santiago", start.repeatedTimeChoice), start.startedAt);
  for (const day of ["", "2026-02-30", "2026-11-05", "04/11/2026"]) {
    assert.throws(() => cycleStartFromDate(day, "America/Santiago", null, now));
  }
});

test("consecutive same-day cycles preserve exact/fractional close bounds and deterministic retries", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  for (const [close, expected] of [
    ["2026-11-04T10:30:00Z", "2026-11-04T10:30:00.000Z"],
    ["2026-11-04T10:30:00.000456Z", "2026-11-04T10:30:01.000Z"]
  ]) {
    const start = cycleStartFromDate("2026-11-04", "America/Santiago", close, now);
    assert.equal(start.startedAt, expected);
    assert.deepEqual(cycleStartFromDate("2026-11-04", "America/Santiago", close, now + 1000), start);
  }
  assert.throws(() => cycleStartFromDate("2026-11-03", "America/Santiago", "2026-11-04T10:30:00Z", now));
  assert.throws(() => cycleStartFromDate("2026-11-04", "America/Santiago", "2026-11-04T12:00:00.000001Z", now));
});

test("date-only start respects policy instant, legacy and a bound rounding into the next day", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(cycleStartFromDate("2026-05-04", "UTC", "2026-05-04T10:00:00Z", now).startedAt, "2026-05-04T10:00:00.000Z");
  assert.throws(() => cycleStartFromDate("2026-05-03", "UTC", "2026-05-04T00:00:00Z", now));
  assert.equal(cycleStartFromDate("2020-01-01", "UTC", null, now).startedAt, "2020-01-01T00:00:00.000Z");
  assert.throws(() => cycleStartFromDate("2026-05-04", "UTC", "2026-05-04T23:59:59.999999Z", now));
  assert.equal(cycleStartFromDate("2026-05-05", "UTC", "2026-05-04T23:59:59.999999Z", now).startedAt, "2026-05-05T00:00:00.000Z");
});

test("date-only DST: skipped midnight, repeated midnight, repeated close hour and skipped day", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(cycleStartFromDate("2026-09-06", "America/Santiago", null, now).localStart, "2026-09-06T01:00:00");
  const repeated = cycleStartFromDate("2026-11-01", "America/Havana", null, now);
  assert.equal(repeated.repeatedTimeChoice, "earlier");
  assert.equal(localDateTimeToIso(repeated.localStart, "America/Havana", repeated.repeatedTimeChoice), repeated.startedAt);
  const afterClose = cycleStartFromDate("2026-04-04", "America/Santiago", "2026-04-05T03:15:00Z", now);
  assert.equal(afterClose.repeatedTimeChoice, "later");
  assert.equal(localDateTimeToIso(afterClose.localStart, "America/Santiago", afterClose.repeatedTimeChoice), "2026-04-05T03:15:00.000Z");
  assert.throws(() => cycleStartFromDate("2011-12-30", "Pacific/Apia", null, now), /no existe/);
});

test("minute close has a strict lower bound, preserving stored seconds and DST ambiguity", () => {
  assert.equal(cycleCloseInputMin("2026-11-01T12:00:00Z", "UTC"), "2026-11-01T12:01");
  assert.equal(cycleCloseInputMin("2026-11-01T12:00:59.999999Z", "UTC"), "2026-11-01T12:01");
  assert.equal(cycleCloseInputMin("2026-04-05T02:30:00Z", "America/Santiago"), undefined);
});

test("field validation rejects missing, malformed, impossible and future dates", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  for (const value of ["", "invalid", "2026-02-30T12:00", "2026-11-04T12:00:01"]) {
    assert.notEqual(cycleDateError(value, "UTC", { now }), "");
  }
  assert.equal(cycleDateError("2026-11-04T12:00:00", "UTC", { now }), "");
  assert.match(cycleDateError("2026-11-04T12:00:00", "UTC", { now, minimum: "invalid" }), /validar/);
});

test("start policy is inclusive; legacy without a minimum remains valid", () => {
  const options = { now: Date.parse("2026-11-04T12:00:00Z"), minimum: "2026-05-04T03:00:00Z" };
  assert.notEqual(cycleDateError("2026-05-03T22:59:59", "America/Santiago", options), "");
  assert.equal(cycleDateError("2026-05-03T23:00:00", "America/Santiago", options), "");
  assert.equal(cycleDateError("2020-01-01T12:00", "America/Santiago", { now: options.now }), "");
});

test("close rejects before/equal start, accepts later same-day and preserves subsecond bounds", () => {
  for (const minimum of ["2026-05-20T16:00:00Z", "2026-05-20T16:00:00.000456Z"]) {
    const options = { minimum, exclusiveMinimum: true, now: Date.parse("2026-05-21T00:00:00Z") };
    assert.notEqual(cycleDateError("2026-05-20T11:59:59", "America/Santiago", options), "");
    assert.notEqual(cycleDateError("2026-05-20T12:00:00", "America/Santiago", options), "");
    assert.equal(cycleDateError("2026-05-20T12:00:01", "America/Santiago", options), "");
    assert.equal(cycleDateError("2026-05-21T04:00:01", "Pacific/Auckland", options), "");
  }
});

test("field validation handles omitted/repeated DST hours against absolute boundaries", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.match(cycleDateError("2026-09-06T00:30", "America/Santiago", { now }), /no existe/);
  const options = { now, minimum: "2026-04-05T02:30:00Z", exclusiveMinimum: true };
  assert.match(cycleDateError("2026-04-04T23:15", "America/Santiago", options), /se repite/);
  assert.notEqual(cycleDateError("2026-04-04T23:15", "America/Santiago", { ...options, choice: "earlier" }), "");
  assert.equal(cycleDateError("2026-04-04T23:15", "America/Santiago", { ...options, choice: "later" }), "");
  assert.equal(cycleInputMax(new Date("2026-04-05T03:15:00Z"), "America/Santiago"), undefined);
  assert.equal(cycleInputMax(new Date(now), "UTC"), "2026-11-04T12:00:00");
});

test("Chile: la hora repetida exige elegir uno de dos instantes distintos", () => {
  const value = "2026-04-04T23:30";
  const candidates = localDateTimeCandidates(value, "America/Santiago");
  assert.deepEqual(candidates.map((date) => date.toISOString()), [
    "2026-04-05T02:30:00.000Z", "2026-04-05T03:30:00.000Z"
  ]);
  assert.throws(() => localDateTimeToIso(value, "America/Santiago"), /se repite/);
  assert.equal(localDateTimeToIso(value, "America/Santiago", "earlier"), candidates[0].toISOString());
  assert.equal(localDateTimeToIso(value, "America/Santiago", "later"), candidates[1].toISOString());
  assert.equal(timezoneOffsetLabel(candidates[0], "America/Santiago"), "UTC-03:00");
  assert.equal(timezoneOffsetLabel(candidates[1], "America/Santiago"), "UTC-04:00");
});

test("Chile: la hora omitida por el cambio de horario se rechaza", () => {
  const value = "2026-09-06T00:30";
  assert.deepEqual(localDateTimeCandidates(value, "America/Santiago"), []);
  assert.throws(() => localDateTimeToIso(value, "America/Santiago"), /no existe/);
});

test("el instante y la zona conservan el minuto visible sin desplazar día", () => {
  assert.equal(localDateTimeValue(new Date("2026-09-06T04:30:00.000Z"), "America/Santiago"), "2026-09-06T01:30:00");
  assert.equal(localDateTimeToIso("2026-09-06T01:30", "America/Santiago"), "2026-09-06T04:30:00.000Z");
  assert.equal(localDateTimeToIso("2026-09-06T01:30:42", "America/Santiago"), "2026-09-06T04:30:42.000Z");
  assert.throws(() => localDateTimeToIso("2026-02-30T12:00", "America/Santiago"), /válidas/);
  assert.throws(() => localDateTimeToIso("2099-01-01T12:00", "America/Santiago"), /futuras/);
});

test("el siguiente proceso rechaza antes del cierre y acepta el mismo instante y día", () => {
  const closedAt = "2026-05-20T16:00:00.000Z";
  assert.equal(startInputMin(closedAt, "America/Santiago"), "2026-05-20T12:00:00");
  assert.equal(startIsOnOrAfterClose("2026-05-20T11:59:59", "America/Santiago", closedAt), false);
  assert.equal(startIsOnOrAfterClose("2026-05-20T12:00:00", "America/Santiago", closedAt), true);
  assert.equal(startIsOnOrAfterClose("2026-05-20T14:30:00", "America/Santiago", closedAt), true);
});

test("el límite se convierte a la zona del usuario sin comparar fechas civiles", () => {
  const closedAt = "2026-03-20T23:45:00.000Z";
  assert.equal(startInputMin(closedAt, "Pacific/Auckland"), "2026-03-21T12:45:00");
  assert.equal(startIsOnOrAfterClose("2026-03-21T12:44:59", "Pacific/Auckland", closedAt), false);
  assert.equal(startIsOnOrAfterClose("2026-03-21T12:45:00", "Pacific/Auckland", closedAt), true);
  assert.equal(startIsOnOrAfterClose("2026-03-21T13:00:00", "Pacific/Auckland", closedAt), true);
  assert.equal(startInputMin(closedAt, "UTC"), "2026-03-20T23:45:00");
  assert.equal(startIsOnOrAfterClose("2026-03-20T23:44:59", "UTC", closedAt), false);
  assert.equal(startIsOnOrAfterClose("2026-03-20T23:45:00", "UTC", closedAt), true);
});

test("cierre con fracción conserva el instante persistido y exige el siguiente segundo seleccionable", () => {
  const closedAt = "2026-05-20T16:00:00.500123Z";
  assert.equal(firstSelectableStartInstant(closedAt), Date.parse("2026-05-20T16:00:01Z"));
  assert.equal(startInputMin(closedAt, "America/Santiago"), "2026-05-20T12:00:01");
  assert.equal(startIsOnOrAfterClose("2026-05-20T12:00:00", "America/Santiago", closedAt), false);
  assert.equal(startIsOnOrAfterClose("2026-05-20T12:00:01", "America/Santiago", closedAt), true);
  assert.equal(startInputMin(closedAt, "Pacific/Auckland"), "2026-05-21T04:00:01");
  assert.equal(startIsOnOrAfterClose("2026-05-21T04:00:01", "Pacific/Auckland", closedAt), true);
});

test("una fracción inferior al milisegundo tampoco permite igualdad falsa en UI", () => {
  const closedAt = "2026-05-20T16:00:00.000456+00:00";
  assert.equal(Date.parse(closedAt), Date.parse("2026-05-20T16:00:00Z"));
  assert.equal(startInputMin(closedAt, "UTC"), "2026-05-20T16:00:01");
  assert.equal(startIsOnOrAfterClose("2026-05-20T16:00:00", "UTC", closedAt), false);
  assert.equal(startIsOnOrAfterClose("2026-05-20T16:00:01", "UTC", closedAt), true);
  const exact = "2026-05-20T16:00:00.000000Z";
  assert.equal(firstSelectableStartInstant(exact), Date.parse(exact));
  assert.equal(startIsOnOrAfterClose("2026-05-20T16:00:00", "UTC", exact), true);
});

test("una hora repetida conserva la elección DST y omite el mínimo nativo que bloquearía instantes válidos", () => {
  const firstClose = "2026-04-05T02:30:00.000Z";
  assert.equal(startInputMin(firstClose, "America/Santiago"), undefined);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:00", "America/Santiago", firstClose), null);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:29:59", "America/Santiago", firstClose, "earlier"), false);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:00", "America/Santiago", firstClose, "earlier"), true);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:15:00", "America/Santiago", firstClose, "later"), true);
  const secondClose = "2026-04-05T03:30:00.000Z";
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:00", "America/Santiago", secondClose, "earlier"), false);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:00", "America/Santiago", secondClose, "later"), true);
});

test("una fracción de segundo en hora repetida mantiene la selección de instante DST", () => {
  const closedAt = "2026-04-05T02:30:00.500Z";
  assert.equal(startInputMin(closedAt, "America/Santiago"), undefined);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:00", "America/Santiago", closedAt, "earlier"), false);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:30:01", "America/Santiago", closedAt, "earlier"), true);
  assert.equal(startIsOnOrAfterClose("2026-04-04T23:15:00", "America/Santiago", closedAt, "later"), true);
});

test("la versión cambia al configurar legacy y entre intervalos sin ciclo", () => {
  const legacy = { id: "legacy", status: "active", start_request_id: null } as NetworkingCycle;
  assert.deepEqual(networkingContextFromCycles([legacy]), { cycleId: "legacy", token: "active:legacy:legacy" });
  assert.deepEqual(networkingContextFromCycles([{ ...legacy, start_request_id: "configured" }]),
    { cycleId: "legacy", token: "active:legacy:configured" });
  const firstClosed = { ...legacy, status: "closed", closed_recorded_at: "2026-01-01T00:00:00Z" } as NetworkingCycle;
  const laterClosed = { ...firstClosed, id: "later", closed_recorded_at: "2026-02-01T00:00:00Z" };
  assert.deepEqual(networkingContextFromCycles([]), { cycleId: null, token: "none:initial" });
  assert.deepEqual(networkingContextFromCycles([firstClosed]), { cycleId: null, token: "none:legacy" });
  assert.deepEqual(networkingContextFromCycles([firstClosed, laterClosed]), { cycleId: null, token: "none:later" });
});
