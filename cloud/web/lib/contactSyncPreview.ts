import type { ContactRow } from "./readModel.ts";
import {
  contactRowToMergeSource,
  externalContactToMergeSource
} from "./contactMerge.ts";
import {
  phoneIdentitiesFor,
  normalizePhoneDigits,
  phoneIdentitySet,
  phoneMatchesSet
} from "./phoneIdentity.ts";
import {
  externalContactSnapshotMetadata
} from "./externalContactSnapshots.ts";
import type {
  ExternalContactInput,
  SyncPreviewChange,
  SyncPreviewFieldChange,
  SyncMode,
  SyncProvider
} from "./syncOrchestrator.ts";

type KnownExternalContactValue = {
  kind: "email" | "phone";
  value: string;
};

const MAX_MERGE_SOURCES = 3;

export type ContactSyncPreviewInput = {
  provider: SyncProvider;
  appContacts: ContactRow[];
  externalContacts: ExternalContactInput[];
  externalIdToContactId?: Record<string, string | null | undefined>;
  knownExternalValuesByContactId?: Record<string, KnownExternalContactValue[]>;
  mode?: SyncMode;
  suppressedChangeKeys?: string[];
};

export type ContactSyncPreviewBranchTrace = {
  externalId: string;
  externalName: string;
  linkedContactId: string | null;
  linkedContactFound: boolean;
  secondaryMatchContactIds: string[];
  stage: "external_id" | "second_order_identity" | "new_contact";
  resultType: SyncPreviewChange["type"];
  fieldCount: number;
  note?: string;
};

export function buildContactSyncPreview(input: ContactSyncPreviewInput): SyncPreviewChange[] {
  const appById = new Map(input.appContacts.map((contact) => [contact.id, contact]));
  const externalByLinkedContact = groupExternalContactsByLinkedContact(input.externalContacts, input.externalIdToContactId ?? {});
  const suppressed = new Set(input.suppressedChangeKeys ?? []);
  const changes: SyncPreviewChange[] = [];

  for (const externalContact of input.externalContacts) {
    const linkedContactId = linkedContactIdForExternalContact(externalContact, input.externalIdToContactId ?? {});
    const linkedContact = linkedContactId ? appById.get(linkedContactId) : null;

    if (isExternalDeleted(externalContact)) {
      if (linkedContact && !suppressed.has(deletedContactChangeKey(linkedContact.id))) {
        changes.push(deletedContactChange(input.provider, linkedContact));
      }
      continue;
    }

    if (!linkedContact) {
      changes.push(newContactChange(input.provider, externalContact));
      continue;
    }

    const fields = modifiedFields(
      linkedContact,
      externalContact,
      input.knownExternalValuesByContactId?.[linkedContact.id] ?? [],
      suppressed
    );

    if (fields.length) {
      changes.push({
        defaultSelected: true,
        fields,
        id: stableChangeId(input.provider, "modified", linkedContact.id, externalContact.externalId),
        metadata: {
          appContactId: linkedContact.id,
          externalId: externalContact.externalId,
          externalMetadata: externalContact.metadata ?? {},
          externalMetadataByExternalId: {
            [externalContact.externalId]: externalContact.metadata ?? {}
          },
          externalSnapshot: externalContactSnapshotMetadata(externalContact),
          externalSnapshotsByExternalId: {
            [externalContact.externalId]: externalContactSnapshotMetadata(externalContact)
          },
          mergeSources: [
            contactRowToMergeSource(linkedContact, "Guardado"),
            externalContactToMergeSource(externalContact, "Fuente conectada")
          ],
          provider: input.provider
        },
        title: linkedContact.display_name || externalContact.displayName,
        type: "modified"
      });
    } else {
      changes.push(unchangedContactChange(input.provider, linkedContact, externalContact));
    }
  }

  if ((input.mode ?? "historical") === "historical") {
    for (const [contactId, externalContacts] of externalByLinkedContact.entries()) {
      const contact = appById.get(contactId);
      if (!contact || externalContacts.length) continue;
      if (suppressed.has(deletedContactChangeKey(contactId))) continue;
      changes.push(deletedContactChange(input.provider, contact));
    }
  }

  return mergeDuplicateTargetChanges(changes);
}

export function traceContactSyncPreviewBranches(input: ContactSyncPreviewInput): ContactSyncPreviewBranchTrace[] {
  const appById = new Map(input.appContacts.map((contact) => [contact.id, contact]));
  const suppressed = new Set(input.suppressedChangeKeys ?? []);

  return input.externalContacts.map((externalContact) => {
    const linkedContactId = linkedContactIdForExternalContact(externalContact, input.externalIdToContactId ?? {});
    const linkedContact = linkedContactId ? appById.get(linkedContactId) : null;
    const secondaryMatchContactIds = findExistingCandidates(
      input.appContacts,
      externalContact,
      linkedContact?.id ?? linkedContactId ?? ""
    ).map((contact) => contact.id);

    if (linkedContact) {
      const fields = modifiedFields(
        linkedContact,
        externalContact,
        input.knownExternalValuesByContactId?.[linkedContact.id] ?? [],
        suppressed
      );
      return {
        externalId: externalContact.externalId,
        externalName: externalContact.displayName,
        fieldCount: fields.length,
        linkedContactFound: true,
        linkedContactId,
        resultType: fields.length ? "modified" : "unchanged",
        secondaryMatchContactIds,
        stage: "external_id"
      };
    }

    return {
      externalId: externalContact.externalId,
      externalName: externalContact.displayName,
      fieldCount: wholeContactFields(externalContact).length,
      linkedContactFound: false,
      linkedContactId,
      note: secondaryMatchContactIds.length
        ? "El ID externo no esta enlazado; correo/telefono coincidente se revisa despues en duplicados."
        : linkedContactId ? "El ID externo apuntaba a un contacto que no esta en el set activo evaluado." : undefined,
      resultType: "new",
      secondaryMatchContactIds,
      stage: "new_contact"
    };
  });
}

function newContactChange(provider: SyncProvider, externalContact: ExternalContactInput): SyncPreviewChange {
  return {
    defaultSelected: true,
    fields: wholeContactFields(externalContact),
    id: stableChangeId(provider, "new", externalContact.externalId),
    metadata: {
      externalId: externalContact.externalId,
      externalMetadata: externalContact.metadata ?? {},
      externalMetadataByExternalId: {
        [externalContact.externalId]: externalContact.metadata ?? {}
      },
      externalSnapshot: externalContactSnapshotMetadata(externalContact),
      externalSnapshotsByExternalId: {
        [externalContact.externalId]: externalContactSnapshotMetadata(externalContact)
      },
      mergeSources: [
        externalContactToMergeSource(externalContact, "Fuente conectada")
      ],
      provider
    },
    title: externalContact.displayName,
    type: "new"
  };
}

function deletedContactChange(provider: SyncProvider, contact: ContactRow): SyncPreviewChange {
  return {
    defaultSelected: false,
    fields: [
      { before: contact.display_name, changed: true, label: "Nombre" },
      { before: cleanValue(contact.company), changed: true, label: "Empresa" },
      { before: cleanValue(contact.role), changed: true, label: "Cargo" },
      ...contactEmails(contact).map((email) => ({ before: email, changed: true, label: "Correo" })),
      ...contactPhones(contact).map((phone) => ({ before: phone, changed: true, label: "Telefono" }))
    ],
    id: stableChangeId(provider, "deleted", contact.id),
    metadata: {
      appContactId: contact.id,
      provider
    },
    title: contact.display_name,
    type: "deleted"
  };
}

function unchangedContactChange(
  provider: SyncProvider,
  contact: ContactRow,
  externalContact: ExternalContactInput
): SyncPreviewChange {
  return {
    blocking: true,
    defaultSelected: false,
    fields: [
      { after: contact.display_name || externalContact.displayName, changed: false, label: "Nombre", operation: "info" },
      ...matchingFields(contact, externalContact)
    ],
    id: stableChangeId(provider, "unchanged", contact.id, externalContact.externalId),
    metadata: {
      appContactId: contact.id,
      externalId: externalContact.externalId,
      externalMetadata: externalContact.metadata ?? {},
      externalMetadataByExternalId: {
        [externalContact.externalId]: externalContact.metadata ?? {}
      },
      externalSnapshot: externalContactSnapshotMetadata(externalContact),
      externalSnapshotsByExternalId: {
        [externalContact.externalId]: externalContactSnapshotMetadata(externalContact)
      },
      provider
    },
    title: contact.display_name || externalContact.displayName,
    type: "unchanged"
  };
}

function modifiedFields(
  appContact: ContactRow,
  externalContact: ExternalContactInput,
  knownExternalValues: KnownExternalContactValue[],
  suppressed: Set<string>
) {
  return [
    ...singleValueFields(appContact, externalContact, { preserveExistingAppValues: true, showIgnoredExistingValues: true }),
    ...multiValueFields(appContact, externalContact, knownExternalValues, suppressed)
  ];
}

function singleValueFields(
  appContact: ContactRow,
  externalContact: ExternalContactInput,
  options: { preserveExistingAppValues?: boolean; showIgnoredExistingValues?: boolean } = {}
): SyncPreviewFieldChange[] {
  return [
    singleValueField("Nombre", appContact.display_name, externalContact.displayName, options),
    singleValueField("Empresa", appContact.company, externalContact.company, options),
    singleValueField("Cargo", appContact.role, externalContact.role, options)
  ].filter((field): field is SyncPreviewFieldChange => Boolean(field));
}

function singleValueField(
  label: string,
  appValue?: string | null,
  externalValue?: string | null,
  options: { preserveExistingAppValues?: boolean; showIgnoredExistingValues?: boolean } = {}
): SyncPreviewFieldChange | null {
  const before = cleanValue(appValue);
  const after = cleanValue(externalValue);
  if (!after) return null;
  if (before === after) return null;
  if (options.preserveExistingAppValues && before) {
    if (!options.showIgnoredExistingValues) return null;
    return {
      after,
      apply: false,
      before,
      changed: true,
      label,
      operation: "replace"
    };
  }
  return {
    after,
    before,
    changed: true,
    label,
    operation: "replace"
  };
}

function multiValueFields(
  appContact: ContactRow,
  externalContact: ExternalContactInput,
  knownExternalValues: KnownExternalContactValue[],
  suppressed: Set<string>
): SyncPreviewFieldChange[] {
  const fields: SyncPreviewFieldChange[] = [];
  const appEmails = new Set(contactEmails(appContact).map(normalizeEmail));
  const appPhones = phoneIdentitySet(contactPhones(appContact));
  const externalEmails = new Set((externalContact.emails ?? []).map(normalizeEmail).filter(Boolean));
  const externalPhoneValues = uniquePhoneValues(externalContact.phones ?? []);
  const externalPhones = phoneIdentitySet(externalContact.phones ?? []);

  for (const email of externalEmails) {
    if (!appEmails.has(email) && !isSuppressed(suppressed, appContact.id, "email", "add", email)) {
      fields.push({ after: email, changed: true, label: "Correo", operation: "add" });
    }
  }

  for (const phone of externalPhoneValues) {
    if (!phoneMatchesSet(appPhones, phone) && !isSuppressed(suppressed, appContact.id, "phone", "add", phone)) {
      fields.push({ after: phone, changed: true, label: "Telefono", operation: "add" });
    }
  }

  for (const known of knownExternalValues) {
    if (known.kind === "email") {
      const email = normalizeEmail(known.value);
      if (email && appEmails.has(email) && !externalEmails.has(email) && !isSuppressed(suppressed, appContact.id, "email", "remove", email)) {
        fields.push({ apply: false, before: email, changed: true, label: "Correo", operation: "remove" });
      }
    }
    if (known.kind === "phone") {
      const phone = normalizePhone(known.value);
      if (phone && phoneMatchesSet(appPhones, phone) && !phoneMatchesSet(externalPhones, phone) && !isSuppressed(suppressed, appContact.id, "phone", "remove", phone)) {
        fields.push({ apply: false, before: phone, changed: true, label: "Telefono", operation: "remove" });
      }
    }
  }

  return fields;
}

function matchingFields(appContact: ContactRow, externalContact: ExternalContactInput): SyncPreviewFieldChange[] {
  const fields: SyncPreviewFieldChange[] = [];
  const appEmails = new Set(contactEmails(appContact).map(normalizeEmail));
  const appPhones = phoneIdentitySet(contactPhones(appContact));

  for (const email of externalContact.emails ?? []) {
    const normalized = normalizeEmail(email);
    if (appEmails.has(normalized)) fields.push({ after: normalized, before: normalized, changed: true, label: "Correo", operation: "match" });
  }

  for (const phone of externalContact.phones ?? []) {
    const normalized = normalizePhone(phone);
    if (phoneMatchesSet(appPhones, normalized)) fields.push({ after: normalized, before: normalized, changed: true, label: "Telefono", operation: "match" });
  }

  return fields;
}

function wholeContactFields(externalContact: ExternalContactInput): SyncPreviewFieldChange[] {
  return [
    { after: externalContact.displayName, changed: true, label: "Nombre" },
    { after: externalContact.company, changed: true, label: "Empresa" },
    { after: externalContact.role, changed: true, label: "Cargo" },
    ...(externalContact.emails ?? []).map((email) => ({ after: normalizeEmail(email), changed: true, label: "Correo" })),
    ...uniquePhoneValues(externalContact.phones ?? []).map((phone) => ({ after: phone, changed: true, label: "Telefono" }))
  ].filter((field) => cleanValue(field.after));
}

function mergeDuplicateTargetChanges(changes: SyncPreviewChange[]) {
  const byKey = new Map<string, number>();
  const merged: SyncPreviewChange[] = [];

  for (const change of changes) {
    const key = mergeKey(change);
    if (!key || !byKey.has(key)) {
      if (key) byKey.set(key, merged.length);
      merged.push(change);
      continue;
    }

    const index = byKey.get(key);
    if (index === undefined) {
      merged.push(change);
      continue;
    }

    merged[index] = mergeChange(merged[index], change);
  }

  return merged;
}

function mergeKey(change: SyncPreviewChange) {
  if (change.type === "new" || change.type === "duplicate_complex") return "";
  if (change.type === "modified") return `modified:${metadataString(change, "appContactId")}`;
  if (change.type === "consolidation") {
    return `consolidation:${metadataString(change, "consolidationTargetContactId") || metadataString(change, "appContactId")}`;
  }
  if (change.type === "deleted" || change.type === "deactivated" || change.type === "unchanged") {
    return `${change.type}:${metadataString(change, "appContactId")}`;
  }
  return "";
}

function mergeChange(first: SyncPreviewChange, second: SyncPreviewChange): SyncPreviewChange {
  const sourceMerge = mergeSourcesForPreview(first, second);
  if (sourceMerge.overflowCount > 0) {
    return {
      ...first,
      blocking: Boolean(first.blocking || second.blocking),
      defaultSelected: Boolean(first.defaultSelected || second.defaultSelected),
      metadata: {
        ...first.metadata,
        duplicatePendingCount: metadataNumber(first, "duplicatePendingCount")
          + metadataNumber(second, "duplicatePendingCount")
          + sourceMerge.overflowCount,
        mergeSources: sourceMerge.sources
      }
    };
  }

  return {
    ...first,
    blocking: Boolean(first.blocking || second.blocking),
    defaultSelected: Boolean(first.defaultSelected || second.defaultSelected),
    fields: mergeFields(first.fields, second.fields),
    metadata: {
      ...first.metadata,
      ...second.metadata,
      externalId: metadataString(first, "externalId") || metadataString(second, "externalId"),
      externalIds: mergeExternalIds(first, second),
      externalMetadataByExternalId: mergeExternalMetadata(first, second),
      externalSnapshotsByExternalId: mergeExternalSnapshots(first, second),
      mergeSources: sourceMerge.sources
    }
  };
}

function mergeFields(first: SyncPreviewFieldChange[], second: SyncPreviewFieldChange[]) {
  const seen = new Set<string>();
  const fields: SyncPreviewFieldChange[] = [];

  for (const field of [...first, ...second]) {
    const key = [
      field.label,
      field.operation || "",
      cleanValue(field.before),
      cleanValue(field.after)
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(field);
  }

  return fields;
}

function mergeExternalIds(first: SyncPreviewChange, second: SyncPreviewChange) {
  const ids = new Set<string>();
  for (const change of [first, second]) {
    const single = metadataString(change, "externalId");
    if (single) ids.add(single);
    const multiple = change.metadata?.externalIds;
    if (Array.isArray(multiple)) {
      multiple.forEach((id) => {
        if (typeof id === "string" && id.trim()) ids.add(id);
      });
    }
  }
  return Array.from(ids);
}

function mergeExternalMetadata(first: SyncPreviewChange, second: SyncPreviewChange) {
  return [first, second].reduce<Record<string, unknown>>((merged, change) => {
    const byId = change.metadata?.externalMetadataByExternalId;
    if (isRecord(byId)) {
      for (const [key, value] of Object.entries(byId)) {
        if (key && isRecord(value)) merged[key] = value;
      }
    }
    const externalId = metadataString(change, "externalId");
    const metadata = change.metadata?.externalMetadata;
    if (externalId && isRecord(metadata)) merged[externalId] = metadata;
    return merged;
  }, {});
}

function mergeManyExternalSnapshots(changes: SyncPreviewChange[]) {
  return changes.reduce<Record<string, unknown>>((merged, change) => {
    const byId = change.metadata?.externalSnapshotsByExternalId;
    if (isRecord(byId)) {
      for (const [key, value] of Object.entries(byId)) {
        if (key && isRecord(value)) merged[key] = value;
      }
    }
    const externalId = metadataString(change, "externalId");
    const snapshot = change.metadata?.externalSnapshot;
    if (externalId && isRecord(snapshot)) merged[externalId] = snapshot;
    return merged;
  }, {});
}

function mergeExternalSnapshots(first: SyncPreviewChange, second: SyncPreviewChange) {
  return mergeManyExternalSnapshots([first, second]);
}

function mergeSourcesForPreview(first: SyncPreviewChange, second: SyncPreviewChange) {
  const sources = [...metadataArray(first, "mergeSources"), ...metadataArray(second, "mergeSources")];
  const seen = new Set<string>();
  const uniqueSources = sources.filter((source) => {
    if (!isRecord(source)) return false;
    const key = mergeSourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    overflowCount: Math.max(0, uniqueSources.length - MAX_MERGE_SOURCES),
    sources: uniqueSources.slice(0, MAX_MERGE_SOURCES)
  };
}

function mergeSourceKey(source: Record<string, unknown>) {
  return `${source.kind || ""}:${source.id || ""}`;
}

function metadataArray(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isExternalDeleted(externalContact: ExternalContactInput) {
  return isRecord(externalContact.metadata) && externalContact.metadata.google_deleted === true;
}

function findExistingCandidates(appContacts: ContactRow[], externalContact: ExternalContactInput, excludedContactId = "") {
  const externalEmails = new Set((externalContact.emails ?? []).map(normalizeEmail).filter(Boolean));
  const externalPhones = phoneIdentitySet(externalContact.phones ?? []);
  if (!externalEmails.size && !externalPhones.size) return [];

  return appContacts.filter((candidate) => {
    if (candidate.id === excludedContactId) return false;
    return contactEmails(candidate).some((email) => externalEmails.has(normalizeEmail(email)))
      || contactPhones(candidate).some((phone) => phoneMatchesSet(externalPhones, phone));
  });
}

function linkedContactIdForExternalContact(
  externalContact: ExternalContactInput,
  externalIdToContactId: Record<string, string | null | undefined>
) {
  const direct = externalIdToContactId[externalContact.externalId];
  if (direct) return direct;
  for (const previousId of previousResourceNames(externalContact)) {
    const previous = externalIdToContactId[previousId];
    if (previous) return previous;
  }
  return null;
}

function previousResourceNames(externalContact: ExternalContactInput) {
  if (!isRecord(externalContact.metadata) || !Array.isArray(externalContact.metadata.previous_resource_names)) return [];
  return externalContact.metadata.previous_resource_names.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function groupExternalContactsByLinkedContact(externalContacts: ExternalContactInput[], externalIdToContactId: Record<string, string | null | undefined>) {
  const grouped = new Map<string, ExternalContactInput[]>();
  for (const contactId of Object.values(externalIdToContactId)) {
    if (contactId && !grouped.has(contactId)) grouped.set(contactId, []);
  }
  for (const externalContact of externalContacts) {
    const contactId = linkedContactIdForExternalContact(externalContact, externalIdToContactId);
    if (!contactId) continue;
    if (!grouped.has(contactId)) grouped.set(contactId, []);
    grouped.get(contactId)?.push(externalContact);
  }
  return grouped;
}

function contactEmails(contact: ContactRow) {
  return (contact.contact_emails ?? []).map((item) => item.email).filter(Boolean);
}

function contactPhones(contact: ContactRow) {
  return (contact.contact_phones ?? []).map((item) => item.phone).filter(Boolean);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return normalizePhoneDigits(phone);
}

function cleanValue(value?: string | null) {
  const clean = value?.trim() ?? "";
  if (!clean) return "";
  if (["empresa", "sin empresa", "cargo", "sin cargo", "sin dato", "sin datos", "null", "undefined", "none", "n/a"].includes(clean.toLowerCase())) return "";
  return clean;
}

function uniquePhoneValues(phones: string[]) {
  const seenIdentities = new Set<string>();
  const values: string[] = [];

  for (const rawPhone of phones) {
    const normalized = normalizePhone(rawPhone);
    if (!normalized) continue;

    const identities = phoneIdentitiesFor(rawPhone);
    const alreadySeen = Array.from(identities).some((identity) => seenIdentities.has(identity));
    if (alreadySeen) continue;

    values.push(normalized);
    identities.forEach((identity) => seenIdentities.add(identity));
  }

  return values;
}

function metadataString(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stableChangeId(provider: SyncProvider, ...parts: string[]) {
  return [provider, ...parts].map((part) => part.trim().toLowerCase()).join(":");
}

export function changeKey(kind: "email" | "phone", operation: "add" | "remove", value: string) {
  const normalized = kind === "email" ? normalizeEmail(value) : normalizePhone(value);
  return `${kind}:${operation}:${normalized}`;
}

export function contactChangeKey(contactId: string, kind: "email" | "phone", operation: "add" | "remove", value: string) {
  return `${contactId}:${changeKey(kind, operation, value)}`;
}

export function deletedContactChangeKey(contactId: string) {
  return `${contactId}:contact:deleted`;
}

function isSuppressed(
  suppressed: Set<string>,
  contactId: string,
  kind: "email" | "phone",
  operation: "add" | "remove",
  value: string
) {
  return suppressed.has(changeKey(kind, operation, value))
    || suppressed.has(contactChangeKey(contactId, kind, operation, value));
}
