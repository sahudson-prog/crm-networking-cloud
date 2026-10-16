import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarRollingWindowIso,
  latestIsoInstant,
  NetworkingStartConfigurationError,
  networkingStartBounds,
  networkingStartStatus,
  parseDateSetting,
  resolveHistoricalNetworkingStartIso,
  resolvePeriodicNetworkingStartIso
} from "../lib/syncDate.ts";

test("la fecha civil de inicio usa límites inclusivos y una ventana de 12 meses calendario", () => {
  const now = new Date("2026-10-13T23:59:59.000Z");
  assert.deepEqual(networkingStartBounds(now), {
    maximumDate: "2026-10-13",
    minimumDate: "2025-10-13"
  });
  assert.equal(networkingStartStatus("2025-10-13", now).valid, true);
  assert.equal(networkingStartStatus("2026-10-13", now).valid, true);
  assert.equal(networkingStartStatus("2025-10-12", now).reason, "too_old");
  assert.equal(networkingStartStatus("2026-10-14", now).reason, "future");
});

test("resta meses calendario preservando fin de mes y año bisiesto", () => {
  assert.equal(networkingStartBounds(new Date("2024-02-29T12:00:00.000Z")).minimumDate, "2023-02-28");
  assert.equal(networkingStartBounds(new Date("2026-03-31T12:00:00.000Z")).minimumDate, "2025-03-31");
});

test("la fecha configurada produce medianoche UTC sin desplazamiento de día", () => {
  const status = networkingStartStatus("13/10/2026", new Date("2026-10-13T23:59:59.000Z"));
  assert.equal(status.configuredDate, "2026-10-13");
  assert.equal(status.effectiveStartIso, "2026-10-13T00:00:00.000Z");
  assert.equal(parseDateSetting("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(parseDateSetting("2025-02-29"), null);
});

test("fecha ausente o malformada bloquea nuevas importaciones", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  assert.equal(networkingStartStatus("", now).reason, "missing");
  assert.equal(networkingStartStatus("no-es-fecha", now).reason, "invalid");
  assert.equal(networkingStartStatus("2026-02-30", now).reason, "invalid");
  assert.equal(networkingStartStatus("2026-10-13T00:00:00.000Z", now).reason, "invalid");
});

test("el piso más restrictivo conserva las ventanas operativas existentes", () => {
  assert.equal(
    latestIsoInstant("2026-10-06T12:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    "2026-10-06T12:00:00.000Z"
  );
  assert.equal(
    latestIsoInstant("2026-10-06T12:00:00.000Z", "2026-10-10T00:00:00.000Z"),
    "2026-10-10T00:00:00.000Z"
  );
});

test("sync periódico acepta una fecha histórica antigua sin ampliar sus ventanas rolling", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const configuredStart = resolvePeriodicNetworkingStartIso("2025-10-01", now);
  const calendarWindow = calendarRollingWindowIso(now);

  assert.equal(configuredStart, "2025-10-01T00:00:00.000Z");
  assert.equal(
    latestIsoInstant("2026-10-02T12:00:00.000Z", configuredStart),
    "2026-10-02T12:00:00.000Z"
  );
  assert.equal(
    latestIsoInstant(calendarWindow.since, configuredStart),
    "2026-10-09T12:00:00.000Z"
  );
  assert.equal(calendarWindow.until, "2026-11-15T12:00:00.000Z");
});

test("sync periódico permite que una fecha reciente acorte Gmail y Calendar", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const configuredStart = resolvePeriodicNetworkingStartIso("2026-10-12", now);

  assert.equal(
    latestIsoInstant("2026-10-02T12:00:00.000Z", configuredStart),
    "2026-10-12T00:00:00.000Z"
  );
  assert.equal(
    latestIsoInstant("2026-10-09T12:00:00.000Z", configuredStart),
    "2026-10-12T00:00:00.000Z"
  );
});

test("importaciones históricas conservan el máximo de 12 meses", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");

  assert.throws(
    () => resolveHistoricalNetworkingStartIso("2025-10-01", now),
    /debe ser igual o posterior a 2025-10-16/
  );
});

test("sync periódico rechaza fechas inválidas o futuras con mensajes seguros", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");

  assert.throws(
    () => resolvePeriodicNetworkingStartIso("fecha-inválida", now),
    (error) => error instanceof NetworkingStartConfigurationError && /no es válida/.test(error.message)
  );
  assert.throws(
    () => resolvePeriodicNetworkingStartIso("2026-10-17", now),
    (error) => error instanceof NetworkingStartConfigurationError && /no puede ser futura/.test(error.message)
  );
});
