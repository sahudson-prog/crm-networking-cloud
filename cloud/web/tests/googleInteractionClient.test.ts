import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleInteractionClientError,
  createGoogleGmailRequestGovernor,
  listGoogleGmailUserLabels,
  readGoogleCalendarEvents,
  readGoogleGmailMessages,
  readGoogleGmailProfileHistoryId
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

test("Google Gmail client lista solo etiquetas user con el casing real de la API", async () => {
  const urls: string[] = [];
  const reservedUnits: number[] = [];
  let authorization = "";
  const labels = await listGoogleGmailUserLabels({
    accessToken: "renewed-token",
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse({
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Networking", type: "user" }
        ]
      });
    },
    requestGovernor: {
      reserve: async (units) => {
        reservedUnits.push(units);
      },
      wait: async () => {}
    }
  });

  assert.deepEqual(labels, [{ id: "Label_1", name: "Networking", type: "user" }]);
  assert.equal(new URL(urls[0]).pathname, "/gmail/v1/users/me/labels");
  assert.equal(authorization, "Bearer renewed-token");
  assert.deepEqual(reservedUnits, [1]);
});

test("Google Gmail client distingue respuesta valida sin etiquetas user", async () => {
  const labels = await listGoogleGmailUserLabels({
    accessToken: "token",
    fetchImpl: async () => jsonResponse({
      labels: [{ id: "INBOX", name: "INBOX", type: "system" }]
    })
  });

  assert.deepEqual(labels, []);
});

test("Google Gmail client propaga error de labels en vez de devolver lista vacia", async () => {
  await assert.rejects(
    listGoogleGmailUserLabels({
      accessToken: "token",
      fetchImpl: async () => jsonResponse({ error: { message: "Invalid Credentials" } }, 401)
    }),
    (error) => {
      assert.ok(error instanceof GoogleInteractionClientError);
      assert.equal(error.code, "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
      return true;
    }
  );
});

test("Google Gmail client envia labelId y fecha de inicio en messages.list", async () => {
  const urls: string[] = [];
  await readGoogleGmailMessages({
    accessToken: "token",
    labelIds: ["Label_1"],
    since: "2026-08-01T10:00:00Z",
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/profile")) return jsonResponse({ historyId: "300" });
      return jsonResponse({ messages: [], resultSizeEstimate: 0 });
    }
  });

  const params = new URL(urls[0]).searchParams;
  assert.deepEqual(params.getAll("labelIds"), ["Label_1"]);
  assert.match(params.get("q") ?? "", /after:\d+/);
});

test("Google Gmail client marca truncacion por paginas y mensajes", async () => {
  const byPages = await readGoogleGmailMessages({
    accessToken: "token",
    maxMessages: 10,
    maxPages: 1,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (!path.endsWith("/messages")) return jsonResponse({ historyId: "301", id: "mail-1", payload: { headers: [] } });
      return jsonResponse({ messages: [{ id: "mail-1" }], nextPageToken: "next" });
    }
  });
  const byMessages = await readGoogleGmailMessages({
    accessToken: "token",
    maxMessages: 1,
    maxPages: 3,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (!path.endsWith("/messages")) return jsonResponse({ historyId: "302", id: "mail-2", payload: { headers: [] } });
      return jsonResponse({ messages: [{ id: "mail-2" }], nextPageToken: "next" });
    }
  });

  assert.equal(byPages.complete, false);
  assert.deepEqual(byPages.truncatedBy, ["max_pages"]);
  assert.equal(byMessages.complete, false);
  assert.deepEqual(byMessages.truncatedBy, ["max_messages"]);
});

test("Google Gmail client expone historyId de perfil para baseline", async () => {
  const historyId = await readGoogleGmailProfileHistoryId({
    accessToken: "token",
    fetchImpl: async () => jsonResponse({ historyId: "450" })
  });
  assert.equal(historyId, "450");
});

test("Google Gmail client excluye ids ya descargados antes de leer detalles", async () => {
  const detailRequests: string[] = [];
  const fetchImpl = async (url: URL | RequestInfo) => {
    const requestedUrl = new URL(String(url));
    if (requestedUrl.pathname.endsWith("/messages")) {
      const query = requestedUrl.searchParams.get("q");
      return jsonResponse({
        messages: query === "batch-1"
          ? [{ id: "shared" }, { id: "first" }]
          : [{ id: "shared" }, { id: "second" }]
      });
    }
    const messageId = requestedUrl.pathname.split("/").pop() ?? "";
    detailRequests.push(messageId);
    return jsonResponse({ historyId: "200", id: messageId, payload: { headers: [] } });
  };

  const first = await readGoogleGmailMessages({ accessToken: "token", fetchImpl, query: "batch-1" });
  const second = await readGoogleGmailMessages({
    accessToken: "token",
    excludeMessageIds: first.messages.map((message) => message.id ?? ""),
    fetchImpl,
    query: "batch-2"
  });

  assert.deepEqual(first.messages.map((message) => message.id), ["shared", "first"]);
  assert.deepEqual(second.messages.map((message) => message.id), ["second"]);
  assert.deepEqual(detailRequests, ["shared", "first", "second"]);
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

test("Google Gmail client pagina history completo y usa el historyId de la ultima pagina", async () => {
  const historyUrls: URL[] = [];
  const result = await readGoogleGmailMessages({
    accessToken: "token",
    historyId: "100",
    maxMessages: 10,
    maxPages: 3,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.includes("/messages/")) {
        const id = parsed.pathname.split("/").at(-1)!;
        return jsonResponse({ historyId: id === "msg-1" ? "110" : "120", id, payload: { headers: [] } });
      }
      historyUrls.push(parsed);
      if (!parsed.searchParams.get("pageToken")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "msg-1" } }] }],
          historyId: "110",
          nextPageToken: "page-2"
        });
      }
      return jsonResponse({
        history: [{ messagesAdded: [{ message: { id: "msg-2" } }] }],
        historyId: "120"
      });
    }
  });

  assert.equal(result.complete, true);
  assert.equal(result.pagesRead, 2);
  assert.equal(result.nextCursor, "120");
  assert.deepEqual(result.messages.map((message) => message.id), ["msg-1", "msg-2"]);
  assert.equal(historyUrls[1]?.searchParams.get("pageToken"), "page-2");
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

test("Google Gmail client clasifica rate limit sin convertirlo en auth required", async () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
    const waits: number[] = [];
    let requests = 0;
    const requestGovernor = createGoogleGmailRequestGovernor({
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      }
    });

    await assert.rejects(
      readGoogleGmailMessages({
        accessToken: "token",
        fetchImpl: async () => {
          requests += 1;
          return jsonResponse({
            error: {
              errors: [{ domain: "usageLimits", reason }],
              message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user'."
            }
          }, 403);
        },
        requestGovernor
      }),
      (error) => {
        assert.ok(error instanceof GoogleInteractionClientError);
        assert.equal(error.code, "GOOGLE_INTERACTIONS_RATE_LIMITED");
        assert.match(error.message, /Quota exceeded/);
        return true;
      }
    );

    assert.equal(requests, 4, reason);
    assert.deepEqual(waits, [1_000, 2_000, 4_000], reason);
  }
});

test("Google Gmail client limita 250 detalles a 3000 unidades por ventana movil", async () => {
  let currentTime = 0;
  const requestLog: Array<{ at: number; units: number }> = [];
  const requestGovernor = createGoogleGmailRequestGovernor({
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    }
  });

  const result = await readGoogleGmailMessages({
    accessToken: "token",
    fetchImpl: async (url) => {
      const requestedUrl = new URL(String(url));
      if (requestedUrl.pathname.endsWith("/messages")) {
        requestLog.push({ at: currentTime, units: 5 });
        return jsonResponse({
          messages: Array.from({ length: 250 }, (_, index) => ({ id: `mail-${index}` }))
        });
      }
      requestLog.push({ at: currentTime, units: 20 });
      const messageId = requestedUrl.pathname.split("/").pop() ?? "";
      return jsonResponse({ historyId: "300", id: messageId, payload: { headers: [] } });
    },
    maxMessages: 250,
    requestGovernor
  });

  assert.equal(result.messages.length, 250);
  assert.equal(requestLog.filter((request) => request.units === 20).length, 250);
  assert.ok(currentTime >= 60_000);
  for (const request of requestLog) {
    const unitsInWindow = requestLog
      .filter((candidate) => candidate.at > request.at - 60_000 && candidate.at <= request.at)
      .reduce((total, candidate) => total + candidate.units, 0);
    assert.ok(unitsInWindow <= 3_000, `ventana en ${request.at}ms uso ${unitsInWindow} unidades`);
  }
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
  assert.equal(params.get("showDeleted"), null);
  assert.equal(params.get("timeMin"), "2026-08-01T00:00:00.000Z");
  assert.equal(params.get("timeMax"), "2026-11-13T00:00:00.000Z");
});

test("Google Calendar client pagina la ventana completa sin cambiar la semantica de eventos", async () => {
  const requestedUrls: string[] = [];
  const result = await readGoogleCalendarEvents({
    accessToken: "token",
    maxPages: 2,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return requestedUrls.length === 1
        ? jsonResponse({
            items: [{ id: "event-1", recurringEventId: "series-1", status: "confirmed" }],
            nextPageToken: "page-2"
          })
        : jsonResponse({
            items: [{ id: "event-2", recurringEventId: "series-1", status: "confirmed" }]
          });
    }
  });

  assert.equal(result.complete, true);
  assert.equal(result.pagesRead, 2);
  assert.deepEqual(result.events.map((event) => event.id), ["event-1", "event-2"]);
  assert.equal(new URL(requestedUrls[0]).searchParams.get("singleEvents"), "true");
  assert.equal(new URL(requestedUrls[0]).searchParams.get("showDeleted"), null);
  assert.equal(new URL(requestedUrls[1]).searchParams.get("pageToken"), "page-2");
});

test("Google Calendar client marca incompleta una lectura truncada por paginas", async () => {
  const result = await readGoogleCalendarEvents({
    accessToken: "token",
    maxPages: 1,
    fetchImpl: async () => jsonResponse({
      items: [{ id: "event-1", summary: "Cafe" }],
      nextPageToken: "next-page"
    })
  });

  assert.equal(result.complete, false);
  assert.deepEqual(result.truncatedBy, ["max_pages"]);
  assert.match(result.warnings.join(" "), /limite de paginas/);
});

test("Google Calendar client aborta una request que no responde", async () => {
  await assert.rejects(
    readGoogleCalendarEvents({
      accessToken: "token",
      requestTimeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      })
    }),
    (error) => {
      assert.ok(error instanceof GoogleInteractionClientError);
      assert.equal(error.code, "GOOGLE_INTERACTIONS_HTTP_ERROR");
      assert.match(error.message, /no respondio a tiempo/);
      return true;
    }
  );
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
