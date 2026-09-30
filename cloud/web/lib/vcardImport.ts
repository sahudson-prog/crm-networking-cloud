import VCard from "vcf";

import type { ContactEditorInput } from "./contactActions.ts";
import { hasExistingContactDuplicateSignal } from "./contactDuplicateReview.ts";
import type { ContactRow } from "./readModel.ts";
import type { SyncPreviewChange } from "./syncOrchestrator.ts";

export const MAX_VCARD_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_VCARD_CONTACTS = 1000;

export type VCardImportContact = {
  id: string;
  displayName: string;
  company: string;
  role: string;
  emails: string[];
  phones: string[];
};

export type VCardParseResult = {
  contacts: VCardImportContact[];
  invalidCount: number;
};

export type VCardPreviewCategory = "new" | "possible_duplicate";

type VCardProperty = { valueOf(): unknown };

export function parseVCardContacts(source: string): VCardParseResult {
  if (!/BEGIN:VCARD/i.test(source) || !/END:VCARD/i.test(source)) {
    throw new Error("El archivo no contiene una vCard válida.");
  }

  let cards: VCard[];
  try {
    cards = VCard.parse(source.replace(/\r\n|\r|\n/g, "\r\n"));
  } catch {
    throw new Error("No pudimos leer el archivo vCard.");
  }

  if (cards.length > MAX_VCARD_CONTACTS) {
    throw new Error(`El archivo supera el límite de ${MAX_VCARD_CONTACTS} contactos.`);
  }

  const contacts: VCardImportContact[] = [];
  let invalidCount = 0;

  cards.forEach((card, index) => {
    const contact = mapVCardToContact(card, index);
    if (contact) contacts.push(contact);
    else invalidCount += 1;
  });

  if (!contacts.length) throw new Error("No encontramos contactos válidos en el archivo.");
  return { contacts, invalidCount };
}

export function mapVCardToContact(card: VCard, index: number): VCardImportContact | null {
  const displayName = firstValue(card, "fn") || structuredName(firstValue(card, "n"));
  if (!displayName) return null;

  return {
    company: firstStructuredPart(firstValue(card, "org")),
    displayName,
    emails: uniqueValues(propertyValues(card, "email").map(cleanEmail).filter(Boolean)),
    id: `vcard-${index}`,
    phones: uniqueValues(propertyValues(card, "tel").map(cleanPhone).filter(Boolean)),
    role: firstValue(card, "title")
  };
}

export function buildVCardPreviewChanges(
  contacts: VCardImportContact[],
  existingContacts: ContactRow[]
): SyncPreviewChange[] {
  return contacts.map((contact) => {
    const category: VCardPreviewCategory = hasExistingContactDuplicateSignal(contact, existingContacts)
      ? "possible_duplicate"
      : "new";
    const fields: SyncPreviewChange["fields"] = [
      { after: contact.displayName, apply: true, label: "Nombre", operation: "add" },
      ...(contact.company ? [{ after: contact.company, apply: true, label: "Empresa", operation: "add" as const }] : []),
      ...(contact.role ? [{ after: contact.role, apply: true, label: "Cargo", operation: "add" as const }] : []),
      ...(contact.emails.length
        ? [{ after: contact.emails.join(", "), apply: true, label: "Correos", operation: "add" as const }]
        : []),
      ...(contact.phones.length
        ? [{ after: contact.phones.join(", "), apply: true, label: "Teléfonos", operation: "add" as const }]
        : [])
    ];

    return {
      defaultSelected: true,
      fields,
      id: contact.id,
      metadata: { vcardCategory: category },
      reason: category === "possible_duplicate"
        ? "Coincide por correo o teléfono con un contacto existente."
        : null,
      sourceLabel: "vCard",
      subtitle: [contact.company, contact.role].filter(Boolean).join(" · "),
      title: contact.displayName,
      type: "new"
    };
  });
}

export async function importSelectedVCardContacts(
  contacts: VCardImportContact[],
  saveContact: (input: ContactEditorInput) => Promise<{ contactId: string }>
) {
  let importedCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    try {
      await saveContact({
        company: contact.company,
        displayName: contact.displayName,
        emails: contact.emails,
        headhunterDomains: [],
        isHeadhunter: false,
        networkingFocus: true,
        networkingStatus: "Pendiente",
        phones: contact.phones,
        role: contact.role,
        source: "vcard_import"
      });
      importedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return { failedCount, importedCount };
}

export function selectVCardContacts(contacts: VCardImportContact[], selectedIds: Iterable<string>) {
  const selected = new Set(selectedIds);
  return contacts.filter((contact) => selected.has(contact.id));
}

function propertyValues(card: VCard, key: string) {
  const value = card.data[key];
  const properties = Array.isArray(value) ? value : value ? [value] : [];
  return properties.map(propertyText).filter(Boolean);
}

function firstValue(card: VCard, key: string) {
  return propertyValues(card, key)[0] ?? "";
}

function propertyText(property: VCardProperty) {
  const value = property.valueOf();
  return typeof value === "string" ? unescapeText(value).trim() : "";
}

function structuredName(value: string) {
  const [family, given, additional, prefix, suffix] = splitStructured(value);
  return [prefix, given, additional, family, suffix].filter(Boolean).join(" ").trim();
}

function firstStructuredPart(value: string) {
  return splitStructured(value)[0] ?? "";
}

function splitStructured(value: string) {
  const parts: string[] = [];
  let current = "";
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ";") {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current.trim());
  return parts.map(unescapeText);
}

function unescapeText(value: string) {
  return value
    .replace(/\\[nN]/g, " ")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

function cleanEmail(value: string) {
  return value.replace(/^mailto:/i, "").trim().toLowerCase();
}

function cleanPhone(value: string) {
  return value.replace(/^tel:/i, "").trim();
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}
