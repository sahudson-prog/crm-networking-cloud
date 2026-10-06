import type { SyncGoogleInteractionsResult } from "./googleInteractionSyncFlow";
import type { InteractionSyncPreferences } from "./interactionSyncPreferences";

export const GLOBAL_SYNC_SUMMARY_DURATION_MS = 10_000;

export type GlobalActivityStatusInput = {
  applying: boolean;
  connectionRequired?: boolean;
  error: string;
  lastSuccessfulAt: string | null;
  loading: boolean;
  pendingUpdate?: boolean;
  reauthorizationRequired: boolean;
  syncDisabled?: boolean;
  transientSummary: string;
};

export type GlobalActivityServiceFreshness = {
  calendar: string | null;
  mail: string | null;
};

export function resolveActivitySyncSelection(input: {
  calendarAvailable: boolean;
  contactFocused?: boolean;
  gmailAvailable: boolean;
  preferences: InteractionSyncPreferences;
  variant: "focus_incremental" | "single_contact";
}) {
  const includeMail = input.preferences.gmailEnabled
    && (input.variant === "focus_incremental" || input.contactFocused === true);
  const includeCalendar = input.preferences.calendarEnabled
    && (input.variant === "focus_incremental" || input.contactFocused === true);
  const connectionRequired = (includeMail && !input.gmailAvailable)
    || (includeCalendar && !input.calendarAvailable);
  return {
    canSync: (includeMail || includeCalendar) && !connectionRequired,
    connectionRequired,
    includeCalendar,
    includeMail,
    syncDisabled: !includeMail && !includeCalendar
  };
}

export function aggregateGlobalActivityFreshness(
  preferences: InteractionSyncPreferences,
  freshness: GlobalActivityServiceFreshness
) {
  const enabledTimestamps = [
    preferences.gmailEnabled ? freshness.mail : undefined,
    preferences.calendarEnabled ? freshness.calendar : undefined
  ].filter((value): value is string | null => value !== undefined);
  if (!enabledTimestamps.length) return { lastSuccessfulAt: null, pendingUpdate: false };
  if (enabledTimestamps.some((value) => !validTimestamp(value))) {
    return { lastSuccessfulAt: null, pendingUpdate: true };
  }
  const oldest = enabledTimestamps
    .map((value) => value as string)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
  return { lastSuccessfulAt: oldest, pendingUpdate: false };
}

export function globalActivityCreatedSummary(result: SyncGoogleInteractionsResult) {
  const mailCreated = result.mail?.counts.created ?? 0;
  const calendarCreated = result.calendar?.counts.created ?? 0;
  if (!mailCreated && !calendarCreated) return "Sin novedades";
  return `+${mailCreated} ${mailCreated === 1 ? "correo" : "correos"} · +${calendarCreated} ${calendarCreated === 1 ? "cita" : "citas"}`;
}

export function formatGlobalActivityLastUpdated(value: string | null, now = new Date()) {
  if (!value) return "Nunca actualizado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nunca actualizado";
  const time = date.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Última actualización: hoy ${time}`;
  const day = date.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" });
  return `Última actualización: ${day} ${time}`;
}

export function globalActivityStatusText(state: GlobalActivityStatusInput, now = new Date()) {
  if (state.syncDisabled) return "Sincronización desactivada";
  if (state.connectionRequired) return "Requiere conexión";
  const lastUpdate = formatGlobalActivityFreshness(state.lastSuccessfulAt, now);
  const compactLastUpdate = lastUpdate === "Nunca actualizado"
    ? "nunca actualizado"
    : lastUpdate.toLocaleLowerCase("es-CL");
  if (state.loading || state.applying) {
    return state.lastSuccessfulAt ? `Actualizando… · ${compactLastUpdate}` : "Actualizando…";
  }
  if (state.transientSummary) return state.transientSummary;
  if (state.reauthorizationRequired) {
    return state.lastSuccessfulAt
      ? `Autorización de Google requerida · ${compactLastUpdate}`
      : "Autorización de Google requerida";
  }
  if (state.error) return state.lastSuccessfulAt ? `${state.error} · ${compactLastUpdate}` : state.error;
  if (state.pendingUpdate) return "Pendiente de actualización";
  return lastUpdate;
}

export function formatGlobalActivityFreshness(value: string | null, now = new Date()) {
  if (!validTimestamp(value)) return "Nunca actualizado";
  const elapsedMs = Math.max(0, now.getTime() - new Date(value as string).getTime());
  if (elapsedMs < 60 * 60 * 1000) {
    const upperMinutes = Math.max(1, Math.floor(elapsedMs / (60 * 1000)) + 1);
    return `Actualizado hace menos de ${upperMinutes} min`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    const upperHours = Math.max(1, Math.floor(elapsedMs / (60 * 60 * 1000)) + 1);
    return `Actualizado hace menos de ${upperHours} h`;
  }
  return formatGlobalActivityLastUpdated(value, now);
}

function validTimestamp(value: string | null) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}
