import assert from "node:assert/strict";
import test from "node:test";
import { isCalendarDeletedAtSource, withoutCancelledCalendar } from "../lib/interactionState.ts";

const source = { interaction_id: "synthetic", provider: "google", source_service: "calendar",
  external_object_type: "event", external_id: "CALENDAR_event", sync_status: "deleted_at_source" };

test("only explicit active Google Calendar tombstones hide a timeline row", () => {
  assert.equal(isCalendarDeletedAtSource([source]), true);
  assert.equal(isCalendarDeletedAtSource([]), false);
  for (const override of [{ sync_status: "synced" }, { sync_status: "pending" }, { is_active: false },
    { provider: "manual" }, { source_service: "gmail" }]) {
    assert.equal(isCalendarDeletedAtSource([{ ...source, ...override }]), false);
  }
  assert.equal(source.sync_status, "deleted_at_source", "visibility does not mutate the source");
});

test("normal-list anti-join preserves the query and does not target technical source identity", () => {
  const calls: unknown[] = [];
  const query = { eq(column: string, value: unknown) { calls.push([column,value]); return this; },
    is(column: string, value: unknown) { calls.push([column,value]); return this; } };
  assert.equal(withoutCancelledCalendar(query), query);
  assert.deepEqual(calls, [["cancelled_calendar.provider","google"], ["cancelled_calendar.source_service","calendar"],
    ["cancelled_calendar.is_active",true], ["cancelled_calendar.sync_status","deleted_at_source"], ["cancelled_calendar",null]]);
});
