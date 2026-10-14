import assert from "node:assert/strict";
import test from "node:test";

import {
  activitySyncExecutionHasErrors,
  activitySyncExecutionSummary,
  allActivitySyncServicesSucceeded,
  executeActivitySyncServices,
  freshnessAfterActivitySync,
  getGlobalActivitySyncSnapshot,
  resetGlobalActivitySyncCoordinatorForTests,
  startGlobalActivitySync,
  subscribeGlobalActivitySync,
  type ActivitySyncServiceOutcome
} from "../lib/activitySyncExecution.ts";

test("un error Calendar no bloquea Review, Apply ni cursor Gmail", async () => {
  const calls: string[] = [];
  const outcomes = await executeActivitySyncServices({
    includeCalendar: true,
    includeMail: true,
    runService: async (service) => {
      calls.push(`${service}:review`);
      if (service === "calendar") return failure("calendar", "Error al actualizar Calendar");
      calls.push("mail:apply", "mail:cursor");
      return success("mail", 3);
    }
  });

  assert.deepEqual(calls, ["mail:review", "mail:apply", "mail:cursor", "calendar:review"]);
  assert.equal(activitySyncExecutionSummary(outcomes), "+3 correos · Error al actualizar Calendar");
  assert.equal(allActivitySyncServicesSucceeded(outcomes), false);
});

test("ambos servicios completan la corrida y el no-op sigue siendo exito", async () => {
  const calls: string[] = [];
  const outcomes = await executeActivitySyncServices({
    includeCalendar: true,
    includeMail: true,
    runService: async (service) => {
      calls.push(service);
      return success(service, 0);
    }
  });

  assert.deepEqual(calls, ["mail", "calendar"]);
  assert.equal(allActivitySyncServicesSucceeded(outcomes), true);
  assert.equal(activitySyncExecutionSummary(outcomes), "Sin novedades");
});

test("un error Gmail no bloquea persistencia Calendar", async () => {
  const calls: string[] = [];
  const outcomes = await executeActivitySyncServices({
    includeCalendar: true,
    includeMail: true,
    runService: async (service) => {
      calls.push(`${service}:review`);
      if (service === "mail") return failure("mail", "Error al actualizar Gmail");
      calls.push("calendar:apply", "calendar:cursor");
      return success("calendar", 2);
    }
  });

  assert.deepEqual(calls, ["mail:review", "calendar:review", "calendar:apply", "calendar:cursor"]);
  assert.equal(activitySyncExecutionSummary(outcomes), "+2 citas · Error al actualizar Gmail");
});

test("un error Apply de un servicio no detiene el otro", async () => {
  const calls: string[] = [];
  const outcomes = await executeActivitySyncServices({
    includeCalendar: true,
    includeMail: true,
    runService: async (service) => {
      calls.push(`${service}:review`, `${service}:apply`);
      return service === "mail"
        ? failure("mail", "No pude guardar algunos correos")
        : success("calendar", 1);
    }
  });

  assert.deepEqual(calls, ["mail:review", "mail:apply", "calendar:review", "calendar:apply"]);
  assert.equal(activitySyncExecutionSummary(outcomes), "+1 cita · No pude guardar algunos correos");
});

test("una excepcion inesperada de un servicio tampoco detiene el siguiente", async () => {
  const calls: string[] = [];
  const outcomes = await executeActivitySyncServices({
    includeCalendar: true,
    includeMail: true,
    runService: async (service) => {
      calls.push(service);
      if (service === "mail") throw new Error("detalle interno");
      return success("calendar", 1);
    }
  });

  assert.deepEqual(calls, ["mail", "calendar"]);
  assert.equal(activitySyncExecutionSummary(outcomes), "+1 cita · Error al actualizar Gmail");
  assert.equal(activitySyncExecutionSummary(outcomes).includes("detalle interno"), false);
});

test("resumen usa solo creados y agrega fallas por servicio", () => {
  assert.equal(activitySyncExecutionSummary([success("mail", 3), success("calendar", 2)]), "+3 correos · +2 citas");
  assert.equal(activitySyncExecutionSummary([success("mail", 0), success("calendar", 2)]), "+0 correos · +2 citas");
  assert.equal(activitySyncExecutionSummary([success("mail", 0), success("calendar", 0)]), "Sin novedades");
  assert.equal(
    activitySyncExecutionSummary([success("mail", 0), failure("calendar", "Error al actualizar Calendar")]),
    "Sin novedades en Gmail · Error al actualizar Calendar"
  );
  assert.equal(
    activitySyncExecutionSummary([failure("mail", "Error al actualizar Gmail"), failure("calendar", "Error al actualizar Calendar")]),
    "Error al actualizar Gmail · Error al actualizar Calendar"
  );
  assert.equal(activitySyncExecutionHasErrors([success("mail", 0), failure("calendar", "fallo")]), true);
  assert.equal(allActivitySyncServicesSucceeded([success("mail", 0), success("calendar", 0)]), true);
});

test("freshness avanza solo para servicios exitosos", () => {
  const previous = {
    calendar: "2026-10-05T10:00:00.000Z",
    mail: "2026-10-05T11:00:00.000Z"
  };
  assert.deepEqual(freshnessAfterActivitySync(previous, [
    success("mail", 1),
    failure("calendar", "Error al actualizar Calendar")
  ]), {
    calendar: previous.calendar,
    mail: "2026-10-06T12:00:00.000Z"
  });
});

test("solo se ejecutan servicios seleccionados por el preflight", async () => {
  const calls: string[] = [];
  await executeActivitySyncServices({
    includeCalendar: false,
    includeMail: true,
    runService: async (service) => {
      calls.push(service);
      return success(service, 0);
    }
  });
  assert.deepEqual(calls, ["mail"]);
});

test("coordinador global es single-flight y sobrevive a nuevos suscriptores", async () => {
  resetGlobalActivitySyncCoordinatorForTests();
  let resolveRun!: (outcomes: ActivitySyncServiceOutcome[]) => void;
  let operationCalls = 0;
  const snapshots: boolean[] = [];
  const unsubscribe = subscribeGlobalActivitySync(() => {
    snapshots.push(getGlobalActivitySyncSnapshot().running);
  });
  const operation = () => {
    operationCalls += 1;
    return new Promise<ActivitySyncServiceOutcome[]>((resolve) => {
      resolveRun = resolve;
    });
  };

  const first = startGlobalActivitySync(operation);
  const second = startGlobalActivitySync(operation);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(first.promise, second.promise);
  assert.equal(operationCalls, 0);
  assert.equal(getGlobalActivitySyncSnapshot().running, true);

  const remountedSnapshots = [getGlobalActivitySyncSnapshot().running];
  const unsubscribeRemounted = subscribeGlobalActivitySync(() => {
    remountedSnapshots.push(getGlobalActivitySyncSnapshot().running);
  });

  await Promise.resolve();
  assert.equal(operationCalls, 1);
  resolveRun([success("mail", 1)]);
  await first.promise;

  assert.equal(getGlobalActivitySyncSnapshot().running, false);
  assert.equal(getGlobalActivitySyncSnapshot().outcomes[0]?.created, 1);
  assert.deepEqual(snapshots, [true, false]);
  assert.deepEqual(remountedSnapshots, [true, false]);
  unsubscribe();
  unsubscribeRemounted();
  resetGlobalActivitySyncCoordinatorForTests();
});

test("coordinador global libera single-flight en finally ante error inesperado", async () => {
  resetGlobalActivitySyncCoordinatorForTests();
  const failed = startGlobalActivitySync(async () => {
    throw new Error("fallo controlado");
  });
  assert.deepEqual(await failed.promise, []);
  assert.equal(getGlobalActivitySyncSnapshot().running, false);
  assert.equal(getGlobalActivitySyncSnapshot().error, "fallo controlado");

  const retry = startGlobalActivitySync(async () => [success("calendar", 0)]);
  assert.equal(retry.started, true);
  await retry.promise;
  assert.equal(getGlobalActivitySyncSnapshot().running, false);
  assert.equal(getGlobalActivitySyncSnapshot().error, "");
  resetGlobalActivitySyncCoordinatorForTests();
});

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

function failure(service: ActivitySyncServiceOutcome["service"], error: string): ActivitySyncServiceOutcome {
  return {
    created: 0,
    error,
    reauthorizationRequired: false,
    service,
    success: false,
    syncedAt: null
  };
}
