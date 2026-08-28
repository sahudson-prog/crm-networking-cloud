import test from "node:test";
import assert from "node:assert/strict";

import { prepareGoogleContactSyncPreview } from "../lib/googleContactSyncFlow.ts";
import { GoogleContactsClientError } from "../lib/googleContactsClient.ts";
import type { ContactRow } from "../lib/readModel.ts";

function contact(overrides: Partial<ContactRow> & { id: string; display_name: string }): ContactRow {
  return {
    company: "",
    contact_emails: [],
    contact_phones: [],
    headhunter_domains: [],
    is_active: true,
    is_headhunter: false,
    networking_focus: true,
    networking_status: "Pendiente",
    role: "",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides
  };
}

test("prepareGoogleContactSyncPreview usa cursor guardado y genera preview sin guardar cursor", async () => {
  const providerCalls: Array<string | null | undefined> = [];
  const result = await prepareGoogleContactSyncPreview(
    { accessToken: "token-google", connectedAccountId: "account-1" },
    {
      readAppContacts: async () => [
        contact({
          display_name: "Josefina Camus",
          id: "contact-1"
        })
      ],
      readCursor: async () => "cursor-previo",
      readExternalContactLinks: async () => [{ contactId: "contact-1", externalId: "people/1" }],
      readKnownExternalContactValues: async () => [],
      readProviderContacts: async (input) => {
        providerCalls.push(input.syncToken);
        return {
          contacts: [
            {
              company: "Seminarium",
              displayName: "Josefina Camus",
              externalId: "people/1",
              provider: "google"
            }
          ],
          mode: "incremental",
          nextSyncToken: "cursor-nuevo",
          pagesRead: 1,
          totalItems: 1,
          warnings: []
        };
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.cursorBefore, "cursor-previo");
  assert.equal(result.cursorAfter, "cursor-nuevo");
  assert.equal(result.cursorExpired, false);
  assert.deepEqual(providerCalls, ["cursor-previo"]);
  assert.equal(result.preview?.length, 1);
  assert.equal(result.preview?.[0].type, "modified");
});

test("prepareGoogleContactSyncPreview marca cursor vencido y reintenta lectura completa", async () => {
  const providerCalls: Array<string | null | undefined> = [];
  let expiredMarked = false;

  const result = await prepareGoogleContactSyncPreview(
    { accessToken: "token-google" },
    {
      readAppContacts: async () => [contact({ display_name: "Ana Pereira", id: "contact-1" })],
      readCursor: async () => "cursor-vencido",
      readExternalContactLinks: async () => [],
      readKnownExternalContactValues: async () => [],
      markCursorExpired: async () => {
        expiredMarked = true;
      },
      readProviderContacts: async (input) => {
        providerCalls.push(input.syncToken);
        if (input.syncToken) {
          throw new GoogleContactsClientError(
            "GOOGLE_CONTACTS_EXPIRED_SYNC_TOKEN",
            "Cursor vencido.",
            400
          );
        }
        return {
          contacts: [
            {
              displayName: "Contacto nuevo",
              externalId: "people/new",
              provider: "google"
            }
          ],
          mode: "full",
          nextSyncToken: "cursor-full",
          pagesRead: 2,
          totalItems: 1,
          warnings: ["Lectura completa realizada."]
        };
      }
    }
  );

  assert.equal(expiredMarked, true);
  assert.equal(result.cursorExpired, true);
  assert.equal(result.cursorBefore, null);
  assert.equal(result.cursorAfter, "cursor-full");
  assert.deepEqual(providerCalls, ["cursor-vencido", null]);
  assert.equal(result.googleRead.mode, "full");
  assert.equal(result.warnings.at(-1), "El cursor anterior vencio; prepare una revision completa de contactos.");
  assert.equal(result.preview?.[0].type, "new");
});

test("prepareGoogleContactSyncPreview reintenta lectura completa sin cursor futuro si Google rechaza requestSyncToken", async () => {
  const providerCalls: Array<{ requestSyncToken?: boolean; syncToken?: string | null }> = [];
  const checkpoints: string[] = [];

  const result = await prepareGoogleContactSyncPreview(
    {
      accessToken: "token-google",
      onCheckpoint: (checkpoint) => {
        checkpoints.push(`${checkpoint.step}: ${checkpoint.detail ?? ""}`);
      }
    },
    {
      readAppContacts: async () => [contact({ display_name: "Alienor Tordeur", id: "contact-1" })],
      readCursor: async () => null,
      readExternalContactLinks: async () => [{ contactId: "contact-1", externalId: "people/alienor" }],
      readKnownExternalContactValues: async () => [],
      readProviderContacts: async (input) => {
        providerCalls.push({
          requestSyncToken: input.requestSyncToken,
          syncToken: input.syncToken
        });
        if (input.requestSyncToken !== false) {
          throw new GoogleContactsClientError(
            "GOOGLE_CONTACTS_HTTP_ERROR",
            "Request contains an invalid argument.",
            400
          );
        }
        return {
          contacts: [
            {
              displayName: "Alienor Tordeur",
              externalId: "people/alienor",
              provider: "google"
            }
          ],
          mode: "full",
          nextSyncToken: null,
          pagesRead: 1,
          totalItems: 1,
          warnings: ["Lectura completa sin cursor incremental."]
        };
      }
    }
  );

  assert.deepEqual(providerCalls, [
    { requestSyncToken: undefined, syncToken: null },
    { requestSyncToken: false, syncToken: null }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.cursorAfter, null);
  assert.equal(result.preview?.[0].type, "unchanged");
  assert.ok(checkpoints.some((checkpoint) => checkpoint.includes("Reintentando sin pedir cursor incremental")));
});
