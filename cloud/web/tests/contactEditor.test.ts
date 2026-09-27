import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/ContactEditorDialog.tsx", import.meta.url), "utf8");

test("el editor conserva autocomplete headhunter sin interpretar ni advertir sobre el maestro", () => {
  assert.match(source, /readHeadhunterCompanyMaster\(\)/);
  assert.match(source, /const companyMatches = useMemo/);
  assert.match(source, /className="headhunter-company-menu"/);
  assert.match(source, /setCompany\(row\.displayName\)/);

  assert.doesNotMatch(source, /HeadhunterCompanyEditorHint/);
  assert.doesNotMatch(source, /resolveHeadhunterCompany/);
  assert.doesNotMatch(source, /La empresa escrita no coincide con el maestro/);
  assert.doesNotMatch(source, /No pude leer el maestro de empresas headhunter/);
  assert.doesNotMatch(source, /Hay mas de una empresa posible/);
  assert.doesNotMatch(source, /crea una nueva en Sistema/);
});
