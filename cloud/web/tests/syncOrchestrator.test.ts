import test from "node:test";
import assert from "node:assert/strict";

import {
  syncCalendarInteractions,
  syncContacts,
  syncExternalInteractionBatch,
  syncMailInteractions,
  type ExternalInteractionSyncHandler
} from "../lib/syncOrchestrator.ts";

const baseItem = {
  provider: "google",
  sourceService: "gmail",
  externalObjectType: "message",
  externalId: "mail-1",
  interactionType: "email" as const,
  direction: "outbound" as const,
  occurredAt: "2026-07-30T12:00:00Z",
  subject: "Seguimiento",
  sourceDetail: "Hola"
};

test("syncExternalInteractionBatch resume creados, actualizados, omitidos y errores", async () => {
  const handler: ExternalInteractionSyncHandler = async (item) => {
    if (item.externalId === "mail-created") {
      return {
        status: "created",
        interactionId: "interaction-created",
        externalSourceId: "source-created",
        participantsInserted: 2
      };
    }
    if (item.externalId === "mail-updated") {
      return {
        status: "updated",
        interactionId: "interaction-updated",
        externalSourceId: "source-updated",
        participantsInserted: 1
      };
    }
    if (item.externalId === "mail-skipped") {
      return {
        status: "skipped_prevent_reimport",
        interactionId: "interaction-skipped",
        externalSourceId: "source-skipped"
      };
    }
    throw new Error("falla controlada");
  };

  const result = await syncExternalInteractionBatch(
    {
      provider: "google",
      resourceType: "mail",
      mode: "manual_batch",
      items: [
        { ...baseItem, externalId: "mail-created" },
        { ...baseItem, externalId: "mail-updated" },
        { ...baseItem, externalId: "mail-skipped" },
        { ...baseItem, externalId: "mail-error" }
      ]
    },
    handler
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.counts, {
    scanned: 4,
    created: 1,
    updated: 1,
    skipped: 1,
    failed: 1,
    participantsInserted: 3
  });
  assert.deepEqual(result.affected.interactionIds, [
    "interaction-created",
    "interaction-updated",
    "interaction-skipped"
  ]);
  assert.equal(result.errors[0].externalId, "mail-error");
});

test("syncExternalInteractionBatch soporta dry-run sin llamar el handler", async () => {
  let calls = 0;
  const result = await syncExternalInteractionBatch(
    {
      provider: "google",
      resourceType: "calendar",
      mode: "manual_batch",
      dryRun: true,
      items: [baseItem, { ...baseItem, externalId: "mail-2" }]
    },
    async () => {
      calls += 1;
      return { status: "created" };
    }
  );

  assert.equal(calls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.counts.scanned, 2);
  assert.equal(result.counts.skipped, 2);
  assert.equal(result.warnings[0], "Dry-run: no se escribieron cambios.");
});

test("syncMailInteractions y syncCalendarInteractions fijan el tipo de recurso", async () => {
  const handler: ExternalInteractionSyncHandler = async () => ({ status: "created" });
  const mail = await syncMailInteractions(
    { provider: "google", mode: "manual_batch", items: [baseItem] },
    handler
  );
  const calendar = await syncCalendarInteractions(
    { provider: "google", mode: "manual_batch", items: [{ ...baseItem, interactionType: "calendar" }] },
    handler
  );

  assert.equal(mail.resourceType, "mail");
  assert.equal(calendar.resourceType, "calendar");
});

test("syncContacts devuelve contrato claro y no aplica cambios sin preview", async () => {
  const result = await syncContacts({
    provider: "google",
    resourceType: "contacts",
    mode: "manual_batch",
    items: [{ provider: "google", externalId: "person-1", displayName: "Maria Solis" }]
  });

  assert.equal(result.ok, false);
  assert.equal(result.counts.scanned, 1);
  assert.equal(result.errors[0].code, "CONTACT_SYNC_PREVIEW_REQUIRED");
});
