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
  shouldShowAutomaticOnboardingIntro,
  shouldShowOnboardingStart
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

test("Ahora no conserva not_started, registra introSeen y mantiene Empezar visible", () => {
  const deferred = deferOnboarding();
  assert.deepEqual(deferred, {
    version: 1,
    status: "not_started",
    introSeen: true
  });
  assert.equal(shouldShowOnboardingStart(deferred), true);
});

test("Comenzar recorrido inicia en objectives y oculta Empezar", () => {
  const started = beginOnboarding(deferOnboarding());
  assert.deepEqual(started, {
    version: 1,
    status: "in_progress",
    introSeen: true,
    lastStep: "objectives"
  });
  assert.equal(onboardingRouteFor(started.lastStep), "/onboarding/objetivos");
  assert.equal(shouldShowOnboardingStart(started), false);
});

test("Salir deja dismissed, conserva el último paso y no reactiva Empezar", () => {
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "contacts");
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.lastStep, "contacts");
  assert.equal(shouldShowOnboardingStart(dismissed), false);
});

test("completed oculta Empezar y replay no cambia dismissed ni completed", () => {
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "google");
  const completed = completeOnboarding();

  assert.deepEqual(beginOnboardingReplay(dismissed).state, dismissed);
  assert.deepEqual(beginOnboardingReplay(completed).state, completed);
  assert.deepEqual(beginOnboardingReplay(completed).session, { active: true, replay: true });
  assert.equal(beginOnboardingReplay(completed).route, "/onboarding");
  assert.equal(shouldShowOnboardingStart(completed), false);
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

test("Empezar abre /onboarding sin iniciar el recorrido", () => {
  const shellSource = source("../components/Shell.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(shellSource, /shouldShowOnboardingStart\(onboarding\.state\)/);
  assert.match(shellSource, /onClick=\{onboarding\.openIntro\}/);
  assert.match(providerSource, /function openIntro\(\)[\s\S]*router\.push\(onboardingRouteFor\("intro"\)\)/);
  assert.doesNotMatch(shellSource, /onClick=\{\(\) => void onboarding\.start\(\)\}/);
});

test("la intro es privada pero no monta Shell ni Coach", () => {
  const routeComponent = source("../components/OnboardingRoutePage.tsx");
  const introStart = routeComponent.indexOf("function OnboardingIntro");
  const introEnd = routeComponent.indexOf("function OnboardingObjectivesStep", introStart);
  const introSource = routeComponent.slice(introStart, introEnd);

  assert.match(routeComponent, /<AuthGate>[\s\S]*routeId === "intro"[\s\S]*<OnboardingProvider>/);
  assert.match(introSource, /onboarding-intro-shell/);
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

test("Empezar no se renderiza dentro de rutas onboarding", () => {
  const shellSource = source("../components/Shell.tsx");

  assert.match(shellSource, /const isOnboarding = pathname\.startsWith\("\/onboarding"\)/);
  assert.match(shellSource, /!isOnboarding && !onboarding\.loading && shouldShowOnboardingStart/);
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

  assert.match(routeSource, /Conectar Google es opcional/);
  assert.match(routeSource, /<AccountPage view="google-onboarding" \/>/);
  assert.match(accountSource, /redirectPath="\/onboarding\/google"/);
  assert.match(accountSource, /reconnectGoogle\(googleRequiredScopes\(\), `\$\{window\.location\.origin\}\$\{redirectPath\}`\)/);
});

test("final completa y navega a Objetivos", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(routeSource, /nextLabel="Ir a mis objetivos"/);
  assert.match(routeSource, /Coach seguirá acompañándote\./);
  assert.match(routeSource, /Tú decides qué sugerencias aplicar\./);
  assert.match(providerSource, /persist\(completeOnboarding\(\)\)[\s\S]*router\.push\("\/objetivos"\)/);
});

test("Cuenta ofrece replay permanente sin alterar dismissed o completed", () => {
  const accountSource = source("../components/AccountPage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");
  const dismissed = dismissOnboarding(beginOnboarding(INITIAL_ONBOARDING_STATE), "contact");
  const completed = completeOnboarding();

  assert.match(accountSource, /Cómo usar Coffeecito/);
  assert.match(accountSource, /onClick=\{onboarding\.replay\}/);
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

test("CTA Empezar pulsa dos veces y respeta prefers-reduced-motion por CSS", () => {
  const css = source("../styles/components.css");
  assert.match(css, /\.onboarding-start-link[\s\S]*animation: onboarding-start-pulse 900ms ease-in-out 2/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.onboarding-start-link[\s\S]*animation: none/);
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
