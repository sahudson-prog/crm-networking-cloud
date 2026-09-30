import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge.ts";
import type { ContactDeepMergeInput } from "../lib/contactMergeActions.ts";
import { startContactDuplicateMerge } from "../lib/contactDuplicateMergeFlow.ts";
import { lockBodyScroll } from "../components/useBodyScrollLock.ts";

const result: ContactMergeResult = {
  company: "Duke",
  emails: ["sergio@example.com"],
  focus: true,
  headhunter: false,
  name: "Sergio Hudson",
  networkingStatus: "Contactado",
  phones: ["+56912345678"],
  role: "CEO"
};

const sources: ContactMergeSource[] = [
  { company: "Duke", emails: [], focus: true, headhunter: false, id: "target", kind: "Guardado", name: "Sergio", networkingStatus: "Contactado", phones: [], role: "CEO" },
  { company: "", emails: ["sergio@example.com"], focus: false, headhunter: false, id: "source", kind: "Guardado", name: "S. Hudson", networkingStatus: "Pendiente", phones: ["+56912345678"], role: "" }
];

test("Fusionar dispara una sola operación y refresca al terminar", async () => {
  let mergeCalls = 0;
  let refreshCalls = 0;
  let releaseMerge = () => {};
  const mergePending = new Promise<void>((resolve) => { releaseMerge = resolve; });
  const lock = { current: null as Promise<void> | null };
  const dependencies = {
    merge: async (input: ContactDeepMergeInput) => {
      mergeCalls += 1;
      assert.equal(input.targetContactId, "target");
      assert.deepEqual(input.sourceContactIds, ["source"]);
      assert.equal(input.source, "duplicate_review");
      assert.equal(input.result, result);
      await mergePending;
    },
    refresh: async () => { refreshCalls += 1; }
  };

  const first = startContactDuplicateMerge(result, sources, dependencies, lock);
  const second = startContactDuplicateMerge(result, sources, dependencies, lock);

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(mergeCalls, 1);
  releaseMerge();
  await first.operation;
  assert.equal(refreshCalls, 1);
  assert.equal(lock.current, null);
});

test("un error de merge no refresca y libera el bloqueo", async () => {
  let refreshCalls = 0;
  const lock = { current: null as Promise<void> | null };
  const operation = startContactDuplicateMerge(result, sources, {
    merge: async () => { throw new Error("database detail"); },
    refresh: async () => { refreshCalls += 1; }
  }, lock);

  await assert.rejects(operation.operation, /database detail/);
  assert.equal(refreshCalls, 0);
  assert.equal(lock.current, null);
});

test("el diálogo muestra feedback de producto y ambos modales bloquean el fondo", () => {
  const panelSource = readFileSync(new URL("../components/ContactDuplicateReviewPanel.tsx", import.meta.url), "utf8");
  const dialogSource = readFileSync(new URL("../components/ContactMergeDialog.tsx", import.meta.url), "utf8");
  const lockSource = readFileSync(new URL("../components/useBodyScrollLock.ts", import.meta.url), "utf8");

  assert.match(panelSource, /errorMessage=\{mergeError\}/);
  assert.match(panelSource, /No pudimos fusionar estos contactos/);
  assert.match(panelSource, /await merge\.operation;[\s\S]*setSelectedGroup\(null\);[\s\S]*setManualMergeOpen\(false\);[\s\S]*Contactos fusionados correctamente/);
  assert.match(panelSource, /useBodyScrollLock\(reviewOpen\)/);
  assert.match(dialogSource, /useBodyScrollLock\(open\)/);
  assert.match(dialogSource, /role="alert"/);
  assert.match(lockSource, /activeLocks \+= 1/);
  assert.match(lockSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(lockSource, /document\.body\.style\.overflow = bodyOverflow/);
});

test("scroll lock soporta modales anidados y restaura los estilos al cerrar", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const fakeDocument = {
    body: { style: { overflow: "auto" } },
    documentElement: { style: { overflow: "scroll" } }
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

  try {
    const releaseReview = lockBodyScroll();
    const releaseMerge = lockBodyScroll();
    assert.equal(fakeDocument.body.style.overflow, "hidden");
    assert.equal(fakeDocument.documentElement.style.overflow, "hidden");

    releaseMerge();
    assert.equal(fakeDocument.body.style.overflow, "hidden");
    releaseReview();
    assert.equal(fakeDocument.body.style.overflow, "auto");
    assert.equal(fakeDocument.documentElement.style.overflow, "scroll");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
