import test from "node:test";
import assert from "node:assert/strict";

import {
  contactMergeDecisionFromPreviewChange,
  withContactMergeDecision,
  type ContactMergeResult
} from "../lib/contactMerge.ts";
import { normalizeContactDeepMergeInput } from "../lib/contactMergeActions.ts";
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

test("contact merge adjunta y recupera la decision ajustada del preview", () => {
  const decision: ContactMergeResult = {
    company: "Seminarium",
    emails: ["josefina@example.com"],
    focus: true,
    headhunter: false,
    name: "Josefina Camus",
    networkingStatus: "Contactado",
    phones: ["+56912345678"],
    role: "Directora"
  };

  const adjustedChange = withContactMergeDecision(baseChange, decision);

  assert.deepEqual(contactMergeDecisionFromPreviewChange(adjustedChange), decision);
  assert.deepEqual(adjustedChange.metadata?.appContactId, "contact-1");
  assert.deepEqual(adjustedChange.metadata?.externalId, "people/1");
});

test("contact merge ignora decisiones incompletas o mal formadas", () => {
  const malformedChange: SyncPreviewChange = {
    ...baseChange,
    metadata: {
      ...baseChange.metadata,
      contactMergeDecision: {
        company: "Seminarium",
        name: "Josefina Camus"
      }
    }
  };

  assert.equal(contactMergeDecisionFromPreviewChange(malformedChange), null);
});

test("contact merge profundo normaliza inputs antes de llamar la base", () => {
  const normalized = normalizeContactDeepMergeInput({
    result: {
      company: " Duke ",
      emails: [" SERGIO@DUKE.CL ", "sergio@duke.cl"],
      focus: true,
      headhunter: false,
      name: " Sergio Hudson ",
      networkingStatus: "Contactado",
      phones: [" +56 9 1234 5678 ", "+56 9 1234 5678"],
      role: " CEO "
    },
    sourceContactIds: [" source-1 ", "source-1", "target-1"],
    targetContactId: " target-1 "
  });

  assert.deepEqual(normalized, {
    result: {
      company: "Duke",
      emails: ["sergio@duke.cl"],
      focus: true,
      headhunter: false,
      name: "Sergio Hudson",
      networkingStatus: "Contactado",
      phones: ["+56 9 1234 5678"],
      role: "CEO"
    },
    source: undefined,
    sourceContactIds: ["source-1"],
    targetContactId: "target-1"
  });
});

test("contact merge profundo exige nombre y maximo 3 contactos total", () => {
  assert.throws(() => normalizeContactDeepMergeInput({
    result: {
      company: "",
      emails: [],
      focus: true,
      headhunter: false,
      name: "",
      networkingStatus: "Pendiente",
      phones: [],
      role: ""
    },
    sourceContactIds: ["source-1"],
    targetContactId: "target-1"
  }), /nombre/i);

  assert.throws(() => normalizeContactDeepMergeInput({
    result: {
      company: "",
      emails: [],
      focus: true,
      headhunter: false,
      name: "Sergio Hudson",
      networkingStatus: "Pendiente",
      phones: [],
      role: ""
    },
    sourceContactIds: ["source-1", "source-2", "source-3"],
    targetContactId: "target-1"
  }), /maximo 3/i);
});
