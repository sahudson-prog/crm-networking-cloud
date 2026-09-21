import { cleanContactCompany, cleanContactRole } from "./format.ts";
import { phoneIdentitiesFor } from "./phoneIdentity.ts";
import type { ContactRow } from "./readModel.ts";
import type { ExternalContactInput, SyncPreviewChange } from "./syncOrchestrator.ts";

export type ContactMergeSourceKind = "Guardado" | "Fuente conectada";

export type ContactMergeSource = {
  id: string;
  kind: ContactMergeSourceKind;
  name: string;
  company?: string | null;
  role?: string | null;
  emails: string[];
  phones: string[];
  focus: boolean;
  headhunter: boolean;
  networkingStatus: string;
};

export type ContactMergeResult = {
  name: string;
  company: string;
  role: string;
  emails: string[];
  phones: string[];
  focus: boolean;
  headhunter: boolean;
  networkingStatus: string;
};

export const CONTACT_MERGE_STATUS_ORDER = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

export function contactRowToMergeSource(contact: ContactRow, kind: ContactMergeSourceKind = "Guardado"): ContactMergeSource {
  return {
    company: cleanContactCompany(contact.company),
    emails: uniqueEmails((contact.contact_emails ?? []).map((item) => item.email).filter(Boolean)),
    focus: Boolean(contact.networking_focus),
    headhunter: Boolean(contact.is_headhunter),
    id: contact.id,
    kind,
    name: contact.display_name || "Sin nombre",
    networkingStatus: contact.networking_status || "Pendiente",
    phones: uniquePhones((contact.contact_phones ?? []).map((item) => item.phone).filter(Boolean)),
    role: cleanContactRole(contact.role)
  };
}

export function externalContactToMergeSource(contact: ExternalContactInput, kind: ContactMergeSourceKind = "Fuente conectada"): ContactMergeSource {
  return {
    company: cleanContactCompany(contact.company),
    emails: uniqueEmails(contact.emails ?? []),
    focus: false,
    headhunter: false,
    id: contact.externalId,
    kind,
    name: contact.displayName || "Sin nombre",
    networkingStatus: "Pendiente",
    phones: uniquePhones(contact.phones ?? []),
    role: cleanContactRole(contact.role)
  };
}

export function defaultContactMergeResult(sources: ContactMergeSource[]): ContactMergeResult {
  const identity = sources.find((source) => source.kind === "Guardado") ?? richestSource(sources);
  return {
    company: cleanContactCompany(identity?.company) || firstClean(sources.map((source) => cleanContactCompany(source.company))),
    emails: uniqueEmails(sources.flatMap((source) => source.emails)),
    focus: sources.some((source) => source.focus),
    headhunter: sources.some((source) => source.headhunter),
    name: identity?.name || firstClean(sources.map((source) => source.name)),
    networkingStatus: mostAdvancedStatus(sources),
    phones: uniquePhones(sources.flatMap((source) => source.phones)),
    role: cleanContactRole(identity?.role) || firstClean(sources.map((source) => cleanContactRole(source.role)))
  };
}

export function withContactMergeDecision(change: SyncPreviewChange, decision: ContactMergeResult): SyncPreviewChange {
  return {
    ...change,
    metadata: {
      ...change.metadata,
      contactMergeDecision: decision
    }
  };
}

export function contactMergeDecisionFromPreviewChange(change: SyncPreviewChange): ContactMergeResult | null {
  const decision = change.metadata?.contactMergeDecision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return null;
  const value = decision as Record<string, unknown>;
  if (typeof value.name !== "string") return null;
  if (typeof value.company !== "string") return null;
  if (typeof value.role !== "string") return null;
  if (!Array.isArray(value.emails) || !Array.isArray(value.phones)) return null;
  if (typeof value.focus !== "boolean" || typeof value.headhunter !== "boolean") return null;
  if (typeof value.networkingStatus !== "string") return null;
  return {
    company: value.company,
    emails: value.emails.filter((item): item is string => typeof item === "string"),
    focus: value.focus,
    headhunter: value.headhunter,
    name: value.name,
    networkingStatus: value.networkingStatus,
    phones: value.phones.filter((item): item is string => typeof item === "string"),
    role: value.role
  };
}

export function mostAdvancedStatus(sources: ContactMergeSource[]) {
  return sources.reduce((current, source) => {
    const currentRank = CONTACT_MERGE_STATUS_ORDER.indexOf(current);
    const nextRank = CONTACT_MERGE_STATUS_ORDER.indexOf(source.networkingStatus);
    return nextRank > currentRank ? source.networkingStatus : current;
  }, "Pendiente");
}

export function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function uniqueEmails(values: string[]) {
  return uniqueValues(values.map((value) => value.toLowerCase()));
}

export function uniquePhones(values: string[]) {
  const seen = new Set<string>();
  const phones: string[] = [];

  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const identities = Array.from(phoneIdentitiesFor(clean));
    const alreadySeen = identities.some((identity) => seen.has(identity));
    if (alreadySeen) continue;
    phones.push(clean);
    identities.forEach((identity) => seen.add(identity));
  }

  return phones;
}

function firstClean(values: string[]) {
  return values.find((value) => value.trim()) ?? "";
}

function richestSource(sources: ContactMergeSource[]) {
  return [...sources].sort((first, second) => sourceScore(second) - sourceScore(first))[0] ?? sources[0];
}

function sourceScore(source: ContactMergeSource) {
  return (hasUsefulName(source) ? 5 : 0)
    + (cleanContactCompany(source.company) ? 3 : 0)
    + (cleanContactRole(source.role) ? 3 : 0)
    + source.emails.length * 2
    + source.phones.length * 2;
}

function hasUsefulName(source: ContactMergeSource) {
  const name = source.name.trim().toLowerCase();
  if (!name || name === "sin nombre") return false;
  if (source.emails.map((email) => email.toLowerCase()).includes(name)) return false;
  if (source.phones.map((phone) => phone.replace(/\D/g, "")).includes(name.replace(/\D/g, ""))) return false;
  return true;
}
