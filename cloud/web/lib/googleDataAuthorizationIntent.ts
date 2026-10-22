import { GOOGLE_CONTACTS_READONLY_SCOPE } from "./googleContactsClient";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE
} from "./googleInteractionClient";
import { reconnectGoogle } from "./googleAuthSession";
import {
  requireGoogleOAuthRolloutEligibility,
  type ConnectedSyncOperation
} from "./googleSyncAuthorization";

export const PENDING_GOOGLE_DATA_ACTION_KEY = "coffeecito_pending_google_data_action_v1";

export type GoogleDataAuthorizationIntent =
  | "import_contacts"
  | "enable_calendar_sync"
  | "import_gmail_history"
  | "enable_gmail_sync";

export type GoogleDataCapability = "calendar" | "contacts" | "gmail";

const PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

const INTENT_CONFIG: Record<GoogleDataAuthorizationIntent, {
  capability: GoogleDataCapability;
  scopes: string[];
}> = {
  enable_calendar_sync: {
    capability: "calendar",
    scopes: [GOOGLE_CALENDAR_READONLY_SCOPE]
  },
  enable_gmail_sync: {
    capability: "gmail",
    scopes: [GOOGLE_GMAIL_READONLY_SCOPE]
  },
  import_contacts: {
    capability: "contacts",
    scopes: [GOOGLE_CONTACTS_READONLY_SCOPE]
  },
  import_gmail_history: {
    capability: "gmail",
    scopes: [GOOGLE_GMAIL_READONLY_SCOPE]
  }
};

export function googleDataAuthorizationScopes(intent: GoogleDataAuthorizationIntent) {
  return [...INTENT_CONFIG[intent].scopes];
}

export function googleDataAuthorizationCapability(intent: GoogleDataAuthorizationIntent) {
  return INTENT_CONFIG[intent].capability;
}

export function googleDataAuthorizationOperation(intent: GoogleDataAuthorizationIntent): ConnectedSyncOperation {
  const capability = googleDataAuthorizationCapability(intent);
  return capability === "gmail" ? "email" : capability;
}

export async function beginGoogleDataAuthorization(
  intent: GoogleDataAuthorizationIntent,
  redirectTo: string
) {
  await requireGoogleOAuthRolloutEligibility(googleDataAuthorizationOperation(intent));
  rememberPendingGoogleDataAction(intent);
  try {
    await reconnectGoogle(googleDataAuthorizationScopes(intent), redirectTo);
  } catch (error) {
    clearPendingGoogleDataAction();
    throw error;
  }
}

export function rememberPendingGoogleDataAction(intent: GoogleDataAuthorizationIntent) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_GOOGLE_DATA_ACTION_KEY, JSON.stringify({
    createdAt: Date.now(),
    intent
  }));
}

export function readPendingGoogleDataAction(): GoogleDataAuthorizationIntent | null {
  if (typeof window === "undefined") return null;
  const rawValue = window.sessionStorage.getItem(PENDING_GOOGLE_DATA_ACTION_KEY);
  if (!rawValue) return null;
  try {
    const value = JSON.parse(rawValue);
    const intent = isGoogleDataAuthorizationIntent(value?.intent) ? value.intent : null;
    const createdAt = typeof value?.createdAt === "number" ? value.createdAt : 0;
    if (!intent || !createdAt || Date.now() - createdAt > PENDING_ACTION_TTL_MS) {
      clearPendingGoogleDataAction();
      return null;
    }
    return intent;
  } catch {
    clearPendingGoogleDataAction();
    return null;
  }
}

export function clearPendingGoogleDataAction() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_GOOGLE_DATA_ACTION_KEY);
}

function isGoogleDataAuthorizationIntent(value: unknown): value is GoogleDataAuthorizationIntent {
  return value === "import_contacts"
    || value === "enable_calendar_sync"
    || value === "import_gmail_history"
    || value === "enable_gmail_sync";
}
