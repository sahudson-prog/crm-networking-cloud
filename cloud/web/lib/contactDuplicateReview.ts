import { contactRowToMergeSource, type ContactMergeSource } from "./contactMerge.ts";
import { phoneIdentitiesFor } from "./phoneIdentity.ts";
import type { ContactRow } from "./readModel.ts";

export type ContactDuplicateKey = {
  key: string;
  label: string;
  value: string;
};

export type ContactDuplicateGroup = {
  id: string;
  label: string;
  contacts: ContactRow[];
  duplicateKeys: ContactDuplicateKey[];
  mergeSources: ContactMergeSource[];
};

export function findContactDuplicateGroups(contacts: ContactRow[]): ContactDuplicateGroup[] {
  const activeContacts = contacts.filter((contact) => contact.is_active);
  const contactById = new Map(activeContacts.map((contact) => [contact.id, contact]));
  const keyToContactIds = new Map<string, Set<string>>();
  const keyLabels = new Map<string, ContactDuplicateKey>();

  for (const contact of activeContacts) {
    for (const duplicateKey of duplicateKeysForContact(contact)) {
      if (!keyToContactIds.has(duplicateKey.key)) keyToContactIds.set(duplicateKey.key, new Set());
      keyToContactIds.get(duplicateKey.key)?.add(contact.id);
      keyLabels.set(duplicateKey.key, duplicateKey);
    }
  }

  const parent = new Map<string, string>();
  activeContacts.forEach((contact) => parent.set(contact.id, contact.id));

  for (const contactIds of keyToContactIds.values()) {
    if (contactIds.size < 2) continue;
    const [first, ...rest] = Array.from(contactIds);
    rest.forEach((contactId) => union(parent, first, contactId));
  }

  const groupsByRoot = new Map<string, ContactRow[]>();
  for (const contact of activeContacts) {
    const root = find(parent, contact.id);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)?.push(contact);
  }

  return Array.from(groupsByRoot.values())
    .filter((groupContacts) => groupContacts.length > 1)
    .map((groupContacts) => buildDuplicateGroup(groupContacts, keyToContactIds, keyLabels))
    .filter((group): group is ContactDuplicateGroup => Boolean(group))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

function duplicateKeysForContact(contact: ContactRow): ContactDuplicateKey[] {
  const keys: ContactDuplicateKey[] = [];
  for (const item of contact.contact_emails ?? []) {
    const email = normalizeEmail(item.email);
    if (email) keys.push({ key: `email:${email}`, label: "Correo", value: email });
  }
  for (const item of contact.contact_phones ?? []) {
    const phone = item.phone?.trim();
    if (!phone) continue;
    for (const identity of phoneIdentitiesFor(phone)) {
      keys.push({ key: `phone:${identity}`, label: "Telefono", value: phone });
    }
  }
  return dedupeKeys(keys);
}

function buildDuplicateGroup(
  contacts: ContactRow[],
  keyToContactIds: Map<string, Set<string>>,
  keyLabels: Map<string, ContactDuplicateKey>
) {
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const duplicateKeys = Array.from(keyToContactIds.entries())
    .filter(([, ids]) => Array.from(ids).filter((id) => contactIds.has(id)).length > 1)
    .map(([key]) => keyLabels.get(key))
    .filter((key): key is ContactDuplicateKey => Boolean(key));
  const visibleDuplicateKeys = dedupeDuplicateKeyValues(duplicateKeys);

  if (!visibleDuplicateKeys.length) return null;

  const sortedContacts = [...contacts].sort(compareContactsForMerge);
  const preferredKey = visibleDuplicateKeys.find((key) => key.label === "Correo")
    ?? visibleDuplicateKeys.find((key) => key.label === "Telefono")
    ?? visibleDuplicateKeys[0];
  return {
    contacts: sortedContacts,
    duplicateKeys: visibleDuplicateKeys,
    id: `duplicate:${preferredKey.key}:${sortedContacts.map((contact) => contact.id).sort().join(":")}`,
    label: preferredKey.value || sortedContacts[0].display_name || "Duplicados",
    mergeSources: sortedContacts.map((contact) => contactRowToMergeSource(contact, "Guardado"))
  };
}

function dedupeDuplicateKeyValues(keys: ContactDuplicateKey[]) {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const displayKey = `${key.label}:${key.value.trim().toLowerCase()}`;
    if (seen.has(displayKey)) return false;
    seen.add(displayKey);
    return true;
  });
}

function compareContactsForMerge(a: ContactRow, b: ContactRow) {
  return contactCompletenessScore(b) - contactCompletenessScore(a)
    || a.display_name.localeCompare(b.display_name, "es", { sensitivity: "base" })
    || a.id.localeCompare(b.id);
}

function contactCompletenessScore(contact: ContactRow) {
  return [
    contact.display_name,
    contact.company,
    contact.role,
    ...(contact.contact_emails ?? []).map((item) => item.email),
    ...(contact.contact_phones ?? []).map((item) => item.phone)
  ].filter((value) => value?.trim()).length;
}

function dedupeKeys(keys: ContactDuplicateKey[]) {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (seen.has(key.key)) return false;
    seen.add(key.key);
    return true;
  });
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function find(parent: Map<string, string>, value: string): string {
  const current = parent.get(value) ?? value;
  if (current === value) return value;
  const root = find(parent, current);
  parent.set(value, root);
  return root;
}

function union(parent: Map<string, string>, a: string, b: string) {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent.set(rootB, rootA);
}
