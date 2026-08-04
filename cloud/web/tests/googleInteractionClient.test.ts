import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleInteractionClientError,
  readGoogleCalendarEvents,
  readGoogleGmailMessages
} from "../lib/googleInteractionClient.ts";

test("Google Gmail client lista ids y lee mensajes full con limite", async () => {
  const urls: string[] = [];
  const result = await readGoogleGmailMessages({
    accessToken: "token",
    maxMessages: 2,
    since: "2026-08-01T10:00:00Z",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/messages/msg-1")) {
        return jsonResponse({ id: "msg-1", threadId: "thread-1", payload: { headers: [] } });
      }
      if (String(url).includes("/messages/msg-2")) {
        return jsonResponse({ id: "msg-2", threadId: "thread-2", payload: { headers: [] } });
      }
      return jsonResponse({
        messages: [{ id: "msg-1" }, { id: "msg-2" }],
        resultSizeEstimate: 9
      });
    }
  });

  assert.equal(result.messages.length, 2);
  assert.equal(result.resultSizeEstimate, 9);
  assert.equal(result.pagesRead, 1);
  assert.equal(new URL(urls[0]).searchParams.get("maxResults"), "2");
  assert.match(new URL(urls[0]).searchParams.get("q") ?? "", /after:2026\/08\/01/);
  assert.match(urls[1], /format=full/);
});

test("Google Gmail client identifica permisos invalidos", async () => {
  await assert.rejects(
    readGoogleGmailMessages({
      accessToken: "bad-token",
      fetchImpl: async () => jsonResponse({ error: { message: "Invalid Credentials" } }, 401)
    }),
    (error) => {
      assert.ok(error instanceof GoogleInteractionClientError);
      assert.equal(error.code, "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
      return true;
    }
  );
});

test("Google Calendar client usa syncToken para incremental", async () => {
  let requestedUrl = "";
  const result = await readGoogleCalendarEvents({
    accessToken: "token",
    syncToken: "sync-prev",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({
        items: [{ id: "event-1", summary: "Cafe" }],
        nextSyncToken: "sync-next"
      });
    }
  });

  assert.equal(result.mode, "incremental");
  assert.equal(result.events.length, 1);
  assert.equal(result.nextSyncToken, "sync-next");
  assert.equal(new URL(requestedUrl).searchParams.get("syncToken"), "sync-prev");
  assert.equal(new URL(requestedUrl).searchParams.get("timeMin"), null);
});

test("Google Calendar client identifica cursor vencido", async () => {
  await assert.rejects(
    readGoogleCalendarEvents({
      accessToken: "token",
      syncToken: "expired",
      fetchImpl: async () => jsonResponse({ error: { message: "Sync token expired" } }, 410)
    }),
    (error) => {
      assert.ok(error instanceof GoogleInteractionClientError);
      assert.equal(error.code, "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN");
      return true;
    }
  );
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
