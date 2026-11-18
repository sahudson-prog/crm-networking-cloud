import assert from "node:assert/strict";
import test from "node:test";
import { BoardMoveQueue, attachBoardUnloadWarning } from "../lib/boardMoveQueue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let invalidations = 0;
  const queue = new BoardMoveQueue(() => { invalidations++; });
  queue.scope("test-owner");
  return { queue, invalidations: () => invalidations };
}
const key = "contact:synthetic";
const result = { previous: "Pendiente", actual: "Contactado" };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("drop starts immediately; navigation/unsubscribe does not discard the active write", async () => {
  const f = fixture(), pending = deferred<typeof result>();
  let writes = 0;
  const unsubscribe = f.queue.subscribe(() => {});
  const done = f.queue.enqueue({ key, target: "Contactado", write: () => { writes++; return pending.promise; }, read: async () => "Contactado" });
  assert.equal(writes, 1); assert.equal(f.queue.getSnapshot()[0].phase, "saving");
  unsubscribe(); // View unmounts immediately after the drop.
  pending.resolve(result); await done;
  const returnedView = f.queue.getSnapshot();
  assert.equal(returnedView[0].phase, "saved"); assert.equal(returnedView[0].actual, "Contactado");
  assert.equal(writes, 1); assert.equal(f.invalidations(), 1); assert.equal(f.queue.isActive(), false);
});

test("same entity serializes rapid moves including a return to its original state", async () => {
  const f = fixture(), first = deferred<typeof result>(), second = deferred<typeof result>();
  const writes: string[] = []; let actual = "Pendiente";
  const one = f.queue.enqueue({ key, target: "Contactado", write: () => { writes.push("Contactado"); return first.promise; }, read: async () => actual });
  const two = f.queue.enqueue({ key, target: "Pendiente", write: () => { writes.push("Pendiente"); return second.promise; }, read: async () => actual });
  assert.deepEqual(writes, ["Contactado"]); assert.equal(f.queue.getSnapshot()[0].target, "Pendiente");
  actual = "Contactado"; first.resolve(result); await one; await tick();
  assert.deepEqual(writes, ["Contactado", "Pendiente"]); assert.equal(f.queue.getSnapshot()[0].phase, "saving");
  actual = "Pendiente"; second.resolve({ previous: "Contactado", actual }); await two;
  assert.equal(f.queue.getSnapshot()[0].actual, "Pendiente"); assert.equal(f.invalidations(), 1);
});

test("different contacts in a grouped card save independently and survive unmount", async () => {
  const f = fixture(), pending = deferred<typeof result>(); let writes = 0;
  const commands = [key, "contact:second", "contact:third"].map(key => f.queue.enqueue({ key, target: "Contactado",
    write: () => { writes++; return pending.promise; }, read: async () => "Contactado" }));
  assert.equal(writes, 3); pending.resolve(result); await Promise.all(commands);
  assert.equal(f.queue.getSnapshot().filter(s => s.phase === "saved").length, 3);
});

for (const committed of [false, true]) test(`failed/uncertain write reconciles without replay (committed=${committed})`, async () => {
  const f = fixture(); let writes = 0, reads = 0;
  await f.queue.enqueue({ key, target: "Contactado", tutorial: true,
    write: async () => { writes++; throw Error("transport_or_server_failure"); },
    read: async () => { reads++; return committed ? "Contactado" : "Pendiente"; } });
  assert.equal(f.queue.getSnapshot()[0].phase, "error");
  assert.equal(f.queue.getSnapshot()[0].actual, committed ? "Contactado" : "Pendiente");
  assert.equal(f.queue.getSnapshot()[0].confirmation, undefined);
  await f.queue.reconcile(key); assert.equal(writes, 1); assert.equal(reads, 2);
});

test("a failed move stops already queued followers; fresh user intent requires reconciliation", async () => {
  const f = fixture(), first = deferred<typeof result>(); let writes = 0;
  const one = f.queue.enqueue({ key, target: "Contactado", write: () => { writes++; return first.promise; }, read: async () => "Pendiente" });
  const two = f.queue.enqueue({ key, target: "Agendado", write: async () => { writes++; return result; }, read: async () => "Agendado" });
  first.reject(Error("failure")); await Promise.all([one, two]);
  assert.equal(writes, 1); assert.equal(f.queue.getSnapshot()[0].phase, "error");
  await f.queue.enqueue({ key, target: "Contactado", write: async () => { writes++; return result; }, read: async () => "Contactado" });
  assert.equal(writes, 2); assert.equal(f.queue.getSnapshot()[0].phase, "saved");
});

test("failed fresh read blocks another write; read-only retry is deduplicated", async () => {
  const f = fixture(), fresh = deferred<string>(); let reads = 0, writes = 0;
  await f.queue.enqueue({ key, target: "Contactado", write: async () => { writes++; throw Error("response_lost"); },
    read: () => { reads++; return reads === 1 ? Promise.reject(Error("offline")) : fresh.promise; } });
  assert.equal(f.queue.getSnapshot()[0].unresolved, true);
  const command = { key, target: "Agendado", write: async () => { writes++; return result; }, read: async () => "Agendado" };
  await assert.rejects(f.queue.enqueue(command), /reconciliation_required/);
  const retry = f.queue.reconcile(key); await f.queue.reconcile(key);
  await assert.rejects(f.queue.enqueue(command), /reconciliation_required/);
  fresh.resolve("Contactado"); await retry;
  assert.equal(reads, 2); assert.equal(writes, 1); assert.equal(f.queue.getSnapshot()[0].unresolved, false);
});

test("persisted writer evidence confirms without a redundant reconciliation read", async () => {
  const f = fixture(); let reads = 0;
  await f.queue.enqueue({ key, target: "Contactado", write: async () => result, read: async () => { reads++; return "Agendado"; } });
  assert.equal(f.queue.getSnapshot()[0].phase, "saved"); assert.equal(f.queue.getSnapshot()[0].actual, "Contactado");
  assert.equal(reads, 0);
});

test("an old list on remount cannot erase the reconciled overlay", async () => {
  const f = fixture();
  await f.queue.enqueue({ key, target: "Contactado", write: async () => result, read: async () => "Contactado" });
  f.queue.acknowledgeRead("contact:", new Map([["synthetic", "Pendiente"]]));
  assert.equal(f.queue.getSnapshot()[0].actual, "Contactado");
  f.queue.acknowledgeRead("contact:", new Map([["synthetic", "Contactado"]]));
  assert.equal(f.queue.getSnapshot().length, 0);
});

test("confirmed tutorial exercise survives navigation; no credit for noop or other transition", async () => {
  const f = fixture();
  await f.queue.enqueue({ key, target: "Contactado", tutorial: true, write: async () => result, read: async () => "Contactado" });
  const confirmation = f.queue.getSnapshot()[0].confirmation!;
  assert.deepEqual(confirmation, result);
  f.queue.acknowledgeRead("contact:", new Map([["synthetic", "Contactado"]]));
  assert.equal(f.queue.getSnapshot()[0].confirmation, confirmation);
  f.queue.acknowledgeConfirmation(key, confirmation);
  assert.equal(f.queue.getSnapshot().length, 0);
  for (const previous of ["Contactado", "Agendado"]) {
    await f.queue.enqueue({ key, target: "Contactado", tutorial: true, write: async () => ({ previous, actual: "Contactado" }), read: async () => "Contactado" });
    assert.equal(f.queue.getSnapshot()[0].confirmation, undefined);
  }
});

test("owner change suppresses queued writes and late results from the previous session", async () => {
  const f = fixture(), pending = deferred<typeof result>(); let oldWrites = 0, oldReads = 0;
  const command = { key, target: "Contactado", write: () => { oldWrites++; return pending.promise; }, read: async () => { oldReads++; return "Contactado"; } };
  const one = f.queue.enqueue(command), two = f.queue.enqueue(command);
  f.queue.scope("another-owner"); assert.equal(f.queue.getSnapshot().length, 0);
  await f.queue.enqueue({ key, target: "Agendado", write: async () => ({ previous: "Contactado", actual: "Agendado" }), read: async () => "Agendado" });
  pending.resolve(result); await Promise.all([one, two]);
  assert.equal(oldWrites, 1); assert.equal(oldReads, 0); assert.equal(f.queue.getSnapshot()[0].actual, "Agendado");
  assert.equal(f.invalidations(), 1); f.queue.scope(null);
  await assert.rejects(f.queue.enqueue(command), /access_changed/);
});

test("beforeunload warning exists only during active work and never performs a write", async () => {
  const f = fixture(), pending = deferred<typeof result>();
  let handler: EventListener | undefined, writes = 0;
  const detach = attachBoardUnloadWarning(f.queue, {
    addEventListener(_name: string, fn: EventListenerOrEventListenerObject) { handler = fn as EventListener; },
    removeEventListener() { handler = undefined; }
  });
  assert.equal(handler, undefined);
  const done = f.queue.enqueue({ key, target: "Contactado", write: () => { writes++; return pending.promise; }, read: async () => "Contactado" });
  let warned = false;
  handler!({ preventDefault() { warned = true; }, returnValue: null } as unknown as Event);
  assert.equal(warned, true); assert.equal(writes, 1);
  pending.resolve(result); await done; assert.equal(handler, undefined); detach();
});
