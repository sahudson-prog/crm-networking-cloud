import assert from "node:assert/strict";
import test from "node:test";
import {
  firstSelectableStartInstant, localDateTimeCandidates, localDateTimeToIso, localDateTimeValue,
  startInputMin, startIsOnOrAfterClose, timezoneOffsetLabel
} from "../lib/networkingCycleTime.ts";
import { networkingContextFromCycles, type NetworkingCycle } from "../lib/networkingCycles.ts";

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
