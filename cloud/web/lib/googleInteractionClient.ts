import type { GoogleCalendarEvent, GoogleGmailMessage } from "./googleInteractionAdapter.ts";

export const GOOGLE_GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_INTERACTIONS_READONLY_SCOPES = [
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE
].join(" ");

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_MAX_MESSAGES = 25;
const DEFAULT_MAX_EVENTS = 25;
const DEFAULT_MAX_PAGES = 2;

type FetchLike = typeof fetch;

export type GoogleGmailReadInput = {
  accessToken: string;
  fetchImpl?: FetchLike;
  maxMessages?: number;
  maxPages?: number;
  query?: string | null;
  since?: string | null;
};

export type GoogleGmailReadResult = {
  messages: GoogleGmailMessage[];
  nextCursor: string;
  pagesRead: number;
  resultSizeEstimate: number | null;
  warnings: string[];
};

export type GoogleCalendarReadInput = {
  accessToken: string;
  fetchImpl?: FetchLike;
  maxEvents?: number;
  maxPages?: number;
  query?: string | null;
  syncToken?: string | null;
  timeMin?: string | null;
};

export type GoogleCalendarReadResult = {
  events: GoogleCalendarEvent[];
  mode: "full" | "incremental";
  nextSyncToken: string | null;
  pagesRead: number;
  warnings: string[];
};

export class GoogleInteractionClientError extends Error {
  code:
    | "GOOGLE_INTERACTIONS_AUTH_REQUIRED"
    | "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN"
    | "GOOGLE_INTERACTIONS_HTTP_ERROR"
    | "GOOGLE_INTERACTIONS_INVALID_RESPONSE";
  status?: number;

  constructor(code: GoogleInteractionClientError["code"], message: string, status?: number) {
    super(message);
    this.name = "GoogleInteractionClientError";
    this.code = code;
    this.status = status;
  }
}

export async function readGoogleGmailMessages(input: GoogleGmailReadInput): Promise<GoogleGmailReadResult> {
  const accessToken = clean(input.accessToken);
  if (!accessToken) throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_HTTP_ERROR", "Falta token de acceso Google.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const maxMessages = clamp(input.maxMessages ?? DEFAULT_MAX_MESSAGES, 1, 100);
  const maxPages = clamp(input.maxPages ?? DEFAULT_MAX_PAGES, 1, 10);
  const messages: GoogleGmailMessage[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let pagesRead = 0;
  let resultSizeEstimate: number | null = null;

  while (messages.length < maxMessages) {
    pagesRead += 1;
    const response = await fetchImpl(gmailListUrl({ maxResults: Math.min(maxMessages - messages.length, 100), pageToken, query: input.query, since: input.since }), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const body = await parseJson(response);
    if (!response.ok) throw googleInteractionError(response.status, body, "Gmail");

    const payload = body as GmailListResponse;
    if (!Array.isArray(payload.messages ?? [])) {
      throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_INVALID_RESPONSE", "Gmail devolvio una respuesta inesperada.", response.status);
    }

    resultSizeEstimate = typeof payload.resultSizeEstimate === "number" ? payload.resultSizeEstimate : resultSizeEstimate;
    for (const item of payload.messages ?? []) {
      const messageId = clean(item.id);
      if (!messageId) continue;
      messages.push(await readSingleGmailMessage(fetchImpl, accessToken, messageId));
      if (messages.length >= maxMessages) break;
    }

    pageToken = payload.nextPageToken ?? "";
    if (!pageToken) break;
    if (pagesRead >= maxPages) {
      warnings.push("Se alcanzo el limite de paginas para esta lectura de Gmail.");
      break;
    }
  }

  return {
    messages,
    nextCursor: new Date().toISOString(),
    pagesRead,
    resultSizeEstimate,
    warnings
  };
}

export async function readGoogleCalendarEvents(input: GoogleCalendarReadInput): Promise<GoogleCalendarReadResult> {
  const accessToken = clean(input.accessToken);
  if (!accessToken) throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_HTTP_ERROR", "Falta token de acceso Google.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const maxEvents = clamp(input.maxEvents ?? DEFAULT_MAX_EVENTS, 1, 250);
  const maxPages = clamp(input.maxPages ?? DEFAULT_MAX_PAGES, 1, 10);
  const events: GoogleCalendarEvent[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let pagesRead = 0;
  let nextSyncToken: string | null = null;

  while (events.length < maxEvents) {
    pagesRead += 1;
    const response = await fetchImpl(calendarEventsUrl({
      maxResults: Math.min(maxEvents - events.length, 250),
      pageToken,
      query: input.query,
      syncToken: input.syncToken,
      timeMin: input.timeMin
    }), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const body = await parseJson(response);
    if (!response.ok) throw googleInteractionError(response.status, body, "Google Calendar");

    const payload = body as CalendarEventsResponse;
    if (!Array.isArray(payload.items ?? [])) {
      throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_INVALID_RESPONSE", "Google Calendar devolvio una respuesta inesperada.", response.status);
    }

    events.push(...(payload.items ?? []).slice(0, maxEvents - events.length));
    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
    if (pagesRead >= maxPages) {
      warnings.push("Se alcanzo el limite de paginas para esta lectura de Calendar.");
      break;
    }
  }

  return {
    events,
    mode: input.syncToken ? "incremental" : "full",
    nextSyncToken,
    pagesRead,
    warnings
  };
}

async function readSingleGmailMessage(fetchImpl: FetchLike, accessToken: string, messageId: string) {
  const url = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "full");
  const response = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await parseJson(response);
  if (!response.ok) throw googleInteractionError(response.status, body, "Gmail");
  if (!isRecord(body)) {
    throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_INVALID_RESPONSE", "Gmail devolvio un mensaje inesperado.", response.status);
  }
  return body as GoogleGmailMessage;
}

function gmailListUrl(input: { maxResults: number; pageToken?: string | null; query?: string | null; since?: string | null }) {
  const url = new URL(GMAIL_MESSAGES_URL);
  url.searchParams.set("maxResults", String(input.maxResults));
  const query = gmailQuery(input.query, input.since);
  if (query) url.searchParams.set("q", query);
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  return url.toString();
}

function gmailQuery(query?: string | null, since?: string | null) {
  const parts = [clean(query) || "in:anywhere"];
  const after = gmailAfterDate(since);
  if (after) parts.push(`after:${after}`);
  return parts.filter(Boolean).join(" ");
}

function gmailAfterDate(value?: string | null) {
  const cleanValue = clean(value);
  if (!cleanValue) return "";
  const date = new Date(cleanValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function calendarEventsUrl(input: { maxResults: number; pageToken?: string | null; query?: string | null; syncToken?: string | null; timeMin?: string | null }) {
  const url = new URL(CALENDAR_EVENTS_URL);
  url.searchParams.set("maxResults", String(input.maxResults));
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  if (input.query) url.searchParams.set("q", input.query);
  if (input.syncToken) {
    url.searchParams.set("syncToken", input.syncToken);
    return url.toString();
  }
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", clean(input.timeMin) || defaultCalendarTimeMin());
  return url.toString();
}

function defaultCalendarTimeMin() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString();
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_INVALID_RESPONSE", "Google devolvio JSON invalido.", response.status);
  }
}

function googleInteractionError(status: number, body: unknown, service: string) {
  if (status === 410) {
    return new GoogleInteractionClientError(
      "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN",
      `El cursor de ${service} vencio. Hay que hacer una sincronizacion historica nueva.`,
      status
    );
  }
  if (status === 401 || status === 403) {
    return new GoogleInteractionClientError(
      "GOOGLE_INTERACTIONS_AUTH_REQUIRED",
      `El permiso de ${service} vencio o no es valido. Reconecta Google.`,
      status
    );
  }
  return new GoogleInteractionClientError(
    "GOOGLE_INTERACTIONS_HTTP_ERROR",
    googleErrorMessage(body) || `${service} respondio con error ${status}.`,
    status
  );
}

function googleErrorMessage(body: unknown) {
  if (!isRecord(body)) return "";
  const error = body.error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clean(value: string | null | undefined) {
  return value?.trim() || "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

type GmailListResponse = {
  messages?: Array<{ id?: string | null; threadId?: string | null }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type CalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};
