import type { ExternalContactInput, SyncPreviewChange, SyncProvider } from "./syncOrchestrator.ts";

export type ExternalContactSnapshot = {
  displayName: string;
  company: string;
  role: string;
  emails: string[];
  phones: string[];
  birthdays: unknown[];
  metadata: Record<string, unknown>;
  lastSeenAt: string | null;
};

export type ExternalContactSnapshotEntry = {
  externalId: string;
  snapshot: ExternalContactSnapshot;
};

export type KnownExternalContactValue = {
  contactId: string;
  kind: "email" | "phone";
  value: string;
};

export function externalContactSnapshotMetadata(contact: ExternalContactInput): ExternalContactSnapshot {
  const metadata = cleanRecord(contact.metadata);
  const birthdays = Array.isArray(metadata.google_birthdays) ? metadata.google_birthdays : [];
  return {
    birthdays,
    company: contact.company?.trim() ?? "",
    displayName: contact.displayName?.trim() ?? "",
    emails: cleanList(contact.emails),
    lastSeenAt: contact.lastSeenAt ?? new Date().toISOString(),
    metadata,
    phones: cleanList(contact.phones),
    role: contact.role?.trim() ?? ""
  };
}

export function externalContactSnapshotsByExternalId(contacts: ExternalContactInput[]) {
  return Object.fromEntries(contacts.map((contact) => [
    contact.externalId,
    externalContactSnapshotMetadata(contact)
  ]));
}

export function externalContactSnapshotsFromPreviewChange(change: SyncPreviewChange): ExternalContactSnapshotEntry[] {
  const snapshotsById = recordValue(change.metadata?.externalSnapshotsByExternalId);
  const primarySnapshot = snapshotValue(change.metadata?.externalSnapshot);
  const primaryExternalId = stringValue(change.metadata?.externalId);
  const entries: ExternalContactSnapshotEntry[] = [];

  for (const externalId of externalIdsFromChange(change)) {
    const snapshot = snapshotValue(snapshotsById?.[externalId])
      ?? (externalId === primaryExternalId ? primarySnapshot : null);
    if (snapshot) entries.push({ externalId, snapshot });
  }

  return entries;
}

export function knownValuesFromExternalContactSnapshots(input: {
  links: Array<{ contactId: string; externalId: string }>;
  snapshots: Array<{ externalId: string; emails?: unknown; phones?: unknown; isDeleted?: boolean | null }>;
}): KnownExternalContactValue[] {
  const contactIdByExternalId = new Map(input.links.map((link) => [link.externalId, link.contactId]));
  const values: KnownExternalContactValue[] = [];

  for (const snapshot of input.snapshots) {
    if (snapshot.isDeleted) continue;
    const contactId = contactIdByExternalId.get(snapshot.externalId);
    if (!contactId) continue;
    for (const email of cleanList(snapshot.emails)) values.push({ contactId, kind: "email", value: email });
    for (const phone of cleanList(snapshot.phones)) values.push({ contactId, kind: "phone", value: phone });
  }

  return values;
}

export function externalContactSnapshotDbPayload(input: {
  connectedAccountId?: string | null;
  externalId: string;
  provider: SyncProvider;
  snapshot: ExternalContactSnapshot;
  userId: string;
}) {
  return {
    user_id: input.userId,
    connected_account_id: input.connectedAccountId ?? null,
    provider: input.provider,
    external_id: input.externalId,
    display_name: input.snapshot.displayName,
    company: input.snapshot.company,
    role: input.snapshot.role,
    emails: input.snapshot.emails,
    phones: input.snapshot.phones,
    birthdays: input.snapshot.birthdays,
    metadata: input.snapshot.metadata,
    content_hash: stableSnapshotHash(input.snapshot),
    is_deleted: false,
    last_seen_at: input.snapshot.lastSeenAt ?? new Date().toISOString()
  };
}

function externalIdsFromChange(change: SyncPreviewChange) {
  const ids = new Set<string>();
  const single = stringValue(change.metadata?.externalId);
  if (single) ids.add(single);
  const multiple = change.metadata?.externalIds;
  if (Array.isArray(multiple)) {
    multiple.forEach((id) => {
      if (typeof id === "string" && id.trim()) ids.add(id);
    });
  }
  return Array.from(ids);
}

function stableSnapshotHash(snapshot: ExternalContactSnapshot) {
  return JSON.stringify({
    birthdays: snapshot.birthdays,
    company: snapshot.company,
    displayName: snapshot.displayName,
    emails: snapshot.emails,
    phones: snapshot.phones,
    role: snapshot.role
  });
}

function snapshotValue(value: unknown): ExternalContactSnapshot | null {
  const record = recordValue(value);
  if (!record) return null;
  return {
    birthdays: Array.isArray(record.birthdays) ? record.birthdays : [],
    company: stringValue(record.company),
    displayName: stringValue(record.displayName),
    emails: cleanList(record.emails),
    lastSeenAt: stringValue(record.lastSeenAt) || null,
    metadata: recordValue(record.metadata) ?? {},
    phones: cleanList(record.phones),
    role: stringValue(record.role)
  };
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return recordValue(value) ?? {};
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}
