import type { ActivitySyncService } from "./activitySyncExecution";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_GMAIL_READONLY_SCOPE
} from "./googleInteractionClient";
import { reconnectGoogle } from "./googleAuthSession";
import { requireGoogleOAuthRolloutEligibility } from "./googleSyncAuthorization";

export const PENDING_ACTIVITY_SYNC_AUTHORIZATION_KEY = "coffeecito_pending_activity_sync_authorization_v1";

const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

type PendingActivitySyncAuthorization = {
  createdAt: number;
  services: ActivitySyncService[];
};

export async function beginActivitySyncAuthorization(
  requestedServices: ActivitySyncService[],
  missingServices: ActivitySyncService[],
  redirectTo: string
) {
  const normalizedRequestedServices = normalizeServices(requestedServices);
  const normalizedMissingServices = normalizeServices(missingServices);
  if (!normalizedRequestedServices.length || !normalizedMissingServices.length) return;
  await requireGoogleOAuthRolloutEligibility();
  rememberPendingActivitySyncAuthorization(normalizedRequestedServices);
  try {
    await reconnectGoogle(activitySyncAuthorizationScopes(normalizedMissingServices), redirectTo);
  } catch (error) {
    clearPendingActivitySyncAuthorization();
    throw error;
  }
}

export function activitySyncAuthorizationScopes(services: ActivitySyncService[]) {
  return normalizeServices(services).map((service) => (
    service === "mail" ? GOOGLE_GMAIL_READONLY_SCOPE : GOOGLE_CALENDAR_READONLY_SCOPE
  ));
}

export function readPendingActivitySyncAuthorization(): PendingActivitySyncAuthorization | null {
  if (typeof window === "undefined") return null;
  const rawValue = window.sessionStorage.getItem(PENDING_ACTIVITY_SYNC_AUTHORIZATION_KEY);
  if (!rawValue) return null;
  try {
    const value = JSON.parse(rawValue);
    const createdAt = typeof value?.createdAt === "number" ? value.createdAt : 0;
    const services = normalizeServices(Array.isArray(value?.services) ? value.services : []);
    if (!createdAt || !services.length || Date.now() - createdAt > PENDING_AUTHORIZATION_TTL_MS) {
      clearPendingActivitySyncAuthorization();
      return null;
    }
    return { createdAt, services };
  } catch {
    clearPendingActivitySyncAuthorization();
    return null;
  }
}

export function clearPendingActivitySyncAuthorization() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_ACTIVITY_SYNC_AUTHORIZATION_KEY);
}

function rememberPendingActivitySyncAuthorization(services: ActivitySyncService[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PENDING_ACTIVITY_SYNC_AUTHORIZATION_KEY, JSON.stringify({
    createdAt: Date.now(),
    services
  }));
}

function normalizeServices(services: ActivitySyncService[]) {
  return Array.from(new Set(services.filter((service): service is ActivitySyncService => (
    service === "mail" || service === "calendar"
  )))).sort();
}
