import test from "node:test";
import assert from "node:assert/strict";

import { findContactDuplicateGroups } from "../lib/contactDuplicateReview.ts";
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
    updated_at: "2026-08-04T00:00:00Z",
    ...overrides
  };
}

test("detecta duplicados guardados por correo normalizado", () => {
  const groups = findContactDuplicateGroups([
    contact({
      contact_emails: [{ domain: "@empresa.cl", email: "Sergio@Empresa.cl" }],
      display_name: "Sergio Hudson",
      id: "contact-1"
    }),
    contact({
      contact_emails: [{ domain: "@empresa.cl", email: "sergio@empresa.cl" }],
      display_name: "Sergio H.",
      id: "contact-2"
    }),
    contact({
      contact_emails: [{ domain: "@otra.cl", email: "otro@otra.cl" }],
      display_name: "Otro Contacto",
      id: "contact-3"
    })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "sergio@empresa.cl");
  assert.deepEqual(groups[0].contacts.map((item) => item.id).sort(), ["contact-1", "contact-2"]);
});

test("agrupa duplicados indirectos conectados por telefono y correo", () => {
  const groups = findContactDuplicateGroups([
    contact({
      contact_phones: [{ phone: "+56 9 9221 5817" }],
      display_name: "Alberto Villate",
      id: "contact-1"
    }),
    contact({
      contact_emails: [{ domain: "@astara.com", email: "alberto@astara.com" }],
      contact_phones: [{ phone: "56992215817" }],
      display_name: "Alberto V.",
      id: "contact-2"
    }),
    contact({
      contact_emails: [{ domain: "@astara.com", email: "ALBERTO@ASTARA.COM" }],
      display_name: "Alberto Villate Galarce",
      id: "contact-3"
    })
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].contacts.map((item) => item.id).sort(), ["contact-1", "contact-2", "contact-3"]);
  assert.equal(groups[0].duplicateKeys.some((key) => key.label === "Correo"), true);
  assert.equal(groups[0].duplicateKeys.some((key) => key.label === "Telefono"), true);
});

test("ignora contactos inactivos al revisar duplicados", () => {
  const groups = findContactDuplicateGroups([
    contact({
      contact_emails: [{ domain: "@empresa.cl", email: "duplicado@empresa.cl" }],
      display_name: "Activo",
      id: "contact-1"
    }),
    contact({
      contact_emails: [{ domain: "@empresa.cl", email: "duplicado@empresa.cl" }],
      display_name: "Inactivo",
      id: "contact-2",
      is_active: false
    })
  ]);

  assert.equal(groups.length, 0);
});
