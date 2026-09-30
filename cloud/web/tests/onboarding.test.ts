import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INITIAL_ONBOARDING_STATE,
  ONBOARDING_PRODUCT_DESTINATION,
  ONBOARDING_FLOW,
  ONBOARDING_STEPS,
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
  assert.deepEqual(ONBOARDING_STEPS, ["objectives", "google", "contacts", "contact", "final"]);
  assert.deepEqual(ONBOARDING_FLOW, [
    { id: "intro", path: "/onboarding" },
    { id: "objectives", path: "/onboarding/objetivos" },
    { id: "google", path: "/onboarding/google" },
    { id: "contacts", path: "/onboarding/contactos" },
    { id: "contact", path: "/onboarding/contacto" },
    { id: "final", path: "/onboarding/final" }
  ]);
  assert.deepEqual(onboardingRouteNavigation("objectives"), { back: "intro", next: "google" });
  assert.deepEqual(onboardingRouteNavigation("google"), { back: "objectives", next: "contacts" });
  assert.deepEqual(onboardingRouteNavigation("contacts"), { back: "google", next: "contact" });
  assert.deepEqual(onboardingRouteNavigation("contact"), { back: "contacts", next: "final" });
  assert.deepEqual(onboardingRouteNavigation("final"), { back: "contact", next: null });
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
  const slidesSource = source("../components/OnboardingIntroSlides.tsx");
  const styles = source("../styles/components.css");
  const introStart = routeComponent.indexOf("function OnboardingIntro");
  const introEnd = routeComponent.indexOf("function OnboardingObjectivesStep", introStart);
  const introSource = routeComponent.slice(introStart, introEnd);
  const slideCount = slidesSource.match(/<SwiperSlide>/g)?.length ?? 0;

  assert.match(routeComponent, /<AuthGate>[\s\S]*routeId === "intro"[\s\S]*<OnboardingProvider>/);
  assert.match(introSource, /onboarding-intro-shell/);
  assert.match(introSource, /Simplifica y ordena tu networking\./);
  assert.match(introSource, /Organiza tu red, mantén visibles tus relaciones y pendientes, y enfócate en las conversaciones que importan/);
  assert.match(introSource, /onboarding-intro-background/);
  assert.match(styles, /url\("\/brand\/coffeecito-onboarding-bg\.webp"\)/);
  assert.match(styles, /\.onboarding-intro-layout \{[\s\S]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\)/);
  assert.match(styles, /@media \(max-width: 920px\) \{[\s\S]*\.onboarding-intro-layout \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(introSource, /<OnboardingIntroSlides \/>/);
  assert.equal(slideCount, 3);
  assert.match(slidesSource, /pagination=\{\{ type: "progressbar" \}\}/);
  assert.match(slidesSource, />\s*Anterior\s*</);
  assert.match(slidesSource, />\s*Siguiente\s*</);
  assert.doesNotMatch(slidesSource, /Diapositiva \$\{activeIndex \+ 1\} de/);
  assert.match(slidesSource, /Networking no es acumular contactos\. Es construir relaciones que amplían tu acceso a información,/);
  assert.match(slidesSource, /personas y oportunidades relevantes\./);
  assert.match(slidesSource, /la\s+relevancia de esas relaciones, los círculos a los que te conectan y tu capacidad de movilizarlas cuando importa\./);
  assert.match(slidesSource, /Una buena red profesional amplía tu alcance y abre nuevas posibilidades\./);
  assert.match(slidesSource, /Más efectividad en procesos de selección/);
  assert.match(slidesSource, /Más negocios y alianzas/);
  assert.match(slidesSource, /Más crecimiento y posicionamiento/);
  assert.match(slidesSource, /Los candidatos referidos tienen más probabilidades de llegar a entrevistas y recibir ofertas - incluso hasta/);
  assert.match(slidesSource, /<strong>7x<\/strong>/);
  assert.match(slidesSource, /Gestionar tu red no debería convertirse en otro trabajo\./);
  assert.match(slidesSource, /también crecen los contactos, conversaciones y pendientes\./);
  assert.match(slidesSource, /Coffeecito se encarga de la gestión\. Tú del café y la conversación\./);
  assert.doesNotMatch(slidesSource, /52% vs 35%|5,2% vs 3,1%|Ashby|Pinpoint|job boards|Para eso está Coffeecito/);
  assert.doesNotMatch(slidesSource, /autoplay/i);
  assert.doesNotMatch(routeComponent, /onboarding-flow|Define tus objetivos|Activa tus próximas conversaciones/);
  assert.ok(introSource.indexOf("<OnboardingIntroSlides />") < introSource.indexOf("Ahora no"));
  assert.match(introSource, /onboarding\.replaying \? onboarding\.exit\(\) : onboarding\.defer\(\)/);
  assert.match(introSource, /onboarding\.start\(\)/);
  assert.match(introSource, /Empecemos/);
  assert.doesNotMatch(introSource, /Comenzar recorrido/);
  assert.match(styles, /--onboarding-intro-title-size: clamp\(24px, 2\.1vw, 32px\)/);
  assert.match(styles, /--onboarding-intro-body-size: 15px/);
  assert.match(styles, /\.onboarding-intro-actions \.button\.onboarding-intro-start \{[\s\S]*background: var\(--brand-espresso\)[\s\S]*color: var\(--brand-warm-white\)/);
  assert.match(styles, /\.onboarding-intro-actions \.button\.onboarding-intro-defer \{[\s\S]*border-color: transparent/);
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
  assert.match(shellSource, /pathname === "\/"[\s\S]*pathname === "\/contactos"[\s\S]*pathname === "\/onboarding\/contactos"[\s\S]*pathname === "\/onboarding\/contacto"/);
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

test("Contactos se muestra incluso vacío y continúa a ficha o final según contactos reales", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const contactsSource = source("../components/ReadOnlyContacts.tsx");

  assert.match(routeSource, /<ReadOnlyContacts[\s\S]*beforeList=/);
  assert.match(contactsSource, /const table = <ContactTable contacts=\{contacts\} onReload=\{loadContacts\} \/>/);
  assert.match(routeSource, /setFirstContactId\(contacts\[0\]\?\.id \?\? ""\)/);
  assert.match(routeSource, /moveTo\(firstContactId \? "contact" : "final"\)/);
  assert.match(routeSource, /const contacts = await readContactListRows\(\)/);
  assert.match(routeSource, /const firstContact = contacts\[0\]/);
  assert.match(routeSource, /if \(!firstContact\)[\s\S]*moveTo\("final"\)/);
  assert.match(routeSource, /if \(nextProfile\) setProfile\(nextProfile\);[\s\S]*moveTo\("final"\)/);
  assert.match(routeSource, /onBack=\{goBack\}[\s\S]*routeId="final"/);
  assert.match(routeSource, /moveTo\(contacts\.length \? "contact" : "contacts"\)/);
  assert.doesNotMatch(routeSource, /display_name.*find|find\(.*display_name/);
});

test("Contactos abre filtrado por Foco y permite elegir Todos", () => {
  const filtersSource = source("../lib/contactFilters.ts");
  const tableSource = source("../components/ContactTable.tsx");
  const controlsSource = source("../components/ContactFilterControls.tsx");

  assert.match(filtersSource, /DEFAULT_CONTACT_FILTERS: ContactFilters = \{[\s\S]*networkingFocus: "true"/);
  assert.match(tableSource, /useState<ContactFilters>\(DEFAULT_CONTACT_FILTERS\)/);
  assert.match(controlsSource, /label="Foco"[\s\S]*value=\{filters\.networkingFocus\}/);
  assert.match(controlsSource, /<option value="all">Todos<\/option>/);
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

test("el paso de importación monta el importador vCard real junto a Google", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const accountSource = source("../components/AccountPage.tsx");
  const vcardSource = source("../components/VCardImportPanel.tsx");

  assert.match(routeSource, /title="Importa tus contactos de forma masiva"/);
  assert.match(routeSource, /puedes importar contactos desde un archivo vCard o desde tu cuenta de Google/);
  assert.match(routeSource, /Si prefieres, también puedes construir tu red manualmente/);
  assert.match(routeSource, /<AccountPage view="google-onboarding" \/>/);
  assert.match(accountSource, /includeVCard[\s\S]*redirectPath="\/onboarding\/google"/);
  assert.match(accountSource, /includeOtherSources \|\| includeVCard \? <VCardImportPanel \/>/);
  assert.doesNotMatch(accountSource, /OnboardingVCardImportPreview/);
  assert.match(vcardSource, /accept="\.vcf,text\/vcard,text\/x-vcard"/);
  assert.match(vcardSource, /parseVCardContacts\(await file\.text\(\)\)/);
  assert.match(vcardSource, /<SyncPreviewDialog[\s\S]*onApply=\{\(selectedChanges\) => void applySelection\(selectedChanges\)\}/);
  assert.match(vcardSource, /importSelectedVCardContacts\(selectedContacts, saveContactFromEditor\)/);
  assert.match(accountSource, /redirectPath="\/onboarding\/google"/);
  assert.match(accountSource, /reconnectGoogle\(googleRequiredScopes\(\), `\$\{window\.location\.origin\}\$\{redirectPath\}`\)/);
});

test("las burbujas usan el copy aprobado y una estructura uniforme", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");

  assert.match(routeSource, /title="Comencemos definiendo tus objetivos"/);
  assert.match(routeSource, /title="Aquí organizas y priorizas tu red"/);
  assert.match(routeSource, /Por defecto, esta vista muestra sólo los contactos que quieres priorizar para hacer networking\. En\s+Coffeecito, esos contactos se marcan como Foco\./);
  assert.match(routeSource, /Cambia el filtro de “Foco” a “Todos” para revisar tu red completa y marcar como Foco a las personas que\s+quieras priorizar\./);
  assert.match(routeSource, /También puedes arrastrar una tarjeta para actualizar su estado, crear nuevos contactos o gestionar varios\s+desde la tabla inferior\./);
  assert.match(routeSource, /title="Cada contacto tiene una ficha con su historia"/);
  assert.match(routeSource, /Aquí puedes editar la información del contacto y mantener todo el contexto de la relación en un solo lugar\./);
  assert.match(routeSource, /Registra interacciones —mensajes, citas, correos o llamadas— y edítalas para incorporar minutas y notas\./);
  assert.match(routeSource, /También puedes registrar personas referidas durante esas interacciones\. Si una se vuelve relevante, puedes\s+convertirla en contacto y comenzar a darle seguimiento en Coffeecito\./);
  assert.match(routeSource, /title="Importa tus contactos de forma masiva"/);
  assert.doesNotMatch(routeSource, /<ul className="onboarding-summary"|onboarding-coach-continuation/);
});

test("las salidas visibles del onboarding navegan a Contactos", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(routeSource, /nextLabel="Fin del tutorial"/);
  assert.match(routeSource, /Coach seguirá acompañándote con sugerencias/);
  assert.equal(ONBOARDING_PRODUCT_DESTINATION, "/contactos");
  assert.match(providerSource, /function defer\(\)[\s\S]*router\.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
  assert.match(providerSource, /function exit\([\s\S]*router\.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
  assert.match(providerSource, /function complete\(\)[\s\S]*router\.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
});

test("Dashboard queda fuera de la navegación pero su ruta sigue disponible", () => {
  const shellSource = source("../components/Shell.tsx");
  const rootRoute = source("../app/page.tsx");
  const dashboardRoute = source("../app/dashboard/page.tsx");

  assert.doesNotMatch(shellSource, />\s*Dashboard\s*</);
  assert.doesNotMatch(shellSource, /<Icon name="chart"/);
  assert.match(rootRoute, /<ReadOnlyContacts \/>/);
  assert.doesNotMatch(rootRoute, /ReadOnlyDashboard/);
  assert.match(dashboardRoute, /<ReadOnlyDashboard \/>/);
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

  assert.match(css, /\.contact-profile-grid\.onboarding-contact-profile-grid[\s\S]*"identity"[\s\S]*"interactions"[\s\S]*"side"/);
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
  assert.match(css, /\.coach-bubble::before,[\s\S]*\.coach-bubble::after/);
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
