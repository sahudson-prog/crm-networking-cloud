import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFESSIONAL_SITUATION_OPTIONS, isProfessionalSituationCode, normalizeStartingPoint, validateStartingPoint } from "../lib/startingPoint.ts";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("global situation labels preserve persisted codes and legacy profile compatibility", () => {
  assert.equal(PROFESSIONAL_SITUATION_OPTIONS.find(v => v.code === "employed")?.label, "Dependiente");
  assert.equal(PROFESSIONAL_SITUATION_OPTIONS.find(v => v.code === "unemployed")?.label, "En búsqueda activa");
  for (const code of ["employed", "unemployed"] as const) {
    const profile = { fullName: "Synthetic", professionalSituationCode: code, networkingStartDate: "" };
    assert.equal(isProfessionalSituationCode(code), true);
    assert.equal(normalizeStartingPoint(profile).professionalSituationCode, code);
    assert.deepEqual(validateStartingPoint(profile), {});
  }
  const fields = source("../components/StartingPointFields.tsx");
  assert.match(fields, /PROFESSIONAL_SITUATION_OPTIONS.map/);
  assert.match(fields, /value=\{option.code\}>\{option.label\}/);
  assert.match(source("../components/AccountPage.tsx"), /mode="account"/);
});

test("both section headings reuse official priority icon and exact shared dimensions", () => {
  const css = source("../styles/components.css");
  assert.match(css, /\.networking-cycle-panel \.panel-title,\s*\.onboarding-priorities \.panel-title,\s*\.objectives-priorities \.panel-title \{\s*display: inline-flex;\s*align-items: center;\s*gap: 8px;/);
  assert.match(css, /\.onboarding-priorities \.panel-title \.icon,[\s\S]*?width: 20px;\s*height: 20px;/);
  assert.match(css, /\.onboarding-priorities \.panel-title \.icon \{\s*flex: 0 0 20px;/);
  assert.match(source("../components/OnboardingPriorities.tsx"), /<div className="panel-header"><h2 className="panel-title"><Icon name="tag" \/>/);
  assert.match(source("../components/ObjectivesPage.tsx"), /<Icon name="tag" \/> Prioridades/);
});

test("compact active cards share styles without overriding glow in onboarding", () => {
  const css = source("../styles/components.css");
  assert.match(css, /\.networking-plan \{[^}]*min-height: 148px;[^}]*padding: 16px;/);
  assert.match(css, /\.networking-plan.is-active \{[^}]*background: var\(--crm-status-agendado-soft\);[^}]*box-shadow:/);
  assert.match(css, /\.networking-plan-actions \{[^}]*justify-content: center;/);
  assert.match(css, /\.button.networking-plan-notice \{[^}]*align-self: center;/);
  assert.doesNotMatch(source("../styles/onboarding.css"), /\.networking-plan\s*\{/);
  const tracking = source("../styles/tracking.css");
  assert.match(tracking, /\.networking-cycle-panel\.panel \.networking-plan:not\(\.is-active\) \{ box-shadow: none;/);
  assert.match(tracking, /\.networking-plan:not\(\.is-unavailable\):not\(\.is-active\) \{ background: transparent;/);
  const panel = source("../components/NetworkingCyclePanel.tsx");
  assert.match(panel, /mode = "standard"/);
  assert.match(panel, /onClick=\{openClose\}>Finalizar proceso/);
  assert.match(panel, /onClick=\{\(\) => void changeNotice\("BUSINESS_DEVELOPMENT"\)\}/);
  assert.match(panel, /onClick=\{\(\) => void changeNotice\("PERSONAL_BRAND"\)\}/);
});
