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
  canMoveOnboardingToStep,
  completeOnboarding,
  isOnboardingReplayAllowed,
  isOnboardingRouteAdmitted,
  isProductOnboardingComplete,
  moveOnboardingToStep,
  normalizeOnboardingSession,
  onboardingRouteFor,
  onboardingRouteIdFromPathname,
  onboardingRouteNavigation,
  onboardingStepFromPathname,
  isOnboardingTestResetAvailable,
  parseProductOnboardingState,
  requiredOnboardingRoute,
  resolveStoredOnboardingState,
  serializeProductOnboardingState
} from "../lib/onboarding.ts";

test("parser conserva payloads v1 previos, acepta dismissed y rechaza payloads inválidos", () => {
  const previousState = {
    version: 1 as const,
    status: "in_progress" as const,
    introSeen: true,
    lastStep: "contacts" as const
  };
  const dismissedState = {
    version: 1 as const,
    status: "dismissed" as const,
    introSeen: true,
    lastStep: "contact" as const
  };

  assert.deepEqual(parseProductOnboardingState(serializeProductOnboardingState(previousState)), previousState);
  assert.deepEqual(parseProductOnboardingState(serializeProductOnboardingState(dismissedState)), dismissedState);
  assert.equal(parseProductOnboardingState(""), null);
  assert.equal(parseProductOnboardingState("not-json"), null);
  assert.equal(parseProductOnboardingState('{"version":2,"status":"completed","introSeen":true}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"unknown","introSeen":true}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"not_started","introSeen":"yes"}'), null);
  assert.equal(parseProductOnboardingState('{"version":1,"status":"in_progress","introSeen":true,"lastStep":"other"}'), null);
});

test("missing e inválido normalizan al estado inicial obligatorio", () => {
  const missing = resolveStoredOnboardingState({ exists: false, value: null });
  const invalid = resolveStoredOnboardingState({ exists: true, value: "invalid" });
  const invalidLastStep = resolveStoredOnboardingState({
    exists: true,
    value: '{"version":1,"status":"in_progress","introSeen":true,"lastStep":"other"}'
  });

  assert.deepEqual(missing, INITIAL_ONBOARDING_STATE);
  assert.deepEqual(invalid, INITIAL_ONBOARDING_STATE);
  assert.deepEqual(invalidLastStep, INITIAL_ONBOARDING_STATE);
  assert.equal(requiredOnboardingRoute(invalidLastStep), "intro");
  assert.equal(onboardingRouteFor("intro"), "/onboarding");
});

test("solo completed admite producto y los estados incompletos tienen ruta obligatoria", () => {
  const notStarted = INITIAL_ONBOARDING_STATE;
  const inProgress = { ...beginOnboarding(notStarted), lastStep: "contacts" as const };
  const dismissed = { version: 1 as const, status: "dismissed" as const, introSeen: true };
  const completed = completeOnboarding();

  for (const state of [notStarted, inProgress, dismissed]) {
    assert.equal(isProductOnboardingComplete(state), false);
    assert.equal(isOnboardingRouteAdmitted(state, { active: false, replay: false }, null), false);
  }
  assert.equal(requiredOnboardingRoute(notStarted), "intro");
  assert.equal(requiredOnboardingRoute(dismissed), "intro");
  assert.equal(requiredOnboardingRoute(inProgress), "contacts");
  assert.equal(requiredOnboardingRoute({ ...inProgress, lastStep: undefined }), "objectives");
  assert.equal(isOnboardingRouteAdmitted(notStarted, { active: false, replay: false }, "intro"), true);
  assert.equal(isOnboardingRouteAdmitted(dismissed, { active: false, replay: false }, "intro"), true);
  assert.equal(isProductOnboardingComplete(completed), true);
  assert.equal(isOnboardingRouteAdmitted(completed, { active: false, replay: false }, null), true);
  assert.equal(isOnboardingRouteAdmitted(completed, { active: false, replay: false }, "intro"), false);
  assert.equal(isOnboardingRouteAdmitted(completed, { active: false, replay: false }, "final"), false);
});

test("Empecemos inicia en objectives", () => {
  const started = beginOnboarding(INITIAL_ONBOARDING_STATE);
  assert.deepEqual(started, {
    version: 1,
    status: "in_progress",
    introSeen: true,
    lastStep: "objectives"
  });
  assert.equal(onboardingRouteFor(started.lastStep), "/onboarding/objetivos");
});

test("una ruta guiada solo se admite cuando coincide con lastStep", () => {
  const started = moveOnboardingToStep(beginOnboarding(INITIAL_ONBOARDING_STATE), "contacts");
  const session = { active: true, replay: false };

  assert.equal(isOnboardingRouteAdmitted(started, session, "contacts"), true);
  assert.equal(isOnboardingRouteAdmitted(started, session, "google"), false);
  assert.equal(isOnboardingRouteAdmitted(started, session, "final"), false);
  assert.equal(isOnboardingRouteAdmitted(started, session, null), false);
});

test("replay solo es válido para completed y no cambia su estado persistente", () => {
  const incomplete = moveOnboardingToStep(beginOnboarding(INITIAL_ONBOARDING_STATE), "google");
  const completed = completeOnboarding();
  const completedReplay = beginOnboardingReplay(completed);
  const staleReplay = beginOnboardingReplay(incomplete);

  assert.deepEqual(completedReplay.state, completed);
  assert.deepEqual(completedReplay.session, { active: true, replay: true });
  assert.equal(completedReplay.route, "/onboarding");
  assert.equal(isOnboardingReplayAllowed(completed, completedReplay.session), true);
  assert.equal(isOnboardingReplayAllowed(incomplete, staleReplay.session), false);
  assert.deepEqual(normalizeOnboardingSession(incomplete, staleReplay.session), { active: false, replay: false });
});

test("las transiciones legítimas no permiten adelantar el recorrido", () => {
  assert.equal(canMoveOnboardingToStep("objectives", "google"), true);
  assert.equal(canMoveOnboardingToStep("objectives", "final"), false);
  assert.equal(canMoveOnboardingToStep("google", "contacts"), true);
  assert.equal(canMoveOnboardingToStep("contacts", "contact"), true);
  assert.equal(canMoveOnboardingToStep("contacts", "final"), true);
  assert.equal(canMoveOnboardingToStep("contact", "final"), true);
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
  const completedReplay = beginOnboardingReplay(completed);

  assert.equal(isOnboardingRouteAdmitted(completedReplay.state, completedReplay.session, null), true);
  assert.equal(isOnboardingRouteAdmitted(completedReplay.state, completedReplay.session, "intro"), true);
  assert.equal(completedReplay.route, "/onboarding");
});

test("la intro es privada pero no monta Shell ni Coach", () => {
  const routeComponent = source("../components/OnboardingRoutePage.tsx");
  const slidesSource = source("../components/OnboardingIntroSlides.tsx");
  const styles = source("../styles/components.css");
  const introStart = routeComponent.indexOf("function OnboardingIntro");
  const introEnd = routeComponent.indexOf("function OnboardingObjectivesStep", introStart);
  const introSource = routeComponent.slice(introStart, introEnd);
  const slideCount = slidesSource.match(/<SwiperSlide>/g)?.length ?? 0;
  const navigationStart = slidesSource.indexOf('<div className="onboarding-intro-slide-navigation">');
  const navigationEnd = slidesSource.indexOf("</div>\n      </div>\n      {onExit", navigationStart);
  const primaryNavigation = slidesSource.slice(navigationStart, navigationEnd);

  assert.match(routeComponent, /<AuthGate>[\s\S]*routeId === "intro"[\s\S]*<OnboardingProvider>/);
  assert.match(introSource, /onboarding-intro-shell/);
  assert.match(introSource, /Simplifica y ordena tu networking\./);
  assert.match(introSource, /Organiza tu red, mantén visibles tus relaciones y pendientes, y enfócate en las conversaciones que importan/);
  assert.match(introSource, /onboarding-intro-background/);
  assert.match(styles, /url\("\/brand\/coffeecito-onboarding-bg\.webp"\)/);
  assert.match(styles, /\.onboarding-intro-layout \{[\s\S]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\)/);
  assert.match(styles, /@media \(max-width: 920px\) \{[\s\S]*\.onboarding-intro-layout \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(introSource, /<OnboardingIntroSlides/);
  assert.equal(slideCount, 4);
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
  assert.match(slidesSource, /onboarding-intro-slide-final-content/);
  assert.equal(slidesSource.match(/Coffeecito se encarga de la gestión\. Tú del café y la conversación\./g)?.length, 1);
  assert.doesNotMatch(slidesSource, /52% vs 35%|5,2% vs 3,1%|Ashby|Pinpoint|job boards|Para eso está Coffeecito/);
  assert.doesNotMatch(slidesSource, /autoplay/i);
  assert.doesNotMatch(routeComponent, /onboarding-flow|Define tus objetivos|Activa tus próximas conversaciones/);
  assert.match(introSource, /<OnboardingIntroSlides[\s\S]*onExit=\{onboarding\.replaying[\s\S]*onStart=\{\(\) => void onboarding\.start\(\)\}/);
  assert.match(slidesSource, /onStart/);
  assert.match(slidesSource, /Empecemos/);
  assert.ok(navigationStart >= 0 && navigationEnd > navigationStart);
  assert.doesNotMatch(primaryNavigation, /onExit|Salir/);
  assert.match(slidesSource, /<div className="onboarding-intro-replay-exit">[\s\S]*<Button onClick=\{onExit\} tone="ghost">Salir<\/Button>/);
  assert.doesNotMatch(introSource, /Ahora no|onboarding\.defer|onboarding-intro-actions/);
  assert.doesNotMatch(introSource, /Comenzar recorrido/);
  assert.match(styles, /--onboarding-intro-title-size: clamp\(24px, 2\.1vw, 32px\)/);
  assert.match(styles, /--onboarding-intro-body-size: 15px/);
  assert.match(styles, /\.onboarding-intro-slide-final-content \{[\s\S]*place-items: center[\s\S]*text-align: center/);
  assert.match(styles, /\.onboarding-intro-slide-navigation \.button\.onboarding-intro-start \{[\s\S]*background: var\(--brand-espresso\)[\s\S]*color: var\(--brand-warm-white\)/);
  assert.match(styles, /\.onboarding-intro-replay-exit \{[\s\S]*justify-content: center/);
  assert.match(styles, /\.onboarding-intro-slide-navigation \{[\s\S]*display: grid;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /onboarding-intro-actions|onboarding-intro-defer|onboarding-intro-closing/);
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

test("rutas privadas quedan cerradas hasta completed y Shell evita el flash privado", () => {
  const providerSource = source("../components/OnboardingProvider.tsx");
  const shellSource = source("../components/Shell.tsx");
  const normalRouteStart = providerSource.indexOf("if (!routeId)");
  const normalRouteEnd = providerSource.indexOf("if (routeId === \"intro\")", normalRouteStart);
  const normalRouteSource = providerSource.slice(normalRouteStart, normalRouteEnd);

  assert.ok(normalRouteStart >= 0 && normalRouteEnd > normalRouteStart);
  assert.match(normalRouteSource, /!isProductOnboardingComplete\(state\)[\s\S]*router\.replace\(onboardingRouteFor\(requiredOnboardingRoute\(state\)\)\)/);
  assert.match(providerSource, /isOnboardingRouteAdmitted\(state, session, routeId\)/);
  assert.match(shellSource, /if \(onboarding\.loading \|\| !onboarding\.routeReady\)[\s\S]*Preparando recorrido/);
  assert.ok(shellSource.indexOf("if (onboarding.loading || !onboarding.routeReady)") < shellSource.indexOf("<header"));
});

test("errores de carga y escritura quedan fail-closed", () => {
  const providerSource = source("../components/OnboardingProvider.tsx");
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const shellSource = source("../components/Shell.tsx");

  assert.match(providerSource, /setLoadFailed\(true\)[\s\S]*No pudimos comprobar el avance de la guía/);
  assert.match(providerSource, /const routeReady = !loading && !loadFailed && isOnboardingRouteAdmitted/);
  assert.match(providerSource, /await saveProductOnboardingState\(nextState\)[\s\S]*setState\(nextState\)[\s\S]*catch/);
  assert.match(providerSource, /if \(completionPending\.current\) return;[\s\S]*completionPending\.current = true/);
  assert.match(providerSource, /if \(!\(await persist\(completeOnboarding\(\)\)\)\) \{[\s\S]*completionPending\.current = false;[\s\S]*setCompleting\(false\);[\s\S]*return;/);
  assert.equal(providerSource.match(/persist\(completeOnboarding\(\)\)/g)?.length, 1);
  assert.match(providerSource, /clearOnboardingSession\(\);[\s\S]*setSession\(INACTIVE_ONBOARDING_SESSION\);[\s\S]*if \(replayAllowed\) router\.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
  assert.match(providerSource, /state\.status !== "in_progress" \|\| !routeStep[\s\S]*isProductOnboardingComplete\(state\)[\s\S]*ONBOARDING_PRODUCT_DESTINATION/);
  assert.match(routeSource, /nextDisabled=\{nextDisabled \|\| \(routeId === "final" && onboarding\.completing\)\}/);
  assert.match(shellSource, /onboarding\.loadFailed[\s\S]*onboarding\.retry/);
  assert.doesNotMatch(providerSource, /Puedes seguir usando Coffeecito normalmente/);
});

test("URL arbitraria no reemplaza lastStep ni permite final prematuro", () => {
  const providerSource = source("../components/OnboardingProvider.tsx");

  assert.match(providerSource, /requiredOnboardingRoute\(state\) !== routeStep[\s\S]*router\.replace\(onboardingRouteFor\(requiredOnboardingRoute\(state\)\)\)/);
  assert.doesNotMatch(providerSource, /moveOnboardingToStep\(state, routeStep\)/);
  assert.match(providerSource, /canMoveOnboardingToStep\(currentStep, step\)/);
  assert.match(providerSource, /state\.lastStep !== "final"[\s\S]*Completa los pasos anteriores/);
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
  assert.match(accountSource, /<VCardImportPanel[\s\S]*actionLabel="Importar archivo vCard"[\s\S]*sourceLabel="vCard \(\.vcf\)"/);
  assert.doesNotMatch(accountSource, /OnboardingVCardImportPreview/);
  assert.match(vcardSource, /accept="\.vcf,text\/vcard,text\/x-vcard"/);
  assert.match(vcardSource, /parseVCardContacts\(await file\.text\(\)\)/);
  assert.match(vcardSource, /<SyncPreviewDialog[\s\S]*onApply=\{\(selectedChanges\) => void applySelection\(selectedChanges\)\}/);
  assert.match(vcardSource, /importSelectedVCardContacts\(selectedContacts, saveContactFromEditor\)/);
  assert.match(accountSource, /redirectPath="\/onboarding\/google"/);
  assert.match(accountSource, /authorizationRedirectPath=\{redirectPath\}/);
  assert.match(accountSource, /resumeImport=\{resumeAction === "import_contacts"\}/);
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

test("mandatory no ofrece salida y replay completed conserva salida descartable", () => {
  const routeSource = source("../components/OnboardingRoutePage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");
  const coachSource = source("../components/CoachPreview.tsx");

  assert.match(routeSource, /nextLabel="Fin del tutorial"/);
  assert.match(routeSource, /Coach seguirá acompañándote con sugerencias/);
  assert.equal(ONBOARDING_PRODUCT_DESTINATION, "/contactos");
  assert.doesNotMatch(routeSource, /Ahora no|onboarding\.defer/);
  assert.match(routeSource, /onExit=\{onboarding\.replaying \? \(\) => void onboarding\.exit\(routeId\) : undefined\}/);
  assert.match(coachSource, /onExit\?: \(\) => void/);
  assert.match(coachSource, /\{onExit \? <Button onClick=\{onExit\}/);
  assert.match(providerSource, /if \(!isOnboardingReplayAllowed\(state, session\)\) return;[\s\S]*router\.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
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

test("el replay preserva completed, stale replay se limpia y Cuenta no ofrece navegación de producto", () => {
  const accountSource = source("../components/AccountPage.tsx");
  const providerSource = source("../components/OnboardingProvider.tsx");
  const completed = completeOnboarding();
  const incomplete = beginOnboarding(INITIAL_ONBOARDING_STATE);

  assert.doesNotMatch(accountSource, /Cómo usar Coffeecito|onboarding\.replay/);
  assert.match(providerSource, /function replay\(\)[\s\S]*if \(!isProductOnboardingComplete\(state\)\) return[\s\S]*router\.push\(transition\.route\)/);
  assert.match(providerSource, /normalizeOnboardingSession\(stored\.state, storedSession\)[\s\S]*clearOnboardingSession\(\)/);
  assert.deepEqual(beginOnboardingReplay(completed).state, completed);
  assert.deepEqual(normalizeOnboardingSession(incomplete, { active: true, replay: true }), { active: false, replay: false });
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
  assert.doesNotMatch(shellSource, /Empezar|Continuar|onboarding\.state/);
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
