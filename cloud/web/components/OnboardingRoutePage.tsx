"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { peekSharedView } from "../lib/indicatorReads";
import { subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision } from "../lib/networkingDataRevision";
import { readContactListRows } from "../lib/cloudData";
import { currentOnboardingStep, type OnboardingRouteId, type OnboardingStep } from "../lib/onboarding";
import type { ContactListRow } from "../lib/readModel";
import { AuthGate } from "./AuthGate";
import { BRAND_ACCESSIBLE_NAME, BrandBetaWordmark } from "./ui/BrandBetaWordmark";
import { CoachModule } from "./CoachPreview";
import { ContactTable } from "./ContactTable";
import { NetworkingCyclePanel } from "./NetworkingCyclePanel";
import { OnboardingPriorities } from "./OnboardingPriorities";
import { OnboardingIntroSlides } from "./OnboardingIntroSlides";
import { OnboardingProvider, useOnboarding } from "./OnboardingProvider";
import { Shell } from "./Shell";
import { ShellHeader } from "./ShellHeader";
import { StartingPointFields, type StartingPointFieldsHandle } from "./StartingPointFields";
import { Button } from "./ui/Button";
import { ViewSkeleton } from "./ui/ViewSkeleton";
import { Panel } from "./ui/Panel";

export const GUIDED_COPY = {
  objectives: "Cuéntame quién eres y qué buscas: tu nombre, en qué punto está tu carrera hoy, y crea tu primer objetivo con los cafés: el cargo, la industria o el tipo de empresa que priorizarás. Con uno basta para partir, después sumas más.",
  google: "Partamos con lo más fácil: agrega a la persona que te invitó a Coffeecito. Después suma 2 o 3 contactos más que quieras tener presentes en tu búsqueda.",
  contacts: "Este es tu tablero: acá vive tu red. Arrastra tu contacto a 'Contactado' y mira cómo funciona.",
  success: '¡Eso! Así se mueve tu red. Tu networking ya partió 🎉 Aprieta "Empezar" y sigamos con los próximos pasos.'
};
const guidedSteps = ["objectives", "google", "contacts"] as const;
const stepNames = ["Tu objetivo", "Carga tu red", "Tu tablero"];

export function OnboardingRoutePage({ routeId }: { routeId: OnboardingRouteId }) {
  return <AuthGate>{routeId === "intro" ? <OnboardingProvider><OnboardingRouteContent routeId={routeId} /></OnboardingProvider>
    : <Shell><OnboardingRouteContent routeId={routeId} /></Shell>}</AuthGate>;
}

function OnboardingRouteContent({ routeId }: { routeId: OnboardingRouteId }) {
  const onboarding = useOnboarding();
  if (onboarding.loadFailed) return <section className="onboarding-route onboarding-route-gate" role="alert">
    <p>{onboarding.error}</p><Button onClick={onboarding.retry}>Reintentar</Button></section>;
  if (onboarding.loading || !onboarding.routeReady) return <main className="app-shell onboarding-guided"><ViewSkeleton kind="list" rows={3} label="Tutorial" /></main>;
  if (routeId === "intro") return <OnboardingIntro />;
  const step = currentOnboardingStep(routeId);
  return step === "objectives" ? <OnboardingObjectiveStep /> : <OnboardingNetworkStep key={step} step={step === "google" ? "google" : "contacts"} />;
}

export function OnboardingFrame({ step, children, ready, busy = false, message, onNext }: {
  step: "objectives" | "google" | "contacts"; children: ReactNode; ready: boolean; busy?: boolean; message: string; onNext: () => void;
}) {
  const onboarding = useOnboarding();
  const index = guidedSteps.indexOf(step);
  const disabled = busy || onboarding.completing;
  return <main className="app-shell application-shell-v2 onboarding-guided">
    <div className="shell-top-region onboarding-guided-top">
        <ShellHeader linkedBrand={false} />
        <div className="onboarding-tracker">
          <strong>Paso {index + 1} de 3 · {stepNames[index]}</strong>
          <ol aria-label="Avance del tour">{stepNames.map((name, position) => <li key={name} aria-label={name} aria-current={position === index ? "step" : undefined} className={position < index ? "complete" : position === index ? "current" : "pending"} />)}</ol>
          <Button tone="ghost" disabled={disabled} icon="arrowRight" onClick={() => void onboarding.skip()}>Saltar el tour</Button>
        </div>
    </div>
    <div className="onboarding-guided-body">
      <CoachModule mode="onboarding"><p>{message}</p></CoachModule>
      {children}
      <OnboardingError />
      <nav className="onboarding-bottom-navigation" aria-label="Navegación del tour">
        <div>{index > 0 ? <Button disabled={disabled} icon="arrowLeft" onClick={() => void onboarding.moveTo(guidedSteps[index - 1] as OnboardingStep)}>Anterior</Button> : null}</div>
        <Button disabled={disabled || !ready} tone="primary" icon={index === 2 ? "check" : "arrowRight"} onClick={onNext}>
          {disabled ? "Guardando..." : index === 2 ? "Empezar!" : "Siguiente"}
        </Button>
      </nav>
    </div>
  </main>;
}

function OnboardingObjectiveStep() {
  const onboarding = useOnboarding();
  const fields = useRef<StartingPointFieldsHandle>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cycleReady, setCycleReady] = useState(false);
  const [priorityReady, setPriorityReady] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  async function next() {
    if (saving || priorityBusy || !cycleReady || !priorityReady) return;
    setSaving(true);
    try { if (await fields.current?.save()) await onboarding.moveTo("google"); }
    finally { setSaving(false); }
  }
  return <OnboardingFrame step="objectives" message={GUIDED_COPY.objectives} ready={profileReady && cycleReady && priorityReady} busy={saving || priorityBusy} onNext={() => void next()}>
    <section className="panel onboarding-objective-content">
      <StartingPointFields mode="onboarding" ref={fields} onReadyChange={setProfileReady} requireComplete showSaveAction={false} />
      <NetworkingCyclePanel title="Tu objetivo" mode="onboarding" onReadyChange={setCycleReady} onCycleChange={() => setRevision(v => v + 1)} />
      {cycleReady ? <OnboardingPriorities key={revision} onReadyChange={setPriorityReady} onBusyChange={setPriorityBusy} /> : <ViewSkeleton kind="chips" rows={3} label="Prioridades" />}
    </section>
  </OnboardingFrame>;
}

function OnboardingNetworkStep({ step }: { step: "google" | "contacts" }) {
  const onboarding = useOnboarding();
  const cached = peekSharedView<ContactListRow[]>("contact-list");
  const [contacts, setContacts] = useState<ContactListRow[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [resolved, setResolved] = useState(Boolean(cached));
  const loadVersion = useRef(0);
  const revision = useSyncExternalStore(subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision);
  const [error, setError] = useState("");
  const [tableBusy, setTableBusy] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const progressWrite = useRef<Promise<boolean> | null>(null);
  const busy = tableBusy || progressBusy;
  const [confirmed, setConfirmed] = useState(false);
  const [progressError, setProgressError] = useState("");
  const exercise = Boolean(onboarding.state.boardExerciseCompleted);
  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    setError("");
    try {
      const rows = await readContactListRows();
      if (version !== loadVersion.current) return;
      setContacts(rows); setResolved(true);
    }
    catch { if (version === loadVersion.current) setError("No pudimos leer tus contactos. Reintenta antes de continuar."); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { loadVersion.current++; }; }, [reload, revision]);
  function saveExercise() {
    if (progressWrite.current) return progressWrite.current;
    setProgressError("");
    setProgressBusy(true);
    const pending = Promise.resolve().then(() => onboarding.confirmBoardExercise())
      .then(() => true)
      .catch(() => { setProgressError("El contacto quedó guardado, pero no tu avance. Reintenta sin moverlo otra vez."); return false; })
      .finally(() => { progressWrite.current = null; setProgressBusy(false); });
    progressWrite.current = pending;
    return pending;
  }
  async function onStatusSaved(change: { previous: string; next: string }) {
    if (exercise || change.previous !== "Pendiente" || change.next !== "Contactado") return;
    setConfirmed(true);
    if (!await saveExercise()) throw Error("onboarding_progress_not_confirmed");
  }
  return <OnboardingFrame step={step} message={step === "contacts" && exercise ? GUIDED_COPY.success : GUIDED_COPY[step]}
    ready={resolved && !loading && !error && (step === "google" ? contacts.length > 0 : exercise)} busy={busy}
    onNext={() => void (step === "google" ? onboarding.moveTo("contacts") : onboarding.complete())}>
    {!resolved ? <Panel title={step === "google" ? "Contactos" : "Tu tablero"}
      status={{ resolved: false, busy: loading, error, onRetry: () => void reload() }}>
      {loading ? <ViewSkeleton kind={step === "google" ? "table" : "board"} rows={4} label={step === "google" ? "Contactos" : "Tu tablero"} /> : null}
    </Panel> : null}
    {error ? <p role="alert">{error} <Button onClick={() => void reload()}>Reintentar</Button></p> : null}
    {resolved ? <ContactTable contacts={contacts} view={step === "google" ? "contacts" : "states"} tutorial={step === "google" ? "list" : "board"}
      readState={{ resolved, busy: loading || progressBusy, confirming: progressBusy, error: error || progressError, onRetry: () => void reload() }}
      onReload={reload} onStatusSaved={onStatusSaved} onBusyChange={setTableBusy} /> : null}
    {progressError && confirmed ? <p role="alert">{progressError} <Button disabled={busy} onClick={() => void saveExercise()}>Reintentar</Button></p> : null}
  </OnboardingFrame>;
}

function OnboardingIntro() {
  const onboarding = useOnboarding();
  return (
    <main className="onboarding-intro-shell">
      <div aria-hidden="true" className="onboarding-intro-background" />
      <section className="onboarding-intro" aria-labelledby="onboarding-intro-title">
        <div className="onboarding-intro-layout">
          <div className="onboarding-intro-editorial">
            <div aria-label={BRAND_ACCESSIBLE_NAME} className="onboarding-brand-lockup">
              <img aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
              <BrandBetaWordmark />
            </div>
            <div className="onboarding-intro-copy">
              <h1 id="onboarding-intro-title">Simplifica y ordena tu networking.</h1>
              <p>
                Organiza tu red, mantén visibles tus relaciones y pendientes, y enfócate en las conversaciones que importan
              </p>
            </div>
          </div>
          <OnboardingIntroSlides
            onExit={onboarding.replaying ? () => void onboarding.exit() : undefined}
            onStart={() => void onboarding.start()}
          />
        </div>
        <OnboardingError />
      </section>
    </main>
  );
}

function OnboardingError() {
  const onboarding = useOnboarding();
  return onboarding.error ? <p className="form-error" role="alert">{onboarding.error}</p> : null;
}
