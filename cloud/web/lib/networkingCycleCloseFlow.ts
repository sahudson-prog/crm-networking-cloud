import type { NetworkingCycleResult } from "./networkingCycleModel.ts";
import type { NetworkingCycle } from "./networkingCycles.ts";

export type CycleCloseInput = {
  requestId: string;
  cycleId: string;
  localEnd: string;
  result: NetworkingCycleResult;
  repeatedTimeChoice?: "earlier" | "later";
};

export type CycleCloseOutcome =
  | { kind: "ignored" }
  | { kind: "failed"; error: unknown }
  | { kind: "closed"; cycles: NetworkingCycle[] }
  | { kind: "closed_elsewhere"; cycles: NetworkingCycle[] }
  | { kind: "unconfirmed"; error: unknown }
  | { kind: "closed_refresh_failed"; error: unknown };

export function createCycleCloseFlow(
  close: (input: CycleCloseInput) => Promise<unknown>,
  read: () => Promise<NetworkingCycle[]>,
  adoptOwnClose: (cycle: NetworkingCycle, requestId: string) => void
) {
  let inFlight = false;
  const confirmed = new Set<string>();
  const unconfirmed = new Set<string>();

  return async (input: CycleCloseInput): Promise<CycleCloseOutcome> => {
    if (inFlight || confirmed.has(input.cycleId) || unconfirmed.has(input.cycleId)) return { kind: "ignored" };
    inFlight = true;
    try {
      try {
        await close(input);
      } catch (error) {
        try {
          const cycles = await read();
          const saved = cycles.find((cycle) => cycle.id === input.cycleId);
          if (saved?.status === "closed") {
            if (saved.close_request_id !== input.requestId) {
              confirmed.add(input.cycleId);
              return { kind: "closed_elsewhere", cycles };
            }
            if (saved.closed_result !== input.result) {
              unconfirmed.add(input.cycleId);
              return { kind: "unconfirmed", error: new Error("El resultado del cierre confirmado no coincide.") };
            }
            adoptOwnClose(saved, input.requestId);
            confirmed.add(input.cycleId);
            return { kind: "closed", cycles };
          }
          return { kind: "failed", error };
        } catch {
          unconfirmed.add(input.cycleId);
          return { kind: "unconfirmed", error };
        }
      }
      try {
        const cycles = await read();
        const saved = cycles.find((cycle) => cycle.id === input.cycleId);
        if (saved?.status !== "closed" || saved.closed_result !== input.result
          || saved.close_request_id !== input.requestId) {
          throw new Error("El cierre se guardó, pero la lectura aún no muestra el resultado confirmado.");
        }
        adoptOwnClose(saved, input.requestId);
        confirmed.add(input.cycleId);
        return { kind: "closed", cycles };
      } catch (error) {
        unconfirmed.add(input.cycleId);
        return { kind: "closed_refresh_failed", error };
      }
    } catch (error) {
      return { kind: "failed", error };
    } finally {
      inFlight = false;
    }
  };
}
