import type { GoogleCalendarEvent } from "./googleInteractionAdapter.ts";
import type { ExternalInteractionInput } from "./externalInteractionSync.ts";
import { sanitizeLogDetail } from "./syncRunLog.ts";
import { supabase } from "./supabaseClient.ts";

const DIAGNOSTIC_CHUNK_SIZE = 150;

export type CalendarReadDiagnosticInput = {
  calendarTimeMin?: string | null;
  events: GoogleCalendarEvent[];
  mappedItems: ExternalInteractionInput[];
  matchedContactEmailsByEventKey?: Record<string, string[]>;
  provider: string;
  readContext?: Record<string, unknown>;
  sourceService: "calendar";
  syncedItems: ExternalInteractionInput[];
};

export async function saveCalendarReadDiagnostics(input: CalendarReadDiagnosticInput) {
  if (!supabase || !input.events.length) return;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("No pude identificar el usuario para guardar diagnostico de Calendar.");

  const now = new Date().toISOString();
  const mappedByExternalId = new Map(input.mappedItems.map((item) => [normalizeExternalId(item.externalId), item]));
  const syncedExternalIds = new Set(input.syncedItems.map((item) => normalizeExternalId(item.externalId)));
  const rows = input.events
    .map((event) => diagnosticRowForCalendarEvent({
      calendarTimeMin: input.calendarTimeMin,
      event,
      mappedByExternalId,
      matchedContactEmailsByEventKey: input.matchedContactEmailsByEventKey,
      now,
      provider: input.provider,
      readContext: input.readContext,
      sourceService: input.sourceService,
      syncedExternalIds,
      userId
    }))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  for (let index = 0; index < rows.length; index += DIAGNOSTIC_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + DIAGNOSTIC_CHUNK_SIZE);
    const { error: upsertError } = await supabase
      .from("external_interaction_read_diagnostics")
      .upsert(chunk, { onConflict: "user_id,provider,source_service,external_id" });
    if (upsertError) throw upsertError;
  }
}

function diagnosticRowForCalendarEvent(input: {
  calendarTimeMin?: string | null;
  event: GoogleCalendarEvent;
  mappedByExternalId: Map<string, ExternalInteractionInput>;
  matchedContactEmailsByEventKey?: Record<string, string[]>;
  now: string;
  provider: string;
  readContext?: Record<string, unknown>;
  sourceService: "calendar";
  syncedExternalIds: Set<string>;
  userId: string;
}) {
  const externalId = calendarExternalId(input.event);
  if (!externalId) return null;
  const normalizedExternalId = normalizeExternalId(externalId);
  const mappedItem = input.mappedByExternalId.get(normalizedExternalId);
  const isCandidate = input.syncedExternalIds.has(normalizedExternalId);
  const status = candidateStatus(mappedItem, isCandidate);

  return {
    candidate_status: status,
    exclusion_reason: exclusionReason(status),
    external_id: normalizedExternalId,
    last_seen_at: input.now,
    mapped_contact_ids: contactIdsForItem(mappedItem),
    matched_emails: uniqueTextList(input.matchedContactEmailsByEventKey?.[calendarEventKey(input.event)] ?? []),
    occurred_at: normalizeDateTime(input.event.start?.dateTime || input.event.start?.date),
    participant_emails: calendarParticipantEmails(input.event),
    provider: input.provider,
    raw_payload: calendarDiagnosticPayload(input.event),
    read_context: {
      calendar_time_min: input.calendarTimeMin ?? null,
      ...input.readContext
    },
    source_service: input.sourceService,
    subject: clean(input.event.summary),
    user_id: input.userId
  };
}

export function calendarDiagnosticPayload(event: GoogleCalendarEvent) {
  return {
    attendee_count: event.attendees?.length ?? 0,
    created: clean(event.created),
    description_present: Boolean(clean(event.description)),
    end: event.end ?? null,
    html_link_present: Boolean(clean(event.htmlLink)),
    id: clean(event.id),
    organizer_self: event.organizer?.self === true,
    start: event.start ?? null,
    status: clean(event.status),
    summary: sanitizeLogDetail(clean(event.summary)) ?? "",
    updated: clean(event.updated)
  };
}

function candidateStatus(mappedItem: ExternalInteractionInput | undefined, isCandidate: boolean) {
  if (!mappedItem) return "not_mapped";
  if (!contactIdsForItem(mappedItem).length) return "not_mapped";
  if (!isCandidate) return "filtered_out";
  return "candidate";
}

function exclusionReason(status: string) {
  if (status === "candidate") return "Paso al preview/sync de la app.";
  if (status === "filtered_out") return "Quedo fuera despues de aplicar fecha de inicio u otro filtro interno.";
  return "Google lo devolvio, pero no quedo vinculado a ningun contacto del alcance.";
}

function calendarExternalId(event: GoogleCalendarEvent) {
  const id = clean(event.id);
  return id ? `CALENDAR_${id}` : "";
}

function calendarEventKey(event: GoogleCalendarEvent) {
  const id = clean(event.id).toLowerCase();
  if (id) return id;
  return [
    event.summary ?? "",
    event.start?.dateTime ?? event.start?.date ?? ""
  ].join("|").toLowerCase();
}

function calendarParticipantEmails(event: GoogleCalendarEvent) {
  return uniqueTextList([
    event.creator?.email,
    event.organizer?.email,
    ...(event.attendees ?? []).map((attendee) => attendee.email)
  ]);
}

function contactIdsForItem(item?: ExternalInteractionInput) {
  return uniqueTextList((item?.participants ?? []).map((participant) => participant.contactId ?? ""))
    .filter(isUuid);
}

function normalizeDateTime(value?: string | null) {
  const cleanValue = clean(value);
  if (!cleanValue) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(cleanValue)
    ? new Date(`${cleanValue}T00:00:00.000Z`)
    : new Date(cleanValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeExternalId(value: string) {
  return clean(value).toLowerCase();
}

function uniqueTextList(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean)));
}

function clean(value?: string | null) {
  return value?.trim() ?? "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
