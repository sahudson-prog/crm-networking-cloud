import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ContactRow } from "../lib/readModel.ts";
import {
  buildVCardPreviewChanges,
  importSelectedVCardContacts,
  parseVCardContacts,
  selectVCardContacts
} from "../lib/vcardImport.ts";

const SINGLE_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Ada Lovelace
N:Lovelace;Ada;;;
EMAIL;TYPE=WORK:Ada@Example.com
TEL;TYPE=CELL:+56 9 1234 5678
ORG:Analytical Engines;Research
TITLE:Directora
NOTE:Este texto no tiene destino
ADR:;;Calle de ejemplo;;;;
END:VCARD`;

function existingContact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    company: "",
    contact_emails: [],
    contact_phones: [],
    display_name: "Contacto existente",
    headhunter_domains: [],
    id: "existing-1",
    is_active: true,
    is_headhunter: false,
    networking_focus: true,
    networking_status: "Pendiente",
    role: "",
    updated_at: "2026-09-29T00:00:00Z",
    ...overrides
  };
}

test("parsea un contacto y mapea solo campos reales", () => {
  const result = parseVCardContacts(SINGLE_VCARD);

  assert.equal(result.invalidCount, 0);
  assert.deepEqual(result.contacts, [{
    company: "Analytical Engines",
    displayName: "Ada Lovelace",
    emails: ["ada@example.com"],
    id: "vcard-0",
    phones: ["+56 9 1234 5678"],
    role: "Directora"
  }]);
  assert.equal("note" in result.contacts[0], false);
  assert.equal("address" in result.contacts[0], false);
});

test("parsea varios contactos sin deduplicarlos dentro del archivo", () => {
  const source = `${SINGLE_VCARD}\n${SINGLE_VCARD.replace("Ada Lovelace", "Ada Lovelace")}`;
  const result = parseVCardContacts(source);

  assert.equal(result.contacts.length, 2);
  assert.deepEqual(result.contacts.map((contact) => contact.id), ["vcard-0", "vcard-1"]);
});

test("usa N como fallback cuando FN no existe", () => {
  const result = parseVCardContacts(`BEGIN:VCARD
VERSION:3.0
N:Hopper;Grace;Brewster;Rear Admiral;
END:VCARD`);

  assert.equal(result.contacts[0].displayName, "Rear Admiral Grace Brewster Hopper");
});

test("clasifica posibles duplicados solo contra contactos activos existentes", () => {
  const [candidate] = parseVCardContacts(SINGLE_VCARD).contacts;
  const duplicate = existingContact({
    contact_emails: [{ domain: "@example.com", email: "ADA@EXAMPLE.COM" }]
  });
  const inactive = existingContact({
    contact_emails: [{ domain: "@example.com", email: "ada@example.com" }],
    id: "inactive-1",
    is_active: false
  });

  assert.equal(buildVCardPreviewChanges([candidate], [duplicate])[0].metadata?.vcardCategory, "possible_duplicate");
  assert.equal(buildVCardPreviewChanges([candidate], [inactive])[0].metadata?.vcardCategory, "new");
  assert.equal(buildVCardPreviewChanges([candidate], [existingContact({ display_name: "Ada Lovelace" })])[0].metadata?.vcardCategory, "new");
});

test("reutiliza la identidad telefónica normalizada para advertir duplicados", () => {
  const [candidate] = parseVCardContacts(SINGLE_VCARD).contacts;
  const existing = existingContact({ contact_phones: [{ phone: "56912345678" }] });

  assert.equal(buildVCardPreviewChanges([candidate], [existing])[0].metadata?.vcardCategory, "possible_duplicate");
});

test("la selección controla exclusivamente qué contactos se crean como nuevos", async () => {
  const contacts = parseVCardContacts(`${SINGLE_VCARD}\n${SINGLE_VCARD.replaceAll("Ada", "Grace").replace("Lovelace;Grace", "Hopper;Grace")}`).contacts;
  const selected = selectVCardContacts(contacts, ["vcard-1"]);
  const saved: string[] = [];

  const result = await importSelectedVCardContacts(selected, async (input) => {
    saved.push(input.displayName);
    assert.equal(input.contactId, undefined);
    assert.equal(input.source, "vcard_import");
    return { contactId: "created-1" };
  });

  assert.deepEqual(saved, [selected[0].displayName]);
  assert.deepEqual(result, { failedCount: 0, importedCount: 1 });
});

test("la UI no escribe antes de confirmar Importar selección", () => {
  const source = readFileSync(new URL("../components/VCardImportPanel.tsx", import.meta.url), "utf8");
  const fileHandler = source.slice(source.indexOf("async function handleFileSelection"), source.indexOf("async function applySelection"));

  assert.doesNotMatch(fileHandler, /importSelectedVCardContacts|saveContactFromEditor/);
  assert.match(source, /onApply=\{\(selectedChanges\) => void applySelection\(selectedChanges\)\}/);
});
