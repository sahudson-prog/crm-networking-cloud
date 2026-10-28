import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCycleCloseFlow, type CycleCloseInput } from "../lib/networkingCycleCloseFlow.ts";
import { reconciledClosedNetworkingContext, type NetworkingContext, type NetworkingCycle } from "../lib/networkingCycles.ts";

const input: CycleCloseInput = {
  requestId: "request-1", cycleId: "cycle-1", localEnd: "2026-10-27T12:00:00", result: "new_job"
};
const closedCycle = {
  id: input.cycleId, status: "closed", closed_result: input.result,
  closed_at: "2026-10-27T15:00:00Z", closed_recorded_at: "2026-10-27T15:00:02Z",
  close_request_id: input.requestId
} as NetworkingCycle;
const activeCycle = { ...closedCycle, status: "active", closed_result: null } as NetworkingCycle;

test("cierre exitoso confirma la lectura y entrega el historial actualizado", async () => {
  const calls: string[] = [];
  const older = { ...closedCycle, id: "cycle-0", closed_result: "stopped" } as NetworkingCycle;
  const submit = createCycleCloseFlow(
    async () => { calls.push("rpc"); return input.cycleId; },
    async () => { calls.push("read"); return [closedCycle, older]; },
    (cycle, requestId) => { assert.equal(cycle.close_request_id, requestId); calls.push("adopt"); }
  );

  const outcome = await submit(input);
  assert.deepEqual(calls, ["rpc", "read", "adopt"]);
  assert.equal(outcome.kind, "closed");
  if (outcome.kind !== "closed") return;
  assert.deepEqual(outcome.cycles.map((cycle) => cycle.id), ["cycle-1", "cycle-0"]);
  assert.equal(outcome.cycles[0].closed_result, "new_job");
  assert.equal(outcome.cycles[0].closed_recorded_at, "2026-10-27T15:00:02Z");
});

test("fallo confirmado de RPC conserva la solicitud para reintentar", async () => {
  let attempts = 0;
  let reads = 0;
  const submit = createCycleCloseFlow(
    async () => { if (++attempts === 1) throw new Error("cycle_end_invalid"); return input.cycleId; },
    async () => { reads += 1; return attempts === 1 ? [activeCycle] : [closedCycle]; },
    () => {}
  );

  const failed = await submit(input);
  assert.equal(failed.kind, "failed");
  if (failed.kind === "failed") assert.match(String(failed.error), /cycle_end_invalid/);
  assert.equal(reads, 1);
  assert.equal((await submit(input)).kind, "closed");
  assert.equal(attempts, 2);
  assert.equal(reads, 2);
});

test("respuesta RPC perdida se reconcilia con el cierre persistido sin reenviar", async () => {
  let calls = 0;
  let context: NetworkingContext = { cycleId: input.cycleId, token: `active:${input.cycleId}:start-request` };
  const submit = createCycleCloseFlow(
    async () => { calls += 1; throw new Error("network timeout"); },
    async () => [closedCycle],
    (cycle, requestId) => {
      assert.equal(cycle.close_request_id, requestId);
      context = reconciledClosedNetworkingContext(context, cycle, requestId);
    }
  );

  const outcome = await submit(input);
  assert.equal(outcome.kind, "closed");
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(calls, 1);
  assert.deepEqual(context, { cycleId: null, token: `none:${input.cycleId}` });
  // The next start must carry the reconciled none:<closed-id> version.
  const start = (expected: NetworkingContext) => expected.cycleId === null && expected.token === context.token;
  assert.equal(start({ cycleId: null, token: `none:${input.cycleId}` }), true);
  assert.equal(start({ cycleId: input.cycleId, token: `active:${input.cycleId}:start-request` }), false);
});

test("un cierre ajeno incluso con igual resultado no adopta contexto ni repite la RPC", async () => {
  const otherResult = { ...closedCycle, close_request_id: "other-request" } as NetworkingCycle;
  let adopted = false;
  const submit = createCycleCloseFlow(
    async () => { throw new Error("cycle_already_closed"); },
    async () => [otherResult],
    () => { adopted = true; }
  );
  assert.equal((await submit(input)).kind, "closed_elsewhere");
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(adopted, false);
  assert.throws(() => reconciledClosedNetworkingContext(
    { cycleId: input.cycleId, token: `active:${input.cycleId}:start-request` }, otherResult, input.requestId
  ), /confirmar el contexto/);
});

test("estado incierto tras fallo de RPC bloquea un nuevo envío", async () => {
  let calls = 0;
  const submit = createCycleCloseFlow(
    async () => { calls += 1; throw new Error("network timeout"); },
    async () => { throw new Error("read unavailable"); },
    () => {}
  );
  assert.equal((await submit(input)).kind, "unconfirmed");
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(calls, 1);
});

test("doble envío concurrente y repetición posterior no duplican el cierre", async () => {
  let release!: () => void;
  let calls = 0;
  const submit = createCycleCloseFlow(
    async () => { calls += 1; await new Promise<void>((resolve) => { release = resolve; }); },
    async () => [closedCycle],
    () => {}
  );

  const first = submit(input);
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(calls, 1);
  release();
  assert.equal((await first).kind, "closed");
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(calls, 1);
});

test("si falla la lectura después de persistir, no se reenvía la RPC", async () => {
  let calls = 0;
  const submit = createCycleCloseFlow(
    async () => { calls += 1; },
    async () => { throw new Error("read unavailable"); },
    () => {}
  );

  const outcome = await submit(input);
  assert.equal(outcome.kind, "closed_refresh_failed");
  assert.equal((await submit(input)).kind, "ignored");
  assert.equal(calls, 1);
});

test("el panel conecta adopción propia y exige recarga tras cierre ajeno", () => {
  const source = readFileSync(new URL("../components/NetworkingCyclePanel.tsx", import.meta.url), "utf8");
  assert.match(source, /createCycleCloseFlow\(closeNetworkingCycle, readNetworkingCycles, adoptConfirmedOwnClose\)/);
  assert.match(source, /setStale\(outcome\.kind === "closed_elsewhere"\)/);
});
