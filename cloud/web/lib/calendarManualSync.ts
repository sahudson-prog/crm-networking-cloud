import type { GoogleCalendarEvent } from "./googleInteractionAdapter.ts";

export type CalendarV2Event = GoogleCalendarEvent & { etag?: string; originalStartTime?: unknown };
export type CalendarV2Progress = { phase: "changes" | "discovery" | "recovery" | "saving"; pages: number; processed: number };
export type CalendarV2Result = { status: "complete"; created: number; updated: number; skipped: number; synced_at: string; associations_preserved?: number };
export type CalendarV2Dependencies = {
  rpc: (action: string, payload: Record<string, unknown>) => Promise<any>;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  progress?: (value: CalendarV2Progress) => void;
  signal?: AbortSignal;
};
export class CalendarV2Error extends Error {
  created = 0;
  httpStatus: number | null = null;
  retryable = false;
  errorClass: string | null;
  location: CalendarV2ErrorLocation;
  code: string;
  phase: string;
  constructor(code: string, phase: string, cause?: unknown, location: CalendarV2ErrorLocation = "calendar.engine") {
    super(code === "CALENDAR_AUTH" ? "Reconecta Calendar para continuar."
      : code === "CALENDAR_CANCELLED" ? "Actualizacion cancelada. Se conservaron los cambios confirmados."
      : "No pudimos completar Calendar. Se conservaron los cambios confirmados; puedes reintentar.");
    this.code = code;
    this.phase = phase;
    // Never retain raw messages, stacks, provider payloads or the original exception.
    const name = cause instanceof Error ? cause.name : "";
    this.errorClass = ["Error", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError", "SecurityError"].includes(name)
      ? name : cause === undefined ? null : "UnknownError";
    this.location = location;
  }
}
type CalendarV2ErrorLocation = "google.fetch" | "google.response" | "google.response.json" | "calendar.rpc" | "calendar.engine" | "calendar.runtime";

export function calendarV2Diagnostic(error: CalendarV2Error) {
  return { code: error.code, phase: error.phase, error_class: error.errorClass, location: error.location, http_status: error.httpStatus };
}
const root = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const fields = "nextPageToken,nextSyncToken,items(id,etag,status,updated,summary,description,location,htmlLink,start,end,organizer,attendees,attendeesOmitted,recurringEventId,originalStartTime)";

// Both reads belong to the same explicit click. No scheduler, stored OAuth tokens or hard item cutoff.
export async function runCalendarManualSync(input: {
  accessToken: string; timeMin: string; timeMax: string;
}, deps: CalendarV2Dependencies): Promise<CalendarV2Result> {
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let pages = 0, processed = 0, phase: CalendarV2Progress["phase"] = "changes";
  const notify = () => deps.progress?.({ phase, pages, processed });
  const cancelled = () => { if (deps.signal?.aborted) throw new CalendarV2Error("CALENDAR_CANCELLED", phase); };
  const rpc = async (action: string, payload: Record<string, unknown> = {}) => {
    // Same run and batch identity on retries, including a lost COMMIT response.
    for (let attempt = 0; ; attempt++) {
      if (action !== "abort") cancelled();
      try { return await deps.rpc(action, payload); }
      catch (error) {
        if ((error instanceof CalendarV2Error && !error.retryable) || attempt === 3) throw error;
        await sleep(250 * 2 ** attempt);
      }
    }
  };
  const request = async (url: string): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      cancelled();
      const controller = new AbortController();
      const abort = () => controller.abort();
      deps.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 25_000);
      try {
        const response = await deps.fetch(url, { headers: { Authorization: `Bearer ${input.accessToken}` }, signal: controller.signal });
        let body: any = null;
        try { body = await response.json(); }
        catch (error) {
          if (response.ok) throw new CalendarV2Error("CALENDAR_INVALID_RESPONSE", phase, error, "google.response.json");
        }
        if (response.ok) {
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new CalendarV2Error("CALENDAR_INVALID_RESPONSE", phase, undefined, "google.response");
          return body;
        }
        if (response.status === 401) throw new CalendarV2Error("CALENDAR_AUTH", phase, undefined, "google.response");
        if (response.status === 410) throw new CalendarV2Error("CALENDAR_TOKEN_EXPIRED", phase, undefined, "google.response");
        const quota = response.status === 429 || (response.status === 403 &&
          Array.isArray(body?.error?.errors) && body.error.errors.some((e: { reason?: string } | null) =>
            ["rateLimitExceeded", "userRateLimitExceeded"].includes(e?.reason ?? "")));
        if (!(quota || response.status >= 500) || attempt === 3) {
          const failure = new CalendarV2Error(response.status === 403 || response.status === 404 ? "CALENDAR_INACCESSIBLE" : "CALENDAR_HTTP", phase, undefined, "google.response");
          failure.httpStatus = response.status;
          throw failure;
        }
      } catch (error) {
        if (error instanceof CalendarV2Error) throw error;
        cancelled();
        if (attempt === 3) throw new CalendarV2Error("CALENDAR_TRANSPORT", phase, error, "google.fetch");
      } finally {
        clearTimeout(timeout);
        deps.signal?.removeEventListener("abort", abort);
      }
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  };
  const events = new Map<string, CalendarV2Event>();
  const ambiguous = new Set<string>();
  const add = (event: CalendarV2Event) => {
    if (!event || typeof event.id !== "string" || !event.id || !["confirmed", "tentative", "cancelled"].includes(event.status ?? "")) {
      throw new CalendarV2Error("CALENDAR_INVALID_EVENT", phase);
    }
    const old = events.get(event.id);
    if (!old || JSON.stringify(old) === JSON.stringify(event)) { events.set(event.id, event); return; }
    const a = Date.parse(old.updated ?? ""), b = Date.parse(event.updated ?? "");
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      if (b > a) events.set(event.id, event);
    } else ambiguous.add(event.id);
  };
  const list = async (token: string | null, timeMin: string, timeMax: string) => {
    let next = "", cursor = "";
    const seen = new Set<string>();
    do {
      cancelled();
      await rpc("renew");
      const url = new URL(root);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("showHiddenInvitations", "true");
      url.searchParams.set("fields", fields);
      if (token) url.searchParams.set("syncToken", token);
      else { url.searchParams.set("timeMin", timeMin); url.searchParams.set("timeMax", timeMax); }
      if (next) url.searchParams.set("pageToken", next);
      const body = await request(url.toString());
      if (!Array.isArray(body.items ?? [])) throw new CalendarV2Error("CALENDAR_INVALID_RESPONSE", phase);
      for (const event of body.items ?? []) add(event);
      pages++; notify();
      next = body.nextPageToken ?? "";
      if (typeof next !== "string" || (next && seen.has(next))) throw new CalendarV2Error("CALENDAR_PAGE_LOOP", phase);
      if (next) seen.add(next);
      else cursor = body.nextSyncToken;
    } while (next);
    if (typeof cursor !== "string" || !cursor) throw new CalendarV2Error("CALENDAR_CURSOR_MISSING", phase);
    return cursor;
  };
  let admitted = false;
  try {
    const state = await rpc("begin", { timeMin: input.timeMin, timeMax: input.timeMax });
    if (state.status === "complete") return validateCalendarResult(state);
    if (state.status !== "running" || !Number.isFinite(Date.parse(state.timeMin)) || !Number.isFinite(Date.parse(state.timeMax))) {
      throw new CalendarV2Error("CALENDAR_INVALID_CONTEXT", "begin");
    }
    admitted = true;
    let recovering = !state.token, token: string;
    if (state.token) {
      try { token = await list(state.token, state.timeMin, state.timeMax); }
      catch (error) {
        if (!(error instanceof CalendarV2Error) || error.code !== "CALENDAR_TOKEN_EXPIRED") throw error;
        events.clear(); ambiguous.clear(); recovering = true;
        token = "";
      }
    } else token = "";
    phase = "discovery"; notify();
    const windowToken = await list(null, state.timeMin, state.timeMax);
    if (recovering) token = windowToken;
    // Only initial adoption / token loss needs point reads for previously linked IDs absent from the window.
    const exceptional = new Set(ambiguous);
    let unresolved = 0;
    if (recovering) {
      let after: string | null = null;
      const seen = new Set<string>();
      for (;;) {
        const known = await rpc("known", { after });
        if (!Array.isArray(known.rows)) throw new CalendarV2Error("CALENDAR_INVALID_CONTEXT", "known");
        for (const row of known.rows) {
          if (typeof row.id !== "string" || typeof row.source !== "string" || seen.has(row.source)) throw new CalendarV2Error("CALENDAR_INVALID_CONTEXT", "known");
          seen.add(row.source);
          if (!events.has(row.id)) {
            if (row.retryAfter && Date.parse(row.retryAfter) > Date.now()) unresolved++;
            else exceptional.add(row.id);
          }
        }
        if (known.rows.length < 250) break;
        after = known.rows.at(-1).source;
      }
    }
    phase = "recovery"; notify();
    for (const id of exceptional) {
      await rpc("renew");
      try {
        const event = await request(`${root}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields.slice(fields.indexOf('items(')+6,-1))}`);
        if (event.id !== id) throw new CalendarV2Error("CALENDAR_INVALID_EVENT", phase);
        events.set(id, event);
      } catch (error) {
        if (!(error instanceof CalendarV2Error) || error.code !== "CALENDAR_INACCESSIBLE") throw error;
        await rpc("defer", { id, status: error.httpStatus });
        events.delete(id); unresolved++;
      }
    }
    phase = "saving"; notify();
    const ordered = [...events.values()].sort((a, b) => a.id!.localeCompare(b.id!));
    let batches = 0;
    for (let offset = 0; offset < ordered.length; offset += 50) {
      const chunk = ordered.slice(offset, offset + 50);
      await rpc("apply", { batch: batches, events: chunk });
      batches++; processed += chunk.length; notify();
    }
    if (unresolved) throw new CalendarV2Error("CALENDAR_UNRESOLVED", "recovery");
    return validateCalendarResult(await rpc("finish", { token, batches }));
  } catch (error) {
    const failure = error instanceof CalendarV2Error ? error : new CalendarV2Error("CALENDAR_UNCERTAIN", phase, error);
    if (admitted) { try { const result = await rpc("abort"); if (Number.isSafeInteger(result.created)) failure.created = result.created; } catch { /* Lease expiration fences abandoned work. */ } }
    throw failure;
  }
}

function validateCalendarResult(value: any): CalendarV2Result {
  if (value?.status !== "complete" || ![value.created, value.updated, value.skipped].every(x => Number.isSafeInteger(x) && x >= 0)
    || !Number.isFinite(Date.parse(value.synced_at))) throw new CalendarV2Error("CALENDAR_INVALID_RESULT", "finish");
  return value;
}
