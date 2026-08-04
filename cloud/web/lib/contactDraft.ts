import {
  contactToEditorInput,
  normalizeEmail,
  normalizePhone,
  type ContactEditorInput
} from "./contactActions";
import type { ContactRow } from "./readModel";

export type ContactDraftPatch = {
  company?: string;
  role?: string;
  emailsToAdd?: string[];
  phonesToAdd?: string[];
  source?: string;
};

export function buildContactEditorInputWithPatch(contact: ContactRow, patch: ContactDraftPatch): ContactEditorInput {
  const input = contactToEditorInput(contact);
  if (patch.company !== undefined) input.company = patch.company;
  if (patch.role !== undefined) input.role = patch.role;
  if (patch.emailsToAdd?.length) input.emails = appendUniqueEmails(input.emails, patch.emailsToAdd);
  if (patch.phonesToAdd?.length) input.phones = appendUniquePhones(input.phones, patch.phonesToAdd);
  input.source = patch.source || "contact_draft_patch";
  return input;
}

function appendUniqueEmails(current: string[], additions: string[]) {
  const seen = new Set(current.map(normalizeEmail).filter(Boolean));
  const result = [...current];
  for (const email of additions.map(normalizeEmail).filter(Boolean)) {
    if (seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

function appendUniquePhones(current: string[], additions: string[]) {
  const seen = new Set(current.map(normalizePhone).filter(Boolean));
  const result = [...current];
  for (const phone of additions.map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalizePhone(phone);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(phone);
  }
  return result;
}
