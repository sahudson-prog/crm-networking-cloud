import { readAllActiveContacts, readAllInteractions, readInteractionParticipants, readExternalSourcesForInteractions, readDashboardReferrals } from "./cloudData";

/** Existing dashboard detail readers; never used as the source of the tracking metrics. */
export async function readDashboardDetails() {
  const [contacts, interactions, participants, referrals] = await Promise.all([
    readAllActiveContacts(true), readAllInteractions(), readInteractionParticipants(true), readDashboardReferrals()
  ]);
  const sources = await readExternalSourcesForInteractions(interactions.map(i => i.id), true);
  return { contacts, interactions, participants, referrals, sources };
}
export type DashboardDetails = Awaited<ReturnType<typeof readDashboardDetails>>;
