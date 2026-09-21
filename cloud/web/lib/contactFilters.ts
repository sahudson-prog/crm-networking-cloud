import { NETWORKING_STATUSES } from "./contactActions";
import { cleanContactCompany, cleanContactRole } from "./format";
import type { ContactListRow, ContactRow, ObjectiveRow } from "./readModel";

export type TriState = "all" | "true" | "false";

export type ContactFilters = {
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  headhunterDomain: string;
  isHeadhunter: TriState;
  networkingFocus: TriState;
  networkingStatus: string;
  networkingStatuses: string[];
  hashtag: string;
  objectiveIds: string[];
};

export const DEFAULT_CONTACT_FILTERS: ContactFilters = {
  name: "",
  email: "",
  phone: "",
  company: "",
  role: "",
  headhunterDomain: "",
  isHeadhunter: "all",
  networkingFocus: "true",
  networkingStatus: "",
  networkingStatuses: [],
  hashtag: "",
  objectiveIds: []
};

export function filterContacts<T extends ContactRow>(contacts: T[], quickQuery: string, filters: ContactFilters): T[] {
  const quick = normalize(quickQuery);
  const name = normalize(filters.name);
  const email = normalize(filters.email);
  const phone = normalize(filters.phone);

  return contacts.filter((contact) => {
    const emails = (contact.contact_emails ?? []).map((item) => item.email);
    const phones = (contact.contact_phones ?? []).map((item) => item.phone);
    const domains = headhunterDomainsForContact(contact);
    const objectives = objectivesForContact(contact);
    const company = cleanContactCompany(contact.company);
    const role = cleanContactRole(contact.role);

    if (quick && !normalize([contact.display_name, company, role, ...emails, ...phones, ...domains, ...objectives.map((objective) => objective.objective_name), contact.networking_status].join(" ")).includes(quick)) {
      return false;
    }
    if (name && !normalize(contact.display_name).includes(name)) return false;
    if (email && !normalize(emails.join(" ")).includes(email)) return false;
    if (phone && !normalize(phones.join(" ")).includes(phone)) return false;
    if (filters.company && company !== filters.company) return false;
    if (filters.role && role !== filters.role) return false;
    if (filters.headhunterDomain && !domains.includes(filters.headhunterDomain)) return false;
    if (filters.isHeadhunter !== "all" && contact.is_headhunter !== (filters.isHeadhunter === "true")) return false;
    if (filters.networkingFocus !== "all" && contact.networking_focus !== (filters.networkingFocus === "true")) return false;
    const selectedStatuses = filters.networkingStatuses?.length ? filters.networkingStatuses : filters.networkingStatus ? [filters.networkingStatus] : [];
    if (selectedStatuses.length && !selectedStatuses.includes(contact.networking_status)) return false;
    if (filters.objectiveIds.length) {
      const contactObjectiveIds = new Set(objectives.map((objective) => objective.id));
      if (!filters.objectiveIds.some((objectiveId) => contactObjectiveIds.has(objectiveId))) return false;
    }
    return true;
  });
}

export function buildContactFilterOptions(contacts: ContactRow[]) {
  return {
    companies: uniqueSorted(contacts.map((contact) => cleanContactCompany(contact.company))),
    roles: uniqueSorted(contacts.map((contact) => cleanContactRole(contact.role))),
    headhunterDomains: uniqueSorted(contacts.flatMap(headhunterDomainsForContact)),
    statuses: [...NETWORKING_STATUSES]
  };
}

export function objectiveOptionsForContacts(contacts: ContactRow[]) {
  const byId = new Map<string, ObjectiveRow>();
  for (const contact of contacts) {
    for (const objective of objectivesForContact(contact)) {
      if (objective.is_active) byId.set(objective.id, objective);
    }
  }
  return Array.from(byId.values()).sort(compareObjectives);
}

export function objectivesForContact(contact: ContactRow | ContactListRow) {
  return (contact.contact_objective_assignments ?? [])
    .map((assignment) => assignment.objective)
    .filter((objective): objective is ObjectiveRow => Boolean(objective));
}

export function headhunterDomainsForContact(contact: ContactRow | ContactListRow) {
  const domains = new Set<string>();
  for (const domain of contact.headhunter_domains ?? []) {
    const normalized = normalizeDomain(domain);
    if (normalized) domains.add(normalized);
  }
  for (const email of contact.contact_emails ?? []) {
    const normalized = normalizeDomain(email.domain ?? "");
    if (normalized) domains.add(normalized);
  }
  return Array.from(domains).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function normalize(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(domain: string) {
  const clean = domain.trim().toLowerCase();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

function compareObjectives(a: ObjectiveRow, b: ObjectiveRow) {
  const typeOrder = objectiveTypeOrder(a.objective_type) - objectiveTypeOrder(b.objective_type);
  if (typeOrder) return typeOrder;
  return a.objective_name.localeCompare(b.objective_name, "es", { sensitivity: "base" });
}

function objectiveTypeOrder(type: string) {
  if (type === "COMPANY") return 0;
  if (type === "INDUSTRY") return 1;
  if (type === "ROLE") return 2;
  if (type === "FUNCTION") return 3;
  return 4;
}
