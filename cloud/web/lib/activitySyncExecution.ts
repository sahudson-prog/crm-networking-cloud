export type ActivitySyncService = "mail" | "calendar";

export type ActivitySyncServiceOutcome = {
  notice?: string;
  created: number;
  error: string;
  reauthorizationRequired: boolean;
  service: ActivitySyncService;
  success: boolean;
  syncedAt: string | null;
};

export type GlobalActivitySyncSnapshot = {
  progress?: string;
  lastSuccess?: Partial<Record<ActivitySyncService, string>>;
  completedAt: number | null;
  error: string;
  outcomes: ActivitySyncServiceOutcome[];
  runId: number;
  running: boolean;
};

type GlobalActivitySyncListener = () => void;

const idleGlobalActivitySyncSnapshot: GlobalActivitySyncSnapshot = {
  completedAt: null,
  error: "",
  outcomes: [],
  runId: 0,
  running: false
};

let globalActivitySyncSnapshot = idleGlobalActivitySyncSnapshot;
let activeGlobalActivitySync: Promise<ActivitySyncServiceOutcome[]> | null = null;
const globalActivitySyncListeners = new Set<GlobalActivitySyncListener>();
let activityScope = "";
let scopeRevision = 0;
let calendarAbort: AbortController | null = null;

export function startCalendarRunControl() {
  calendarAbort = new AbortController();
  return calendarAbort.signal;
}
export function cancelCalendarRun() { calendarAbort?.abort(); }
export function endCalendarRunControl() { calendarAbort = null; }
export function setCalendarRunProgress(account: string, progress: string) {
  if (activityScope === account && globalActivitySyncSnapshot.running) publishGlobalActivitySync({ ...globalActivitySyncSnapshot, progress });
}

export function bindGlobalActivitySyncScope(connectedAccountId: string | null) {
  const next = connectedAccountId ?? "";
  if (activityScope === next) return;
  cancelCalendarRun();
  activityScope = next;
  scopeRevision += 1;
  activeGlobalActivitySync = null;
  publishGlobalActivitySync({ ...idleGlobalActivitySyncSnapshot });
}

export async function withActivitySyncLock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return operation();
  if (!scope || !navigator.locks) throw new Error("No podemos coordinar esta actualización. Usa un navegador compatible.");
  return navigator.locks.request(`coffeecito-calendar:${scope}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Ya hay una actualización en otra pestaña. Espera a que termine.");
    return operation();
  });
}

export function getGlobalActivitySyncSnapshot() {
  return globalActivitySyncSnapshot;
}

export function getGlobalActivitySyncServerSnapshot() {
  return idleGlobalActivitySyncSnapshot;
}

export function subscribeGlobalActivitySync(listener: GlobalActivitySyncListener) {
  globalActivitySyncListeners.add(listener);
  return () => globalActivitySyncListeners.delete(listener);
}

export function startGlobalActivitySync(
  operation: () => Promise<ActivitySyncServiceOutcome[]>
) {
  if (activeGlobalActivitySync) {
    return { promise: activeGlobalActivitySync, started: false };
  }

  const runId = globalActivitySyncSnapshot.runId + 1;
  const revision = scopeRevision;
  const scope = activityScope;
  publishGlobalActivitySync({
    lastSuccess: globalActivitySyncSnapshot.lastSuccess,
    completedAt: null,
    error: "",
    outcomes: [],
    runId,
    running: true
  });

  const promise = Promise.resolve()
    .then(() => withActivitySyncLock(scope, operation))
    .then((outcomes) => {
      const lastSuccess = { ...globalActivitySyncSnapshot.lastSuccess };
      for (const outcome of outcomes) {
        if (outcome.success && outcome.syncedAt) lastSuccess[outcome.service] = outcome.syncedAt;
      }
      if (revision === scopeRevision) publishGlobalActivitySync({
        lastSuccess,
        completedAt: Date.now(),
        error: "",
        outcomes,
        runId,
        running: false
      });
      return outcomes;
    })
    .catch((error: unknown) => {
      if (revision === scopeRevision) publishGlobalActivitySync({
        lastSuccess: globalActivitySyncSnapshot.lastSuccess,
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : "No pude actualizar las interacciones.",
        outcomes: [],
        runId,
        running: false
      });
      return [];
    })
    .finally(() => {
      if (revision === scopeRevision) activeGlobalActivitySync = null;
    });

  activeGlobalActivitySync = promise;
  return { promise, started: true };
}

export function clearGlobalActivitySyncFeedback() {
  if (globalActivitySyncSnapshot.running) return;
  publishGlobalActivitySync({
    ...globalActivitySyncSnapshot,
    completedAt: null,
    // Only the badge expires; the last confirmed counts remain available in the popover.
    outcomes: globalActivitySyncSnapshot.outcomes
  });
}

export function resetGlobalActivitySyncCoordinatorForTests() {
  activityScope = "";
  scopeRevision += 1;
  activeGlobalActivitySync = null;
  globalActivitySyncSnapshot = idleGlobalActivitySyncSnapshot;
  globalActivitySyncListeners.clear();
}

export async function executeActivitySyncServices(input: {
  includeCalendar: boolean;
  includeMail: boolean;
  runService: (service: ActivitySyncService) => Promise<ActivitySyncServiceOutcome>;
}) {
  const services: ActivitySyncService[] = [];
  if (input.includeMail) services.push("mail");
  if (input.includeCalendar) services.push("calendar");

  const outcomes: ActivitySyncServiceOutcome[] = [];
  for (const service of services) {
    try {
      outcomes.push(await input.runService(service));
    } catch {
      outcomes.push({
        created: 0,
        error: genericServiceError(service),
        reauthorizationRequired: false,
        service,
        success: false,
        syncedAt: null
      });
    }
  }
  return outcomes;
}

export function activitySyncExecutionSummary(outcomes: ActivitySyncServiceOutcome[]) {
  const successful = outcomes.filter((outcome) => outcome.success);
  const failed = outcomes.filter((outcome) => !outcome.success);
  const createdParts = (failed.length
    ? successful.filter((outcome) => outcome.created > 0)
    : successful
  ).map((outcome) => createdSummary(outcome.service, outcome.created));
  const errorParts = failed.map((outcome) => outcome.error || genericServiceError(outcome.service));

  if (!failed.length && successful.every((outcome) => outcome.created === 0)) return "Sin novedades";
  if (failed.length && successful.length && !createdParts.length) {
    createdParts.push(successful.length === 1
      ? `Sin novedades en ${serviceLabel(successful[0].service)}`
      : "Sin novedades en los servicios completados");
  }
  return [...createdParts, ...errorParts].join(" · ");
}

export function allActivitySyncServicesSucceeded(outcomes: ActivitySyncServiceOutcome[]) {
  return outcomes.length > 0 && outcomes.every((outcome) => outcome.success);
}

export function activitySyncExecutionHasErrors(outcomes: ActivitySyncServiceOutcome[]) {
  return outcomes.some((outcome) => !outcome.success);
}

export function freshnessAfterActivitySync(
  current: { calendar: string | null; mail: string | null },
  outcomes: ActivitySyncServiceOutcome[],
  confirmed: Partial<Record<ActivitySyncService, string>> = {}
) {
  const freshness = { ...current };
  const accept = (service: ActivitySyncService, value: string | null | undefined) => {
    if (value && Number.isFinite(Date.parse(value))
      && (!freshness[service] || Date.parse(value) > Date.parse(freshness[service]!))) freshness[service] = value;
  };
  for (const service of ["calendar", "mail"] as const) accept(service, confirmed[service]);
  for (const outcome of outcomes) if (outcome.success) accept(outcome.service, outcome.syncedAt);
  return freshness;
}

function createdSummary(service: ActivitySyncService, created: number) {
  if (service === "mail") return `+${created} ${created === 1 ? "correo" : "correos"}`;
  return `+${created} ${created === 1 ? "cita" : "citas"}`;
}

function genericServiceError(service: ActivitySyncService) {
  return `Error al actualizar ${serviceLabel(service)}`;
}

function serviceLabel(service: ActivitySyncService) {
  return service === "mail" ? "Gmail" : "Calendar";
}

function publishGlobalActivitySync(snapshot: GlobalActivitySyncSnapshot) {
  globalActivitySyncSnapshot = snapshot;
  for (const listener of globalActivitySyncListeners) listener();
}
