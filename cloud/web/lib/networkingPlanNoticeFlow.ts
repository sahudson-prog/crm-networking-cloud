export const FUTURE_NETWORKING_PLANS = ["BUSINESS_DEVELOPMENT", "PERSONAL_BRAND"] as const;
export type FutureNetworkingPlan = typeof FUTURE_NETWORKING_PLANS[number];

export async function reconcileNetworkingPlanNotice(input: {
  modality: FutureNetworkingPlan;
  desired: boolean;
  request: (modality: FutureNetworkingPlan) => Promise<void>;
  withdraw: (modality: FutureNetworkingPlan) => Promise<void>;
  read: () => Promise<Set<FutureNetworkingPlan>>;
}): Promise<{ notices: Set<FutureNetworkingPlan>; confirmed: boolean }> {
  try {
    if (input.desired) await input.request(input.modality);
    else await input.withdraw(input.modality);
  } catch {
    // A lost response is not evidence that the write failed. Read the server state.
  }
  const notices = await input.read();
  return { notices, confirmed: notices.has(input.modality) === input.desired };
}
