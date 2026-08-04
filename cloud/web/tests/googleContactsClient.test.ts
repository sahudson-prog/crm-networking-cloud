import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleContactsClientError,
  readGoogleContacts
} from "../lib/googleContactsClient.ts";

test("Google Contacts client lee paginas y devuelve nextSyncToken", async () => {
  const urls: string[] = [];
  const result = await readGoogleContacts({
    accessToken: "token",
    fetchImpl: async (url) => {
      urls.push(String(url));
      const parsed = new URL(String(url));
      if (!parsed.searchParams.get("pageToken")) {
        return jsonResponse({
          connections: [
            {
              resourceName: "people/1",
              names: [{ displayName: "Maria Solis" }],
              emailAddresses: [{ value: "maria@empresa.cl" }]
            }
          ],
          nextPageToken: "page-2",
          totalItems: 2
        });
      }
      return jsonResponse({
        connections: [
          {
            resourceName: "people/2",
            names: [{ displayName: "Jorge Marin" }]
          }
        ],
        nextSyncToken: "sync-next",
        totalItems: 2
      });
    }
  });

  assert.equal(result.mode, "full");
  assert.equal(result.pagesRead, 2);
  assert.equal(result.totalItems, 2);
  assert.equal(result.nextSyncToken, "sync-next");
  assert.deepEqual(result.contacts.map((contact) => contact.externalId), ["people/1", "people/2"]);
  assert.equal(new URL(urls[0]).searchParams.get("requestSyncToken"), "true");
  assert.equal(new URL(urls[0]).searchParams.get("personFields"), "names,emailAddresses,phoneNumbers,organizations,metadata");
  assert.equal(new URL(urls[0]).searchParams.get("sources"), "READ_SOURCE_TYPE_CONTACT");
  assert.equal(new URL(urls[1]).searchParams.get("pageToken"), "page-2");
});

test("Google Contacts client usa syncToken en modo incremental", async () => {
  let requestedUrl = "";
  const result = await readGoogleContacts({
    accessToken: "token",
    syncToken: "sync-prev",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({
        connections: [
          {
            metadata: { deleted: true, previousResourceNames: ["people/old"] },
            names: [{ displayName: "Eliminado" }],
            resourceName: "people/current"
          }
        ],
        nextSyncToken: "sync-next"
      });
    }
  });

  assert.equal(result.mode, "incremental");
  assert.equal(new URL(requestedUrl).searchParams.get("syncToken"), "sync-prev");
  assert.equal(result.contacts[0].metadata?.google_deleted, true);
  assert.deepEqual(result.contacts[0].metadata?.previous_resource_names, ["people/old"]);
});

test("Google Contacts client identifica syncToken vencido", async () => {
  await assert.rejects(
    readGoogleContacts({
      accessToken: "token",
      syncToken: "expired",
      fetchImpl: async () => jsonResponse({
        error: {
          message: "Sync token is expired",
          details: [{ reason: "EXPIRED_SYNC_TOKEN" }]
        }
      }, 400)
    }),
    (error) => {
      assert.ok(error instanceof GoogleContactsClientError);
      assert.equal(error.code, "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN");
      return true;
    }
  );
});

test("Google Contacts client identifica credenciales invalidas como reconexion requerida", async () => {
  await assert.rejects(
    readGoogleContacts({
      accessToken: "token-vencido",
      fetchImpl: async () => jsonResponse({
        error: {
          message: "Request had invalid authentication credentials."
        }
      }, 401)
    }),
    (error) => {
      assert.ok(error instanceof GoogleContactsClientError);
      assert.equal(error.code, "GOOGLE_CONTACTS_AUTH_REQUIRED");
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test("Google Contacts client corta lectura si se alcanza maxPages", async () => {
  const result = await readGoogleContacts({
    accessToken: "token",
    maxPages: 1,
    fetchImpl: async () => jsonResponse({
      connections: [{ resourceName: "people/1", names: [{ displayName: "Uno" }] }],
      nextPageToken: "page-2"
    })
  });

  assert.equal(result.pagesRead, 1);
  assert.equal(result.warnings[0], "Se alcanzo el limite de paginas para esta lectura de contactos.");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
