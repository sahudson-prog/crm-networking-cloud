import assert from "node:assert/strict";
import test from "node:test";

import type { ActivitySyncServiceOutcome } from "../lib/activitySyncExecution.ts";
import {
  GLOBAL_SYNC_SUMMARY_DURATION_MS,
  buildGlobalActivitySyncRows,
  deriveGlobalActivityIconState,
  formatActivityServiceFreshness,
  globalActivityPrimaryAction,
  resolveActivitySyncSelection,
  type GlobalActivityServiceStates
} from "../lib/activitySyncStatus.ts";
import { calendarRollingWindowIso } from "../lib/syncDate.ts";

const authorizedServices: GlobalActivityServiceStates = {
  calendar: { authorized: true, error: "", reauthorizationRequired: false },
  mail: { authorized: true, error: "", reauthorizationRequired: false }
};

test("estado global usa solo normal, syncing, auth_required, error y feedback transitorio", () => {
  assert.equal(iconState(), "normal");
  assert.equal(iconState({ successFeedback: true }), "success");
  assert.equal(iconState({ hasError: true, successFeedback: true }), "error");
  assert.equal(iconState({ authorizationRequired: true, hasError: true, successFeedback: true }), "auth_required");
  assert.equal(iconState({ running: true, authorizationRequired: true, hasError: true }), "syncing");
  assert.equal(GLOBAL_SYNC_SUMMARY_DURATION_MS, 10_000);
});

test("filas normales muestran freshness individual y pending por servicio", () => {
  const now = new Date("2026-10-05T22:30:00-03:00");
  const rows = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: "2026-10-05T22:25:00-03:00" },
    now,
    preferences: { calendarEnabled: true, gmailEnabled: true },
    services: authorizedServices
  });

  assert.deepEqual(rows.map(({ key, label, status }) => ({ key, label, status })), [
    { key: "mail", label: "Correos", status: "Actualizado hace 5 min" },
    { key: "calendar", label: "Citas", status: "Pendiente de primera actualización" }
  ]);
  assert.equal(formatActivityServiceFreshness(null, now), "Pendiente de primera actualización");
});

test("servicios OFF se omiten y ambos OFF muestran una sola fila", () => {
  const gmailOnly = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    preferences: { calendarEnabled: false, gmailEnabled: true },
    services: authorizedServices
  });
  assert.deepEqual(gmailOnly.map((row) => row.key), ["mail"]);

  const disabled = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    preferences: { calendarEnabled: false, gmailEnabled: false },
    services: authorizedServices
  });
  assert.deepEqual(disabled, [{
    icon: "sync",
    key: "disabled",
    label: "",
    status: "Sincronización desactivada",
    tone: "muted"
  }]);
});

test("resultados quedan en filas por servicio con counts persistidos y error parcial", () => {
  const rows = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    outcomes: [success("mail", 3), failure("calendar")],
    preferences: { calendarEnabled: true, gmailEnabled: true },
    services: authorizedServices
  });

  assert.deepEqual(rows.map(({ label, status }) => ({ label, status })), [
    { label: "Correos", status: "+3 correos" },
    { label: "Citas", status: "Error al actualizar Calendar" }
  ]);
  assert.equal(rows.some((row) => row.status.includes("·")), false);
});

test("filas globales conservan errores accionables ya sanitizados por el servicio", () => {
  const rows = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    outcomes: [failure("mail", "Define la fecha de inicio de networking en Cuenta antes de importar correos o citas.")],
    preferences: { calendarEnabled: false, gmailEnabled: true },
    services: authorizedServices
  });

  assert.equal(rows[0]?.status, "Define la fecha de inicio de networking en Cuenta antes de importar correos o citas.");
});

test("filas distinguen autorización, error técnico y éxito sin novedades", () => {
  const services: GlobalActivityServiceStates = {
    calendar: { authorized: true, error: "fallo técnico", reauthorizationRequired: false },
    mail: { authorized: false, error: "", reauthorizationRequired: true }
  };
  const rows = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    preferences: { calendarEnabled: true, gmailEnabled: true },
    services
  });
  assert.deepEqual(rows.map((row) => row.status), ["Requiere autorización", "Error al actualizar"]);

  const successfulRows = buildGlobalActivitySyncRows({
    freshness: { calendar: null, mail: null },
    outcomes: [success("mail", 0), success("calendar", 0)],
    preferences: { calendarEnabled: true, gmailEnabled: true },
    services: authorizedServices
  });
  assert.deepEqual(successfulRows.map((row) => row.status), ["Sin novedades", "Sin novedades"]);
});

test("acción contextual depende del estado sin activar servicios OFF", () => {
  assert.deepEqual(globalActivityPrimaryAction({ anyServiceEnabled: true, iconState: "normal", ready: true }), {
    disabled: false,
    kind: "sync",
    label: "Actualizar ahora"
  });
  assert.equal(globalActivityPrimaryAction({ anyServiceEnabled: false, iconState: "normal", ready: true }), null);
  assert.equal(globalActivityPrimaryAction({ anyServiceEnabled: true, iconState: "auth_required", ready: true })?.label, "Autorizar y actualizar");
  assert.equal(globalActivityPrimaryAction({ anyServiceEnabled: true, iconState: "error", ready: true })?.label, "Reintentar");
  assert.deepEqual(globalActivityPrimaryAction({ anyServiceEnabled: true, iconState: "syncing", ready: true }), {
    disabled: true,
    kind: "sync",
    label: "Actualizando…"
  });
});

test("selección de servicios respeta toggles, capabilities y Foco", () => {
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
  assert.equal(resolveActivitySyncSelection({
    calendarAvailable: true,
    contactFocused: false,
    gmailAvailable: true,
    preferences: bothOn,
    variant: "single_contact"
  }).syncDisabled, true);
});

test("ventana Calendar periódica cubre exactamente 7 días y 30 días", () => {
  const window = calendarRollingWindowIso(new Date("2026-10-06T15:30:00.000Z"));
  assert.deepEqual(window, {
    since: "2026-09-29T15:30:00.000Z",
    until: "2026-11-05T15:30:00.000Z"
  });
});

test("freshness usa unidades enteras y nunca muestra cero ni menos de", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  assert.equal(formatActivityServiceFreshness("2026-10-06T11:59:30.000Z", now), "Actualizado ahora");
  assert.equal(formatActivityServiceFreshness("2026-10-06T11:59:00.000Z", now), "Actualizado hace 1 min");
  assert.equal(formatActivityServiceFreshness("2026-10-06T10:00:00.000Z", now), "Actualizado hace 2 h");
  assert.equal(formatActivityServiceFreshness("2026-10-03T12:00:00.000Z", now), "Actualizado hace 3 d");
  assert.equal(formatActivityServiceFreshness("2026-10-06T11:59:30.000Z", now).includes("0 min"), false);
  assert.equal(formatActivityServiceFreshness("2026-10-06T11:55:00.000Z", now).includes("menos de"), false);
});

function iconState(input: Partial<Parameters<typeof deriveGlobalActivityIconState>[0]> = {}) {
  return deriveGlobalActivityIconState({
    authorizationRequired: false,
    hasError: false,
    running: false,
    successFeedback: false,
    ...input
  });
}

function success(service: ActivitySyncServiceOutcome["service"], created: number): ActivitySyncServiceOutcome {
  return {
    created,
    error: "",
    reauthorizationRequired: false,
    service,
    success: true,
    syncedAt: "2026-10-06T12:00:00.000Z"
  };
}

function failure(
  service: ActivitySyncServiceOutcome["service"],
  error = `Error al actualizar ${service === "mail" ? "Gmail" : "Calendar"}`
): ActivitySyncServiceOutcome {
  return {
    created: 0,
    error,
    reauthorizationRequired: false,
    service,
    success: false,
    syncedAt: null
  };
}
