import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTERACTION_SYNC_PREFERENCES,
  INTERACTION_SYNC_PREFERENCES_SETTING_KEY,
  interactionSyncToggleAction,
  parseInteractionSyncPreferences,
  serializeInteractionSyncPreferences,
  withInteractionSyncService
} from "../lib/interactionSyncPreferences.ts";
import {
  loadInteractionSyncPreferences,
  saveInteractionSyncPreferences
} from "../lib/interactionSyncPreferencesStore.ts";

test("preferencias de sync ausentes o invalidas dejan Gmail y Calendar OFF", async () => {
  assert.deepEqual(parseInteractionSyncPreferences(null), DEFAULT_INTERACTION_SYNC_PREFERENCES);
  assert.deepEqual(parseInteractionSyncPreferences("not-json"), DEFAULT_INTERACTION_SYNC_PREFERENCES);
  assert.deepEqual(await loadInteractionSyncPreferences(fakeClient()), DEFAULT_INTERACTION_SYNC_PREFERENCES);
});

test("preferencias Gmail y Calendar se serializan y persisten independientemente", async () => {
  const client = fakeClient();
  const gmailOn = withInteractionSyncService(DEFAULT_INTERACTION_SYNC_PREFERENCES, "gmail", true);
  await saveInteractionSyncPreferences(gmailOn, client);
  assert.deepEqual(await loadInteractionSyncPreferences(client), {
    calendarEnabled: false,
    gmailEnabled: true
  });

  const bothOn = withInteractionSyncService(gmailOn, "calendar", true);
  await saveInteractionSyncPreferences(bothOn, client);
  assert.deepEqual(await loadInteractionSyncPreferences(client), {
    calendarEnabled: true,
    gmailEnabled: true
  });

  const gmailOff = withInteractionSyncService(bothOn, "gmail", false);
  await saveInteractionSyncPreferences(gmailOff, client);
  assert.deepEqual(await loadInteractionSyncPreferences(client), {
    calendarEnabled: true,
    gmailEnabled: false
  });
  assert.equal(client.rows[0]?.setting_key, INTERACTION_SYNC_PREFERENCES_SETTING_KEY);
  assert.equal(client.rows[0]?.setting_value, serializeInteractionSyncPreferences(gmailOff));
});

test("toggle autorizado habilita, toggle sin capability autoriza y OFF deshabilita", () => {
  assert.equal(interactionSyncToggleAction({ capabilityAvailable: true, enabled: true }), "enable");
  assert.equal(interactionSyncToggleAction({ capabilityAvailable: false, enabled: true }), "authorize");
  assert.equal(interactionSyncToggleAction({ capabilityAvailable: false, enabled: false }), "disable");
});

function fakeClient(initialValue?: string) {
  let storedValue = initialValue;
  const rows: Array<{ setting_key: string; setting_value: string; user_id: string }> = [];
  return {
    rows,
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } } };
      }
    },
    from(table: string) {
      assert.equal(table, "user_settings");
      const builder = {
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: storedValue === undefined ? null : { setting_value: storedValue },
            error: null
          });
        },
        select() {
          return builder;
        },
        upsert(row: { setting_key: string; setting_value: string; user_id: string }, options: { onConflict: string }) {
          assert.equal(options.onConflict, "user_id,setting_key");
          rows.splice(0, rows.length, row);
          storedValue = row.setting_value;
          return Promise.resolve({ error: null });
        }
      };
      return builder;
    }
  };
}
