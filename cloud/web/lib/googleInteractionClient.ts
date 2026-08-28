import type { GoogleCalendarEvent, GoogleGmailMessage } from "./googleInteractionAdapter.ts";

export const GOOGLE_GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_INTERACTIONS_READONLY_SCOPES = [
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE
].join(" ");

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_HISTORY_URL = "https://gmail.googleapis.com/gmail/v1/users/me/history";
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DEFAULT_MAX_MESSAGES = 25;
const DEFAULT_MAX_EVENTS = 25;
const DEFAULT_MAX_PAGES = 2;
const GMAIL_MAX_RESULTS_PER_PAGE = 500;
const CALENDAR_MAX_RESULTS_PER_PAGE = 2500;

type FetchLike = typeof fetch;

export type GoogleGmailReadInput = {
  accessToken: string;
  fetchImpl?: FetchLike;
  historyId?: string | null;
  maxMessages?: number;
  maxPages?: number;
  query?: string | null;
  since?: string | null;
};

export type GoogleGmailReadResult = {
  messages: GoogleGmailMessage[];
  mode: "full" | "incremental";
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
  timeMax?: string | null;
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

  if (clean(input.historyId)) return readGoogleGmailHistoryMessages(input);
  return readGoogleGmailFullMessages(input);
}

async function readGoogleGmailFullMessages(input: GoogleGmailReadInput): Promise<GoogleGmailReadResult> {
  const accessToken = clean(input.accessToken);
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxMessages = clamp(input.maxMessages ?? DEFAULT_MAX_MESSAGES, 1, GMAIL_MAX_RESULTS_PER_PAGE);
  const maxPages = clamp(input.maxPages ?? DEFAULT_MAX_PAGES, 1, 10);
  const messages: GoogleGmailMessage[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let pagesRead = 0;
  let resultSizeEstimate: number | null = null;

  while (messages.length < maxMessages) {
    pagesRead += 1;
    const response = await fetchImpl(gmailListUrl({ maxResults: Math.min(maxMessages - messages.length, GMAIL_MAX_RESULTS_PER_PAGE), pageToken, query: input.query, since: input.since }), {
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
    mode: "full",
    nextCursor: latestMessageHistoryId(messages) || await readGmailProfileHistoryId(fetchImpl, accessToken),
    pagesRead,
    resultSizeEstimate,
    warnings
  };
}

async function readGoogleGmailHistoryMessages(input: GoogleGmailReadInput): Promise<GoogleGmailReadResult> {
  const accessToken = clean(input.accessToken);
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxMessages = clamp(input.maxMessages ?? DEFAULT_MAX_MESSAGES, 1, GMAIL_MAX_RESULTS_PER_PAGE);
  const maxPages = clamp(input.maxPages ?? DEFAULT_MAX_PAGES, 1, 10);
  const messageIds = new Set<string>();
  const messages: GoogleGmailMessage[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let pagesRead = 0;
  let nextCursor = clean(input.historyId);

  while (messageIds.size < maxMessages) {
    pagesRead += 1;
    const response = await fetchImpl(gmailHistoryUrl({
      maxResults: Math.min(maxMessages - messageIds.size, GMAIL_MAX_RESULTS_PER_PAGE),
      pageToken,
      startHistoryId: clean(input.historyId)
    }), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const body = await parseJson(response);
    if (!response.ok) throw googleInteractionError(response.status, body, "Gmail");

    const payload = body as GmailHistoryResponse;
    for (const historyItem of payload.history ?? []) {
      for (const messageId of historyMessageIds(historyItem)) {
        if (messageIds.size >= maxMessages) break;
        messageIds.add(messageId);
      }
      if (messageIds.size >= maxMessages) break;
    }

    nextCursor = clean(payload.historyId) || nextCursor;
    pageToken = payload.nextPageToken ?? "";
    if (!pageToken) break;
    if (pagesRead >= maxPages) {
      warnings.push("Se alcanzo el limite de paginas para esta lectura incremental de Gmail.");
      break;
    }
  }

  for (const messageId of messageIds) {
    messages.push(await readSingleGmailMessage(fetchImpl, accessToken, messageId));
  }

  return {
    messages,
    mode: "incremental",
    nextCursor,
    pagesRead,
    resultSizeEstimate: null,
    warnings
  };
}

export async function readGoogleCalendarEvents(input: GoogleCalendarReadInput): Promise<GoogleCalendarReadResult> {
  const accessToken = clean(input.accessToken);
  if (!accessToken) throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_HTTP_ERROR", "Falta token de acceso Google.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const maxEvents = clamp(input.maxEvents ?? DEFAULT_MAX_EVENTS, 1, CALENDAR_MAX_RESULTS_PER_PAGE);
  const maxPages = clamp(input.maxPages ?? DEFAULT_MAX_PAGES, 1, 10);
  const events: GoogleCalendarEvent[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let pagesRead = 0;
  let nextSyncToken: string | null = null;

  while (events.length < maxEvents) {
    pagesRead += 1;
    const response = await fetchImpl(calendarEventsUrl({
      maxResults: Math.min(maxEvents - events.length, CALENDAR_MAX_RESULTS_PER_PAGE),
      pageToken,
      query: input.query,
      syncToken: input.syncToken,
      timeMin: input.timeMin,
      timeMax: input.timeMax
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

async function readGmailProfileHistoryId(fetchImpl: FetchLike, accessToken: string) {
  const response = await fetchImpl(GMAIL_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await parseJson(response);
  if (!response.ok) throw googleInteractionError(response.status, body, "Gmail");
  if (isRecord(body) && typeof body.historyId === "string" && body.historyId.trim()) return body.historyId.trim();
  throw new GoogleInteractionClientError("GOOGLE_INTERACTIONS_INVALID_RESPONSE", "Gmail no devolvio historyId en el perfil.", response.status);
}

function gmailListUrl(input: { maxResults: number; pageToken?: string | null; query?: string | null; since?: string | null }) {
  const url = new URL(GMAIL_MESSAGES_URL);
  url.searchParams.set("maxResults", String(input.maxResults));
  const query = gmailQuery(input.query, input.since);
  if (query) url.searchParams.set("q", query);
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  return url.toString();
}

function gmailHistoryUrl(input: { maxResults: number; pageToken?: string | null; startHistoryId: string }) {
  const url = new URL(GMAIL_HISTORY_URL);
  url.searchParams.set("maxResults", String(input.maxResults));
  url.searchParams.set("startHistoryId", input.startHistoryId);
  url.searchParams.append("historyTypes", "messageAdded");
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
  return String(Math.floor(date.getTime() / 1000));
}

function calendarEventsUrl(input: { maxResults: number; pageToken?: string | null; query?: string | null; syncToken?: string | null; timeMin?: string | null; timeMax?: string | null }) {
  const url = new URL(CALENDAR_EVENTS_URL);
  url.searchParams.set("maxResults", String(input.maxResults));
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  if (input.query) url.searchParams.set("q", input.query);
  url.searchParams.set("showHiddenInvitations", "true");
  if (input.syncToken) {
    url.searchParams.set("syncToken", input.syncToken);
    return url.toString();
  }
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", clean(input.timeMin) || defaultCalendarTimeMin());
  if (clean(input.timeMax)) url.searchParams.set("timeMax", clean(input.timeMax));
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
  if (status === 410 || (service === "Gmail" && status === 404)) {
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

type GmailHistoryResponse = {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
};

type GmailHistoryRecord = {
  messages?: Array<{ id?: string | null; threadId?: string | null }>;
  messagesAdded?: Array<{ message?: { id?: string | null; threadId?: string | null } | null }>;
};

function historyMessageIds(history: GmailHistoryRecord) {
  const ids = [
    ...(history.messagesAdded ?? []).map((item) => item.message?.id),
    ...(history.messages ?? []).map((message) => message.id)
  ];
  return ids.map(clean).filter(Boolean);
}

function latestMessageHistoryId(messages: GoogleGmailMessage[]) {
  return messages
    .map((message) => clean(message.historyId))
    .filter((value) => /^\d+$/.test(value))
    .filter(Boolean)
    .sort(compareNumericStringsDesc)[0] ?? "";
}

function compareNumericStringsDesc(left: string, right: string) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? -1 : 1;
}

type CalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};
