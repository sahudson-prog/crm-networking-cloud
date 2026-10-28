"use client";

import { supabase } from "./supabaseClient.ts";
import type { NetworkingCycleResult } from "./networkingCycleModel.ts";
import { localDateTimeToIso, type RepeatedTimeChoice } from "./networkingCycleTime.ts";
export { localDateTimeValue } from "./networkingCycleTime.ts";

export type NetworkingCycle = {
  id: string;
  objective_type: "JOB_SEARCH" | "BUSINESS_DEVELOPMENT" | "PERSONAL_BRAND";
  origin: "user" | "legacy";
  status: "active" | "closed";
  cycle_name: string | null;
  started_at: string | null;
  started_on: string | null;
  timezone_name: string | null;
  closed_at: string | null;
  closed_result: NetworkingCycleResult | null;
  closed_recorded_at: string | null;
  start_request_id: string | null;
  close_request_id: string | null;
};

// Kept in memory per tab. A tab that began work in an older cycle keeps that
// expectation until this tab itself creates or closes a cycle.
export type NetworkingContext = { cycleId: string | null; token: string };
let expectedContext: NetworkingContext | undefined;
let expectedUserId: string | undefined;

function requireClient() {
  if (!supabase) throw new Error("Supabase no está configurado.");
  return supabase;
}

async function requireUserId() {
  const { data, error } = await requireClient().auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("No hay usuario autenticado.");
  return data.user.id;
}

export async function readNetworkingCycles(): Promise<NetworkingCycle[]> {
  const userId = await requireUserId();
  const { data, error } = await requireClient().from("networking_cycles")
    .select("id,objective_type,origin,status,cycle_name,started_at,started_on,timezone_name,closed_at,closed_result,closed_recorded_at,start_request_id,close_request_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NetworkingCycle[];
}

export function networkingContextFromCycles(cycles: NetworkingCycle[]): NetworkingContext {
  const active = cycles.find((cycle) => cycle.status === "active");
  if (active) return { cycleId: active.id, token: `active:${active.id}:${active.start_request_id ?? active.id}` };
  const closed = cycles.filter((cycle) => cycle.status === "closed")
    .sort((left, right) => (Date.parse(right.closed_recorded_at ?? "") || 0)
      - (Date.parse(left.closed_recorded_at ?? "") || 0)
      || right.id.localeCompare(left.id))[0];
  return { cycleId: null, token: `none:${closed?.id ?? "initial"}` };
}

export async function expectedNetworkingContext(): Promise<NetworkingContext> {
  const userId = await requireUserId();
  if (expectedUserId !== userId) {
    expectedUserId = userId;
    expectedContext = undefined;
  }
  if (expectedContext === undefined) {
    const initial = networkingContextFromCycles(await readNetworkingCycles());
    if (expectedUserId === userId && expectedContext === undefined) expectedContext = initial;
  }
  if (!expectedContext) throw new Error("El contexto de networking cambió. Actualiza la página.");
  return expectedContext;
}

export async function expectedNetworkingCycleId(): Promise<string | null> {
  return (await expectedNetworkingContext()).cycleId;
}

function setExpectedNetworkingContext(value: NetworkingContext) {
  expectedContext = value;
}

export async function networkingWriteContext() {
  return (await expectedNetworkingContext()).token;
}

export async function startNetworkingCycle(input: {
  requestId: string;
  name: string;
  localStart: string;
  resetStatus: boolean;
  clearFocus: boolean;
  legacyCycleId?: string;
  repeatedTimeChoice?: RepeatedTimeChoice;
}) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Escribe un nombre de hasta 120 caracteres.");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const startedAt = localDateTimeToIso(input.localStart, timezone, input.repeatedTimeChoice);
  const expected = await expectedNetworkingContext();
  if (input.legacyCycleId) {
    if (expected.cycleId !== input.legacyCycleId) throw new Error("El ciclo cambió. Actualiza la página.");
    const { data, error } = await requireClient().rpc("configure_legacy_networking_cycle_r2b", {
      p_request_id: input.requestId,
      p_cycle_id: input.legacyCycleId,
      p_expected_context: expected.token,
      p_name: name,
      p_started_at: startedAt,
      p_timezone: timezone
    });
    if (error) throw error;
    await adoptActiveCycle(String(data));
    return String(data);
  }
  const { data, error } = await requireClient().rpc("start_networking_cycle_r2b", {
    p_request_id: input.requestId,
    p_name: name,
    p_started_at: startedAt,
    p_timezone: timezone,
    p_expected_cycle_id: expected.cycleId,
    p_expected_context: expected.token,
    p_reset_status: input.resetStatus,
    p_clear_focus: input.clearFocus
  });
  if (error) throw error;
  await adoptActiveCycle(String(data));
  return String(data);
}

async function adoptActiveCycle(cycleId: string) {
  const row = (await readNetworkingCycles()).find((cycle) => cycle.id === cycleId);
  if (!row) throw new Error("El ciclo guardado no se pudo leer. Actualiza la página.");
  setExpectedNetworkingContext({ cycleId, token: `active:${cycleId}:${row.start_request_id ?? cycleId}` });
}

export async function closeNetworkingCycle(input: {
  requestId: string;
  cycleId: string;
  localEnd: string;
  result: NetworkingCycleResult;
  repeatedTimeChoice?: RepeatedTimeChoice;
}) {
  const expected = await expectedNetworkingContext();
  if (expected.cycleId !== input.cycleId) {
    throw new Error("El ciclo cambió. Actualiza la página.");
  }
  const { data, error } = await requireClient().rpc("close_networking_cycle_r2b", {
    p_request_id: input.requestId,
    p_cycle_id: input.cycleId,
    p_expected_context: expected.token,
    p_closed_at: localDateTimeToIso(input.localEnd,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", input.repeatedTimeChoice),
    p_result: input.result
  });
  if (error) throw error;
  setExpectedNetworkingContext({ cycleId: null, token: `none:${input.cycleId}` });
  return String(data);
}

export function adoptConfirmedOwnClose(cycle: NetworkingCycle, requestId: string) {
  if (!expectedContext) throw new Error("No pudimos confirmar el contexto del cierre. Recarga la página.");
  setExpectedNetworkingContext(reconciledClosedNetworkingContext(expectedContext, cycle, requestId));
}

export function reconciledClosedNetworkingContext(current: NetworkingContext,
  cycle: NetworkingCycle, requestId: string): NetworkingContext {
  if (cycle.status !== "closed" || cycle.close_request_id !== requestId
    || (current.cycleId !== cycle.id && current.token !== `none:${cycle.id}`)) {
    throw new Error("No pudimos confirmar el contexto del cierre. Recarga la página.");
  }
  return { cycleId: null, token: `none:${cycle.id}` };
}
