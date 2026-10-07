import type { ActivitySyncService, ActivitySyncServiceOutcome } from "./activitySyncExecution";
import type { InteractionSyncPreferences } from "./interactionSyncPreferences";

export const GLOBAL_SYNC_SUMMARY_DURATION_MS = 10_000;

export type GlobalActivityIconState = "normal" | "syncing" | "auth_required" | "error" | "success";

export type GlobalActivityServiceFreshness = {
  calendar: string | null;
  mail: string | null;
};

export type GlobalActivityServiceState = {
  authorized: boolean;
  error: string;
  reauthorizationRequired: boolean;
};

export type GlobalActivityServiceStates = Record<ActivitySyncService, GlobalActivityServiceState>;

export type GlobalActivitySyncRow = {
  icon: "calendar" | "mail" | "sync";
  key: ActivitySyncService | "disabled";
  label: string;
  status: string;
  tone: "default" | "error" | "muted" | "success";
};

export type GlobalActivityPrimaryAction = {
  disabled: boolean;
  kind: "authorize" | "retry" | "sync";
  label: string;
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

export function deriveGlobalActivityIconState(input: {
  authorizationRequired: boolean;
  hasError: boolean;
  running: boolean;
  successFeedback: boolean;
}): GlobalActivityIconState {
  if (input.running) return "syncing";
  if (input.authorizationRequired) return "auth_required";
  if (input.hasError) return "error";
  if (input.successFeedback) return "success";
  return "normal";
}

export function globalActivityPrimaryAction(input: {
  anyServiceEnabled: boolean;
  iconState: GlobalActivityIconState;
  ready: boolean;
}): GlobalActivityPrimaryAction | null {
  if (!input.anyServiceEnabled) return null;
  if (input.iconState === "syncing") {
    return { disabled: true, kind: "sync", label: "Actualizando…" };
  }
  if (input.iconState === "auth_required") {
    return { disabled: !input.ready, kind: "authorize", label: "Autorizar y actualizar" };
  }
  if (input.iconState === "error") {
    return { disabled: !input.ready, kind: "retry", label: "Reintentar" };
  }
  return { disabled: !input.ready, kind: "sync", label: "Actualizar ahora" };
}

export function buildGlobalActivitySyncRows(input: {
  freshness: GlobalActivityServiceFreshness;
  globalError?: boolean;
  outcomes?: ActivitySyncServiceOutcome[];
  preferences: InteractionSyncPreferences;
  services: GlobalActivityServiceStates;
  now?: Date;
}): GlobalActivitySyncRow[] {
  const enabledServices = activityServicesFromPreferences(input.preferences);
  if (!enabledServices.length) {
    return [{
      icon: "sync",
      key: "disabled",
      label: "",
      status: "Sincronización desactivada",
      tone: "muted"
    }];
  }

  const outcomes = new Map((input.outcomes ?? []).map((outcome) => [outcome.service, outcome]));
  return enabledServices.map((service) => {
    const outcome = outcomes.get(service);
    if (outcome) return rowFromOutcome(outcome);

    const serviceState = input.services[service];
    if (input.globalError) {
      return serviceRow(service, "Error al actualizar", "error");
    }
    if (!serviceState.authorized || serviceState.reauthorizationRequired) {
      return serviceRow(service, "Requiere autorización", "error");
    }
    if (serviceState.error) {
      return serviceRow(service, "Error al actualizar", "error");
    }
    return serviceRow(
      service,
      formatActivityServiceFreshness(input.freshness[service], input.now),
      input.freshness[service] ? "default" : "muted"
    );
  });
}

export function activityServicesFromPreferences(preferences: InteractionSyncPreferences) {
  const services: ActivitySyncService[] = [];
  if (preferences.gmailEnabled) services.push("mail");
  if (preferences.calendarEnabled) services.push("calendar");
  return services;
}

export function formatActivityServiceFreshness(value: string | null, now = new Date()) {
  if (!validTimestamp(value)) return "Pendiente de primera actualización";
  const elapsedMs = Math.max(0, now.getTime() - new Date(value as string).getTime());
  if (elapsedMs < 60 * 1000) return "Actualizado ahora";
  if (elapsedMs < 60 * 60 * 1000) {
    return `Actualizado hace ${Math.floor(elapsedMs / (60 * 1000))} min`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    return `Actualizado hace ${Math.floor(elapsedMs / (60 * 60 * 1000))} h`;
  }
  return `Actualizado hace ${Math.floor(elapsedMs / (24 * 60 * 60 * 1000))} d`;
}

function rowFromOutcome(outcome: ActivitySyncServiceOutcome): GlobalActivitySyncRow {
  if (outcome.reauthorizationRequired) {
    return serviceRow(outcome.service, "Requiere autorización", "error");
  }
  if (!outcome.success) {
    return serviceRow(outcome.service, "Error al actualizar", "error");
  }
  if (outcome.created === 0) {
    return serviceRow(outcome.service, "Sin novedades", "success");
  }
  const noun = outcome.service === "mail"
    ? outcome.created === 1 ? "correo" : "correos"
    : outcome.created === 1 ? "cita" : "citas";
  return serviceRow(outcome.service, `+${outcome.created} ${noun}`, "success");
}

function serviceRow(
  service: ActivitySyncService,
  status: string,
  tone: GlobalActivitySyncRow["tone"]
): GlobalActivitySyncRow {
  return {
    icon: service === "mail" ? "mail" : "calendar",
    key: service,
    label: service === "mail" ? "Correos" : "Citas",
    status,
    tone
  };
}

function validTimestamp(value: string | null) {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}
