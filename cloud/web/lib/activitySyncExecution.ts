export type ActivitySyncService = "mail" | "calendar";

export type ActivitySyncServiceOutcome = {
  created: number;
  error: string;
  reauthorizationRequired: boolean;
  service: ActivitySyncService;
  success: boolean;
  syncedAt: string | null;
};

export type GlobalActivitySyncSnapshot = {
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
  publishGlobalActivitySync({
    completedAt: null,
    error: "",
    outcomes: [],
    runId,
    running: true
  });

  const promise = Promise.resolve()
    .then(operation)
    .then((outcomes) => {
      publishGlobalActivitySync({
        completedAt: Date.now(),
        error: "",
        outcomes,
        runId,
        running: false
      });
      return outcomes;
    })
    .catch((error: unknown) => {
      publishGlobalActivitySync({
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : "No pude actualizar las interacciones.",
        outcomes: [],
        runId,
        running: false
      });
      return [];
    })
    .finally(() => {
      activeGlobalActivitySync = null;
    });

  activeGlobalActivitySync = promise;
  return { promise, started: true };
}

export function clearGlobalActivitySyncFeedback() {
  if (globalActivitySyncSnapshot.running) return;
  publishGlobalActivitySync({
    ...globalActivitySyncSnapshot,
    completedAt: null,
    outcomes: globalActivitySyncSnapshot.outcomes.filter((outcome) => !outcome.success)
  });
}

export function resetGlobalActivitySyncCoordinatorForTests() {
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
  outcomes: ActivitySyncServiceOutcome[]
) {
  return outcomes.reduce((freshness, outcome) => {
    if (!outcome.success || !outcome.syncedAt) return freshness;
    return { ...freshness, [outcome.service]: outcome.syncedAt };
  }, current);
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
