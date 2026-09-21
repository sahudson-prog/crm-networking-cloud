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
        return jsonResponse({ historyId: "102", id: "msg-1", threadId: "thread-1", payload: { headers: [] } });
      }
      if (String(url).includes("/messages/msg-2")) {
        return jsonResponse({ historyId: "101", id: "msg-2", threadId: "thread-2", payload: { headers: [] } });
      }
      return jsonResponse({
        messages: [{ id: "msg-1" }, { id: "msg-2" }],
        resultSizeEstimate: 9
      });
    }
  });

  assert.equal(result.messages.length, 2);
  assert.equal(result.mode, "full");
  assert.equal(result.nextCursor, "102");
  assert.equal(result.resultSizeEstimate, 9);
  assert.equal(result.pagesRead, 1);
  assert.equal(new URL(urls[0]).searchParams.get("maxResults"), "2");
  assert.match(new URL(urls[0]).searchParams.get("q") ?? "", /after:\d+/);
  assert.match(urls[1], /format=full/);
});

test("Google Gmail client usa historyId para incremental", async () => {
  const urls: string[] = [];
  const result = await readGoogleGmailMessages({
    accessToken: "token",
    historyId: "100",
    maxMessages: 2,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/messages/msg-3")) {
        return jsonResponse({ historyId: "106", id: "msg-3", threadId: "thread-3", payload: { headers: [] } });
      }
      if (String(url).includes("/messages/msg-4")) {
        return jsonResponse({ historyId: "105", id: "msg-4", threadId: "thread-4", payload: { headers: [] } });
      }
      return jsonResponse({
        history: [
          { messagesAdded: [{ message: { id: "msg-3" } }] },
          { messages: [{ id: "msg-4" }] }
        ],
        historyId: "107"
      });
    }
  });

  assert.equal(result.mode, "incremental");
  assert.equal(result.nextCursor, "107");
  assert.deepEqual(result.messages.map((message) => message.id), ["msg-3", "msg-4"]);
  assert.equal(new URL(urls[0]).pathname, "/gmail/v1/users/me/history");
  assert.equal(new URL(urls[0]).searchParams.get("startHistoryId"), "100");
  assert.equal(new URL(urls[0]).searchParams.getAll("historyTypes")[0], "messageAdded");
});

test("Google Gmail client usa profile historyId si la carga base no trae mensajes", async () => {
  const urls: string[] = [];
  const result = await readGoogleGmailMessages({
    accessToken: "token",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/profile")) {
        return jsonResponse({ emailAddress: "sergio@crm.cl", historyId: "250" });
      }
      return jsonResponse({ messages: [], resultSizeEstimate: 0 });
    }
  });

  assert.equal(result.mode, "full");
  assert.equal(result.nextCursor, "250");
  assert.deepEqual(result.messages, []);
  assert.match(urls[1], /\/profile$/);
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

test("Google Gmail client identifica historyId vencido", async () => {
  await assert.rejects(
    readGoogleGmailMessages({
      accessToken: "token",
      historyId: "old-history",
      fetchImpl: async () => jsonResponse({ error: { message: "History expired" } }, 404)
    }),
    (error) => {
      assert.ok(error instanceof GoogleInteractionClientError);
      assert.equal(error.code, "GOOGLE_INTERACTIONS_EXPIRED_SYNC_TOKEN");
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
  assert.equal(new URL(requestedUrl).searchParams.get("showHiddenInvitations"), "true");
});

test("Google Calendar client incluye invitaciones ocultas en lectura historica", async () => {
  let requestedUrl = "";
  await readGoogleCalendarEvents({
    accessToken: "token",
    query: "francisca@empresa.cl",
    timeMin: "2026-08-01T00:00:00.000Z",
    timeMax: "2026-11-13T00:00:00.000Z",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ items: [] });
    }
  });

  const params = new URL(requestedUrl).searchParams;
  assert.equal(params.get("q"), "francisca@empresa.cl");
  assert.equal(params.get("showHiddenInvitations"), "true");
  assert.equal(params.get("singleEvents"), "true");
  assert.equal(params.get("timeMin"), "2026-08-01T00:00:00.000Z");
  assert.equal(params.get("timeMax"), "2026-11-13T00:00:00.000Z");
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
