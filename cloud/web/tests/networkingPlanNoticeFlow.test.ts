import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reconcileNetworkingPlanNotice, type FutureNetworkingPlan } from "../lib/networkingPlanNoticeFlow.ts";

const business: FutureNetworkingPlan = "BUSINESS_DEVELOPMENT";
const brand: FutureNetworkingPlan = "PERSONAL_BRAND";

test("alta y retirada confirman el estado persistido sin invertir la operación", async () => {
  const active = new Set<FutureNetworkingPlan>([brand]);
  let requests = 0;
  const request = async (mode: FutureNetworkingPlan) => { requests++; active.add(mode); };
  const withdraw = async (mode: FutureNetworkingPlan) => { active.delete(mode); };
  const read = async () => new Set(active);
  assert.equal((await reconcileNetworkingPlanNotice({ modality: business, desired: true, request, withdraw, read })).confirmed, true);
  assert.equal((await reconcileNetworkingPlanNotice({ modality: business, desired: true, request, withdraw, read })).confirmed, true);
  assert.equal(requests, 2);
  const removed = await reconcileNetworkingPlanNotice({ modality: business, desired: false, request, withdraw, read });
  assert.equal(removed.confirmed, true);
  assert.deepEqual([...removed.notices], [brand]);
});

test("respuesta perdida se resuelve leyendo el servidor, sin segunda escritura", async () => {
  let writes = 0;
  const result = await reconcileNetworkingPlanNotice({
    modality: business, desired: true,
    request: async () => { writes++; throw new Error("lost response"); },
    withdraw: async () => { throw new Error("unexpected"); },
    read: async () => new Set([business])
  });
  assert.equal(writes, 1);
  assert.equal(result.confirmed, true);
});

test("error confirmado o lectura fallida nunca se presenta como alta", async () => {
  const args = {
    modality: business, desired: true,
    request: async () => { throw new Error("denied"); },
    withdraw: async () => {},
    read: async () => new Set<FutureNetworkingPlan>()
  };
  assert.equal((await reconcileNetworkingPlanNotice(args)).confirmed, false);
  await assert.rejects(reconcileNetworkingPlanNotice({ ...args, read: async () => { throw new Error("read failed"); } }));
});

test("la UI conserva un botón por modalidad y muestra el aviso solo tras confirmación", () => {
  const source = readFileSync(new URL("../components/NetworkingCyclePanel.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/className="networking-plan-notice"/g) ?? []).length, 2);
  assert.match(source, /else if \(desired\)\s*\{\s*setNoticeInformation\(modality\)/);
  assert.match(source, /Te notificaremos al correo registrado en Coffeecito/);
  assert.doesNotMatch(source, /Confirma que quieres dejarnos tu correo/);
});
