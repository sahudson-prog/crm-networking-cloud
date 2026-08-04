import test from "node:test";
import assert from "node:assert/strict";

import {
  markSyncCursorExpired,
  readSyncCursor,
  upsertSyncCursor,
  type SyncCursorRecord
} from "../lib/syncCursorStore.ts";

test("syncCursorStore lee cursor por usuario, proveedor, recurso y etiqueta", async () => {
  const client = fakeClient({
    "user-1|google|contacts|primary": {
      cursor_label: "primary",
      cursor_value: "sync-token",
      last_synced_at: "2026-07-31T10:00:00Z",
      metadata: {},
      provider: "google",
      resource_type: "contacts",
      status: "ok",
      user_id: "user-1"
    }
  });

  const cursor = await readSyncCursor({ cursorLabel: "primary", provider: "google", resourceType: "contacts" }, client);

  assert.equal(cursor?.cursor_value, "sync-token");
  assert.deepEqual(client.calls[0], {
    cursor_label: "primary",
    provider: "google",
    resource_type: "contacts",
    table: "sync_cursors",
    user_id: "user-1"
  });
});

test("syncCursorStore guarda cursor con upsert por clave unica", async () => {
  const client = fakeClient();

  const saved = await upsertSyncCursor({
    connectedAccountId: "account-1",
    cursorLabel: "primary",
    cursorValue: "sync-next",
    metadata: { pages: 2 },
    provider: "google",
    resourceType: "contacts",
    syncedAt: "2026-07-31T12:00:00Z"
  }, client);

  assert.equal(saved.cursor_value, "sync-next");
  assert.equal(client.upserts[0].options.onConflict, "user_id,provider,resource_type,cursor_label");
  assert.deepEqual(client.upserts[0].row, {
    connected_account_id: "account-1",
    cursor_label: "primary",
    cursor_value: "sync-next",
    last_synced_at: "2026-07-31T12:00:00Z",
    metadata: { pages: 2 },
    provider: "google",
    resource_type: "contacts",
    status: "ok",
    user_id: "user-1"
  });
});

test("syncCursorStore marca cursor vencido sin conservar cursor_value", async () => {
  const client = fakeClient();

  const saved = await markSyncCursorExpired({ provider: "google", resourceType: "contacts" }, client);

  assert.equal(saved.status, "expired");
  assert.equal(saved.cursor_value, null);
  assert.equal(saved.cursor_label, "");
  assert.equal(typeof saved.metadata.expired_at, "string");
});

function fakeClient(initialRows: Record<string, SyncCursorRecord> = {}) {
  const rows = new Map(Object.entries(initialRows));
  const calls: Array<Record<string, unknown>> = [];
  const upserts: Array<{ row: Record<string, unknown>; options: Record<string, unknown> }> = [];

  return {
    calls,
    upserts,
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } } };
      }
    },
    from(table: string) {
      const filters: Record<string, unknown> = { table };
      const builder = {
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle() {
          calls.push({ ...filters });
          const key = `${filters.user_id}|${filters.provider}|${filters.resource_type}|${filters.cursor_label}`;
          return Promise.resolve({ data: rows.get(key) ?? null, error: null });
        },
        select() {
          return builder;
        },
        single() {
          const row = builder.__row as SyncCursorRecord;
          return Promise.resolve({ data: row, error: null });
        },
        upsert(row: SyncCursorRecord, options: Record<string, unknown>) {
          upserts.push({ row: row as unknown as Record<string, unknown>, options });
          const key = `${row.user_id}|${row.provider}|${row.resource_type}|${row.cursor_label}`;
          const saved = { id: "cursor-1", ...row };
          rows.set(key, saved);
          builder.__row = saved;
          return builder;
        },
        __row: null as SyncCursorRecord | null
      };
      return builder;
    }
  };
}
