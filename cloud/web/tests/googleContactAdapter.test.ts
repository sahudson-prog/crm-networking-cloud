import test from "node:test";
import assert from "node:assert/strict";

import {
  mapGooglePeopleToExternalContacts,
  mapGooglePersonToExternalContact
} from "../lib/googleContactAdapter.ts";

test("Google Contacts mapea nombre, empresa, cargo, correos y telefonos al contrato externo", () => {
  const result = mapGooglePersonToExternalContact({
    connectedAccountId: "account-1",
    person: {
      etag: "etag-1",
      resourceName: "people/c123",
      names: [{ displayName: "Josefina Camus" }],
      organizations: [{ name: "Seminarium", title: "Headhunter" }],
      emailAddresses: [{ value: " Josefina@Seminarium.cl " }, { value: "josefina@seminarium.cl" }],
      phoneNumbers: [{ value: "+56 9 1234 5678" }]
    }
  });

  assert.ok(result);
  assert.equal(result.provider, "google");
  assert.equal(result.connectedAccountId, "account-1");
  assert.equal(result.externalId, "people/c123");
  assert.equal(result.displayName, "Josefina Camus");
  assert.equal(result.company, "Seminarium");
  assert.equal(result.role, "Headhunter");
  assert.deepEqual(result.emails, ["josefina@seminarium.cl"]);
  assert.deepEqual(result.phones, ["+56 9 1234 5678"]);
  assert.equal(result.metadata?.google_etag, "etag-1");
});

test("Google Contacts usa email como fallback si no hay nombre visible", () => {
  const result = mapGooglePersonToExternalContact({
    person: {
      resourceName: "people/c456",
      emailAddresses: [{ value: "sin.nombre@empresa.cl" }]
    }
  });

  assert.ok(result);
  assert.equal(result.displayName, "sin.nombre@empresa.cl");
  assert.equal(result.metadata?.missing_display_name, true);
});

test("Google Contacts prefiere telefono visible sobre canonicalForm para evitar truncados", () => {
  const result = mapGooglePersonToExternalContact({
    person: {
      resourceName: "people/basilio",
      names: [{ displayName: "Basilio Kine RedSalud" }],
      phoneNumbers: [
        {
          canonicalForm: "+56998506473",
          value: "+569985064738"
        }
      ]
    }
  });

  assert.ok(result);
  assert.deepEqual(result.phones, ["+569985064738"]);
});

test("Google Contacts conserva deleted y previousResourceNames como metadata de sync", () => {
  const result = mapGooglePersonToExternalContact({
    person: {
      resourceName: "people/c789",
      names: [{ givenName: "Ricardo", familyName: "Smith" }],
      metadata: {
        deleted: true,
        previousResourceNames: ["people/old-1"]
      }
    }
  });

  assert.ok(result);
  assert.equal(result.displayName, "Ricardo Smith");
  assert.equal(result.metadata?.google_deleted, true);
  assert.deepEqual(result.metadata?.previous_resource_names, ["people/old-1"]);
});

test("Google Contacts omite personas sin resourceName", () => {
  const result = mapGooglePeopleToExternalContacts({
    people: [
      { names: [{ displayName: "Sin ID" }] },
      { resourceName: "people/ok", names: [{ displayName: "Con ID" }] }
    ]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].externalId, "people/ok");
});
