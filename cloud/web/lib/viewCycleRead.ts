import { expectedNetworkingContext, networkingContextFromCycles, readNetworkingCycles } from "./networkingCycles";
import { readSharedView, peekSharedView } from "./indicatorReads";

/** Presentation cache only; mutation-time context guards remain in the existing writers. */
export function readViewCycle() {
  return readSharedView("cycle-view", async () => {
    const [cycles, expected] = await Promise.all([readNetworkingCycles(), expectedNetworkingContext()]);
    return { cycles, stale: expected.token !== networkingContextFromCycles(cycles).token };
  });
}
export const peekViewCycle = () => peekSharedView<Awaited<ReturnType<typeof readViewCycle>>>("cycle-view");
