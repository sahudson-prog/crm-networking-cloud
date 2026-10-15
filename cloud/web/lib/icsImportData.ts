"use client";

import { activeInteractions } from "./interactionState.ts";
import { isMissingInteractionLifecycleColumn } from "./interactionSchemaCompatibility.ts";
export { isMissingInteractionLifecycleColumn } from "./interactionSchemaCompatibility.ts";
import type { NormalizedIcsEvent, IcsParticipant, IcsTemporalValue } from "./icsImport.ts";
import type {
  CalendarInteractionForIcsReview,
  ExistingIcsSourceForReview,
  IcsImportReviewSnapshot
} from "./icsImportReview.ts";
import { buildIcsImportReviewSnapshot } from "./icsImportReview.ts";
import { supabase } from "./supabaseClient.ts";

export const ICS_IMPORT_PROVIDER = "icalendar";
export const ICS_IMPORT_SOURCE_SERVICE = "ics_import";
export const ICS_IMPORT_EXTERNAL_OBJECT_TYPE = "calendar_event";
export const ICS_IMPORT_IDENTITY_VERSION = 1;

const ICS_IDENTITY_PREFIX = "ics_uid_sha256_";
const MAX_REVIEW_INTERACTIONS = 5000;
const MAX_REVIEW_PARTICIPANTS = 15000;
const MAX_REVIEW_SOURCES = 10000;
const MAX_REVIEW_CONTACTS = 10000;
const MAX_REVIEW_CONTACT_EMAILS = 30000;

type JsonObject = Record<string, unknown>;

export type IcsInteractionReadRow = {
  id: string;
  interaction_type: string;
  occurred_at: string | null;
  subject: string | null;
  source_detail: string | null;
  user_notes_raw: string | null;
  is_deleted?: boolean;
  prevent_reimport?: boolean;
  metadata: JsonObject | null;
  updated_at: string;
};

export type IcsParticipantReadRow = {
  interaction_id: string;
  contact_id: string | null;
  email_identity: string | null;
  role: string | null;
};

export type IcsExternalSourceReadRow = {
  interaction_id: string;
  provider: string;
  source_service: string;
  external_object_type: string;
  external_id: string;
  prevent_reimport: boolean;
  is_active: boolean;
  content_hash: string | null;
  metadata: JsonObject | null;
  updated_at: string;
};

export type IcsFocusContactReadRow = {
  id: string;
  is_active: boolean;
  networking_focus: boolean;
};

export type IcsContactEmailReadRow = {
  contact_id: string;
  normalized_email: string;
};

export type IcsImportReadGateway = {
  currentUserId(): Promise<string>;
  readCalendarInteractions(userId: string): Promise<IcsInteractionReadRow[]>;
  readInteractionParticipants(userId: string): Promise<IcsParticipantReadRow[]>;
  readActiveExternalSources(userId: string): Promise<IcsExternalSourceReadRow[]>;
  readContacts(userId: string): Promise<IcsFocusContactReadRow[]>;
  readContactEmails(userId: string): Promise<IcsContactEmailReadRow[]>;
};

export type IcsImportReviewData = {
  existingIcsSources: ExistingIcsSourceForReview[];
  calendarInteractions: CalendarInteractionForIcsReview[];
  focusContactIdsByEmail: Map<string, string>;
};

export type IcsImportMetadataV1 = {
  version: 1;
  uid: string;
  start: IcsTemporalValue;
  end: IcsTemporalValue | null;
  allDay: boolean;
  location: string;
  organizer: IcsParticipant | null;
  attendees: IcsParticipant[];
  status: string | null;
  method: string | null;
};

export type IcsPersistenceDraft = {
  identity: {
    uid: string;
    externalId: string;
  };
  interactionCreate: {
    provider: typeof ICS_IMPORT_PROVIDER;
    provider_event_id: string;
    provider_thread_id: null;
    interaction_type: "calendar";
    direction: "unknown";
    occurred_at: string;
    subject: string | null;
    source_detail: string | null;
    user_notes_raw: string;
    metadata: JsonObject;
  };
  interactionUpdate: {
    provider: typeof ICS_IMPORT_PROVIDER;
    provider_event_id: string;
    interaction_type: "calendar";
    direction: "unknown";
    occurred_at: string;
    subject: string | null;
    source_detail: string | null;
    metadata: JsonObject;
  };
  externalSource: {
    connected_account_id: null;
    provider: typeof ICS_IMPORT_PROVIDER;
    source_service: typeof ICS_IMPORT_SOURCE_SERVICE;
    external_object_type: typeof ICS_IMPORT_EXTERNAL_OBJECT_TYPE;
    external_id: string;
    external_thread_id: null;
    external_url: null;
    source_subject: string | null;
    source_detail: string | null;
    content_hash: null;
    sync_status: "imported";
    prevent_reimport: false;
    is_active: true;
    last_seen_at: null;
    last_synced_at: null;
    metadata: JsonObject;
  };
  participants: Array<{
    contact_id: null;
    email_identity: string;
    role: string;
  }>;
};

export class IcsImportDataError extends Error {
  readonly code: "not_authenticated" | "read_limit_exceeded" | "invalid_persisted_identity" | "unsupported_event";

  constructor(code: IcsImportDataError["code"], message: string) {
    super(message);
    this.name = "IcsImportDataError";
    this.code = code;
  }
}

export async function readIcsImportReviewData(
  gateway: IcsImportReadGateway = supabaseIcsImportReadGateway
): Promise<IcsImportReviewData> {
  const userId = await gateway.currentUserId();
  if (!userId) throw new IcsImportDataError("not_authenticated", "No hay usuario autenticado.");

  const [interactionRows, participantRows, sourceRows, contactRows, contactEmailRows] = await Promise.all([
    gateway.readCalendarInteractions(userId),
    gateway.readInteractionParticipants(userId),
    gateway.readActiveExternalSources(userId),
    gateway.readContacts(userId),
    gateway.readContactEmails(userId)
  ]);
  assertReadLimit(interactionRows, MAX_REVIEW_INTERACTIONS, "citas");
  assertReadLimit(participantRows, MAX_REVIEW_PARTICIPANTS, "participantes");
  assertReadLimit(sourceRows, MAX_REVIEW_SOURCES, "fuentes externas");
  assertReadLimit(contactRows, MAX_REVIEW_CONTACTS, "contactos");
  assertReadLimit(contactEmailRows, MAX_REVIEW_CONTACT_EMAILS, "correos de contactos");

  const interactions = activeInteractions(
    interactionRows.filter((row) => row.interaction_type === "calendar" && row.is_deleted !== true)
  );
  const interactionIds = new Set(interactions.map((row) => row.id));
  const participantsByInteraction = groupParticipantEmails(participantRows, interactionIds);
  const sourcesByInteraction = groupSourcesByInteraction(sourceRows, interactionIds);

  const calendarInteractions = interactions.map<CalendarInteractionForIcsReview>((row) => {
    const metadata = readIcsMetadata(row.metadata);
    return {
      id: row.id,
      interactionType: "calendar",
      title: row.subject,
      description: row.source_detail,
      occurredAt: row.occurred_at,
      endAt: metadata?.end?.instant ?? null,
      allDayDate: metadata?.start.valueType === "date" ? metadata.start.localValue : null,
      allDayEndDate: metadata?.end?.valueType === "date" ? metadata.end.localValue : null,
      participantEmails: participantsByInteraction.get(row.id) ?? [],
      sourceProvider: sourceLabel(sourcesByInteraction.get(row.id) ?? []),
      updatedAt: row.updated_at
    };
  });

  const interactionById = new Map(interactionRows.map((row) => [row.id, row]));
  const existingIcsSources: ExistingIcsSourceForReview[] = [];
  for (const row of sourceRows) {
    if (!isIcsImportSource(row)) continue;
    const metadata = readIcsMetadata(row.metadata);
    if (!metadata) {
      throw invalidPersistedIdentity("Una fuente iCalendar existente no conserva su UID original.");
    }
    const expectedExternalId = await icsExternalIdForUid(metadata.uid);
    if (row.external_id !== expectedExternalId) {
      throw invalidPersistedIdentity("Una fuente iCalendar existente no coincide con su identidad persistida.");
    }
    existingIcsSources.push({
      uid: metadata.uid,
      interactionId: row.interaction_id,
      contentHash: requiredContentHash(row.content_hash),
      updatedAt: row.updated_at,
      preventReimport: row.prevent_reimport || Boolean(interactionById.get(row.interaction_id)?.prevent_reimport),
      material: {
        start: metadata.start,
        end: metadata.end,
        location: metadata.location,
        organizer: metadata.organizer,
        attendees: metadata.attendees,
        status: metadata.status,
        method: metadata.method
      }
    });
  }

  return {
    existingIcsSources,
    calendarInteractions,
    focusContactIdsByEmail: focusContactIdsByUnambiguousEmail(contactRows, contactEmailRows)
  };
}

export async function buildIcsImportReviewFromPersistedData(input: {
  minimumStartIso: string;
  parsed: Parameters<typeof buildIcsImportReviewSnapshot>[0]["parsed"];
  gateway?: IcsImportReadGateway;
}): Promise<IcsImportReviewSnapshot> {
  const existing = await readIcsImportReviewData(input.gateway);
  return buildIcsImportReviewSnapshot({ minimumStartIso: input.minimumStartIso, parsed: input.parsed, ...existing });
}

export async function icsExternalIdForUid(uid: string) {
  if (!uid) throw new IcsImportDataError("unsupported_event", "La cita no tiene UID iCalendar.");
  return `${ICS_IDENTITY_PREFIX}${await sha256(uid)}`;
}

export async function buildIcsPersistenceDraft(event: NormalizedIcsEvent): Promise<IcsPersistenceDraft> {
  if (event.start.valueType === "date") {
    throw new IcsImportDataError(
      "unsupported_event",
      "Las citas de día completo no se importan en esta versión."
    );
  }
  const occurredAt = persistenceInstant(event.start);
  if (!occurredAt) {
    throw new IcsImportDataError(
      "unsupported_event",
      "La cita necesita una fecha y zona horaria resolubles antes de importarse."
    );
  }

  const externalId = await icsExternalIdForUid(event.uid);
  const icsMetadata: IcsImportMetadataV1 = {
    version: ICS_IMPORT_IDENTITY_VERSION,
    uid: event.uid,
    start: event.start,
    end: event.end,
    allDay: false,
    location: event.location,
    organizer: event.organizer,
    attendees: event.attendees,
    status: event.status,
    method: event.method
  };
  const metadata = {
    source: ICS_IMPORT_SOURCE_SERVICE,
    external_provider: ICS_IMPORT_PROVIDER,
    external_source_service: ICS_IMPORT_SOURCE_SERVICE,
    ics_import: icsMetadata
  };
  const subject = event.summary.trim() || null;
  const sourceDetail = event.description.trim() || null;

  return {
    identity: { uid: event.uid, externalId },
    interactionCreate: {
      provider: ICS_IMPORT_PROVIDER,
      provider_event_id: externalId,
      provider_thread_id: null,
      interaction_type: "calendar",
      direction: "unknown",
      occurred_at: occurredAt,
      subject,
      source_detail: sourceDetail,
      user_notes_raw: "",
      metadata
    },
    interactionUpdate: {
      provider: ICS_IMPORT_PROVIDER,
      provider_event_id: externalId,
      interaction_type: "calendar",
      direction: "unknown",
      occurred_at: occurredAt,
      subject,
      source_detail: sourceDetail,
      metadata
    },
    externalSource: {
      connected_account_id: null,
      provider: ICS_IMPORT_PROVIDER,
      source_service: ICS_IMPORT_SOURCE_SERVICE,
      external_object_type: ICS_IMPORT_EXTERNAL_OBJECT_TYPE,
      external_id: externalId,
      external_thread_id: null,
      external_url: null,
      source_subject: subject,
      source_detail: sourceDetail,
      content_hash: null,
      sync_status: "imported",
      prevent_reimport: false,
      is_active: true,
      last_seen_at: null,
      last_synced_at: null,
      metadata: { ics_import: icsMetadata }
    },
    participants: persistenceParticipants(event)
  };
}

export const supabaseIcsImportReadGateway: IcsImportReadGateway = {
  async currentUserId() {
    const client = requireSupabase();
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    const userId = data.user?.id;
    if (!userId) throw new IcsImportDataError("not_authenticated", "No hay usuario autenticado.");
    return userId;
  },

  async readCalendarInteractions(userId) {
    const client = requireSupabase();
    const canonical = await client
      .from("interactions")
      .select("id,interaction_type,occurred_at,subject,source_detail,user_notes_raw,is_deleted,prevent_reimport,metadata,updated_at")
      .eq("user_id", userId)
      .eq("interaction_type", "calendar")
      .eq("is_deleted", false)
      .limit(MAX_REVIEW_INTERACTIONS + 1);
    if (!canonical.error) return (canonical.data ?? []) as IcsInteractionReadRow[];
    if (!isMissingInteractionLifecycleColumn(canonical.error)) throw canonical.error;

    const legacy = await client
      .from("interactions")
      .select("*")
      .eq("user_id", userId)
      .eq("interaction_type", "calendar")
      .limit(MAX_REVIEW_INTERACTIONS + 1);
    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []) as IcsInteractionReadRow[];
  },

  async readInteractionParticipants(userId) {
    const { data, error } = await requireSupabase()
      .from("interaction_participants")
      .select("interaction_id,contact_id,email_identity,role")
      .eq("user_id", userId)
      .limit(MAX_REVIEW_PARTICIPANTS + 1);
    if (error) throw error;
    return (data ?? []) as IcsParticipantReadRow[];
  },

  async readActiveExternalSources(userId) {
    const { data, error } = await requireSupabase()
      .from("external_interaction_sources")
      .select("interaction_id,provider,source_service,external_object_type,external_id,prevent_reimport,is_active,content_hash,metadata,updated_at")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(MAX_REVIEW_SOURCES + 1);
    if (error) throw error;
    return (data ?? []) as IcsExternalSourceReadRow[];
  },

  async readContacts(userId) {
    const { data, error } = await requireSupabase()
      .from("contacts")
      .select("id,is_active,networking_focus")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(MAX_REVIEW_CONTACTS + 1);
    if (error) throw error;
    return (data ?? []) as IcsFocusContactReadRow[];
  },

  async readContactEmails(userId) {
    const { data, error } = await requireSupabase()
      .from("contact_emails")
      .select("contact_id,normalized_email")
      .eq("user_id", userId)
      .limit(MAX_REVIEW_CONTACT_EMAILS + 1);
    if (error) throw error;
    return (data ?? []) as IcsContactEmailReadRow[];
  }
};

export function focusContactIdsByUnambiguousEmail(
  contacts: IcsFocusContactReadRow[],
  emails: IcsContactEmailReadRow[]
) {
  const activeContacts = new Map(contacts.filter((contact) => contact.is_active).map((contact) => [contact.id, contact]));
  const contactsByEmail = new Map<string, Set<string>>();
  for (const row of emails) {
    if (!activeContacts.has(row.contact_id)) continue;
    const email = normalizeEmail(row.normalized_email);
    if (!email) continue;
    const ids = contactsByEmail.get(email) ?? new Set<string>();
    ids.add(row.contact_id);
    contactsByEmail.set(email, ids);
  }
  const resolved = new Map<string, string>();
  for (const [email, ids] of contactsByEmail) {
    if (ids.size !== 1) continue;
    const [contactId] = ids;
    if (activeContacts.get(contactId)?.networking_focus) resolved.set(email, contactId);
  }
  return resolved;
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  return supabase;
}

function assertReadLimit(rows: unknown[], maximum: number, label: string) {
  if (rows.length > maximum) {
    throw new IcsImportDataError(
      "read_limit_exceeded",
      `La revisión supera el límite seguro de ${label}.`
    );
  }
}

function groupParticipantEmails(rows: IcsParticipantReadRow[], interactionIds: Set<string>) {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!interactionIds.has(row.interaction_id)) continue;
    const email = normalizeEmail(row.email_identity);
    if (!email) continue;
    const current = grouped.get(row.interaction_id) ?? new Set<string>();
    current.add(email);
    grouped.set(row.interaction_id, current);
  }
  return new Map(Array.from(grouped, ([interactionId, emails]) => [interactionId, Array.from(emails).sort()]));
}

function groupSourcesByInteraction(rows: IcsExternalSourceReadRow[], interactionIds: Set<string>) {
  const grouped = new Map<string, IcsExternalSourceReadRow[]>();
  for (const row of rows) {
    if (!row.is_active || !interactionIds.has(row.interaction_id)) continue;
    const current = grouped.get(row.interaction_id) ?? [];
    current.push(row);
    grouped.set(row.interaction_id, current);
  }
  return grouped;
}

function sourceLabel(rows: IcsExternalSourceReadRow[]) {
  if (rows.some((row) => row.provider === "google" && row.source_service === "calendar")) return "google";
  if (rows.some(isIcsImportSource)) return "ics_file";
  return rows[0]?.provider ?? null;
}

function isIcsImportSource(row: IcsExternalSourceReadRow) {
  return row.is_active
    && row.provider === ICS_IMPORT_PROVIDER
    && row.source_service === ICS_IMPORT_SOURCE_SERVICE
    && row.external_object_type === ICS_IMPORT_EXTERNAL_OBJECT_TYPE;
}

function readIcsMetadata(metadata: JsonObject | null): IcsImportMetadataV1 | null {
  const value = metadata?.ics_import;
  if (!isObject(value) || value.version !== ICS_IMPORT_IDENTITY_VERSION || typeof value.uid !== "string" || !value.uid) {
    return null;
  }
  if (!isTemporalValue(value.start) || (value.end !== null && !isTemporalValue(value.end))) return null;
  if (typeof value.allDay !== "boolean" || typeof value.location !== "string") return null;
  if (value.status !== null && typeof value.status !== "string") return null;
  if (value.method !== null && typeof value.method !== "string") return null;
  if (value.organizer !== null && !isIcsParticipant(value.organizer)) return null;
  if (!Array.isArray(value.attendees) || !value.attendees.every(isIcsParticipant)) return null;
  return value as IcsImportMetadataV1;
}

function isTemporalValue(value: unknown): value is IcsTemporalValue {
  return isObject(value)
    && (value.valueType === "date" || value.valueType === "date-time")
    && typeof value.localValue === "string"
    && (value.timeZoneKind === "date" || value.timeZoneKind === "utc" || value.timeZoneKind === "tzid" || value.timeZoneKind === "floating")
    && (value.timeZoneId === null || typeof value.timeZoneId === "string")
    && (value.instant === null || typeof value.instant === "string");
}

function isIcsParticipant(value: unknown): value is IcsParticipant {
  return isObject(value)
    && typeof value.email === "string"
    && (value.commonName === null || typeof value.commonName === "string")
    && typeof value.role === "string"
    && (value.participationStatus === null || typeof value.participationStatus === "string");
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidPersistedIdentity(message: string) {
  return new IcsImportDataError("invalid_persisted_identity", message);
}

function requiredContentHash(value: string | null) {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw invalidPersistedIdentity("Una fuente iCalendar existente no conserva una huella de contenido válida.");
  }
  return value;
}

function persistenceInstant(value: IcsTemporalValue) {
  if (value.valueType === "date") return null;
  return value.timeZoneKind === "floating" ? null : value.instant;
}

function persistenceParticipants(event: NormalizedIcsEvent) {
  const participants = [
    ...(event.organizer ? [{ participant: event.organizer, role: "ORGANIZER" }] : []),
    ...event.attendees.map((participant) => ({ participant, role: participant.role.toUpperCase() || "ATTENDEE" }))
  ];
  const seen = new Set<string>();
  return participants.flatMap(({ participant, role }) => {
    const email = normalizeEmail(participant.email);
    if (!email) return [];
    const key = `${email}\n${role}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ contact_id: null as null, email_identity: email, role }];
  });
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
