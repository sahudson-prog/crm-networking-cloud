import test from "node:test";
import assert from "node:assert/strict";
import { SyncItemFailure, summarizeSyncItemErrors, syncItemDiagnostic, syncRpcCode } from "../lib/syncItemDiagnostics.ts";
import { externalInteractionSourceIdsForPreview } from "../lib/googleInteractionSyncFlow.ts";

test("item diagnostics retain only approved phase/code/status/outcome", () => {
  const error = new SyncItemFailure("rpc", "42501", "rejected", 403);
  assert.deepEqual(syncItemDiagnostic(error), { phase: "rpc", code: "42501", outcome: "rejected", httpStatus: 403 });
  assert.deepEqual(syncItemDiagnostic({ code: "secret@example.invalid", phase: "private event", message: "Bearer synthetic", httpStatus: 999 }),
    { phase: "unknown", code: "SYNC_ITEM_FAILED", outcome: "uncertain", httpStatus: null });
});

test("46 item failures are grouped without event IDs, subjects or raw errors", () => {
  const errors = Array.from({ length: 46 }, () => ({ ...syncItemDiagnostic(new SyncItemFailure("context", "SYNC_ACCOUNT_REQUIRED", "not_sent")),
    externalId: "CALENDAR_private", message: "private@example.invalid", payload: "synthetic secret" }));
  const grouped = summarizeSyncItemErrors(errors);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].count, 46);
  assert.doesNotMatch(JSON.stringify(grouped), /private|payload|secret|CALENDAR_/);
});

test("database error whitelist never forwards unknown messages or codes", () => {
  assert.equal(syncRpcCode({ code: "P0001", message: "private@example.invalid" }), "P0001");
  assert.equal(syncRpcCode({ code: "private@example.invalid" }), "SYNC_RPC_REJECTED");
  assert.equal(syncRpcCode(null), "SYNC_RPC_REJECTED");
});

test("legacy preview retains Gmail normalization after Calendar moves to v2", () => {
  assert.deepEqual(externalInteractionSourceIdsForPreview([
    { externalId: "GMAIL_MessageXYZ" }
  ]), ["gmail_messagexyz"]);
});
