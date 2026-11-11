// Calendar is limited to administrators; Gmail remains a separate restricted-scope product gate.
// This does not revoke grants already held by Google or erase persisted preferences.
export const GOOGLE_GMAIL_ENABLED = false;
export const GOOGLE_CALENDAR_OWNED_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned.readonly";
export const GOOGLE_CALENDAR_LEGACY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export function googleProductOperationEnabled(operation: string) {
  return operation === "calendar" || operation === "contacts";
}

export function calendarScopeGranted(scopes: readonly string[]) {
  return scopes.includes(GOOGLE_CALENDAR_OWNED_SCOPE) || scopes.includes(GOOGLE_CALENDAR_LEGACY_SCOPE);
}
