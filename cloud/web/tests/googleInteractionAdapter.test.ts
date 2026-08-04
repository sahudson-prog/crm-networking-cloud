import test from "node:test";
import assert from "node:assert/strict";

import {
  mapCalendarEventToExternalInteraction,
  mapGmailMessageToExternalInteraction
} from "../lib/googleInteractionAdapter.ts";

const contactsByEmail = {
  "maria@empresa.cl": { contactId: "contact-maria" },
  "jorge@empresa.cl": { contactId: "contact-jorge" },
  "cliente@empresa.cl": { contactId: "contact-cliente" }
};

test("Gmail saliente crea una sola interaccion con participantes TO/CC/BCC", () => {
  const result = mapGmailMessageToExternalInteraction({
    userEmail: "sergio@crm.cl",
    contactsByEmail,
    message: {
      id: "abc123",
      threadId: "thread-1",
      internalDate: "1780000000000",
      payload: {
        headers: [
          { name: "From", value: "Sergio <sergio@crm.cl>" },
          { name: "To", value: "Maria <maria@empresa.cl>" },
          { name: "Cc", value: "Jorge <jorge@empresa.cl>" },
          { name: "Bcc", value: "Cliente <cliente@empresa.cl>" },
          { name: "Subject", value: "Seguimiento" }
        ],
        body: { data: Buffer.from("Hola a todos").toString("base64url") },
        mimeType: "text/plain"
      }
    }
  });

  assert.ok(result);
  assert.equal(result.externalId, "GMAIL_abc123");
  assert.equal(result.externalThreadId, "GMAIL_THREAD_thread-1");
  assert.equal(result.direction, "outbound");
  assert.deepEqual(
    result.participants?.map((participant) => [participant.contactId, participant.email, participant.role]),
    [
      ["contact-maria", "maria@empresa.cl", "TO"],
      ["contact-jorge", "jorge@empresa.cl", "CC"],
      ["contact-cliente", "cliente@empresa.cl", "BCC"]
    ]
  );
});

test("Gmail descarta correo de tercero cuando usuario y contacto solo estan copiados", () => {
  const result = mapGmailMessageToExternalInteraction({
    userEmail: "sergio@crm.cl",
    contactsByEmail,
    message: {
      id: "third-party",
      payload: {
        headers: [
          { name: "From", value: "Tercero <tercero@otra.cl>" },
          { name: "Cc", value: "Sergio <sergio@crm.cl>, Maria <maria@empresa.cl>" }
        ]
      }
    }
  });

  assert.equal(result, null);
});

test("Gmail entrante desde contacto incluye remitente y otros contactos conocidos", () => {
  const result = mapGmailMessageToExternalInteraction({
    userEmail: "sergio@crm.cl",
    contactsByEmail,
    message: {
      id: "incoming",
      payload: {
        headers: [
          { name: "From", value: "Maria <maria@empresa.cl>" },
          { name: "To", value: "Sergio <sergio@crm.cl>" },
          { name: "Cc", value: "Jorge <jorge@empresa.cl>" },
          { name: "Subject", value: "Cafe" }
        ]
      }
    }
  });

  assert.ok(result);
  assert.equal(result.direction, "inbound");
  assert.deepEqual(
    result.participants?.map((participant) => [participant.contactId, participant.role]),
    [
      ["contact-maria", "FROM"],
      ["contact-jorge", "CC"]
    ]
  );
});

test("Calendar mapea evento con participantes y link oficial", () => {
  const result = mapCalendarEventToExternalInteraction({
    userEmail: "sergio@crm.cl",
    contactsByEmail,
    event: {
      id: "event-1",
      summary: "Cafe con Maria",
      description: "Minuta del evento",
      location: "Meet",
      htmlLink: "https://calendar.google.com/event?eid=123",
      start: { dateTime: "2026-07-30T14:00:00-04:00" },
      organizer: { email: "sergio@crm.cl", self: true },
      attendees: [{ email: "maria@empresa.cl" }, { email: "nadie@otra.cl" }]
    }
  });

  assert.ok(result);
  assert.equal(result.externalId, "CALENDAR_event-1");
  assert.equal(result.externalUrl, "https://calendar.google.com/event?eid=123");
  assert.equal(result.interactionType, "calendar");
  assert.deepEqual(result.participants?.map((participant) => participant.contactId), ["contact-maria"]);
});
