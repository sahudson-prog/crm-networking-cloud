import test from "node:test";
import assert from "node:assert/strict";

import {
  domainsForHeadhunterResolution,
  normalizeHeadhunterCompanyName,
  normalizeHeadhunterDomain,
  resolveHeadhunterCompany,
  type HeadhunterCompanyMasterRow
} from "../lib/headhunterCompanyMaster.ts";
import type { ContactRow } from "../lib/readModel.ts";

const master: HeadhunterCompanyMasterRow[] = [
  {
    domains: ["@spencerstuart.com"],
    displayName: "Spencer Stuart",
    id: "company-1",
    normalizedName: "spencer stuart"
  },
  {
    domains: ["@kornferry.com", "@kornferry.cl"],
    displayName: "Korn Ferry",
    id: "company-2",
    normalizedName: "korn ferry"
  }
];

function contact(overrides: Partial<ContactRow>): Pick<ContactRow, "company" | "contact_emails" | "headhunter_domains"> {
  return {
    company: "",
    contact_emails: [],
    headhunter_domains: [],
    ...overrides
  };
}

test("normaliza nombres y dominios del maestro headhunter", () => {
  assert.equal(normalizeHeadhunterCompanyName("  Spencer   Stuart  "), "spencer stuart");
  assert.equal(normalizeHeadhunterDomain("Persona@SpencerStuart.com"), "@spencerstuart.com");
  assert.equal(normalizeHeadhunterDomain("https://www.kornferry.cl/personas"), "@kornferry.cl");
});

test("extrae dominios desde campos manuales y correos", () => {
  const domains = domainsForHeadhunterResolution(
    contact({
      contact_emails: [{ domain: "@spencerstuart.com", email: "a@spencerstuart.com" }],
      headhunter_domains: ["kornferry.com"]
    })
  );

  assert.deepEqual(domains, ["@kornferry.com", "@spencerstuart.com"]);
});

test("prioriza coincidencia por empresa cuando existe en el maestro", () => {
  const resolution = resolveHeadhunterCompany(contact({ company: "Korn Ferry" }), master);

  assert.equal(resolution.status, "matched_company");
  assert.equal(resolution.suggestedCompany, "Korn Ferry");
});

test("sugiere empresa por dominio cuando el campo empresa esta vacio", () => {
  const resolution = resolveHeadhunterCompany(
    contact({
      contact_emails: [{ domain: "@spencerstuart.com", email: "ignacio@spencerstuart.com" }]
    }),
    master
  );

  assert.equal(resolution.status, "matched_domain");
  assert.equal(resolution.suggestedCompany, "Spencer Stuart");
});

test("marca como no resuelto cuando no hay match confiable", () => {
  const resolution = resolveHeadhunterCompany(
    contact({
      contact_emails: [{ domain: "@empresa.cl", email: "persona@empresa.cl" }]
    }),
    master
  );

  assert.equal(resolution.status, "unresolved");
});

test("marca como discrepancia cuando la empresa escrita no existe en el maestro", () => {
  const resolution = resolveHeadhunterCompany(
    contact({
      company: "Spencer",
      contact_emails: [{ domain: "@spencerstuart.com", email: "persona@spencerstuart.com" }]
    }),
    master
  );

  assert.equal(resolution.status, "company_mismatch");
});
