import { getSharedReadOwner, readSharedView } from "./indicatorReads";
import { readOpportunities } from "./opportunityActions";

export async function readOpportunityBoard() {
  const owner = getSharedReadOwner();
  try { return await readSharedView("opportunity-board", readOpportunities); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "read_superseded" || !owner || getSharedReadOwner() !== owner) throw error;
    // A cache generation replaced during navigation/mutation is not a storage failure.
    return readSharedView("opportunity-board", readOpportunities);
  }
}
