import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("onboarding and application share the exact visual header and shell paint", () => {
  const route = source("../components/OnboardingRoutePage.tsx");
  const shell = source("../components/ShellChrome.tsx");
  const css = source("../styles/onboarding.css");
  assert.match(route, /app-shell application-shell-v2 onboarding-guided/);
  assert.match(route, /shell-top-region onboarding-guided-top/);
  assert.match(route, /<ShellHeader linkedBrand=\{false\} \/>/);
  assert.match(shell, /<ShellHeader actions=/);
  assert.doesNotMatch(css, /filter:|\.shell-brand-lockup|\.brand-beta-wordmark|html:has|body:has/);
  assert.doesNotMatch(css, /onboarding-guided-top\s*\{[^}]*background/);
});

test("header uses unchanged official asset and omits actions when absent", () => {
  const header = source("../components/ShellHeader.tsx");
  assert.match(header, /src="\/brand\/coffeecito-isotipo\.svg"/);
  assert.match(header, /<BrandBetaWordmark \/>/);
  assert.match(header, /linkedBrand = true/);
  assert.match(header, /actions \? <div className="shell-header-actions">\{actions\}<\/div> : null/);
  assert.doesNotMatch(header, /ActivitySyncButton|useWorkspace|useEffect|svg>/);
});

test("priorities are accessible toggle pills with the existing writer and selection rules", () => {
  const chips = source("../components/OnboardingPriorities.tsx");
  const css = source("../styles/onboarding.css");
  assert.match(chips, /<button type="button" className="objective-chip onboarding-priority-chip"/);
  assert.match(chips, /aria-pressed=\{selected\}/);
  assert.match(chips, /change\(group.type, value, !selected\)/);
  assert.doesNotMatch(chips, /onboardingPriorityCount\(rows\)\s*(?:>=|>)\s*3|hasta 3/);
  assert.match(chips, /onReadyChange\(!busy && !error && onboardingPriorityCount\(rows\) > 0\)/);
  assert.match(chips, /if \(input\) await saveObjective\(input\)/);
  assert.doesNotMatch(chips, /type="checkbox"/);
  assert.match(css, /border-radius: 999px/);
  assert.match(css, /onboarding-priority-chip:focus-visible/);
  assert.match(css, /onboarding-priority-chip\[aria-pressed=true\]/);
});

test("onboarding hides management only; normal Objectives retains its actions", () => {
  const cycle = source("../components/NetworkingCyclePanel.tsx");
  assert.match(cycle, /mode = "standard"/);
  assert.match(cycle, /\(!active\?\.started_at \|\| mode !== "onboarding"\) \? <div className="networking-plan-actions">/);
  assert.match(cycle, /onClick=\{openClose\}>Finalizar proceso/);
  assert.match(cycle, /onClick=\{openCreate\} tone="primary">Comenzar proceso/);
  assert.match(source("../components/OnboardingRoutePage.tsx"), /<NetworkingCyclePanel title="Tu objetivo" mode="onboarding"/);
  assert.doesNotMatch(source("../components/ObjectivesPage.tsx"), /mode="onboarding"/);
});

test("empty onboarding table has no headers; normal table retains them", () => {
  const contacts = source("../components/ContactTable.tsx");
  assert.match(contacts, /\(!tutorial \|\| sortedContacts.length > 0\) \? <thead>/);
  assert.match(contacts, /Tu red comienza aquí/);
  assert.match(contacts, /<ContactImportButton label="Importar"/);
  assert.match(contacts, />Crear contacto<\/Button>/);
});

test("tutorial card reuses real board and title styles without dropdown or navigation", () => {
  const contacts = source("../components/ContactTable.tsx");
  assert.match(contacts, /disableNavigation=\{tutorial\}/);
  assert.match(contacts, /disableNavigation = false/);
  assert.match(contacts, /disableNavigation \? <strong className="contacts-status-card-title"/);
  assert.match(contacts, /: <Link draggable=\{false\} href=\{`\/contactos\?contactId=/);
  assert.match(contacts, /<StatusBoardCard id=\{card.id\}/);
  assert.doesNotMatch(contacts, /tutorialMove|aria-label=\{`Mover/);
  assert.match(source("../styles/components.css"), /\.contacts-status-card-main a,\s*\.contacts-status-card-main \.contacts-status-card-title \{/);
});

test("copy, Coach typography and success feedback are scoped and follow confirmed save", () => {
  const contacts = source("../components/ContactTable.tsx");
  assert.match(contacts, /await updateContactNetworkingStatus[\s\S]*await onStatusSaved\?[\s\S]*failedIds.length \? "Algunos estados no se pudieron guardar\." : tutorial \? "Guardado ✓" : "Estados guardados\."/);
  assert.match(source("../components/StartingPointFields.tsx"), /<span>¿Cómo te llamas\?<\/span>/);
  assert.match(source("../styles/onboarding.css"), /\.onboarding-guided \.coach-onboarding-content \{ font-size: 16px; line-height: 1\.6;/);
  const page = source("../components/OnboardingRoutePage.tsx");
  assert.ok(page.includes('¡Eso! Así se mueve tu red. Tu networking ya partió 🎉 Aprieta "Empezar" y sigamos con los próximos pasos.'));
  assert.match(page, /step === "contacts" && exercise \? GUIDED_COPY.success/);
  assert.match(page, /change.previous !== "Pendiente" \|\| change.next !== "Contactado"/);
});
