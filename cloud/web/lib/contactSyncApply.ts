import { upsertSyncCursor } from "./syncCursorStore.ts";
import { supabase } from "./supabaseClient.ts";
import {
  contactMergeDecisionFromPreviewChange,
  defaultContactMergeResult,
  type ContactMergeResult,
  type ContactMergeSource
} from "./contactMerge.ts";
import { mergeContactsDeep } from "./contactMergeActions.ts";
import type {
  SyncIssue,
  SyncPreviewChange,
  SyncPreviewFieldChange,
  SyncProvider
} from "./syncOrchestrator.ts";

export type ApplyContactSyncPreviewInput = {
  changes: SyncPreviewChange[];
  totalPreviewChanges?: number;
  provider: SyncProvider;
  connectedAccountId?: string | null;
  cursorAfter?: string | null;
  cursorLabel?: string;
  source?: string;
};

export type ApplyContactSyncPreviewResult = {
  ok: boolean;
  appliedChangeIds: string[];
  appliedCount: number;
  failedChangeIds: string[];
  failedCount: number;
  pendingCount: number;
  cursorSaved: boolean;
  contactIds: string[];
  errors: SyncIssue[];
  warnings: string[];
};

type ApplyContactSyncDependencies = {
  applyChange: (change: SyncPreviewChange, context: ApplyContactSyncContext) => Promise<string | null>;
  completeInvocation: (invocationId: string | null, result: ApplyContactSyncPreviewResult, input: ApplyContactSyncPreviewInput) => Promise<void>;
  createInvocation: (input: ApplyContactSyncPreviewInput) => Promise<string | null>;
  failInvocation: (invocationId: string | null, error: unknown) => Promise<void>;
  getUserId: () => Promise<string>;
  saveCursor: (input: ApplyContactSyncPreviewInput) => Promise<void>;
};

type ApplyContactSyncContext = {
  connectedAccountId?: string | null;
  provider: SyncProvider;
  userId: string;
};

const SIMPLE_FIELD_TO_COLUMN: Record<string, string> = {
  Cargo: "role",
  Empresa: "company",
  Nombre: "display_name"
};

export async function applyContactSyncPreview(
  input: ApplyContactSyncPreviewInput,
  dependencies: Partial<ApplyContactSyncDependencies> = {}
): Promise<ApplyContactSyncPreviewResult> {
  const deps = defaultDependencies(dependencies);
  const selectedActionableChanges = input.changes.filter((change) => change.type !== "unchanged");
  const result: ApplyContactSyncPreviewResult = {
    appliedChangeIds: [],
    appliedCount: 0,
    contactIds: [],
    cursorSaved: false,
    errors: [],
    failedChangeIds: [],
    failedCount: 0,
    ok: true,
    pendingCount: Math.max(0, (input.totalPreviewChanges ?? selectedActionableChanges.length) - selectedActionableChanges.length),
    warnings: []
  };
  const invocationId = await deps.createInvocation(input);

  try {
    const userId = await deps.getUserId();
    const contactIds = new Set<string>();

    for (const change of selectedActionableChanges) {
      if (change.blocking) {
        result.failedCount += 1;
        result.failedChangeIds.push(change.id);
        result.errors.push({
          code: "CONTACT_SYNC_CHANGE_BLOCKING",
          message: "El cambio esta bloqueado y no se puede aplicar.",
          objectId: metadataString(change, "appContactId")
        });
        continue;
      }

      try {
        const contactId = await deps.applyChange(change, {
          connectedAccountId: input.connectedAccountId,
          provider: input.provider,
          userId
        });
        if (contactId) contactIds.add(contactId);
        result.appliedCount += 1;
        result.appliedChangeIds.push(change.id);
      } catch (error) {
        result.failedCount += 1;
        result.failedChangeIds.push(change.id);
        result.errors.push({
          code: "CONTACT_SYNC_APPLY_FAILED",
          externalId: metadataString(change, "externalId"),
          message: errorMessage(error, "No pude aplicar el cambio de contacto."),
          objectId: changeObjectId(change)
        });
      }
    }

    result.contactIds = Array.from(contactIds);
    result.ok = result.failedCount === 0;

    if (result.ok && input.cursorAfter && result.pendingCount === 0) {
      await deps.saveCursor(input);
      result.cursorSaved = true;
    } else if (result.ok && input.cursorAfter && result.pendingCount > 0) {
      result.warnings.push("No guarde el cursor nuevo porque quedaron cambios pendientes para la proxima sincronizacion.");
    }

    await deps.completeInvocation(invocationId, result, input);
    return result;
  } catch (error) {
    await deps.failInvocation(invocationId, error);
    throw error;
  }
}

function defaultDependencies(overrides: Partial<ApplyContactSyncDependencies>): ApplyContactSyncDependencies {
  return {
    applyChange: applyContactSyncChange,
    completeInvocation: completeActionInvocation,
    createInvocation: createActionInvocation,
    failInvocation: failActionInvocation,
    getUserId: currentUserId,
    saveCursor: async (input) => {
      await upsertSyncCursor({
        connectedAccountId: input.connectedAccountId,
        cursorLabel: input.cursorLabel,
        cursorValue: input.cursorAfter ?? null,
        metadata: {
          source: input.source || "contact_sync_preview"
        },
        provider: input.provider,
        resourceType: "contacts",
        status: "ok"
      });
    },
    ...overrides
  };
}

async function applyContactSyncChange(change: SyncPreviewChange, context: ApplyContactSyncContext) {
  if (change.type === "new" || change.type === "duplicate_complex") return createContactFromSyncChange(change, context);
  if (change.type === "modified") return updateContactFromSyncChange(change, context);
  if (change.type === "consolidation") return consolidateContactFromSyncChange(change, context);
  if (change.type === "deleted" || change.type === "deactivated") return deactivateContactFromSyncChange(change, context);
  throw new Error(`Tipo de cambio no soportado: ${change.type}`);
}

async function createContactFromSyncChange(change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  const mergeDecision = contactMergeDecisionFromPreviewChange(change);
  const payload = fieldsToContactPayload(change.fields);
  await assertContactIdentityAvailableForCreate(change, mergeDecision, context);
  const { data, error } = await db
    .from("contacts")
    .insert({
      user_id: context.userId,
      display_name: mergeDecision?.name.trim() || payload.display_name || change.title,
      company: mergeDecision?.company.trim() ?? payload.company ?? "",
      role: mergeDecision?.role.trim() ?? payload.role ?? "",
      networking_status: mergeDecision?.networkingStatus || "Pendiente",
      networking_focus: mergeDecision?.focus ?? true,
      is_headhunter: mergeDecision?.headhunter ?? false,
      is_active: true,
      sync_status: "synced"
    })
    .select("id")
    .single();
  if (error) throw error;

  const contactId = data.id as string;
  if (mergeDecision) {
    for (const email of mergeDecision.emails) {
      await upsertContactEmail(contactId, email, context);
    }
    for (const phone of mergeDecision.phones) {
      await upsertContactPhone(contactId, phone, context);
    }
  } else {
    await applyFieldOperations(contactId, change.fields, context);
  }
  await upsertExternalContactId(contactId, change, context);
  await auditChange(contactId, change, context);
  return contactId;
}

async function assertContactIdentityAvailableForCreate(
  change: SyncPreviewChange,
  mergeDecision: ContactMergeResult | null,
  context: ApplyContactSyncContext
) {
  const identities = contactIdentityValuesForCreate(change, mergeDecision);
  const db = requireSupabase();

  if (identities.emails.length) {
    const { data, error } = await db
      .from("contact_emails")
      .select("normalized_email")
      .eq("user_id", context.userId)
      .in("normalized_email", identities.emails)
      .limit(1);
    if (error) throw error;
    if ((data ?? []).length) {
      throw new Error("No puedo crear este contacto porque uno de sus correos ya pertenece a otro contacto guardado. Resuelve la fusion desde Revision de duplicados.");
    }
  }

  if (identities.phones.length) {
    const { data, error } = await db
      .from("contact_phones")
      .select("normalized_phone")
      .eq("user_id", context.userId)
      .in("normalized_phone", identities.phones)
      .limit(1);
    if (error) throw error;
    if ((data ?? []).length) {
      throw new Error("No puedo crear este contacto porque uno de sus telefonos ya pertenece a otro contacto guardado. Resuelve la fusion desde Revision de duplicados.");
    }
  }
}

export function contactIdentityValuesForCreate(change: SyncPreviewChange, mergeDecision: ContactMergeResult | null = null) {
  if (mergeDecision) {
    return {
      emails: uniqueClean(mergeDecision.emails.map(normalizeEmail)),
      phones: uniqueClean(mergeDecision.phones.map(normalizePhone))
    };
  }

  return {
    emails: uniqueClean(change.fields
      .filter((field) => field.apply !== false && field.label === "Correo" && field.operation !== "remove")
      .map((field) => normalizeEmail(field.after ?? ""))),
    phones: uniqueClean(change.fields
      .filter((field) => field.apply !== false && field.label === "Telefono" && field.operation !== "remove")
      .map((field) => normalizePhone(field.after ?? "")))
  };
}

async function updateContactFromSyncChange(change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const contactId = requiredMetadata(change, "appContactId");
  const mergeDecision = contactMergeDecisionFromPreviewChange(change);
  if (mergeDecision) {
    await applyContactMergeDecision(contactId, mergeDecision, context);
    await upsertExternalContactId(contactId, change, context);
    await auditChange(contactId, change, context);
    return contactId;
  }

  await applyContactFieldPatch(contactId, change.fields, context);
  await applyFieldOperations(contactId, change.fields, context);
  await upsertExternalContactId(contactId, change, context);
  await auditChange(contactId, change, context);
  return contactId;
}

async function consolidateContactFromSyncChange(change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const targetContactId = requiredMetadata(change, "consolidationTargetContactId");
  const mergeDecision = contactMergeDecisionFromPreviewChange(change);
  const appMergePlan = contactAppMergePlanFromPreviewChange(change, targetContactId);

  if (appMergePlan.sourceContactIds.length) {
    await mergeContactsDeep({
      result: mergeDecision ?? defaultContactMergeResult(appMergePlan.sources),
      source: "sync.contacts.apply_preview",
      sourceContactIds: appMergePlan.sourceContactIds,
      targetContactId
    });
    await upsertExternalContactId(targetContactId, change, context);
    await auditChange(targetContactId, change, context);
    return targetContactId;
  }

  if (mergeDecision) {
    await applyContactMergeDecision(targetContactId, mergeDecision, context);
    await upsertExternalContactId(targetContactId, change, context);
    await auditChange(targetContactId, change, context);
    return targetContactId;
  }

  await applyContactFieldPatch(targetContactId, change.fields, context);
  await applyFieldOperations(targetContactId, change.fields, context);
  await upsertExternalContactId(targetContactId, change, context);
  await auditChange(targetContactId, change, context);
  return targetContactId;
}

async function deactivateContactFromSyncChange(change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  const contactId = requiredMetadata(change, "appContactId");
  const { error } = await db
    .from("contacts")
    .update({
      is_active: false,
      sync_status: "missing_from_source"
    })
    .eq("id", contactId)
    .eq("user_id", context.userId);
  if (error) throw error;
  await auditChange(contactId, change, context);
  return contactId;
}

async function applyContactMergeDecision(contactId: string, decision: ContactMergeResult, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  const { error } = await db
    .from("contacts")
    .update({
      company: decision.company.trim(),
      display_name: decision.name.trim(),
      is_headhunter: decision.headhunter,
      networking_focus: decision.focus,
      networking_status: decision.networkingStatus,
      role: decision.role.trim(),
      sync_status: "synced"
    })
    .eq("id", contactId)
    .eq("user_id", context.userId);
  if (error) throw error;

  for (const email of decision.emails) {
    await upsertContactEmail(contactId, email, context);
  }
  for (const phone of decision.phones) {
    await upsertContactPhone(contactId, phone, context);
  }
}

async function upsertContactEmail(contactId: string, rawEmail: string, context: ApplyContactSyncContext) {
  const email = normalizeEmail(rawEmail);
  if (!email) return;
  const db = requireSupabase();
  const { error } = await db.from("contact_emails").upsert({
    user_id: context.userId,
    contact_id: contactId,
    email,
    normalized_email: email,
    domain: domainFromEmail(email),
    is_primary: false,
    source: context.provider
  }, { onConflict: "user_id,normalized_email" });
  if (error) throw error;
}

async function upsertContactPhone(contactId: string, rawPhone: string, context: ApplyContactSyncContext) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return;
  const db = requireSupabase();
  const { error } = await db.from("contact_phones").upsert({
    user_id: context.userId,
    contact_id: contactId,
    phone: rawPhone.trim(),
    normalized_phone: normalized,
    normalized_phone_last8: normalized.slice(-8) || null,
    is_primary: false,
    source: context.provider
  }, { onConflict: "user_id,normalized_phone" });
  if (error) throw error;
}

async function applyContactFieldPatch(contactId: string, fields: SyncPreviewFieldChange[], context: ApplyContactSyncContext) {
  const db = requireSupabase();
  const patch = fieldsToContactPayload(fields);
  if (!Object.keys(patch).length) return;

  const { error } = await db
    .from("contacts")
    .update(patch)
    .eq("id", contactId)
    .eq("user_id", context.userId);
  if (error) throw error;
}

function fieldsToContactPayload(fields: SyncPreviewFieldChange[]) {
  return fields.reduce<Record<string, string>>((patch, field) => {
    const column = SIMPLE_FIELD_TO_COLUMN[field.label];
    if (field.apply === false) return patch;
    if (!column || field.operation === "match" || !field.after?.trim()) return patch;
    patch[column] = field.after.trim();
    return patch;
  }, {});
}

async function applyFieldOperations(contactId: string, fields: SyncPreviewFieldChange[], context: ApplyContactSyncContext) {
  for (const field of fields) {
    if (field.apply === false) continue;
    if (field.label === "Correo") await applyEmailOperation(contactId, field, context);
    if (field.label === "Telefono") await applyPhoneOperation(contactId, field, context);
  }
}

async function applyEmailOperation(contactId: string, field: SyncPreviewFieldChange, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  if (field.operation === "remove" && field.before) {
    const { error } = await db
      .from("contact_emails")
      .delete()
      .eq("user_id", context.userId)
      .eq("contact_id", contactId)
      .eq("normalized_email", normalizeEmail(field.before))
      .eq("source", context.provider);
    if (error) throw error;
    return;
  }

  if ((field.operation === "add" || !field.operation) && field.after) {
    const email = normalizeEmail(field.after);
    if (!email) return;
    const { error } = await db.from("contact_emails").insert({
      user_id: context.userId,
      contact_id: contactId,
      email,
      normalized_email: email,
      domain: domainFromEmail(email),
      is_primary: false,
      source: context.provider
    });
    if (error) throw error;
  }
}

async function applyPhoneOperation(contactId: string, field: SyncPreviewFieldChange, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  if (field.operation === "remove" && field.before) {
    const { error } = await db
      .from("contact_phones")
      .delete()
      .eq("user_id", context.userId)
      .eq("contact_id", contactId)
      .eq("normalized_phone", normalizePhone(field.before))
      .eq("source", context.provider);
    if (error) throw error;
    return;
  }

  if ((field.operation === "add" || !field.operation) && field.after) {
    const normalized = normalizePhone(field.after);
    if (!normalized) return;
    const { error } = await db.from("contact_phones").insert({
      user_id: context.userId,
      contact_id: contactId,
      phone: field.after.trim(),
      normalized_phone: normalized,
      normalized_phone_last8: normalized.slice(-8) || null,
      is_primary: false,
      source: context.provider
    });
    if (error) throw error;
  }
}

async function upsertExternalContactId(contactId: string, change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const externalIds = externalIdsFromChange(change);
  if (!externalIds.length) return;

  const db = requireSupabase();
  for (const externalId of externalIds) {
    const { error } = await db
      .from("external_contact_ids")
      .upsert({
        user_id: context.userId,
        contact_id: contactId,
        connected_account_id: context.connectedAccountId ?? null,
        provider: context.provider,
        external_id: externalId,
        is_active: true,
        last_seen_at: new Date().toISOString()
      }, { onConflict: "user_id,provider,external_id" });
    if (error) throw error;
  }
}

function externalIdsFromChange(change: SyncPreviewChange) {
  const ids = new Set<string>();
  const single = metadataString(change, "externalId");
  if (single) ids.add(single);
  const multiple = change.metadata?.externalIds;
  if (Array.isArray(multiple)) {
    multiple.forEach((id) => {
      if (typeof id === "string" && id.trim()) ids.add(id);
    });
  }
  return Array.from(ids);
}

export function contactAppMergePlanFromPreviewChange(change: SyncPreviewChange, targetContactId: string) {
  const sources = contactMergeSourcesFromPreviewChange(change);
  return {
    sourceContactIds: sources
      .filter((source) => source.kind === "Guardado" && source.id !== targetContactId)
      .map((source) => source.id),
    sources
  };
}

function contactMergeSourcesFromPreviewChange(change: SyncPreviewChange): ContactMergeSource[] {
  const sources = change.metadata?.mergeSources;
  if (!Array.isArray(sources)) return [];
  return sources.filter(isContactMergeSource);
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

async function createActionInvocation(input: ApplyContactSyncPreviewInput) {
  const db = requireSupabase();
  const userId = await currentUserId();
  const { data, error } = await db
    .from("action_invocations")
    .insert({
      user_id: userId,
      action_name: "sync.contacts.apply_preview",
      actor_type: "user",
      status: "confirmed",
      object_type: "contact",
      input_json: {
        changes_count: input.changes.length,
        total_preview_changes: input.totalPreviewChanges ?? input.changes.length,
        cursor_after_present: Boolean(input.cursorAfter),
        provider: input.provider,
        source: input.source || "contact_sync_preview"
      },
      requires_confirmation: true,
      confirmed_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function completeActionInvocation(invocationId: string | null, result: ApplyContactSyncPreviewResult, input: ApplyContactSyncPreviewInput) {
  if (!invocationId) return;
  const db = requireSupabase();
  const userId = await currentUserId();
  const { error } = await db
    .from("action_invocations")
    .update({
      status: result.ok ? "executed" : "failed",
      output_json: {
        applied_change_ids: result.appliedChangeIds,
        applied_count: result.appliedCount,
        failed_count: result.failedCount,
        failed_change_ids: result.failedChangeIds,
        pending_count: result.pendingCount,
        cursor_saved: result.cursorSaved,
        contact_ids: result.contactIds,
        errors: result.errors,
        provider: input.provider
      },
      error_message: result.errors.map((item) => item.message).join("; ") || null,
      executed_at: new Date().toISOString()
    })
    .eq("id", invocationId)
    .eq("user_id", userId)
    .eq("action_name", "sync.contacts.apply_preview");
  if (error) throw error;
}

async function failActionInvocation(invocationId: string | null, error: unknown) {
  if (!invocationId) return;
  const db = requireSupabase();
  const userId = await currentUserId();
  await db
    .from("action_invocations")
    .update({
      status: "failed",
      error_message: errorMessage(error, "Error al aplicar preview de contactos.")
    })
    .eq("id", invocationId)
    .eq("user_id", userId);
}

async function auditChange(contactId: string, change: SyncPreviewChange, context: ApplyContactSyncContext) {
  const db = requireSupabase();
  await db.from("audit_log").insert({
    user_id: context.userId,
    actor: "user",
    action: "sync.contacts.apply_preview",
    object_type: "contact",
    object_id: contactId,
    before_json: {
      preview_change_id: change.id,
      preview_change_type: change.type
    },
    after_json: {
      fields: change.fields,
      metadata: change.metadata,
      provider: context.provider
    }
  });
}

function requiredMetadata(change: SyncPreviewChange, key: string) {
  const value = metadataString(change, key);
  if (!value) throw new Error(`El cambio no trae metadata requerida: ${key}.`);
  return value;
}

function metadataString(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function changeObjectId(change: SyncPreviewChange) {
  return metadataString(change, "appContactId")
    || metadataString(change, "consolidationTargetContactId")
    || metadataString(change, "externalId")
    || change.id;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      stringValue(record.message),
      stringValue(record.details),
      stringValue(record.hint),
      stringValue(record.code)
    ].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function uniqueClean(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

async function currentUserId() {
  const db = requireSupabase();
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No hay usuario autenticado.");
  return userId;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function domainFromEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at);
  return domain.length > 1 ? domain : null;
}
