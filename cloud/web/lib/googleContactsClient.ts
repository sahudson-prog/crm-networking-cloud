import {
  mapGooglePeopleToExternalContacts,
  type GooglePerson
} from "./googleContactAdapter.ts";
import type { ExternalContactInput } from "./syncOrchestrator.ts";

export const GOOGLE_CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

const PEOPLE_CONNECTIONS_URL = "https://people.googleapis.com/v1/people/me/connections";
const DEFAULT_PERSON_FIELDS = "names,emailAddresses,phoneNumbers,organizations,metadata";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;

type FetchLike = typeof fetch;

export type GoogleContactsReadInput = {
  accessToken: string;
  connectedAccountId?: string | null;
  syncToken?: string | null;
  pageSize?: number;
  maxPages?: number;
  personFields?: string;
  fetchImpl?: FetchLike;
};

export type GoogleContactsReadResult = {
  contacts: ExternalContactInput[];
  nextSyncToken: string | null;
  pagesRead: number;
  totalItems: number | null;
  mode: "full" | "incremental";
  warnings: string[];
};

export class GoogleContactsClientError extends Error {
  code:
    | "GOOGLE_CONTACTS_AUTH_REQUIRED"
    | "GOOGLE_CONTACTS_HTTP_ERROR"
    | "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN"
    | "GOOGLE_CONTACTS_INVALID_RESPONSE";
  status?: number;

  constructor(
    code: GoogleContactsClientError["code"],
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "GoogleContactsClientError";
    this.code = code;
    this.status = status;
  }
}

export async function readGoogleContacts(input: GoogleContactsReadInput): Promise<GoogleContactsReadResult> {
  const accessToken = input.accessToken.trim();
  if (!accessToken) {
    throw new GoogleContactsClientError("GOOGLE_CONTACTS_HTTP_ERROR", "Falta token de acceso Google.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const maxPages = Math.max(1, input.maxPages ?? DEFAULT_MAX_PAGES);
  const contacts: ExternalContactInput[] = [];
  const warnings: string[] = [];
  let pageToken = "";
  let nextSyncToken: string | null = null;
  let totalItems: number | null = null;
  let pagesRead = 0;

  do {
    pagesRead += 1;
    const url = googleContactsUrl({
      pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
      pageToken,
      personFields: input.personFields ?? DEFAULT_PERSON_FIELDS,
      syncToken: input.syncToken ?? null
    });

    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const body = await parseJson(response);
    if (!response.ok) {
      throw googleContactsError(response.status, body);
    }

    const payload = body as GoogleConnectionsResponse;
    if (!Array.isArray(payload.connections ?? [])) {
      throw new GoogleContactsClientError("GOOGLE_CONTACTS_INVALID_RESPONSE", "Google Contacts devolvio una respuesta inesperada.", response.status);
    }

    contacts.push(...mapGooglePeopleToExternalContacts({
      connectedAccountId: input.connectedAccountId,
      people: payload.connections ?? []
    }));
    totalItems = typeof payload.totalItems === "number" ? payload.totalItems : totalItems;
    pageToken = payload.nextPageToken ?? "";
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;

    if (pagesRead >= maxPages && pageToken) {
      warnings.push("Se alcanzo el limite de paginas para esta lectura de contactos.");
      break;
    }
  } while (pageToken);

  return {
    contacts,
    mode: input.syncToken ? "incremental" : "full",
    nextSyncToken,
    pagesRead,
    totalItems,
    warnings
  };
}

function googleContactsUrl(input: {
  pageSize: number;
  pageToken?: string | null;
  personFields: string;
  syncToken?: string | null;
}) {
  const url = new URL(PEOPLE_CONNECTIONS_URL);
  url.searchParams.set("personFields", input.personFields);
  url.searchParams.set("pageSize", String(clampPageSize(input.pageSize)));
  url.searchParams.set("requestSyncToken", "true");
  url.searchParams.append("sources", "READ_SOURCE_TYPE_CONTACT");

  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  if (input.syncToken) url.searchParams.set("syncToken", input.syncToken);
  return url.toString();
}

function clampPageSize(pageSize: number) {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(1000, Math.max(1, Math.floor(pageSize)));
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleContactsClientError("GOOGLE_CONTACTS_INVALID_RESPONSE", "Google Contacts devolvio JSON invalido.", response.status);
  }
}

function googleContactsError(status: number, body: unknown) {
  const reason = googleErrorReason(body);
  if (reason === "EXPIRED_SYNC_TOKEN") {
    return new GoogleContactsClientError(
      "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN",
      "El cursor de Google Contacts vencio. Hay que hacer una sincronizacion completa nueva.",
      status
    );
  }

  if (status === 401 || status === 403) {
    return new GoogleContactsClientError(
      "GOOGLE_CONTACTS_AUTH_REQUIRED",
      "El permiso de Google vencio o no es valido. Reconecta Google para revisar contactos.",
      status
    );
  }

  return new GoogleContactsClientError(
    "GOOGLE_CONTACTS_HTTP_ERROR",
    googleErrorMessage(body) || `Google Contacts respondio con error ${status}.`,
    status
  );
}

function googleErrorMessage(body: unknown) {
  if (!isRecord(body)) return "";
  const error = body.error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "";
}

function googleErrorReason(body: unknown) {
  if (!isRecord(body)) return "";
  const error = body.error;
  if (!isRecord(error) || !Array.isArray(error.details)) return "";

  for (const detail of error.details) {
    if (!isRecord(detail)) continue;
    if (detail.reason === "EXPIRED_SYNC_TOKEN") return "EXPIRED_SYNC_TOKEN";
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

type GoogleConnectionsResponse = {
  connections?: GooglePerson[];
  nextPageToken?: string;
  nextSyncToken?: string;
  totalItems?: number;
};
