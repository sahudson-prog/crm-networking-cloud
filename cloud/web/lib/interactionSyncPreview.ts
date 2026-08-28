import type { SyncGoogleInteractionsResult } from "./googleInteractionSyncFlow";
import type { SyncPreviewChange } from "./syncOrchestrator";

export function interactionPreviewChanges(result: SyncGoogleInteractionsResult | null) {
  return [
    ...(result?.mail?.preview ?? []),
    ...(result?.calendar?.preview ?? [])
  ];
}

export function actionableInteractionPreviewChanges(result: SyncGoogleInteractionsResult | null) {
  return interactionPreviewChanges(result)
    .filter((change) => change.type !== "unchanged" && change.type !== "skipped" && !change.blocking);
}

export function externalIdsFromInteractionPreview(changes: SyncPreviewChange[]) {
  return changes
    .filter((change) => change.type !== "unchanged" && change.type !== "skipped")
    .map((change) => typeof change.metadata?.externalId === "string" ? change.metadata.externalId : "")
    .filter(Boolean);
}
