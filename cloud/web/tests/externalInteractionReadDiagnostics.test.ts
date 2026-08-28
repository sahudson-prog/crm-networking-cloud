import test from "node:test";
import assert from "node:assert/strict";

import { calendarDiagnosticPayload } from "../lib/externalInteractionReadDiagnostics.ts";

test("calendarDiagnosticPayload resume eventos sin guardar descripcion cruda", () => {
  const result = calendarDiagnosticPayload({
    attendees: [
      { email: "persona@empresa.com" },
      { email: "otra@empresa.com" }
    ],
    created: "2026-08-20T10:00:00.000Z",
    description: "Reunion privada con telefono +56 9 1234 5678",
    htmlLink: "https://calendar.google.com/calendar/event?eid=abc",
    id: "event-1",
    organizer: { email: "organizer@empresa.com", self: true },
    start: { dateTime: "2026-08-21T12:00:00.000Z" },
    status: "confirmed",
    summary: "Cafe con persona@empresa.com",
    updated: "2026-08-20T11:00:00.000Z"
  });

  assert.equal(result.attendee_count, 2);
  assert.equal(result.description_present, true);
  assert.equal(result.html_link_present, true);
  assert.equal(result.organizer_self, true);
  assert.equal(result.summary, "Cafe con [correo]");
  assert.equal(Object.hasOwn(result, "description"), false);
  assert.equal(Object.hasOwn(result, "htmlLink"), false);
});
