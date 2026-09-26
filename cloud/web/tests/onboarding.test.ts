import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_FLOW,
  beginOnboarding,
  beginOnboardingReplay,
  completeOnboarding,
  deferOnboarding,
  dismissOnboarding,
  markOnboardingIntroSeen,
  moveOnboardingToStep,
  onboardingRouteFor,
  onboardingRouteIdFromPathname,
  onboardingRouteNavigation,
  onboardingStepFromPathname,
  isOnboardingTestResetAvailable,
  parseProductOnboardingState,
  resolveStoredOnboardingState,
  serializeProductOnboardingState,
  shouldClearOnboardingSessionOnNormalRoute,
  shouldRedirectOnboardingIntroToProduct,
  shouldShowAutomaticOnboardingIntro
} from "../lib/onboarding.ts";

test("parser conserva payloads v1 previos, acepta dismissed y rechaza payloads inválidos", () => {
  const previousState = {
    version: 1 as const,
    status: "in_progress" as const,
    introSeen: true,
    lastStep: "contacts" as const
  };
  const dismissedState = dismissOnboarding(previousState, "contact");

  assert.deepEqual(parseProductOnboardingState(serializeProductOnboardingState(previousState)), previousState);
  assert.deepEqual(parseProductOnboardingState(serializeProductOnboardingState(dismissedState)), dismissedState);
  assert.equal(parseProductOnboardingState(""), null);
  assert.equal(parseProductOnboardingState("not-json"), null);
  assert.equal(parseProductOnboardingState('{"version":2,"status":"completed","introSeen":true}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"unknown","introSeen":true}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"not_started","introSeen":"yes"}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"in_progress","introSeen":true,"lastStep":"other"}'), null);
});

test("ausencia real del setting abre la intro una sola vez", () => {
  const missing = resolveStoredOnboardingState({ exists: false, value: null });
  const seen = markOnboardingIntroSeen(missing);
  const invalid = resolveStoredOnboardingState({ exists: true, value: "invalid" });

  assert.deepEqual(missing, INITIAL_ONBOARDING_STATE);
  assert.equal(shouldShowAutomaticOnboardingIntro({ exists: false, state: missing }), true);
  assert.equal(onboardingRouteFor("intro"), "/onboarding");
  assert.equal(shouldShowAutomaticOnboardingIntro({ exists: true, state: seen }), false);
  assert.equal(invalid.introSeen, true);
  assert.equal(shouldShowAutomaticOnboardingIntro({ exists: true, state: invalid }), false);
});

test("Ahora no conserva not_started y registra introSeen", () => {
  const deferred = deferOnboarding();
  assert.deepEqual(deferred, {
    version: 1,
    status: "not_started",
    introSeen: true
  });
});

test("Comenzar recorrido inicia en objectives", () => {
  const started = beginOnboarding(deferOnboarding());
  assert.deepEqual(started, {
    version: 1,
    status: "in_progress",
    introSeen: true,
    lastStep: "objectives"
  });
  assert.equal(onboardingRouteFor(started.lastStep), "/onboarding/objetivos");
});

test("Salir deja dismissed y conserva el último paso", () => {
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "contacts");
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.lastStep, "contacts");
});

test("replay no cambia dismissed ni completed", () => {
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "google");
  const completed = completeOnboarding();

  assert.deepEqual(beginOnboardingReplay(dismissed).state, dismissed);
  assert.deepEqual(beginOnboardingReplay(completed).state, completed);
  assert.deepEqual(beginOnboardingReplay(completed).session, { active: true, replay: true });
  assert.equal(beginOnboardingReplay(completed).route, "/onboarding");
});

test("la secuencia y Atrás/Siguiente derivan de una sola fuente de verdad", () => {
  assert.deepEqual(ONBOARDING_FLOW, [
    { id: "intro", path: "/onboarding" },
    { id: "objectives", path: "/onboarding/objetivos" },
    { id: "contacts", path: "/onboarding/contactos" },
    { id: "contact", path: "/onboarding/contacto" },
    { id: "google", path: "/onboarding/google" },
    { id: "final", path: "/onboarding/final" }
  ]);
  assert.deepEqual(onboardingRouteNavigation("objectives"), { back: "intro", next: "contacts" });
  assert.deepEqual(onboardingRouteNavigation("contact"), { back: "contacts", next: "google" });
  assert.deepEqual(onboardingRouteNavigation("final"), { back: "google", next: null });
  assert.doesNotMatch(source("../components/OnboardingRoutePage.tsx"), /router\.back|history\./);
});

test("la URL identifica el paso y permite restaurar lastStep al refrescar", () => {
  const pathname = "/onboarding/google";
  const step = onboardingStepFromPathname(pathname);
  assert.equal(onboardingRouteIdFromPathname(pathname), "google");
  assert.equal(step, "google");

  const restored = moveOnboardingToStep(beginOnboarding(INITIAL_ONBOARDING_STATE), step!);
  assert.equal(restored.status, "in_progress");
  assert.equal(restored.lastStep, "google");
});

test("Ver tutorial abre el replay permanente desde el header", () => {
  const shellSource = source("../components/Shell.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(shellSource, /nav-tutorial-link[\s\S]*onClick=\{onboarding\.replay\}[\s\S]*Ver tutorial/);
  assert.match(providerSource, /function replay\(\)[\s\S]*router\.push\(transition\.route\)/);
  assert.doesNotMatch(shellSource, /Empezar|Continuar|shouldShowOnboardingStart/);
});

test("replay iniciado en una ruta normal conserva la sesión hasta mostrar la intro", () => {
  const completed = completeOnboarding();
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "contact");
  const completedReplay = beginOnboardingReplay(completed);
  const dismissedReplay = beginOnboardingReplay(dismissed);

  assert.equal(shouldClearOnboardingSessionOnNormalRoute(completedReplay.session), false);
  assert.equal(shouldRedirectOnboardingIntroToProduct(completedReplay.state, completedReplay.session), false);
  assert.equal(shouldRedirectOnboardingIntroToProduct(dismissedReplay.state, dismissedReplay.session), false);
  assert.equal(completedReplay.route, "/onboarding");
  assert.equal(shouldClearOnboardingSessionOnNormalRoute({ active: true, replay: false }), true);
});

test("la intro es privada pero no monta Shell ni Coach", () => {
  const routeComponent = source("../components/OnboardingRoutePage.tsx");
  const introStart = routeComponent.indexOf("function OnboardingIntro");
  const introEnd = routeComponent.indexOf("function OnboardingObjectivesStep", introStart);
  const introSource = routeComponent.slice(introStart, introEnd);

  assert.match(routeComponent, /<AuthGate>[\s\S]*routeId === "intro"[\s\S]*<OnboardingProvider>/);
  assert.match(introSource, /onboarding-intro-shell/);
  assert.match(introSource, /Tu red puede abrir tu próxima oportunidad\./);
  assert.match(introSource, /Activa tus próximas conversaciones/);
  assert.doesNotMatch(introSource, /<Shell|<CoachModule|Introducción/);
});

test("los pasos guiados usan AuthGate y Shell antes del contenido real", () => {
  const routeComponent = source("../components/OnboardingRoutePage.tsx");
  assert.match(routeComponent, /<AuthGate>[\s\S]*<Shell>[\s\S]*<OnboardingRouteContent/);

  const routes = [
    ["../app/onboarding/objetivos/page.tsx", "objectives"],
    ["../app/onboarding/contactos/page.tsx", "contacts"],
    ["../app/onboarding/contacto/page.tsx", "contact"],
    ["../app/onboarding/google/page.tsx", "google"],
    ["../app/onboarding/final/page.tsx", "final"]
  ];
  for (const [path, routeId] of routes) {
    assert.match(source(path), new RegExp(`OnboardingRoutePage routeId="${routeId}"`));
  }
});

test("Ver tutorial no se renderiza dentro de rutas onboarding", () => {
  const shellSource = source("../components/Shell.tsx");

  assert.match(shellSource, /const isOnboarding = pathname\.startsWith\("\/onboarding"\)/);
  assert.match(shellSource, /!isOnboarding \? \([\s\S]*Ver tutorial/);
});

test("cualquier setting existente mantiene la ruta normal, incluso in_progress", () => {
  const providerSource = source("../components/OnboardingProvider.tsx");
  const normalRouteStart = providerSource.indexOf("if (!routeId)");
  const normalRouteEnd = providerSource.indexOf("if (routeId === \"intro\")", normalRouteStart);
  const normalRouteSource = providerSource.slice(normalRouteStart, normalRouteEnd);

  assert.ok(normalRouteStart >= 0 && normalRouteEnd > normalRouteStart);
  assert.doesNotMatch(normalRouteSource, /state\.status|router\.replace/);
  assert.match(normalRouteSource, /shouldClearOnboardingSessionOnNormalRoute\(session\)/);
});

test("la navegación activa reconoce Objetivos y Contactos dentro del recorrido", () => {
  const shellSource = source("../components/Shell.tsx");

  assert.match(shellSource, /pathname === "\/objetivos" \|\| pathname === "\/onboarding\/objetivos"/);
  assert.match(shellSource, /pathname === "\/contactos"[\s\S]*pathname === "\/onboarding\/contactos"[\s\S]*pathname === "\/onboarding\/contacto"/);
});

test("Objetivos y Contactos reutilizan las vistas reales sin duplicar páginas", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const objectivesSource = source("../components/ObjectivesPage.tsx");
  const contactsSource = source("../components/ReadOnlyContacts.tsx");

  assert.match(routeSource, /<ObjectivesPage[\s\S]*onboardingCoach=/);
  assert.match(routeSource, /<ReadOnlyContacts[\s\S]*beforeList=/);
  assert.match(objectivesSource, /onboardingCoach\?: ReactNode/);
  assert.match(contactsSource, /beforeList\?: ReactNode/);
});

test("Contactos reutiliza el editor real para crear contactos manualmente", () => {
  const tableSource = source("../components/ContactTable.tsx");

  assert.match(tableSource, /import \{ ContactEditorDialog \} from "\.\/ContactEditorDialog"/);
  assert.match(tableSource, /Crear contacto/);
  assert.match(tableSource, /<ContactEditorDialog[\s\S]*open=\{contactEditorOpen\}/);
  assert.match(tableSource, /onSaved=\{\(\) => \{[\s\S]*onReload\?\.\(\)/);
});

test("Contactos decide ficha o Google usando únicamente contactos reales resueltos", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");

  assert.match(routeSource, /setFirstContactId\(contacts\[0\]\?\.id \?\? ""\)/);
  assert.match(routeSource, /moveTo\(firstContactId \? "contact" : "google"\)/);
  assert.match(routeSource, /const contacts = await readContactListRows\(\)/);
  assert.match(routeSource, /const firstContact = contacts\[0\]/);
  assert.match(routeSource, /if \(!firstContact\)[\s\S]*moveTo\("google"\)/);
  assert.doesNotMatch(routeSource, /display_name.*find|find\(.*display_name/);
});

test("contactId se mantiene efímero y no forma parte del payload persistido", () => {
  const stateSource = source("../lib/onboarding.ts");
  const storeSource = source("../lib/onboardingStore.ts");

  assert.doesNotMatch(stateSource, /contactId|contact_id/);
  assert.doesNotMatch(storeSource, /contactId|contact_id/);
});

test("ficha normal conserva suggestions y ficha onboarding inyecta el mismo Coach en modo onboarding", () => {
  const profileSource = source("../components/ContactProfile.tsx");
  const routeSource = source("../components/OnboardingRoutePage.tsx");

  assert.match(profileSource, /onboardingCoach \?\? \([\s\S]*<CoachModule[\s\S]*variant="contact"/);
  assert.match(routeSource, /<ContactProfile[\s\S]*onboardingCoach=\{coach\}/);
  assert.match(routeSource, /function OnboardingCoach[\s\S]*mode="onboarding"/);
});

test("Google reutiliza AccountPage, permanece opcional y retorna al paso onboarding", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const accountSource = source("../components/AccountPage.tsx");

  assert.match(routeSource, /Si prefieres, también puedes construir tu red manualmente/);
  assert.match(routeSource, /<AccountPage view="google-onboarding" \/>/);
  assert.match(accountSource, /redirectPath="\/onboarding\/google"/);
  assert.match(accountSource, /reconnectGoogle\(googleRequiredScopes\(\), `\$\{window\.location\.origin\}\$\{redirectPath\}`\)/);
});

test("las burbujas usan el copy aprobado y una estructura uniforme", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");

  assert.match(routeSource, /title="Comencemos definiendo tus objetivos"/);
  assert.match(routeSource, /title="Aquí administras tus contactos"/);
  assert.match(routeSource, /title="Cada contacto tiene una ficha con su historia"/);
  assert.match(routeSource, /title="Importa tus contactos desde Google o ingrésalos manualmente"/);
  assert.doesNotMatch(routeSource, /<ul className="onboarding-summary"|onboarding-coach-continuation/);
});

test("final completa y navega al home real", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(routeSource, /nextLabel="Fin del tutorial"/);
  assert.match(routeSource, /Coach seguirá acompañándote con sugerencias/);
  assert.match(providerSource, /persist\(completeOnboarding\(\)\)[\s\S]*router\.push\("\/"\)/);
});

test("el replay preserva dismissed y completed, y Cuenta no ofrece navegación de producto", () => {
  const accountSource = source("../components/AccountPage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "contact");
  const completed = completeOnboarding();

  assert.doesNotMatch(accountSource, /Cómo usar Coffeecito|onboarding\.replay/);
  assert.match(providerSource, /function replay\(\)[\s\S]*router\.push\(transition\.route\)/);
  assert.match(providerSource, /session\.active && !session\.replay/);
  assert.match(source("../components/OnboardingRoutePage.tsx"), /onboarding\.replaying \? onboarding\.exit\(\) : onboarding\.defer\(\)/);
  assert.deepEqual(beginOnboardingReplay(dismissed).state, dismissed);
  assert.deepEqual(beginOnboardingReplay(completed).state, completed);
});

test("Coach onboarding ocupa una sola franja superior y conserva una única mascota", () => {
  const css = source("../styles/components.css");
  const coachSource = source("../components/CoachPreview.tsx");

  assert.match(css, /\.contact-profile-grid\.onboarding-contact-profile-grid[\s\S]*"coach coach"/);
  assert.doesNotMatch(css, /\.onboarding-objectives-page\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.equal(coachSource.match(/function CoachMascot/g)?.length, 1);
  assert.match(coachSource, /function CoachOnboardingContent\([\s\S]*botSize = "normal"/);
});

test("onboarding usa spacing semántico y mantiene al Coach hablando", () => {
  const css = source("../styles/components.css");
  const tokens = source("../styles/tokens.css");
  const coachSource = source("../components/CoachPreview.tsx");

  assert.match(tokens, /--crm-section-gap: 14px/);
  assert.match(css, /\.onboarding-objectives-page[\s\S]*gap: var\(--crm-section-gap\)/);
  assert.match(css, /\.onboarding-contacts-view,[\s\S]*gap: var\(--crm-section-gap\)/);
  assert.match(css, /\.coach-floating-bot\.speaking \.coach-bot-mouth/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.coach-floating-bot\.speaking \.coach-bot-mouth[\s\S]*animation: none/);
  assert.match(coachSource, /<CoachMascot size=\{botSize\} speaking=\{mode === "onboarding"\} \/>/);
  assert.match(css, /\.coach-onboarding-bubble[\s\S]*border-radius: 14px/);
  assert.match(css, /\.coach-onboarding-bubble::before,[\s\S]*\.coach-onboarding-bubble::after/);
  assert.match(css, /border-right: 13px solid var\(--crm-border\)/);
  assert.match(css, /border-right: 11px solid var\(--crm-surface\)/);
  assert.match(css, /border-bottom: 13px solid var\(--crm-border\)/);
  assert.match(css, /border-bottom: 10px solid var\(--crm-surface\)/);
});

test("Contactos confina el tablero ancho sin desbordar la página onboarding", () => {
  const css = source("../styles/components.css");

  assert.match(css, /\.onboarding-contacts-view[\s\S]*max-width: 100%/);
  assert.match(css, /\.onboarding-contacts-view \.contacts-status-board[\s\S]*overflow-x: auto/);
});

test("reset de prueba solo se renderiza en development y elimina el setting real", () => {
  const accountSource = source("../components/AccountPage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");
  const storeSource = source("../lib/onboardingStore.ts");

  assert.match(accountSource, /isOnboardingTestResetAvailable\(\)[\s\S]*Reiniciar onboarding de prueba/);
  assert.match(providerSource, /if \(!isOnboardingTestResetAvailable\(\)\) return/);
  assert.match(providerSource, /deleteProductOnboardingState\(\)[\s\S]*clearOnboardingSession\(\)[\s\S]*setState\(INITIAL_ONBOARDING_STATE\)[\s\S]*router\.push\("\/"\)/);
  assert.match(storeSource, /\.from\("user_settings"\)[\s\S]*\.delete\(\)[\s\S]*PRODUCT_ONBOARDING_SETTING_KEY/);
  assert.equal(isOnboardingTestResetAvailable("production"), false);
  assert.equal(isOnboardingTestResetAvailable("development"), true);
  assert.equal(shouldShowAutomaticOnboardingIntro({ exists: false, state: INITIAL_ONBOARDING_STATE }), true);
});

test("onboarding no agrega datos dummy, fixtures ni screenshots", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  assert.doesNotMatch(routeSource, /dummy|fixture|screenshot|mock contact/i);
});

test("modo onboarding del Coach no monta acciones ni diálogos de sugerencias", () => {
  const coachSource = source("../components/CoachPreview.tsx");
  const start = coachSource.indexOf("function CoachOnboardingContent");
  const end = coachSource.indexOf("function CoachFrame", start);
  const onboardingSource = coachSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(onboardingSource, /executeCoachTodos|dismissCoachTodos|reviewNetworkingStatusSuggestions/);
  assert.doesNotMatch(onboardingSource, /CoachConfigDialog|CoachActionLogDialog|coach-actions/);
  assert.match(onboardingSource, /coach-onboarding-bubble/);
});

test("no quedan CTA ni animaciones dinámicas de onboarding en el header", () => {
  const shellSource = source("../components/Shell.tsx");
  const css = source("../styles/components.css");
  assert.doesNotMatch(shellSource, /Empezar|Continuar|onboarding\.state|onboarding\.loading/);
  assert.doesNotMatch(css, /onboarding-start-link|onboarding-start-pulse/);
  assert.match(css, /\.nav-tutorial-link[\s\S]*border: 0/);
});

test("persistencia usa una clave versionada y un wrapper dedicado", () => {
  const storeSource = source("../lib/onboardingStore.ts");
  const genericStoreSource = source("../lib/userSettingsActions.ts");

  assert.match(storeSource, /PRODUCT_ONBOARDING_SETTING_KEY/);
  assert.match(storeSource, /\.from\("user_settings"\)/);
  assert.match(storeSource, /onConflict: "user_id,setting_key"/);
  assert.doesNotMatch(genericStoreSource, /product_onboarding_v1/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
