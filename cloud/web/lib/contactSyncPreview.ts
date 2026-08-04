import type { ContactRow } from "./readModel.ts";
import {
  contactRowToMergeSource,
  externalContactToMergeSource,
  type ContactMergeSource
} from "./contactMerge.ts";
import {
  phoneIdentitiesFor,
  normalizePhoneDigits,
  phoneIdentitySet,
  phoneMatchesSet
} from "./phoneIdentity.ts";
import type {
  ExternalContactInput,
  SyncPreviewChange,
  SyncPreviewFieldChange,
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
  suppressedChangeKeys?: string[];
};

export function buildContactSyncPreview(input: ContactSyncPreviewInput): SyncPreviewChange[] {
  const appById = new Map(input.appContacts.map((contact) => [contact.id, contact]));
  const externalByLinkedContact = groupExternalContactsByLinkedContact(input.externalContacts, input.externalIdToContactId ?? {});
  const suppressed = new Set(input.suppressedChangeKeys ?? []);
  const changes: SyncPreviewChange[] = [];

  for (const externalContact of input.externalContacts) {
    const linkedContactId = input.externalIdToContactId?.[externalContact.externalId] ?? null;
    const linkedContact = linkedContactId ? appById.get(linkedContactId) : null;

    if (!linkedContact) {
      const existingCandidates = findExistingCandidates(input.appContacts, externalContact);
      if (existingCandidates.length) {
        changes.push(linkExistingContactChange(input.provider, existingCandidates, externalContact));
        continue;
      }
      changes.push(newContactChange(input.provider, externalContact));
      continue;
    }

    const consolidationContacts = findConsolidationCandidates(input.appContacts, linkedContact, externalContact);
    if (consolidationContacts.length) {
      changes.push(consolidationChange(input.provider, linkedContact, consolidationContacts, externalContact));
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
          mergeSources: [
            contactRowToMergeSource(linkedContact, "Guardado"),
            externalContactToMergeSource(externalContact, "Importado")
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

  for (const [contactId, externalContacts] of externalByLinkedContact.entries()) {
    const contact = appById.get(contactId);
    if (!contact || externalContacts.length) continue;
    if (suppressed.has(deletedContactChangeKey(contactId))) continue;
    changes.push(deletedContactChange(input.provider, contact));
  }

  return splitComplexConsolidations(mergeDuplicateTargetChanges(mergeConnectedConsolidationChanges(changes)));
}

function linkExistingContactChange(
  provider: SyncProvider,
  candidates: ContactRow[],
  externalContact: ExternalContactInput
): SyncPreviewChange {
  const candidate = candidates[0];
  const fields: SyncPreviewFieldChange[] = [
    ...matchingFields(candidate, externalContact),
    ...singleValueFields(candidate, externalContact, { preserveExistingAppValues: true }),
    ...multiValueFields(candidate, externalContact, [], new Set())
  ];

  return {
    defaultSelected: true,
    fields,
    id: stableChangeId(provider, "consolidation", candidate.id, externalContact.externalId),
    metadata: {
      consolidationTargetContactId: candidate.id,
      externalId: externalContact.externalId,
      mergeSources: [
        ...candidates.map((item) => contactRowToMergeSource(item, "Guardado")),
        externalContactToMergeSource(externalContact, "Importado")
      ],
      provider
    },
    title: candidate.display_name || externalContact.displayName,
    type: "consolidation"
  };
}

function newContactChange(provider: SyncProvider, externalContact: ExternalContactInput): SyncPreviewChange {
  return {
    defaultSelected: true,
    fields: wholeContactFields(externalContact),
    id: stableChangeId(provider, "new", externalContact.externalId),
    metadata: {
      externalId: externalContact.externalId,
      mergeSources: [
        externalContactToMergeSource(externalContact, "Importado")
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
      provider
    },
    title: contact.display_name || externalContact.displayName,
    type: "unchanged"
  };
}

function consolidationChange(
  provider: SyncProvider,
  linkedContact: ContactRow,
  candidates: ContactRow[],
  externalContact: ExternalContactInput
): SyncPreviewChange {
  const candidate = candidates[0];
  const savedSources = uniqueContacts([candidate, linkedContact, ...candidates]);
  const fields: SyncPreviewFieldChange[] = [
    ...matchingFields(candidate, externalContact),
    ...singleValueFields(candidate, externalContact, { preserveExistingAppValues: true }),
    ...multiValueFields(candidate, externalContact, [], new Set())
  ];

  return {
    defaultSelected: true,
    fields,
    id: stableChangeId(provider, "consolidation", linkedContact.id, candidate.id, externalContact.externalId),
    metadata: {
      appContactId: linkedContact.id,
      consolidationTargetContactId: candidate.id,
      externalId: externalContact.externalId,
      mergeSources: [
        ...savedSources.map((item) => contactRowToMergeSource(item, "Guardado")),
        externalContactToMergeSource(externalContact, "Importado")
      ],
      provider
    },
    title: candidate.display_name || linkedContact.display_name || externalContact.displayName,
    type: "consolidation"
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

function mergeConnectedConsolidationChanges(changes: SyncPreviewChange[]) {
  const consolidationIndexes = changes
    .map((change, index) => ({ change, index }))
    .filter((item) => item.change.type === "consolidation");
  if (consolidationIndexes.length < 2) return changes;

  const parent = new Map<number, number>();
  const sourceToIndex = new Map<string, number>();
  for (const item of consolidationIndexes) parent.set(item.index, item.index);

  for (const item of consolidationIndexes) {
    for (const source of mergeSourcesFromChange(item.change)) {
      const key = mergeSourceKey(source);
      const previous = sourceToIndex.get(key);
      if (previous === undefined) {
        sourceToIndex.set(key, item.index);
        continue;
      }
      union(parent, previous, item.index);
    }
  }

  const groups = new Map<number, Array<{ change: SyncPreviewChange; index: number }>>();
  for (const item of consolidationIndexes) {
    const root = find(parent, item.index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)?.push(item);
  }

  const replacementByIndex = new Map<number, SyncPreviewChange[] | null>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const firstIndex = Math.min(...group.map((item) => item.index));
    const groupedChanges = group.map((item) => item.change);
    const replacements = consolidationGroupIsComplex(groupedChanges)
      ? complexDuplicateChanges(groupedChanges)
      : [mergeConsolidationGroup(groupedChanges)];
    for (const item of group) replacementByIndex.set(item.index, item.index === firstIndex ? replacements : null);
  }

  if (!replacementByIndex.size) return changes;
  return changes.flatMap((change, index) => {
    if (!replacementByIndex.has(index)) return [change];
    const replacement = replacementByIndex.get(index);
    return replacement ?? [];
  });
}

function mergeConsolidationGroup(group: SyncPreviewChange[]): SyncPreviewChange {
  const allSources = uniqueMergeSources(group.flatMap(mergeSourcesFromChange));
  const targetContactId = chooseConsolidationTarget(allSources, group);
  const visibleSources = visibleSourcesForMerge(allSources, targetContactId);
  const hiddenCount = Math.max(0, allSources.length - visibleSources.length);
  const savedSourceCount = allSources.filter((source) => source.kind === "Guardado").length;
  const importedSourceCount = allSources.filter((source) => source.kind === "Importado").length;
  const first = group[0];
  const provider = metadataString(first, "provider");
  const externalIds = visibleSources
    .filter((source) => source.kind === "Importado")
    .map((source) => source.id);
  const sourceContactId = visibleSources.find((source) => source.kind === "Guardado" && source.id !== targetContactId)?.id
    || metadataString(first, "appContactId")
    || targetContactId;

  return {
    ...first,
    blocking: group.some((change) => change.blocking),
    defaultSelected: group.some((change) => change.defaultSelected),
    fields: mergeManyFields(group.flatMap((change) => change.fields)),
    id: stableChangeId(
      (provider || "sync") as SyncProvider,
      "consolidation",
      targetContactId,
      ...visibleSources.map((source) => source.id)
    ),
    metadata: {
      ...first.metadata,
      appContactId: sourceContactId,
      consolidationTargetContactId: targetContactId,
      duplicatePendingCount: hiddenCount,
      importedDuplicateCount: importedSourceCount,
      internalDuplicateSavedCount: savedSourceCount,
      externalId: externalIds[0] || metadataString(first, "externalId"),
      externalIds,
      mergeSources: visibleSources,
      provider: provider || first.metadata?.provider
    },
    title: visibleSources.find((source) => source.id === targetContactId)?.name || first.title,
    type: "consolidation"
  };
}

function consolidationGroupIsComplex(group: SyncPreviewChange[]) {
  const sources = uniqueMergeSources(group.flatMap(mergeSourcesFromChange));
  const savedCount = sources.filter((source) => source.kind === "Guardado").length;
  return savedCount !== 1 || sources.length > MAX_MERGE_SOURCES;
}

function splitComplexConsolidations(changes: SyncPreviewChange[]) {
  return changes.flatMap((change) => {
    if (change.type !== "consolidation") return [change];
    return consolidationGroupIsComplex([change]) ? complexDuplicateChanges([change]) : [change];
  });
}

function complexDuplicateChanges(group: SyncPreviewChange[]): SyncPreviewChange[] {
  const allSources = uniqueMergeSources(group.flatMap(mergeSourcesFromChange));
  const provider = (metadataString(group[0], "provider") || "sync") as SyncProvider;
  const groupId = stableChangeId(provider, "duplicate_complex_group", ...allSources.map((item) => item.id).sort());
  const groupLabel = duplicateGroupLabel(allSources);
  const linkedExternalIds = new Set(
    group
      .filter((change) => metadataString(change, "appContactId"))
      .map((change) => metadataString(change, "externalId"))
      .filter(Boolean)
  );
  const savedCount = allSources.filter((source) => source.kind === "Guardado").length;
  const savedSources = allSources.filter((source) => source.kind === "Guardado");
  const importedSources = allSources.filter((source) => source.kind === "Importado");
  const importableSources = importedSources.filter((source) => !linkedExternalIds.has(source.id));
  const sourcesForRows = importableSources.length ? importableSources : importedSources;

  return sourcesForRows.map((source) => ({
    defaultSelected: false,
    fields: wholeMergeSourceFields(source),
    id: stableChangeId(provider, "duplicate_complex", source.id, ...allSources.map((item) => item.id)),
    metadata: {
      duplicateGroupId: groupId,
      duplicateGroupImportedCount: importedSources.length,
      duplicateGroupLabel: groupLabel,
      duplicateGroupSavedCount: savedCount,
      duplicateGroupSavedSources: savedSources,
      duplicateGroupTotalCount: allSources.length,
      externalId: source.id,
      mergeSources: [source],
      provider
    },
    reason: "Duplicado complejo detectado durante la importacion.",
    title: source.name,
    type: "duplicate_complex"
  }));
}

function duplicateGroupLabel(sources: ContactMergeSource[]) {
  return mostFrequentValue(sources.flatMap((source) => source.emails.map(normalizeEmail)))
    || mostFrequentValue(sources.map((source) => cleanValue(source.name)).filter(Boolean))
    || mostFrequentValue(sources.flatMap((source) => source.phones.map(normalizePhone)))
    || "Duplicados complejos";
}

function mostFrequentValue(values: string[]) {
  const counts = new Map<string, { count: number; value: string }>();
  for (const value of values) {
    const clean = cleanValue(value);
    if (!clean) continue;
    const key = clean.toLowerCase();
    const current = counts.get(key);
    counts.set(key, { count: (current?.count ?? 0) + 1, value: current?.value ?? clean });
  }
  const best = [...counts.values()].sort((first, second) => second.count - first.count || first.value.localeCompare(second.value))[0];
  return best && best.count > 1 ? best.value : "";
}

function wholeMergeSourceFields(source: ContactMergeSource): SyncPreviewFieldChange[] {
  return [
    { after: source.name, changed: true, label: "Nombre" },
    { after: source.company, changed: true, label: "Empresa" },
    { after: source.role, changed: true, label: "Cargo" },
    ...source.emails.map((email) => ({ after: normalizeEmail(email), changed: true, label: "Correo" })),
    ...source.phones.map((phone) => ({ after: phone, changed: true, label: "Telefono" }))
  ].filter((field) => cleanValue(field.after));
}

function mergeManyFields(fields: SyncPreviewFieldChange[]) {
  return fields.reduce<SyncPreviewFieldChange[]>((merged, field) => mergeFields(merged, [field]), []);
}

function mergeSourcesFromChange(change: SyncPreviewChange): ContactMergeSource[] {
  return metadataArray(change, "mergeSources").filter(isContactMergeSource);
}

function uniqueMergeSources(sources: ContactMergeSource[]) {
  const seen = new Set<string>();
  const unique: ContactMergeSource[] = [];
  for (const source of sources) {
    const key = mergeSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

function chooseConsolidationTarget(sources: ContactMergeSource[], group: SyncPreviewChange[]) {
  const appSources = sources.filter((source) => source.kind === "Guardado");
  if (!appSources.length) return metadataString(group[0], "consolidationTargetContactId");
  const targetVotes = new Map<string, number>();
  for (const change of group) {
    const targetId = metadataString(change, "consolidationTargetContactId");
    if (targetId) targetVotes.set(targetId, (targetVotes.get(targetId) ?? 0) + 1);
  }
  return [...appSources].sort((first, second) => {
    const scoreDiff = mergeSourceScore(second, targetVotes) - mergeSourceScore(first, targetVotes);
    return scoreDiff || first.name.localeCompare(second.name);
  })[0].id;
}

function mergeSourceScore(source: ContactMergeSource, targetVotes: Map<string, number>) {
  return (targetVotes.get(source.id) ?? 0) * 10
    + source.emails.length * 3
    + source.phones.length * 2
    + (source.company?.trim() ? 2 : 0)
    + (source.role?.trim() ? 2 : 0)
    + (source.name.trim() && source.name !== "Sin nombre" ? 1 : 0);
}

function visibleSourcesForMerge(sources: ContactMergeSource[], targetContactId: string) {
  const target = sources.find((source) => source.id === targetContactId);
  const savedSources = sources.filter((source) => source.kind === "Guardado" && source.id !== targetContactId);
  const importedSources = sources.filter((source) => source.kind === "Importado");
  return [target, ...savedSources, ...importedSources].filter((source): source is ContactMergeSource => Boolean(source)).slice(0, MAX_MERGE_SOURCES);
}

function isContactMergeSource(value: unknown): value is ContactMergeSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.id === "string"
    && (source.kind === "Guardado" || source.kind === "Importado")
    && typeof source.name === "string"
    && Array.isArray(source.emails)
    && Array.isArray(source.phones)
    && typeof source.focus === "boolean"
    && typeof source.headhunter === "boolean"
    && typeof source.networkingStatus === "string";
}

function find(parent: Map<number, number>, index: number): number {
  const current = parent.get(index) ?? index;
  if (current === index) return index;
  const root = find(parent, current);
  parent.set(index, root);
  return root;
}

function union(parent: Map<number, number>, first: number, second: number) {
  const firstRoot = find(parent, first);
  const secondRoot = find(parent, second);
  if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
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

function mergeSources(first: SyncPreviewChange, second: SyncPreviewChange) {
  return mergeSourcesForPreview(first, second).sources;
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

function findConsolidationCandidates(appContacts: ContactRow[], linkedContact: ContactRow, externalContact: ExternalContactInput) {
  return findExistingCandidates(appContacts, externalContact, linkedContact.id);
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

function uniqueContacts(contacts: ContactRow[]) {
  const seen = new Set<string>();
  const unique: ContactRow[] = [];
  for (const contact of contacts) {
    if (seen.has(contact.id)) continue;
    seen.add(contact.id);
    unique.push(contact);
  }
  return unique;
}

function groupExternalContactsByLinkedContact(externalContacts: ExternalContactInput[], externalIdToContactId: Record<string, string | null | undefined>) {
  const grouped = new Map<string, ExternalContactInput[]>();
  for (const contactId of Object.values(externalIdToContactId)) {
    if (contactId && !grouped.has(contactId)) grouped.set(contactId, []);
  }
  for (const externalContact of externalContacts) {
    const contactId = externalIdToContactId[externalContact.externalId];
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
