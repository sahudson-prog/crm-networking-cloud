import { readAllActiveContacts, readAllInteractions, readInteractionParticipants, readExternalSourcesForInteractions, readDashboardReferrals } from "./cloudData";
import {readSharedView} from "./indicatorReads";

/** Existing dashboard detail readers; never used as the source of the tracking metrics. */
export async function readDashboardDetails(scope:"all"|"planning"|"interactions"|"referrals"="all") {
  return readSharedView(`dashboard-details:${scope}`,()=>readDetails(scope));
}
async function readDetails(scope:"all"|"planning"|"interactions"|"referrals") {
  const [contacts, interactions, participants, referrals] = await Promise.all([
    readAllActiveContacts(true),
    readSharedView("interactions",readAllInteractions),
    readSharedView("participants",()=>readInteractionParticipants(true)),
    scope==="all"||scope==="referrals"?readSharedView("referrals",readDashboardReferrals):Promise.resolve([])
  ]);
  const sources = scope==="all"||scope==="interactions"?await readSharedView("interaction-sources",()=>readExternalSourcesForInteractions(interactions.map(i => i.id), true)):[];
  return { contacts, interactions, participants, referrals, sources };
}
export type DashboardDetails = Awaited<ReturnType<typeof readDashboardDetails>>;
