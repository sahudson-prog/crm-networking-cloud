import assert from "node:assert/strict";
import test from "node:test";
import { historyImportCopy, parseHistoryWindow } from "../lib/historyPolicy.ts";
import { parseIcsCalendar } from "../lib/icsImport.ts";
import { buildIcsImportReviewSnapshot } from "../lib/icsImportReview.ts";

test("history context accepts only a complete server window and strips unrelated data", () => {
  const value = { cycle_id: "synthetic", context: "active:synthetic", max_months: 6, revision: 1,
    timezone: "America/Santiago", effective_start: "2026-05-04T04:00:00+00:00" };
  assert.deepEqual(parseHistoryWindow({ ...value, ignored: true }), value);
  for (const invalid of [null, {}, { ...value, max_months: 0 }, { ...value, max_months: 13 },
    { ...value, revision: 0 }, { ...value, effective_start: "invalid" }]) {
    assert.throws(() => parseHistoryWindow(invalid));
  }
  assert.match(historyImportCopy(3), /máximo de 3 meses/);
});

test("ICS compares instants at the cycle timezone boundary, not UTC civil dates", () => {
  const parsed = parseIcsCalendar(["BEGIN:VCALENDAR", "VERSION:2.0", ...["025959", "030000"].flatMap((time, i) => [
    "BEGIN:VEVENT", `UID:synthetic-${i}@example.invalid`, `DTSTART:20261008T${time}Z`,
    "ATTENDEE:mailto:focus@example.invalid", "END:VEVENT"
  ]), "END:VCALENDAR"].join("\r\n"));
  const result = buildIcsImportReviewSnapshot({ parsed, existingIcsSources: [], calendarInteractions: [],
    focusContactIdsByEmail: new Map([["focus@example.invalid", "synthetic-contact"]]), minimumStartIso: "2026-10-08T03:00:00Z" });
  assert.equal(result.omissionCounts.beforeNetworkingStart, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event.start.instant, "2026-10-08T03:00:00.000Z");
});
