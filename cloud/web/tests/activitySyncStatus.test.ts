import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_SYNC_SUMMARY_DURATION_MS,
  aggregateGlobalActivityFreshness,
  formatGlobalActivityFreshness,
  formatGlobalActivityLastUpdated,
  globalActivityCreatedSummary,
  globalActivityStatusText,
  resolveActivitySyncSelection
} from "../lib/activitySyncStatus.ts";
import { calendarRollingWindowIso } from "../lib/syncDate.ts";
import type { SyncGoogleInteractionsResult } from "../lib/googleInteractionSyncFlow.ts";

test("resumen global cuenta solo interacciones creadas por servicio", () => {
  assert.equal(globalActivityCreatedSummary(syncResult(2, 1)), "+2 correos · +1 cita");
  assert.equal(globalActivityCreatedSummary(syncResult(0, 0, 12)), "Sin novedades");
});

test("estado global conserva ultima fecha durante ejecucion y error", () => {
  const now = new Date("2026-10-05T22:30:00-03:00");
  const lastSuccessfulAt = "2026-10-05T22:20:00-03:00";
  const base = {
    applying: false,
    error: "",
    lastSuccessfulAt,
    loading: false,
    reauthorizationRequired: false,
    transientSummary: ""
  };

  assert.match(formatGlobalActivityLastUpdated(lastSuccessfulAt, now), /^Última actualización: hoy /);
  assert.equal(formatGlobalActivityFreshness(lastSuccessfulAt, now), "Actualizado hace menos de 11 min");
  assert.match(globalActivityStatusText({ ...base, loading: true }, now), /^Actualizando… · actualizado hace menos de 11 min/);
  assert.match(globalActivityStatusText({ ...base, error: "Error al actualizar Gmail." }, now), /^Error al actualizar Gmail\. · actualizado hace menos de 11 min/);
  assert.match(globalActivityStatusText({ ...base, reauthorizationRequired: true }, now), /^Autorización de Google requerida · actualizado hace menos de 11 min/);
  assert.equal(globalActivityStatusText({ ...base, transientSummary: "Sin novedades" }, now), "Sin novedades");
  assert.equal(globalActivityStatusText({
    ...base,
    reauthorizationRequired: true,
    transientSummary: "+2 citas · Gmail requiere reconexión."
  }, now), "+2 citas · Gmail requiere reconexión.");
  assert.equal(globalActivityStatusText(base, now), formatGlobalActivityFreshness(lastSuccessfulAt, now));
  assert.equal(GLOBAL_SYNC_SUMMARY_DURATION_MS, 10_000);
});

test("seleccion de servicios respeta toggles, capabilities y Foco", () => {
  const bothOn = { calendarEnabled: true, gmailEnabled: true };
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: true,
    gmailAvailable: true,
    preferences: bothOn,
    variant: "focus_incremental"
  }), {
    canSync: true,
    connectionRequired: false,
    includeCalendar: true,
    includeMail: true,
    syncDisabled: false
  });
  assert.equal(resolveActivitySyncSelection({
    calendarAvailable: true,
    gmailAvailable: false,
    preferences: bothOn,
    variant: "focus_incremental"
  }).canSync, false);
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: false,
    gmailAvailable: true,
    preferences: { calendarEnabled: false, gmailEnabled: true },
    variant: "focus_incremental"
  }), {
    canSync: true,
    connectionRequired: false,
    includeCalendar: false,
    includeMail: true,
    syncDisabled: false
  });
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: true,
    gmailAvailable: false,
    preferences: { calendarEnabled: true, gmailEnabled: false },
    variant: "focus_incremental"
  }), {
    canSync: true,
    connectionRequired: false,
    includeCalendar: true,
    includeMail: false,
    syncDisabled: false
  });
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: false,
    gmailAvailable: false,
    preferences: { calendarEnabled: false, gmailEnabled: false },
    variant: "focus_incremental"
  }), {
    canSync: false,
    connectionRequired: false,
    includeCalendar: false,
    includeMail: false,
    syncDisabled: true
  });
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: true,
    contactFocused: false,
    gmailAvailable: false,
    preferences: bothOn,
    variant: "single_contact"
  }), {
    canSync: false,
    connectionRequired: false,
    includeCalendar: false,
    includeMail: false,
    syncDisabled: true
  });
  assert.equal(resolveActivitySyncSelection({
    calendarAvailable: false,
    contactFocused: false,
    gmailAvailable: true,
    preferences: { calendarEnabled: false, gmailEnabled: true },
    variant: "single_contact"
  }).syncDisabled, true);
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: false,
    contactFocused: true,
    gmailAvailable: true,
    preferences: { calendarEnabled: false, gmailEnabled: true },
    variant: "single_contact"
  }), {
    canSync: true,
    connectionRequired: false,
    includeCalendar: false,
    includeMail: true,
    syncDisabled: false
  });
  assert.deepEqual(resolveActivitySyncSelection({
    calendarAvailable: false,
    contactFocused: true,
    gmailAvailable: false,
    preferences: { calendarEnabled: true, gmailEnabled: false },
    variant: "single_contact"
  }), {
    canSync: false,
    connectionRequired: true,
    includeCalendar: true,
    includeMail: false,
    syncDisabled: false
  });
});

test("ventana Calendar periodica cubre exactamente 14 dias y tres meses", () => {
  const window = calendarRollingWindowIso(new Date("2026-10-06T15:30:00.000Z"));
  assert.deepEqual(window, {
    since: "2026-09-22T15:30:00.000Z",
    until: "2027-01-06T15:30:00.000Z"
  });
});

test("freshness usa solo servicios ON, el mas antiguo y estados incompletos", () => {
  const freshness = { calendar: "2026-10-05T22:13:00-03:00", mail: "2026-10-05T22:25:00-03:00" };
  assert.deepEqual(aggregateGlobalActivityFreshness(
    { calendarEnabled: true, gmailEnabled: true },
    freshness
  ), { lastSuccessfulAt: "2026-10-05T22:13:00-03:00", pendingUpdate: false });
  assert.deepEqual(aggregateGlobalActivityFreshness(
    { calendarEnabled: false, gmailEnabled: true },
    freshness
  ), { lastSuccessfulAt: "2026-10-05T22:25:00-03:00", pendingUpdate: false });
  assert.deepEqual(aggregateGlobalActivityFreshness(
    { calendarEnabled: true, gmailEnabled: true },
    { ...freshness, calendar: null }
  ), { lastSuccessfulAt: null, pendingUpdate: true });
  assert.equal(globalActivityStatusText({
    applying: false,
    error: "",
    lastSuccessfulAt: null,
    loading: false,
    pendingUpdate: true,
    reauthorizationRequired: false,
    transientSummary: ""
  }), "Pendiente de actualización");
  assert.equal(globalActivityStatusText({
    applying: false,
    error: "",
    lastSuccessfulAt: null,
    loading: false,
    reauthorizationRequired: false,
    syncDisabled: true,
    transientSummary: ""
  }), "Sincronización desactivada");
  assert.equal(globalActivityStatusText({
    applying: false,
    connectionRequired: true,
    error: "",
    lastSuccessfulAt: freshness.mail,
    loading: false,
    reauthorizationRequired: false,
    transientSummary: ""
  }), "Requiere conexión");
});

function syncResult(mailCreated: number, calendarCreated: number, skipped = 0) {
  return {
    calendar: { counts: { created: calendarCreated, skipped } },
    mail: { counts: { created: mailCreated, skipped } }
  } as unknown as SyncGoogleInteractionsResult;
}
