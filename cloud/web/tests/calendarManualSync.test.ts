import test from "node:test";
import assert from "node:assert/strict";
import { runCalendarManualSync, CalendarV2Error, calendarV2Diagnostic } from "../lib/calendarManualSync.ts";

const input = { accessToken: "synthetic-only", timeMin: "2026-11-01T00:00:00Z", timeMax: "2026-12-01T00:00:00Z" };
const event = (id: string, updated = "2026-11-06T12:00:00Z") => ({ id, status: "confirmed", updated, start: { dateTime: "2026-11-07T12:00:00Z" } });
function fixture(token: string | null = null) {
  const actions: string[] = [], saved: any[] = [];
  return { actions, saved, rpc: async (action: string, payload: Record<string, any>) => {
    actions.push(action);
    if (action === "begin") return { status: "running", token, ...input };
    if (action === "known") return { rows: [] };
    if (action === "apply") { saved.push(...payload.events); return {}; }
    if (action === "abort") return { status: "aborted", created: saved.length };
    if (action === "finish") return { status: "complete", created: saved.length, updated: 0, skipped: 0, synced_at: "2026-11-06T12:00:00Z" };
    return { status: "running" };
  } };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("one click crosses twelve pages including empty pages without an item/page cutoff", async () => {
  const f = fixture(); let reads = 0;
  const result = await runCalendarManualSync(input, { ...f, sleep: async () => {}, fetch: (async url => {
    reads++; const u = new URL(String(url)), page = Number(u.searchParams.get("pageToken") ?? 0);
    assert.equal(u.searchParams.get("singleEvents"), "true");
    assert.equal(u.searchParams.get("showDeleted"), "true");
    return response(page < 11 ? { items: page % 2 ? [event(`e${page}`)] : [], nextPageToken: String(page + 1) }
      : { items: [event("final")], nextSyncToken: "candidate" });
  }) as typeof fetch });
  assert.equal(reads, 12); assert.equal(result.created, 6); assert.equal(f.actions.filter(x => x === "finish").length, 1);
});

test("changes and discovery unify latest versions; only ambiguous evidence uses a point read", async () => {
  const f = fixture("old"); let gets = 0;
  await runCalendarManualSync(input, { ...f, fetch: (async url => {
    const u = new URL(String(url));
    if (u.pathname.includes("/events/")) { gets++; return response({ ...event("ambiguous"), summary: "Verified synthetic" }); }
    const incremental = u.searchParams.has("syncToken");
    if (incremental) assert.equal(u.searchParams.has("timeMin"), false);
    return response({ items: [event("latest", incremental ? "2026-11-06T14:00:00Z" : "2026-11-06T12:00:00Z"),
      { ...event("ambiguous"), summary: incremental ? "A" : "B" }], nextSyncToken: incremental ? "new" : "ignored" });
  }) as typeof fetch });
  assert.equal(gets, 1); assert.equal(f.saved.length, 2);
  assert.equal(f.saved.find(e => e.id === "latest").updated, "2026-11-06T14:00:00Z");
  assert.equal(f.saved.find(e => e.id === "ambiguous").summary, "Verified synthetic");
});

test("transient quota retry stays in the same run; authorization is not retried", async () => {
  const f = fixture(); let attempts = 0, waits = 0;
  await runCalendarManualSync(input, { ...f, sleep: async () => { waits++; }, fetch: (async () => {
    attempts++; return attempts < 3 ? response({}, 429) : response({ items: [], nextSyncToken: "new" });
  }) as typeof fetch });
  assert.equal(attempts, 3); assert.equal(waits, 2);
  const denied = fixture(); attempts = 0;
  await assert.rejects(runCalendarManualSync(input, { ...denied, fetch: (async () => { attempts++; return response({}, 401); }) as typeof fetch }),
    (e: unknown) => e instanceof CalendarV2Error && e.code === "CALENDAR_AUTH");
  assert.equal(attempts, 1); assert.equal(denied.actions.includes("finish"), false);
});

test("cancelling between batches preserves the first batch but never commits the cursor", async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(runCalendarManualSync(input, { ...f, signal: controller.signal,
    progress: value => { if (value.processed === 50) controller.abort(); },
    fetch: (async () => response({ items: Array.from({ length: 100 }, (_, i) => event(`e${i}`)), nextSyncToken: "new" })) as typeof fetch }),
    (e: unknown) => e instanceof CalendarV2Error && e.code === "CALENDAR_CANCELLED" && e.created === 50);
  assert.equal(f.saved.length, 50); assert.equal(f.actions.includes("finish"), false); assert.equal(f.actions.at(-1), "abort");
});

test("repeated page tokens fail explicitly instead of looping or advancing success", async () => {
  const f = fixture();
  await assert.rejects(runCalendarManualSync(input, { ...f,
    fetch: (async () => response({ items: [], nextPageToken: "same" })) as typeof fetch }),
    (e: unknown) => e instanceof CalendarV2Error && e.code === "CALENDAR_PAGE_LOOP");
  assert.equal(f.actions.includes("finish"), false); assert.equal(f.saved.length, 0);
});

test("transport diagnostics preserve class and location, never the original exception or private message", async () => {
  const f = fixture(); let reads = 0;
  await assert.rejects(runCalendarManualSync(input, { ...f, sleep: async () => {}, fetch: (async () => {
    reads++; throw new TypeError('private@example.invalid Bearer synthetic-token https://private.invalid/event');
  }) as typeof fetch }), (error: unknown) => {
    assert.ok(error instanceof CalendarV2Error);
    assert.deepEqual(calendarV2Diagnostic(error), { code: 'CALENDAR_TRANSPORT', phase: 'discovery',
      error_class: 'TypeError', location: 'google.fetch', http_status: null });
    assert.doesNotMatch(JSON.stringify(error), /private|synthetic-token|https:/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(reads, 4);
  assert.deepEqual(f.actions, ['begin', 'renew', 'abort']);
  assert.equal(f.saved.length, 0);
  const custom = new Error('private'); custom.name = 'private@example.invalid';
  assert.equal(calendarV2Diagnostic(new CalendarV2Error('CALENDAR_UNCERTAIN', 'begin', custom)).error_class, 'UnknownError');
});

test("typed RPC transport uncertainty retries the same payload", async () => {
  const f = fixture(); let attempts = 0; const payloads: unknown[] = [];
  const result = await runCalendarManualSync(input, { ...f, sleep: async () => {},
    rpc: async (action, payload) => {
      if (action === 'finish') {
        payloads.push(payload);
        if (++attempts === 1) {
          const error = new CalendarV2Error('CALENDAR_RPC_TRANSPORT', action, undefined, 'calendar.rpc');
          error.retryable = true; throw error;
        }
      }
      return f.rpc(action, payload);
    }, fetch: (async () => response({ items: [], nextSyncToken: 'candidate' })) as typeof fetch });
  assert.equal(result.status, 'complete');
  assert.equal(attempts, 2);
  assert.strictEqual(payloads[0], payloads[1]);
  assert.equal(f.actions.includes('abort'), false);
});

test("an irregular Google error envelope remains an HTTP rejection, not a transport exception", async () => {
  for (const errors of ['unexpected', [null]]) {
    const f = fixture(); let reads = 0;
    await assert.rejects(runCalendarManualSync(input, { ...f, sleep: async () => {}, fetch: (async () => {
      reads++; return response({ error: { errors } }, 403);
    }) as typeof fetch }), (error: unknown) => {
      assert.ok(error instanceof CalendarV2Error);
      assert.equal(error.code, 'CALENDAR_INACCESSIBLE');
      assert.equal(error.httpStatus, 403);
      assert.equal(error.location, 'google.response');
      return true;
    });
    assert.equal(reads, 1);
    assert.deepEqual(f.actions, ['begin', 'renew', 'abort']);
  }
});
