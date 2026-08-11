import test from "node:test";
import assert from "node:assert/strict";

import { applyContactSyncPreview, contactAppMergePlanFromPreviewChange } from "../lib/contactSyncApply.ts";
import type { SyncPreviewChange } from "../lib/syncOrchestrator.ts";

const baseChange: SyncPreviewChange = {
  defaultSelected: true,
  fields: [{ after: "Seminarium", before: "", changed: true, label: "Empresa" }],
  id: "google:modified:contact-1:people/1",
  metadata: {
    appContactId: "contact-1",
    externalId: "people/1"
  },
  title: "Josefina Camus",
  type: "modified"
};

test("applyContactSyncPreview aplica seleccion completa y guarda cursor nuevo", async () => {
  const applied: string[] = [];
  let cursorSaved = false;
  let completed = false;

  const result = await applyContactSyncPreview(
    {
      changes: [baseChange],
      cursorAfter: "cursor-nuevo",
      provider: "google",
      totalPreviewChanges: 1
    },
    {
      applyChange: async (change) => {
        applied.push(change.id);
        return "contact-1";
      },
      completeInvocation: async (_id, finalResult) => {
        completed = finalResult.cursorSaved;
      },
      createInvocation: async () => "invocation-1",
      failInvocation: async () => undefined,
      getUserId: async () => "user-1",
      saveCursor: async () => {
        cursorSaved = true;
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.cursorSaved, true);
  assert.deepEqual(result.appliedChangeIds, [baseChange.id]);
  assert.deepEqual(result.failedChangeIds, []);
  assert.equal(cursorSaved, true);
  assert.equal(completed, true);
  assert.deepEqual(applied, [baseChange.id]);
});

test("applyContactSyncPreview no guarda cursor si quedan cambios pendientes", async () => {
  let cursorSaved = false;

  const result = await applyContactSyncPreview(
    {
      changes: [baseChange],
      cursorAfter: "cursor-nuevo",
      provider: "google",
      totalPreviewChanges: 3
    },
    {
      applyChange: async () => "contact-1",
      completeInvocation: async () => undefined,
      createInvocation: async () => "invocation-1",
      failInvocation: async () => undefined,
      getUserId: async () => "user-1",
      saveCursor: async () => {
        cursorSaved = true;
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.cursorSaved, false);
  assert.equal(cursorSaved, false);
  assert.equal(result.warnings[0], "No guarde el cursor nuevo porque quedaron cambios pendientes para la proxima sincronizacion.");
});

test("applyContactSyncPreview no guarda cursor si falla algun cambio", async () => {
  let cursorSaved = false;

  const result = await applyContactSyncPreview(
    {
      changes: [baseChange],
      cursorAfter: "cursor-nuevo",
      provider: "google",
      totalPreviewChanges: 1
    },
    {
      applyChange: async () => {
        throw new Error("falla controlada");
      },
      completeInvocation: async () => undefined,
      createInvocation: async () => "invocation-1",
      failInvocation: async () => undefined,
      getUserId: async () => "user-1",
      saveCursor: async () => {
        cursorSaved = true;
      }
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.appliedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.appliedChangeIds, []);
  assert.deepEqual(result.failedChangeIds, [baseChange.id]);
  assert.equal(result.cursorSaved, false);
  assert.equal(cursorSaved, false);
  assert.equal(result.errors[0].message, "falla controlada");
});

test("applyContactSyncPreview ignora filas informativas sin cambios al calcular pendientes", async () => {
  const unchanged: SyncPreviewChange = {
    blocking: true,
    defaultSelected: false,
    fields: [{ after: "Josefina Camus", changed: false, label: "Nombre", operation: "info" }],
    id: "google:unchanged:contact-1:people/1",
    metadata: {
      appContactId: "contact-1",
      externalId: "people/1"
    },
    title: "Josefina Camus",
    type: "unchanged"
  };
  const applied: string[] = [];

  const result = await applyContactSyncPreview(
    {
      changes: [unchanged],
      cursorAfter: "cursor-nuevo",
      provider: "google",
      totalPreviewChanges: 0
    },
    {
      applyChange: async (change) => {
        applied.push(change.id);
        return "contact-1";
      },
      completeInvocation: async () => undefined,
      createInvocation: async () => "invocation-1",
      failInvocation: async () => undefined,
      getUserId: async () => "user-1",
      saveCursor: async () => undefined
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.appliedCount, 0);
  assert.equal(result.pendingCount, 0);
  assert.deepEqual(applied, []);
});

test("applyContactSyncPreview distingue aplicados y fallidos en seleccion parcial", async () => {
  const failingChange: SyncPreviewChange = {
    ...baseChange,
    id: "google:modified:contact-2:people/2",
    metadata: {
      appContactId: "contact-2",
      externalId: "people/2"
    },
    title: "Contacto con falla"
  };

  const result = await applyContactSyncPreview(
    {
      changes: [baseChange, failingChange],
      cursorAfter: "cursor-nuevo",
      provider: "google",
      totalPreviewChanges: 2
    },
    {
      applyChange: async (change) => {
        if (change.id === failingChange.id) throw new Error("falla controlada");
        return "contact-1";
      },
      completeInvocation: async () => undefined,
      createInvocation: async () => "invocation-1",
      failInvocation: async () => undefined,
      getUserId: async () => "user-1",
      saveCursor: async () => undefined
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.appliedChangeIds, [baseChange.id]);
  assert.deepEqual(result.failedChangeIds, [failingChange.id]);
});

test("contactAppMergePlanFromPreviewChange detecta contactos app origen para fusion profunda", () => {
  const change: SyncPreviewChange = {
    defaultSelected: true,
    fields: [{ after: "alberto@empresa.cl", before: "alberto@empresa.cl", changed: true, label: "Correo", operation: "match" }],
    id: "google:consolidation:contact-target:contact-source:people/1",
    metadata: {
      consolidationTargetContactId: "contact-target",
      externalId: "people/1",
      mergeSources: [
        {
          company: "Astara",
          emails: ["alberto@empresa.cl"],
          focus: true,
          headhunter: false,
          id: "contact-target",
          kind: "Guardado",
          name: "Alberto Villate",
          networkingStatus: "Contactado",
          phones: ["+56992215817"],
          role: "Director"
        },
        {
          company: "",
          emails: ["alberto@empresa.cl"],
          focus: false,
          headhunter: false,
          id: "contact-source",
          kind: "Guardado",
          name: "Alberto V",
          networkingStatus: "Pendiente",
          phones: ["+56228371378"],
          role: ""
        },
        {
          company: "",
          emails: ["alberto@empresa.cl"],
          focus: false,
          headhunter: false,
          id: "people/1",
          kind: "Importado",
          name: "Alberto V",
          networkingStatus: "Pendiente",
          phones: ["+56228371378"],
          role: ""
        }
      ]
    },
    title: "Alberto Villate",
    type: "consolidation"
  };

  const plan = contactAppMergePlanFromPreviewChange(change, "contact-target");

  assert.deepEqual(plan.sourceContactIds, ["contact-source"]);
  assert.equal(plan.sources.length, 3);
});
