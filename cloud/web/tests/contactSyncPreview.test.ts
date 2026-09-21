import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContactSyncPreview,
  changeKey,
  contactChangeKey,
  deletedContactChangeKey,
  traceContactSyncPreviewBranches
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

test("solo propone eliminar emails si eran conocidos desde esa fuente", () => {
  const baseContact = contact({
    contact_emails: [
      { domain: "@empresa.cl", email: "manual@empresa.cl" },
      { domain: "@empresa.cl", email: "proveedor@empresa.cl" }
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
      "contact-1": [{ kind: "email", value: "proveedor@empresa.cl" }]
    },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].fields.map((field) => [field.operation, field.before, field.apply]), [
    ["remove", "proveedor@empresa.cl", false]
  ]);
});

test("respeta cambios suprimidos para no volver a sugerirlos", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@empresa.cl", email: "proveedor@empresa.cl" }],
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
      "contact-1": [{ kind: "email", value: "proveedor@empresa.cl" }]
    },
    provider: "google",
    suppressedChangeKeys: [changeKey("email", "remove", "proveedor@empresa.cl")]
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

test("revision incremental no elimina contactos vinculados que no vienen en el lote", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        display_name: "Contacto fuera del lote incremental",
        id: "contact-1"
      })
    ],
    externalContacts: [],
    externalIdToContactId: { "people/1": "contact-1" },
    mode: "incremental",
    provider: "google"
  });

  assert.equal(changes.length, 0);
});

test("revision incremental elimina solo si Google marca el contacto como borrado", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        display_name: "Contacto borrado en Google",
        id: "contact-1"
      })
    ],
    externalContacts: [
      {
        displayName: "Contacto borrado en Google",
        externalId: "people/1",
        metadata: { google_deleted: true },
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/1": "contact-1" },
    mode: "incremental",
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "deleted");
});

test("si el ID externo no esta enlazado, importa como nuevo aunque coincida correo", () => {
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
  assert.equal(changes[0].type, "new");
  assert.equal(changes[0].metadata?.externalId, "people/current-jorge");
  assert.equal(changes[0].fields.some((field) => field.label === "Correo" && field.after === "jorgekehdy@gmail.com"), true);
  assert.equal(changes[0].fields.some((field) => field.label === "Telefono" && field.after === "56993333114"), true);
});

test("importa dos contactos nuevos con distinto ID externo aunque compartan correo", () => {
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

  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((change) => change.type), ["new", "new"]);
  assert.deepEqual(changes.map((change) => change.metadata?.externalId), ["people/old-aaninat", "people/current-aaninat"]);
});

test("no detecta duplicados complejos durante importacion inicial", () => {
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
    "new",
    "new",
    "new",
    "new"
  ]);
  assert.equal(changes.every((change) => change.defaultSelected === true), true);
  assert.deepEqual(changes.map((change) => change.metadata?.externalId), [
    "people/aaninat-1",
    "people/aaninat-2",
    "people/aaninat-3",
    "people/aaninat-4"
  ]);
});

test("si hay contactos ya enlazados y otro ID no enlazado, el no enlazado entra como nuevo", () => {
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

  const newChanges = changes.filter((change) => change.type === "new");
  const unchangedChanges = changes.filter((change) => change.type === "unchanged");

  assert.equal(newChanges.length, 1);
  assert.equal(newChanges[0].metadata?.externalId, "people/alberto-v");
  assert.equal(unchangedChanges.length, 2);
});

test("si multiples contactos guardados coinciden pero el ID externo no esta enlazado, igual entra como nuevo", () => {
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
  assert.equal(changes[0].type, "new");
  assert.equal(changes[0].defaultSelected, true);
  assert.equal(changes[0].metadata?.externalId, "people/alberto-v");
});

test("no fusiona por telefono durante importacion inicial", () => {
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

  assert.equal(changes.length, 2);
  assert.deepEqual(changes.map((change) => change.type), ["new", "new"]);
  assert.deepEqual(changes.map((change) => change.metadata?.externalId), ["people/alberto-original", "people/alberto-duplicate"]);
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

test("prioriza el ID externo guardado antes que coincidencias por telefono o correo", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        company: "Empresa Uno",
        contact_emails: [{ domain: "empresa.test", email: "contacto.pareado@empresa.test" }],
        contact_phones: [{ phone: "+56 9 9000 0001" }],
        display_name: "Contacto Pareado",
        id: "contact-linked",
        role: "Rol Uno"
      })
    ],
    externalContacts: [
      {
        company: "Empresa Uno",
        displayName: "Contacto Pareado",
        emails: ["contacto.pareado@empresa.test"],
        externalId: "people/linked-contact",
        phones: ["+56 9 9000 0001"],
        provider: "google",
        role: "Rol Uno"
      }
    ],
    externalIdToContactId: {
      "people/linked-contact": "contact-linked"
    },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
  assert.equal(changes[0].id.includes("consolidation"), false);
});

test("no convierte un contacto ya pareado por ID externo en duplicado fusionable", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "empresa.test", email: "contacto.pareado@empresa.test" }],
        contact_phones: [{ phone: "+56 9 9000 0001" }],
        display_name: "Contacto Pareado",
        id: "contact-linked"
      }),
      contact({
        contact_phones: [{ phone: "90000001" }],
        display_name: "Otro contacto con mismo telefono",
        id: "contact-otro"
      })
    ],
    externalContacts: [
      {
        displayName: "Contacto Pareado",
        emails: ["contacto.pareado@empresa.test"],
        externalId: "people/linked-contact",
        phones: ["+56 9 9000 0001"],
        provider: "google"
      }
    ],
    externalIdToContactId: {
      "people/linked-contact": "contact-linked"
    },
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "unchanged");
  assert.equal(changes[0].metadata?.appContactId, "contact-linked");
});

test("usa previousResourceNames de Google para no tratar cambio de ID como contacto nuevo", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        display_name: "Abdullah",
        id: "contact-abdullah"
      })
    ],
    externalContacts: [
      {
        displayName: "Abdullahhh",
        externalId: "people/new-abdullah",
        metadata: { previous_resource_names: ["people/old-abdullah"] },
        provider: "google"
      }
    ],
    externalIdToContactId: {
      "people/old-abdullah": "contact-abdullah"
    },
    mode: "incremental",
    provider: "google"
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, "modified");
  assert.equal(changes[0].metadata?.appContactId, "contact-abdullah");
  assert.equal(changes[0].metadata?.externalId, "people/new-abdullah");
});

test("traza el arbol de decision del preview sin escribir datos", () => {
  const input = {
    appContacts: [
      contact({
        contact_emails: [{ domain: "empresa.test", email: "id@empresa.test" }],
        contact_phones: [{ phone: "+56 9 9000 0001" }],
        display_name: "Contacto por ID",
        id: "contact-id"
      }),
      contact({
        contact_emails: [{ domain: "empresa.test", email: "match@empresa.test" }],
        display_name: "Contacto por correo",
        id: "contact-email"
      }),
      contact({
        contact_phones: [{ phone: "90000001" }],
        display_name: "Coincidencia secundaria ignorada",
        id: "contact-secondary"
      })
    ],
    externalContacts: [
      {
        displayName: "Contacto por ID",
        emails: ["id@empresa.test"],
        externalId: "people/id",
        phones: ["+56 9 9000 0001"],
        provider: "google" as const
      },
      {
        displayName: "Contacto por correo",
        emails: ["match@empresa.test"],
        externalId: "people/email",
        provider: "google" as const
      },
      {
        displayName: "Contacto nuevo",
        externalId: "people/new",
        provider: "google" as const
      }
    ],
    externalIdToContactId: {
      "people/id": "contact-id"
    },
    provider: "google" as const
  };

  const trace = traceContactSyncPreviewBranches(input);

  assert.deepEqual(trace.map((item) => item.stage), [
    "external_id",
    "new_contact",
    "new_contact"
  ]);
  assert.equal(trace[0].resultType, "unchanged");
  assert.deepEqual(trace[0].secondaryMatchContactIds, ["contact-secondary"]);
  assert.equal(trace[1].resultType, "new");
  assert.deepEqual(trace[1].secondaryMatchContactIds, ["contact-email"]);
  assert.match(trace[1].note ?? "", /se revisa despues en duplicados/);
  assert.equal(trace[2].resultType, "new");
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

test("no marca como modificado un telefono chileno enlazado por diferencia de signo mas", () => {
  const changes = buildContactSyncPreview({
    appContacts: [
      contact({
        contact_emails: [{ domain: "@gmail.com", email: "ajdelosh@gmail.com" }],
        contact_phones: [{ phone: "56976455077" }, { phone: "19194505684" }],
        display_name: "Alvaro de los Hoyos",
        id: "contact-alvaro"
      })
    ],
    externalContacts: [
      {
        displayName: "Alvaro de los Hoyos",
        emails: ["ajdelosh@gmail.com"],
        externalId: "people/alvaro",
        phones: ["+56976455077", "+19194505684"],
        provider: "google"
      }
    ],
    externalIdToContactId: { "people/alvaro": "contact-alvaro" },
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
