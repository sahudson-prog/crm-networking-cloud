import type { ExternalContactInput } from "./syncOrchestrator.ts";

export type GooglePersonName = {
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
};

export type GooglePersonEmail = {
  value?: string | null;
};

export type GooglePersonPhone = {
  value?: string | null;
  canonicalForm?: string | null;
};

export type GooglePersonOrganization = {
  name?: string | null;
  title?: string | null;
};

export type GooglePersonMetadata = {
  deleted?: boolean | null;
  previousResourceNames?: string[] | null;
};

export type GooglePerson = {
  resourceName?: string | null;
  etag?: string | null;
  names?: GooglePersonName[] | null;
  emailAddresses?: GooglePersonEmail[] | null;
  phoneNumbers?: GooglePersonPhone[] | null;
  organizations?: GooglePersonOrganization[] | null;
  metadata?: GooglePersonMetadata | null;
};

export function mapGooglePersonToExternalContact(input: {
  person: GooglePerson;
  connectedAccountId?: string | null;
}): ExternalContactInput | null {
  const externalId = clean(input.person.resourceName);
  if (!externalId) return null;

  const emails = unique((input.person.emailAddresses ?? []).map((email) => normalizeEmail(email.value)).filter(Boolean));
  const phones = unique((input.person.phoneNumbers ?? []).map((phone) => clean(phone.value) || clean(phone.canonicalForm)).filter(Boolean));
  const primaryName = firstName(input.person.names ?? []);
  const organization = firstOrganization(input.person.organizations ?? []);
  const displayName = primaryName || emails[0] || phones[0] || "Contacto sin nombre";

  return {
    company: organization.company,
    connectedAccountId: input.connectedAccountId,
    displayName,
    emails,
    externalId,
    lastSeenAt: new Date().toISOString(),
    metadata: {
      google_deleted: Boolean(input.person.metadata?.deleted),
      google_etag: clean(input.person.etag) || null,
      missing_display_name: !primaryName,
      previous_resource_names: input.person.metadata?.previousResourceNames ?? []
    },
    phones,
    provider: "google",
    role: organization.role
  };
}

export function mapGooglePeopleToExternalContacts(input: {
  people: GooglePerson[];
  connectedAccountId?: string | null;
}) {
  return input.people
    .map((person) => mapGooglePersonToExternalContact({ person, connectedAccountId: input.connectedAccountId }))
    .filter((contact): contact is ExternalContactInput => Boolean(contact));
}

function firstName(names: GooglePersonName[]) {
  for (const name of names) {
    const displayName = clean(name.displayName);
    if (displayName) return displayName;
    const composed = [clean(name.givenName), clean(name.familyName)].filter(Boolean).join(" ").trim();
    if (composed) return composed;
  }
  return "";
}

function firstOrganization(organizations: GooglePersonOrganization[]) {
  for (const organization of organizations) {
    const company = clean(organization.name);
    const role = clean(organization.title);
    if (company || role) return { company, role };
  }
  return { company: "", role: "" };
}

function normalizeEmail(value?: string | null) {
  return clean(value).toLowerCase();
}

function clean(value?: string | null) {
  return value?.trim() ?? "";
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
