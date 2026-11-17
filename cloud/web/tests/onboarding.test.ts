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
import {
  PROFESSIONAL_SITUATION_OPTIONS,
  startingPointIsComplete,
  validateStartingPoint
} from "../lib/startingPoint.ts";

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

test("Empecemos inicia en Tu objetivo, compatible con el payload v1", () => {
 const started = beginOnboarding(INITIAL_ONBOARDING_STATE);
 assert.deepEqual(started,{version:1,status:"in_progress",introSeen:true,lastStep:"objectives"});
 assert.equal(onboardingRouteFor(started.lastStep),"/onboarding/objetivos");
 assert.equal(onboardingRouteFor("starting_point"),"/onboarding/objetivos");
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

test("transiciones consecutivas y aliases legacy sin saltar etapas", () => {
 for (const [a,b,allowed] of [["objectives","google",true],["google","contacts",true],["contacts","google",true],["objectives","contacts",false],["starting_point","contacts",false],["contact","google",true]] as const)
 assert.equal(canMoveOnboardingToStep(a,b),allowed);
});

test("tres pasos guiados y rutas legacy conservadas como aliases", () => {
 assert.deepEqual(ONBOARDING_FLOW.map(s=>s.id),["intro","objectives","google","contacts"]);
 assert.deepEqual(onboardingRouteNavigation("objectives"),{back:"intro",next:"google"});
 assert.deepEqual(onboardingRouteNavigation("google"),{back:"objectives",next:"contacts"});
 assert.deepEqual(onboardingRouteNavigation("contacts"),{back:"google",next:null});
 for(const legacy of ["starting_point","contact","final"] as const) {
 const state={...beginOnboarding(INITIAL_ONBOARDING_STATE),lastStep:legacy};
 assert.equal(requiredOnboardingRoute(state),legacy==="starting_point"?"objectives":"contacts");
 }
 assert.ok(ONBOARDING_STEPS.includes("final"));
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

test("Ver tutorial permanece en la navegación normal", () => {
 assert.match(source("../components/WorkspaceNavigation.tsx"),/onboarding.replay/);
 assert.match(source("../components/OnboardingProvider.tsx"),/function replay\(\)/);
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
  assert.match(slidesSource, /Hay un diamante en bruto en tu red\./);
  assert.match(slidesSource, /Tus contactos pueden ser el punto de partida de tu próximo trabajo, negocio o marca profesional\./);
  assert.match(slidesSource, /Una red bien cultivada abre oportunidades\./);
  assert.match(slidesSource, /Encontrar tu próximo trabajo:/);
  assert.match(slidesSource, /Generar nuevos negocios:/);
  assert.match(slidesSource, /Fortalecer tu posicionamiento:/);
  assert.match(slidesSource, /<ul className="onboarding-intro-benefits">/);
  assert.equal((slidesSource.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(slidesSource, /7x|benchmarks|onboarding-intro-questions/);
  assert.match(slidesSource, /Que organizar tu red no te quite tiempo para conectar\./);
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
  assert.match(slidesSource, /<div className="onboarding-intro-replay-exit">[\s\S]*<Button onClick=\{onExit\} tone="ghost">Salir del tutorial<\/Button>/);
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
    ["../app/onboarding/punto-de-partida/page.tsx", "starting_point"],
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

test("el shell del tutorial no monta navegación ni utilidades privadas", () => {
 assert.match(source("../components/Shell.tsx"),/path.startsWith\("\/onboarding"\) \? <>\{children\}<\/> : <ApplicationShellContent>/);
 const frame=source("../components/OnboardingRoutePage.tsx").split("export function OnboardingFrame")[1].split("function OnboardingObjectiveStep")[0];
 assert.doesNotMatch(frame,/ActivitySyncButton|Cuenta|WorkspaceNavigation/);
 assert.match(frame,/Saltar el tour/);
});

test("gate privado sigue fail-closed mientras se resuelve onboarding", () => {
 const provider=source("../components/OnboardingProvider.tsx");
 assert.match(provider,/if \(!routeId\)[\s\S]*!isProductOnboardingComplete\(state\)/);
 assert.match(source("../components/ApplicationShellContent.tsx"),/onboarding.loading/);
 assert.match(provider,/isOnboardingRouteAdmitted\(state, session, routeId\)/);
});

test("errores de avance bloquean navegación y ofrecen reintento", () => {
 const provider=source("../components/OnboardingProvider.tsx");
 assert.match(provider,/setLoadFailed\(true\)/);
 assert.match(provider,/if \(!\(await persist\(nextState\)\)\) return/);
 assert.match(source("../components/OnboardingRoutePage.tsx"),/onboarding.loadFailed/);
 assert.match(source("../components/OnboardingRoutePage.tsx"),/Reintentar/);
});

test("URL arbitraria no confirma ejercicio ni completa el tour", () => {
 const provider=source("../components/OnboardingProvider.tsx");
 assert.doesNotMatch(provider,/moveOnboardingToStep\(state, routeStep\)/);
 assert.match(provider,/!state.boardExerciseCompleted/);
 assert.match(provider,/async function skip\(\) \{ await finish\(true\)/);
});

test("la navegación activa reconoce Objetivos y Contactos dentro del recorrido", () => {
  const navigationSource = source("../components/OnboardingNavigation.tsx");

  assert.match(navigationSource, /href === "\/objetivos" && pathname === "\/onboarding\/objetivos"/);
  assert.match(navigationSource, /href === "\/contactos"[\s\S]*pathname === "\/onboarding\/contactos" \|\| pathname === "\/onboarding\/contacto"/);
});

test("pasos componen los bloques reales sin páginas paralelas", () => {
 const page=source("../components/OnboardingRoutePage.tsx");
 for(const name of ["StartingPointFields","NetworkingCyclePanel","ContactTable","CoachModule"]) assert.match(page,new RegExp("<"+name));
 assert.match(source("../components/ContactTable.tsx"),/!workspace && !tutorial/);
});

test("perfil y ciclo se reúnen en paso 1; guardar antes de avanzar", () => {
 const page=source("../components/OnboardingRoutePage.tsx");
 assert.match(page,/fields.current\?\.save\(\)[\s\S]*onboarding.moveTo\("google"\)/);
 assert.match(page,/profileReady && cycleReady && priorityReady/);
 assert.match(page,/<NetworkingCyclePanel title="Tu objetivo"/);
});

test("campos aprobados son compartidos con Cuenta y usan una escritura RPC estrecha", () => {
  const fieldsSource = source("../components/StartingPointFields.tsx");
  const actionsSource = source("../lib/startingPointActions.ts");
  const accountSource = source("../components/AccountPage.tsx");

  assert.match(fieldsSource, /¿Cómo te llamas\?/);
  assert.match(fieldsSource, /Situación profesional/);
  assert.doesNotMatch(fieldsSource, /¿Desde cuándo haces networking\?/);
  assert.match(actionsSource, /p_networking_start_date: null/);
  for (const label of [
    "Dependiente", "En búsqueda activa", "Independiente / emprendiendo", "Estudiando",
    "Otra situación", "Prefiero no indicar"
  ]) assert.equal(PROFESSIONAL_SITUATION_OPTIONS.some((option) => option.label === label), true);
  assert.match(actionsSource, /rpc\("current_user_starting_point_v1"\)/);
  assert.match(actionsSource, /rpc\("save_current_user_starting_point_v1"/);
  assert.doesNotMatch(actionsSource, /\.from\("profiles"\)[\s\S]*\.(update|upsert)/);
  assert.match(accountSource, /<StartingPointFields[\s\S]*mode="account"/);
  assert.match(accountSource, /useHistoryImportAvailability\(\)/);
  assert.doesNotMatch(accountSource, /<NetworkingStartDateSetting/);
});

test("un fallo de escritura conserva el borrador y permite reintentar sin recargar", () => {
  const fieldsSource = source("../components/StartingPointFields.tsx");

  assert.match(fieldsSource, /const \[loadError, setLoadError\]/);
  assert.match(fieldsSource, /const \[saveError, setSaveError\]/);
  assert.match(fieldsSource, /catch \(error\)[\s\S]*setSaveError/);
  assert.doesNotMatch(fieldsSource, /catch \(error\)[\s\S]{0,180}setLoadError/);
  assert.match(fieldsSource, /if \(loading \|\| saving \|\| loadError\) return false/);
  assert.doesNotMatch(fieldsSource, /if \(loading \|\| saving \|\| loadError \|\| saveError\)/);
});

test("Tu punto de partida conserva semántica accesible y una sola columna móvil", () => {
  const fieldsSource = source("../components/StartingPointFields.tsx");
  const styles = source("../styles/components.css");

  assert.match(fieldsSource, /aria-busy=\{loading \|\| saving\}/);
  assert.equal((fieldsSource.match(/aria-invalid=/g) ?? []).length, 2);
  assert.match(fieldsSource, /role="alert"/);
  assert.match(fieldsSource, /autoComplete="name"/);
  assert.match(styles, /\.starting-point-field-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.starting-point-field-grid\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("validación de Tu punto de partida exige campos nuevos sin limitar la fecha a doce meses", () => {
  const valid = {
    fullName: "Ada Lovelace",
    professionalSituationCode: "employed" as const,
    networkingStartDate: "2001-02-03"
  };
  assert.equal(startingPointIsComplete(valid, new Date("2026-10-26T12:00:00Z")), true);
  assert.deepEqual(validateStartingPoint({ ...valid, fullName: "  " }), {
    fullName: "Escribe el nombre que quieres que usemos."
  });
  assert.equal(Boolean(validateStartingPoint({ ...valid, professionalSituationCode: "" }).professionalSituationCode), true);
  assert.equal(Boolean(validateStartingPoint({ ...valid, networkingStartDate: "" }).networkingStartDate), false);
});

test("Contactos reutiliza el editor real para crear contactos manualmente", () => {
  const tableSource = source("../components/ContactTable.tsx");

  assert.match(tableSource, /import \{ ContactEditorDialog \} from "\.\/ContactEditorDialog"/);
  assert.match(tableSource, /Crear contacto/);
  assert.match(tableSource, /<ContactEditorDialog[\s\S]*open=\{contactEditorOpen\}/);
  assert.match(tableSource, /onSaved=\{\(\) => \{[\s\S]*onReload\?\.\(\)/);
});

test("paso 2 bloquea Siguiente sin contactos; no bloquea Saltar", () => {
 const page=source("../components/OnboardingRoutePage.tsx");
 assert.match(page,/contacts.length > 0 : exercise/);
 assert.match(page,/disabled=\{disabled\} icon="arrowRight" onClick=\{\(\) => void onboarding.skip/);
 assert.match(source("../components/ContactTable.tsx"),/Tu red comienza aquí/);
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

test("el tutorial no monta ficha; la ficha normal conserva su Coach", () => {
 assert.doesNotMatch(source("../components/OnboardingRoutePage.tsx"),/<ContactProfile/);
 assert.match(source("../components/ContactProfile.tsx"),/<CoachModule/);
});

test("importación usa el modal canónico, parser y Review/Apply existentes", () => {
 const table=source("../components/ContactTable.tsx");
 assert.match(table,/<ContactImportButton label="Importar" onClosed=/);
 const dialog=source("../components/ContactImportDialog.tsx");
 assert.match(dialog,/<VCardImportPanel/);
 assert.match(dialog,/<GoogleContactsSyncPanel/);
 assert.match(dialog,/readGoogleOAuthOperationEligibility\("contacts"\)/);
});

test("Coach explicativo y navegación exterior única", () => {
 const page=source("../components/OnboardingRoutePage.tsx");
 assert.match(page,/<CoachModule mode="onboarding"><p>\{message\}<\/p><\/CoachModule>/);
 assert.match(page,/<nav className="onboarding-bottom-navigation"/);
 assert.match(page,/Paso \{index \+ 1\} de 3/);
 assert.match(page,/Empezar!/);
});

test("Saltar finaliza sin borrar datos y conduce al Inicio real", () => {
 assert.equal(ONBOARDING_PRODUCT_DESTINATION,"/");
 const provider=source("../components/OnboardingProvider.tsx");
 assert.match(provider,/async function skip\(\) \{ await finish\(true\); \}/);
 const finish=provider.split("async function finish")[1].split("function replay")[0];
 assert.match(finish,/persist/); assert.doesNotMatch(finish,/deleteProductOnboardingState/);
 assert.match(finish,/router.push\(ONBOARDING_PRODUCT_DESTINATION\)/);
});

test("UI-STRUCT-01 distribuye las cinco vistas y conserva el alias dashboard y los deep links", () => {
  const shellSource = source("../components/Shell.tsx");
  const rootRoute = source("../app/page.tsx");
  const dashboardRoute = source("../app/dashboard/page.tsx");
  const navigation = source("../components/WorkspaceNavigation.tsx");
  assert.match(source("../components/ShellChrome.tsx"), /<WorkspaceNavigation\s*\/>/);
  for (const label of ["Inicio", "Producir", "Planificar", "Contactos", "Objetivos"]) assert.ok(navigation.includes(label));
  assert.match(rootRoute, /<HomeView \/>/);
  assert.match(dashboardRoute, /<HomeView \/>/);
  assert.match(source("../components/StructuralViews.tsx"), /contactId \? <ReadOnlyContacts view="contacts" \/> : <ReadOnlyDashboard view="home" \/>/);
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

test("copy nuevo exacto, intro conservada y sin fecha duplicada", () => {
 const route=source("../components/OnboardingRoutePage.tsx");
 for(const text of [
 "Cuéntame quién eres y qué buscas: tu nombre, en qué punto está tu carrera hoy, y crea tu primer objetivo con los cafés:",
 "Partamos con lo más fácil: agrega a la persona que te invitó a Coffeecito.",
 "Este es tu tablero: acá vive tu red. Arrastra tu contacto a 'Contactado' y mira cómo funciona.",
 '¡Eso! Así se mueve tu red. Tu networking ya partió 🎉 Aprieta "Empezar" y sigamos con los próximos pasos.'
 ]) assert.ok(route.includes(text),text);
 const fields=source("../components/StartingPointFields.tsx");
 assert.doesNotMatch(fields,/type="date"/);
 assert.match(fields,/Tu punto de partida quedó guardado/);
 assert.match(source("../components/OnboardingIntroSlides.tsx"),/Hay un diamante en bruto en tu red/);
});

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
