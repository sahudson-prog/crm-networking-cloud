import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("suggestions y onboarding reutilizan CoachFrame, CoachBubble y el responsive base", () => {
  const coach = source("../components/CoachPreview.tsx");
  const css = source("../styles/components.css");

  assert.equal(coach.match(/function CoachFrame/g)?.length, 1);
  assert.equal(coach.match(/function CoachBubble/g)?.length, 1);
  assert.match(coach, /function CoachSuggestionsContent[\s\S]*<CoachFrame[\s\S]*mode="suggestions"/);
  assert.match(coach, /function CoachOnboardingContent[\s\S]*<CoachFrame[\s\S]*mode="onboarding"/);
  assert.match(coach, /<CoachBubble as="details" className="coach-message">/);
  assert.match(coach, /<CoachBubble as="article" className="coach-onboarding-bubble">/);
  assert.match(css, /\.coach-bubble\s*\{[\s\S]*border: 1px solid var\(--crm-border\)[\s\S]*border-radius: 14px/);
  assert.match(css, /\.coach-bubble::before,[\s\S]*\.coach-bubble::after/);
  assert.match(css, /\.coach-module\s*\{[\s\S]*padding-top: 18px/);
  assert.match(css, /\.coach-bot-antenna::after[\s\S]*top: -6px/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.coach-module,[\s\S]*\.coach-module\.bot-mini[\s\S]*\.coach-module \.coach-bubble::before[\s\S]*\.coach-module \.coach-bubble::after/);
  assert.doesNotMatch(css, /\.coach-module\.mode-onboarding \.coach-(?:rail|bubble)/);
  assert.doesNotMatch(css, /@container[\s\S]*contact-coach-panel/);
});

test("la ficha conserva filtro por contactId y todas las acciones de suggestions", () => {
  const coach = source("../components/CoachPreview.tsx");
  const profile = source("../components/ContactProfile.tsx");
  const coachPosition = profile.indexOf('className="contact-profile-coach"');
  const gridPosition = profile.indexOf('className={`contact-profile-grid');

  assert.ok(coachPosition >= 0 && gridPosition > coachPosition);
  assert.match(profile, /<CoachModule[\s\S]*contactId=\{contact\.id\}[\s\S]*variant="contact"/);
  assert.doesNotMatch(profile, /contact-coach-panel/);
  assert.doesNotMatch(profile, /contact-back-link|href="\/contactos"/);
  assert.match(coach, /contactId \? todos\.filter\(\(todo\) => todo\.object_id === contactId\) : todos/);
  assert.match(coach, /executeCoachTodos/);
  assert.match(coach, /dismissCoachTodos/);
  assert.match(coach, /reviewNetworkingStatusSuggestions/);
  assert.match(coach, /CoachConfigDialog/);
  assert.match(coach, /CoachActionLogDialog/);
});

test("Dashboard conserva agrupado y detallado dentro del Coach y lo ubica antes de filtros", () => {
  const coach = source("../components/CoachPreview.tsx");
  const dashboard = source("../components/ReadOnlyDashboard.tsx");
  const coachPosition = dashboard.indexOf('className="dashboard-coach"');
  const filtersPosition = dashboard.indexOf('className="dashboard-filter-bar"');

  assert.ok(coachPosition >= 0 && filtersPosition > coachPosition);
  assert.doesNotMatch(dashboard, /className="coach-panel"|coach-panel-caption/);
  assert.match(coach, /showIndividualSuggestions \? "ver agrupado" : "ver detallado"/);
  assert.match(coach, /shouldGroupSuggestions/);
  assert.match(coach, /CoachGroupSection/);
  assert.match(coach, /\{count\} sugerencias activas/);
  assert.doesNotMatch(coach, /<strong>Coach IA<\/strong>/);
  assert.match(coach, /<section[\s\S]*aria-label="Coach IA"[\s\S]*className=\{`coach-module/);
});

test("Shell usa el lockup oficial de Coffeecito sin texto legacy", () => {
  const shell = source("../components/Shell.tsx");
  const css = source("../styles/components.css");

  assert.doesNotMatch(shell, /CRM Networking/);
  assert.match(shell, /className="shell-brand-lockup"/);
  assert.match(shell, /src="\/brand\/coffeecito-isotipo\.svg"/);
  assert.match(shell, />Coffeecito<\/span>/);
  assert.match(css, /\.shell-brand-lockup span[\s\S]*var\(--font-coffeecito-wordmark\)[\s\S]*font-weight: 900[\s\S]*letter-spacing: -0\.015em/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
