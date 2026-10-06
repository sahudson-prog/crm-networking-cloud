export const INTERACTION_SYNC_PREFERENCES_SETTING_KEY = "interaction_sync_preferences_v1";
export const PENDING_INTERACTION_SYNC_SERVICE_KEY = "coffeecito_pending_interaction_sync_service_v1";

export type InteractionSyncService = "calendar" | "gmail";

export type InteractionSyncPreferences = {
  calendarEnabled: boolean;
  gmailEnabled: boolean;
};

export const DEFAULT_INTERACTION_SYNC_PREFERENCES: InteractionSyncPreferences = {
  calendarEnabled: false,
  gmailEnabled: false
};

export function parseInteractionSyncPreferences(value: string | null | undefined): InteractionSyncPreferences {
  if (!value?.trim()) return { ...DEFAULT_INTERACTION_SYNC_PREFERENCES };
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) return { ...DEFAULT_INTERACTION_SYNC_PREFERENCES };
    return {
      calendarEnabled: parsed.calendarEnabled === true,
      gmailEnabled: parsed.gmailEnabled === true
    };
  } catch {
    return { ...DEFAULT_INTERACTION_SYNC_PREFERENCES };
  }
}

export function serializeInteractionSyncPreferences(preferences: InteractionSyncPreferences) {
  return JSON.stringify({
    calendarEnabled: preferences.calendarEnabled === true,
    gmailEnabled: preferences.gmailEnabled === true
  });
}

export function withInteractionSyncService(
  preferences: InteractionSyncPreferences,
  service: InteractionSyncService,
  enabled: boolean
): InteractionSyncPreferences {
  return {
    ...preferences,
    [service === "gmail" ? "gmailEnabled" : "calendarEnabled"]: enabled
  };
}

export function interactionSyncToggleAction(input: { capabilityAvailable: boolean; enabled: boolean }) {
  if (!input.enabled) return "disable" as const;
  return input.capabilityAvailable ? "enable" as const : "authorize" as const;
}

export function rememberPendingInteractionSyncService(service: InteractionSyncService) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_INTERACTION_SYNC_SERVICE_KEY, service);
}

export function readPendingInteractionSyncService(): InteractionSyncService | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(PENDING_INTERACTION_SYNC_SERVICE_KEY);
  return value === "gmail" || value === "calendar" ? value : null;
}

export function clearPendingInteractionSyncService() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_INTERACTION_SYNC_SERVICE_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
