import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContactSyncPreview,
  changeKey,
  contactChangeKey,
  deletedContactChangeKey
} from "../lib/contactSyncPreview.ts";
import { syncContacts } from "../lib/syncOrchestrator.ts";
import type { ContactRow } from "../lib/readModel.ts";

function contact(overrides: Partial<ContactRow> & { id: string; display_name: string }): ContactRow {
  return {
    company: "",
    contact_emails: [],
    contact_phones: [],
    headhunter_domains: [],
    is_active: true,
    is_headhunter: false,
    networking_focus: true,
    networking_status: "Pendiente",
    role: "",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides
  };
}

test("no trata campos vacios de la fuente como eliminacion de datos locales", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Patria",
        display_name: "Alberto Orlandini",
        id: "contact-1",
        role: "Socio"
      })
    ],
    externalContacts: [
      {
        displayName: "Alberto Orlandini",
        externalId: "people/1",
        provider: "google",
        role: ""
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
});

test("no trata placeholders sin dato o null textual como cambio real", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Sin dato",
        display_name: "Gian Carlos Rivera Pwcc",
        id: "contact-1",
        role: "Sin datos"
      })
    ],
    externalContacts: [
      {
        company: "null",
        displayName: "Gian Carlos Rivera Pwcc",
        externalId: "people/1",
        provider: "google",
        role: ""
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
});

test("propone enriquecer campos simples cuando la app esta vacia y la fuente trae dato", () => {
  const changes = buildContactSyncPreview({
    appContacts: [contact({ display_name: "Josefina Camus", id: "contact-1" })],
    externalContacts: [
      {
        company: "Seminarium",
        displayName: "Josefina Camus",
        externalId: "people/1",
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "modified");
  assert.deepEqual(changes[0].fields.map((field) => [field.label, field.before, field.after]), [
    ["Empresa", "", "Seminarium"]
  ]);
});

test("muestra nombre empresa y cargo distintos como no aplicados durante modificaciones", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Empresa local",
        display_name: "Nombre Local",
        id: "contact-1",
        role: "Cargo local"
      })
    ],
    externalContacts: [
      {
        company: "Empresa proveedor",
        displayName: "Nombre Proveedor",
        externalId: "people/1",
        provider: "google",
        role: "Cargo proveedor"
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "modified");
  assert.deepEqual(changes[0].fields.map((field) => [field.label, field.before, field.after, field.apply]), [
    ["Nombre", "Nombre Local", "Nombre Proveedor", false],
    ["Empresa", "Empresa local", "Empresa proveedor", false],
    ["Cargo", "Cargo local", "Cargo proveedor", false]
  ]);
});

test("solo propone eliminar emails si eran conocidos como importados desde esa fuente", () => {
  const baseContact = contact({
    contact_emails: [
      { domain: "@empresa.cl", email: "manual@empresa.cl" },
      { domain: "@empresa.cl", email: "importado@empresa.cl" }
    ],
    display_name: "Maria Solis",
    id: "contact-1"
  });

  const changes = buildContactSyncPreview({
    appContacts: [baseContact],
    externalContacts: [
      {
        displayName: "Maria Solis",
        emails: [],
        externalId: "people/1",
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    knownExternalValuesByContactId: {
      "contact-1": [{ kind: "email", value: "importado@empresa.cl" }]
    },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].fields.map((field) => [field.operation, field.before, field.apply]), [
    ["remove", "importado@empresa.cl", false]
  ]);
});

test("respeta cambios suprimidos para no volver a sugerirlos", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@empresa.cl", email: "importado@empresa.cl" }],
        display_name: "Maria Solis",
        id: "contact-1"
      })
    ],
    externalContacts: [
      {
        displayName: "Maria Solis",
        emails: [],
        externalId: "people/1",
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    knownExternalValuesByContactId: {
      "contact-1": [{ kind: "email", value: "importado@empresa.cl" }]
    },
    provider: "google",
    suppressedChangeKeys: [changeKey("email", "remove", "importado@empresa.cl")]
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
});

test("respeta supresion especifica por contacto sin bloquear el mismo valor en otro contacto", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@empresa.cl", email: "compartido@empresa.cl" }],
        display_name: "Contacto Uno",
        id: "contact-1"
      }),
      contact({
        contact_emails: [{ domain: "@empresa.cl", email: "compartido@empresa.cl" }],
        display_name: "Contacto Dos",
        id: "contact-2"
      })
    ],
    externalContacts: [
      {
        displayName: "Contacto Uno",
        emails: [],
        externalId: "people/1",
        provider: "google"
      },
      {
        displayName: "Contacto Dos",
        emails: [],
        externalId: "people/2",
        provider: "google"
      }
    ],
    externalIdToContactId: {
      "people/1": "contact-1",
      "people/2": "contact-2"
    },
    knownExternalValuesByContactId: {
      "contact-1": [{ kind: "email", value: "compartido@empresa.cl" }],
      "contact-2": [{ kind: "email", value: "compartido@empresa.cl" }]
    },
    provider: "google",
    suppressedChangeKeys: [contactChangeKey("contact-1", "email", "remove", "compartido@empresa.cl")]
  });

  assert.equal(changes.length, 2);
  assert.equal(changes.find((change) => change.metadata?.appContactId === "contact-1")?.type, "unchanged");
  assert.equal(changes.find((change) => change.metadata?.appContactId === "contact-2")?.type, "modified");
});

test("respeta supresion de eliminacion completa de contacto", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        display_name: "Contacto eliminado ignorado",
        id: "contact-1"
      })
    ],
    externalContacts: [],
    externalIdToContactId: { "people/1": "contact-1" },
    provider: "google",
    suppressedChangeKeys: [deletedContactChangeKey("contact-1")]
  });

  assert.equal(changes.length, 0);
});

test("si el ID externo no esta enlazado pero coincide el correo, propone consolidacion y no contacto nuevo", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Duke",
        contact_emails: [{ domain: "@gmail.com", email: "jorgekehdy@gmail.com" }],
        contact_phones: [{ phone: "56993333114" }],
        display_name: "Jorge Kehdy",
        id: "contact-jorge"
      })
    ],
    externalContacts: [
      {
        company: "Duke",
        displayName: "Jorge Kehdy",
        emails: ["jorgekehdy@gmail.com"],
        externalId: "people/current-jorge",
        phones: ["+56993333114"],
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "consolidation");
  assert.equal(changes[0].metadata?.consolidationTargetContactId, "contact-jorge");
  assert.equal(changes[0].fields.some((field) => field.label === "Correo" && field.operation === "match"), true);
  assert.equal(changes[0].fields.some((field) => field.label === "Telefono" && field.operation === "match"), true);
});

test("consolida en una sola linea varios objetos externos que apuntan al mismo contacto app", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@3di.cl", email: "aaninat@3di.cl" }],
        display_name: "aaninat@3di.cl",
        id: "contact-aaninat"
      })
    ],
    externalContacts: [
      {
        displayName: "aaninat@3di.cl",
        emails: ["aaninat@3di.cl"],
        externalId: "people/old-aaninat",
        provider: "google"
      },
      {
        displayName: "Augusto Aninat",
        emails: ["aaninat@3di.cl"],
        externalId: "people/current-aaninat",
        phones: ["+56998247760"],
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "consolidation");
  assert.deepEqual(changes[0].metadata?.externalIds, ["people/old-aaninat", "people/current-aaninat"]);
  assert.equal(changes[0].fields.some((field) => field.label === "Nombre" && field.after === "Augusto Aninat"), false);
  assert.equal(changes[0].fields.some((field) => field.label === "Telefono" && field.after === "56998247760"), true);
});

test("separa duplicados complejos cuando superan 3 contactos abordables en el editor", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@3di.cl", email: "aaninat@3di.cl" }],
        display_name: "Augusto Aninat",
        id: "contact-aaninat"
      })
    ],
    externalContacts: [
      {
        displayName: "Augusto Aninat",
        emails: ["aaninat@3di.cl"],
        externalId: "people/aaninat-1",
        provider: "google"
      },
      {
        displayName: "Augusto A.",
        emails: ["aaninat@3di.cl"],
        externalId: "people/aaninat-2",
        provider: "google"
      },
      {
        displayName: "A. Aninat",
        emails: ["aaninat@3di.cl"],
        externalId: "people/aaninat-3",
        provider: "google"
      },
      {
        displayName: "aaninat@3di.cl",
        emails: ["aaninat@3di.cl"],
        externalId: "people/aaninat-4",
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 4);
  assert.deepEqual(changes.map((change) => change.type), [
    "duplicate_complex",
    "duplicate_complex",
    "duplicate_complex",
    "duplicate_complex"
  ]);
  assert.equal(changes.every((change) => change.defaultSelected === false), true);
  assert.equal(changes.every((change) => change.metadata?.duplicateGroupTotalCount === 5), true);
  assert.equal(changes.every((change) => change.metadata?.duplicateGroupLabel === "aaninat@3di.cl"), true);
  assert.deepEqual(changes.map((change) => change.metadata?.externalId), [
    "people/aaninat-1",
    "people/aaninat-2",
    "people/aaninat-3",
    "people/aaninat-4"
  ]);
});

test("en duplicados complejos solo importa candidatos no enlazados y deja los ya guardados para revision local", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@astara.com", email: "alberto.villate.g@astara.com" }],
        contact_phones: [{ phone: "+56992215817" }, { phone: "+56228371378" }],
        display_name: "Alberto Villate",
        id: "contact-alberto"
      }),
      contact({
        contact_phones: [{ phone: "+56228371378" }],
        display_name: "Alberto Villate Galarce",
        id: "contact-alberto-galarce"
      })
    ],
    externalContacts: [
      {
        displayName: "Alberto Villate",
        emails: ["Alberto.Villate.G@astara.com"],
        externalId: "people/alberto",
        phones: ["+56992215817", "+56228371378"],
        provider: "google"
      },
      {
        displayName: "Alberto Villate Galarce",
        externalId: "people/alberto-galarce",
        phones: ["+56228371378"],
        provider: "google"
      },
      {
        displayName: "Alberto V",
        externalId: "people/alberto-v",
        phones: ["56228371378"],
        provider: "google"
      }
    ],
    externalIdToContactId: {
      "people/alberto": "contact-alberto",
      "people/alberto-galarce": "contact-alberto-galarce"
    },
    provider: "google"
  });

  const complexDuplicates = changes.filter((change) => change.type === "duplicate_complex");

  assert.equal(complexDuplicates.length, 1);
  assert.equal(complexDuplicates[0].defaultSelected, false);
  assert.equal(complexDuplicates[0].metadata?.externalId, "people/alberto-v");
  assert.equal(complexDuplicates[0].metadata?.duplicateGroupSavedCount, 2);
  assert.equal(complexDuplicates[0].metadata?.duplicateGroupImportedCount, 3);
  assert.equal(complexDuplicates[0].metadata?.duplicateGroupTotalCount, 5);
  assert.equal(complexDuplicates[0].metadata?.duplicateGroupLabel, "alberto.villate.g@astara.com");
});

test("manda a complejos cuando hay multiples contactos guardados aunque el grupo quepa en el editor", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_phones: [{ phone: "+56228371378" }],
        display_name: "Alberto Villate",
        id: "contact-alberto"
      }),
      contact({
        contact_phones: [{ phone: "+56228371378" }],
        display_name: "Alberto Villate Galarce",
        id: "contact-alberto-galarce"
      })
    ],
    externalContacts: [
      {
        displayName: "Alberto V",
        externalId: "people/alberto-v",
        phones: ["56228371378"],
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "duplicate_complex");
  assert.equal(changes[0].defaultSelected, false);
  assert.equal(changes[0].metadata?.duplicateGroupSavedCount, 2);
  assert.equal(changes[0].metadata?.duplicateGroupImportedCount, 1);
});

test("en enlazar y combinar no pisa nombre existente de la app con nombre abreviado del proveedor", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@astara.com", email: "alberto.villate.g@astara.com" }],
        contact_phones: [{ phone: "+56992215817" }, { phone: "+56228371378" }],
        display_name: "Alberto Villate",
        id: "contact-alberto"
      })
    ],
    externalContacts: [
      {
        displayName: "Alberto Villate",
        emails: ["Alberto.Villate.G@astara.com"],
        externalId: "people/alberto-original",
        phones: ["+56992215817", "+56228371378"],
        provider: "google"
      },
      {
        displayName: "Alberto V",
        externalId: "people/alberto-duplicate",
        phones: ["56228371378"],
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "consolidation");
  assert.deepEqual(changes[0].metadata?.externalIds, ["people/alberto-original", "people/alberto-duplicate"]);
  assert.equal(changes[0].fields.some((field) => field.label === "Nombre" && field.operation === "replace"), false);
});

test("marca contactos vinculados sin diferencias como revisados sin cambios", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Duke",
        contact_emails: [{ domain: "@gmail.com", email: "jorge@gmail.com" }],
        display_name: "Jorge Kehdy",
        id: "contact-jorge"
      })
    ],
    externalContacts: [
      {
        company: "Duke",
        displayName: "Jorge Kehdy",
        emails: ["jorge@gmail.com"],
        externalId: "people/jorge",
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/jorge": "contact-jorge" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
  assert.equal(changes[0].defaultSelected, false);
  assert.equal(changes[0].blocking, true);
});

test("reconoce telefono fijo chileno aunque Google agregue codigo de pais", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_phones: [{ phone: "2 2618 8346" }],
        display_name: "Garantia Refrigerador GE",
        id: "contact-ge"
      })
    ],
    externalContacts: [
      {
        displayName: "Garantia Refrigerador GE",
        externalId: "people/ge",
        phones: ["+56226188346"],
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/ge": "contact-ge" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
  assert.equal(changes[0].fields.some((field) => field.label === "Telefono" && field.operation === "add"), false);
});

test("no propone agregar telefono cuando Google trae duplicado chileno con 9 extra", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_phones: [{ phone: "+56 9 8506 4738" }],
        display_name: "Basilio Kine RedSalud",
        id: "contact-basilio"
      })
    ],
    externalContacts: [
      {
        displayName: "Basilio Kine RedSalud",
        externalId: "people/basilio",
        phones: ["+56 9 8506 4738", "+569985064738"],
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/basilio": "contact-basilio" },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
  assert.equal(changes[0].fields.some((field) => field.label === "Telefono" && field.operation === "add"), false);
});

test("deduplica telefonos equivalentes del proveedor antes de crear contacto nuevo", () => {
  const changes = buildContactSyncPreview({
    appContacts: [],
    externalContacts: [
      {
        displayName: "Basilio Kine RedSalud",
        externalId: "people/basilio",
        phones: ["+56 9 8506 4738", "+569985064738"],
        provider: "google"
      }
    ],
    externalIdToContactId: {},
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "new");
  assert.equal(changes[0].fields.filter((field) => field.label === "Telefono").length, 1);
});

test("syncContacts genera preview cuando recibe datos app y datos externos", async () => {
  const result = await syncContacts({
    appContacts: [contact({ display_name: "Ana Pereira", id: "contact-1" })],
    externalIdToContactId: {},
    items: [{ displayName: "Ana Pereira", externalId: "people/1", provider: "google" }],
    mode: "manual_batch",
    provider: "google",
    resourceType: "contacts"
  });

  assert.equal(result.ok, true);
  assert.equal(result.preview?.length, 1);
  assert.equal(result.preview?.[0].type, "new");
  assert.equal(result.warnings[0], "Preview de contactos: no se escribieron cambios hasta que el usuario confirme.");
});
