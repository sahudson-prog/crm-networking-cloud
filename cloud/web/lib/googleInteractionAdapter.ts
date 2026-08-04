import type { ExternalInteractionInput, ExternalInteractionParticipantInput } from "./externalInteractionSync";

export type GoogleContactIndexEntry = {
  contactId: string;
};

export type GoogleContactIndex = Record<string, GoogleContactIndexEntry>;

export type GoogleHeader = {
  name?: string | null;
  value?: string | null;
};

export type GoogleMessagePayload = {
  mimeType?: string | null;
  body?: {
    data?: string | null;
  } | null;
  parts?: GoogleMessagePayload[] | null;
  headers?: GoogleHeader[] | null;
};

export type GoogleGmailMessage = {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  payload?: GoogleMessagePayload | null;
};

export type GoogleCalendarEvent = {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  htmlLink?: string | null;
  start?: {
    dateTime?: string | null;
    date?: string | null;
  } | null;
  organizer?: {
    email?: string | null;
    self?: boolean | null;
  } | null;
  attendees?: Array<{
    email?: string | null;
    self?: boolean | null;
    organizer?: boolean | null;
  }> | null;
};

export function mapGmailMessageToExternalInteraction(input: {
  message: GoogleGmailMessage;
  userEmail: string;
  contactsByEmail: GoogleContactIndex;
}): ExternalInteractionInput | null {
  const messageId = clean(input.message.id);
  if (!messageId) return null;

  const headers = input.message.payload?.headers ?? [];
  const userEmail = normalizeEmail(input.userEmail);
  const contactIndex = normalizeContactIndex(input.contactsByEmail);
  const from = emailsByHeader(headers, "from");
  const fromUser = from.some((address) => address.email === userEmail);
  const fromKnownContacts = participantsForAddresses(from, "FROM", contactIndex);

  if (!fromUser && !fromKnownContacts.length) return null;

  const recipientParticipants = [
    ...participantsForAddresses(emailsByHeader(headers, "to"), "TO", contactIndex),
    ...participantsForAddresses(emailsByHeader(headers, "cc"), "CC", contactIndex),
    ...participantsForAddresses(emailsByHeader(headers, "bcc"), "BCC", contactIndex)
  ];

  const participants = fromUser
    ? dedupeParticipants(recipientParticipants)
    : dedupeParticipants([...fromKnownContacts, ...recipientParticipants]);

  if (!participants.length) return null;

  const subject = headerValue(headers, "subject") || "Correo sincronizado";
  const occurredAt = gmailMessageDate(headers, input.message.internalDate);
  const sourceDetail = extractGmailBodyText(input.message.payload) || clean(input.message.snippet) || "Sin detalle disponible.";
  const threadId = clean(input.message.threadId);

  return {
    provider: "google",
    sourceService: "gmail",
    externalObjectType: "email_message",
    externalId: `GMAIL_${messageId}`,
    externalThreadId: threadId ? `GMAIL_THREAD_${threadId}` : null,
    externalUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`,
    interactionType: "email",
    direction: fromUser ? "outbound" : "inbound",
    occurredAt,
    subject,
    sourceDetail: truncateForStorage(sourceDetail),
    participants,
    metadata: {
      google_message_id: messageId,
      google_thread_id: threadId || null
    },
    source: "google_gmail_adapter"
  };
}

export function mapCalendarEventToExternalInteraction(input: {
  event: GoogleCalendarEvent;
  userEmail: string;
  contactsByEmail: GoogleContactIndex;
}): ExternalInteractionInput | null {
  const eventId = clean(input.event.id);
  if (!eventId) return null;

  const userEmail = normalizeEmail(input.userEmail);
  const contactIndex = normalizeContactIndex(input.contactsByEmail);
  const attendeeAddresses = (input.event.attendees ?? [])
    .map((attendee) => ({ email: normalizeEmail(attendee.email), name: "" }))
    .filter((attendee) => attendee.email && attendee.email !== userEmail);
  const organizerAddress = input.event.organizer?.email && normalizeEmail(input.event.organizer.email) !== userEmail
    ? [{ email: normalizeEmail(input.event.organizer.email), name: "" }]
    : [];

  const participants = dedupeParticipants([
    ...participantsForAddresses(organizerAddress, "FROM", contactIndex),
    ...participantsForAddresses(attendeeAddresses, "TO", contactIndex)
  ]);

  if (!participants.length) return null;

  const summary = clean(input.event.summary) || "Reunion sin titulo";
  const description = clean(input.event.description) || "Sin descripcion en el evento de calendario.";
  const location = clean(input.event.location);
  const dateValue = clean(input.event.start?.dateTime) || clean(input.event.start?.date);

  return {
    provider: "google",
    sourceService: "calendar",
    externalObjectType: "calendar_event",
    externalId: `CALENDAR_${eventId}`,
    externalThreadId: null,
    externalUrl: clean(input.event.htmlLink),
    interactionType: "calendar",
    direction: "unknown",
    occurredAt: normalizeDateTime(dateValue),
    subject: summary,
    sourceDetail: location ? `${description}\n\nUbicacion/Link: ${location}` : description,
    participants,
    metadata: {
      google_calendar_event_id: eventId
    },
    source: "google_calendar_adapter"
  };
}

export function emailsByHeader(headers: GoogleHeader[], headerName: string) {
  return parseAddressList(
    headers
      .filter((header) => clean(header.name).toLowerCase() === headerName.toLowerCase())
      .map((header) => header.value || "")
      .join(", ")
  );
}

export function extractGmailBodyText(payload: GoogleMessagePayload | null | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  const textParts = (payload.parts ?? [])
    .map((part) => extractGmailBodyText(part))
    .filter(Boolean);
  if (textParts.length) return textParts.join("\n").trim();

  if (payload.body?.data) return stripHtml(decodeBase64Url(payload.body.data)).trim();
  return "";
}

function participantsForAddresses(
  addresses: Array<{ email: string; name: string }>,
  role: string,
  contactsByEmail: GoogleContactIndex
): ExternalInteractionParticipantInput[] {
  return addresses
    .map((address) => ({
      contactId: contactsByEmail[address.email]?.contactId || null,
      email: address.email,
      role
    }))
    .filter((participant) => participant.contactId);
}

function parseAddressList(value: string) {
  const results: Array<{ email: string; name: string }> = [];
  const regex = /(?:"?([^"<,]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>|([^<>,\s]+@[^<>,\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const email = normalizeEmail(match[2] || match[3]);
    if (!email) continue;
    results.push({
      email,
      name: clean(match[1]) || ""
    });
  }
  return results;
}

function headerValue(headers: GoogleHeader[], headerName: string) {
  return clean(headers.find((header) => clean(header.name).toLowerCase() === headerName.toLowerCase())?.value);
}

function gmailMessageDate(headers: GoogleHeader[], internalDate?: string | null) {
  const dateHeader = headerValue(headers, "date");
  const parsedHeader = dateHeader ? new Date(dateHeader) : null;
  if (parsedHeader && !Number.isNaN(parsedHeader.getTime())) return parsedHeader.toISOString();

  const internalDateNumber = Number(internalDate);
  if (Number.isFinite(internalDateNumber) && internalDateNumber > 0) {
    return new Date(internalDateNumber).toISOString();
  }

  return null;
}

function normalizeDateTime(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeContactIndex(index: GoogleContactIndex) {
  return Object.fromEntries(
    Object.entries(index).map(([email, value]) => [normalizeEmail(email), value])
  );
}

function normalizeEmail(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function clean(value: string | null | undefined) {
  return value?.trim() || "";
}

function dedupeParticipants(participants: ExternalInteractionParticipantInput[]) {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = [
      participant.contactId || "",
      participant.email?.toLowerCase() || "",
      participant.role?.toUpperCase() || ""
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf-8");
  return decodeURIComponent(escape(globalThis.atob(padded)));
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ");
}

function truncateForStorage(value: string) {
  return value.length > 45000
    ? `${value.slice(0, 45000)}\n\n[... CONTENIDO TRUNCADO POR SEGURIDAD ...]`
    : value;
}
