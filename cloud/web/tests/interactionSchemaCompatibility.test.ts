import assert from "node:assert/strict";
import test from "node:test";

import {
  isMissingInteractionLifecycleColumn,
  legacyInteractionColumns
} from "../lib/interactionSchemaCompatibility.ts";

test("detecta solo columnas lifecycle ausentes en schema legacy", () => {
  assert.equal(isMissingInteractionLifecycleColumn({ code: "42703", message: "column interactions.is_deleted does not exist" }), true);
  assert.equal(isMissingInteractionLifecycleColumn({ code: "PGRST204", message: "prevent_reimport is missing" }), true);
  assert.equal(isMissingInteractionLifecycleColumn({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingInteractionLifecycleColumn({ code: "42703", message: "column subject does not exist" }), false);
});

test("el fallback omite únicamente lifecycle opcional", () => {
  assert.deepEqual(
    legacyInteractionColumns(["id", "is_deleted", "subject", "prevent_reimport", "updated_at"]),
    ["id", "subject", "updated_at"]
  );
});
