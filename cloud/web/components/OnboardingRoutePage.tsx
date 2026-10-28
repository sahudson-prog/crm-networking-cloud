"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readContactListRows, readContactProfile } from "../lib/cloudData";
import {
  ONBOARDING_FLOW,
  onboardingRouteNavigation,
  type OnboardingRouteId,
  type OnboardingStep
} from "../lib/onboarding";
import type { ContactListRow, ContactProfileData } from "../lib/readModel";
import { AccountPage } from "./AccountPage";
import { AuthGate } from "./AuthGate";
import { CoachModule } from "./CoachPreview";
import { ContactProfile } from "./ContactProfile";
import { ObjectivesPage } from "./ObjectivesPage";
import { OnboardingIntroSlides } from "./OnboardingIntroSlides";
import { OnboardingProvider, useOnboarding } from "./OnboardingProvider";
import { ReadOnlyContacts } from "./ReadOnlyContacts";
import { Shell } from "./Shell";
import { StartingPointFields, type StartingPointFieldsHandle } from "./StartingPointFields";
import { Button } from "./ui/Button";

export function OnboardingRoutePage({ routeId }: { routeId: OnboardingRouteId }) {
  return (
    <AuthGate>
      {routeId === "intro" ? (
        <OnboardingProvider>
          <OnboardingRouteContent routeId={routeId} />
        </OnboardingProvider>
      ) : (
        <Shell>
          <OnboardingRouteContent routeId={routeId} />
        </Shell>
      )}
    </AuthGate>
  );
}

function OnboardingRouteContent({ routeId }: { routeId: OnboardingRouteId }) {
  const onboarding = useOnboarding();

  if (onboarding.loadFailed) {
    return (
      <section className="onboarding-route onboarding-route-gate" role="alert">
        <p>{onboarding.error}</p>
        <Button onClick={onboarding.retry}>Reintentar</Button>
      </section>
    );
  }

  if (onboarding.loading || !onboarding.routeReady) {
    return <p className="onboarding-route-loading" role="status">Preparando recorrido...</p>;
  }

  if (routeId === "intro") return <OnboardingIntro />;
  if (routeId === "starting_point") return <OnboardingStartingPointStep />;
  if (routeId === "objectives") return <OnboardingObjectivesStep />;
  if (routeId === "contacts") return <OnboardingContactsStep />;
  if (routeId === "contact") return <OnboardingContactStep />;
  if (routeId === "google") return <OnboardingGoogleStep />;
  return <OnboardingFinalStep />;
}

function OnboardingStartingPointStep() {
  const onboarding = useOnboarding();
  const fieldsRef = useRef<StartingPointFieldsHandle>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  async function continueToObjectives() {
    if (onboarding.replaying) {
      await onboarding.moveTo("objectives");
      return;
    }
    if (!(await fieldsRef.current?.save())) return;
    await onboarding.moveTo("objectives");
  }

  return (
    <section className="onboarding-route starting-point-step" aria-labelledby="starting-point-step-title">
      <OnboardingCoach
        nextDisabled={!ready || saving}
        nextLabel={saving ? "Guardando..." : "Siguiente"}
        onNext={() => void continueToObjectives()}
        routeId="starting_point"
        title="Tu punto de partida"
      >
        <p id="starting-point-step-title">
          Antes de empezar, cuéntame un poco sobre ti. Así podré llamarte por tu nombre, adaptar tu experiencia y medir
          tus avances desde la fecha que elijas. Esa fecha también servirá de referencia para recuperar las
          interacciones históricas disponibles cuando importemos información.
        </p>
      </OnboardingCoach>
      <StartingPointFields
        mode="onboarding"
        onReadyChange={setReady}
        onSavingChange={setSaving}
        ref={fieldsRef}
        requireComplete={!onboarding.replaying}
        showSaveAction={onboarding.replaying}
      />
    </section>
  );
}

function OnboardingIntro() {
  const onboarding = useOnboarding();
  return (
    <main className="onboarding-intro-shell">
      <div aria-hidden="true" className="onboarding-intro-background" />
      <section className="onboarding-intro" aria-labelledby="onboarding-intro-title">
        <div className="onboarding-intro-layout">
          <div className="onboarding-intro-editorial">
            <div aria-label="Coffeecito" className="onboarding-brand-lockup">
              <img aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
              <span>Coffeecito</span>
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

function OnboardingObjectivesStep() {
  const onboarding = useOnboarding();
  const [cycleReady, setCycleReady] = useState(false);
  const onCycleReadyChange = useCallback((ready: boolean) => setCycleReady(ready), []);
  return (
    <ObjectivesPage
      onCycleReadyChange={onCycleReadyChange}
      onboardingCoach={(
        <OnboardingCoach routeId="objectives" title="Comencemos definiendo tus prioridades"
          nextDisabled={!onboarding.replaying && !cycleReady}>
          <p>
            Primero confirma tu ciclo de búsqueda laboral. Después podrás añadir Prioridades para empresas,
            industrias, cargos o funciones.
          </p>
          <p>
            Las Prioridades son opcionales; puedes completarlas más adelante.
          </p>
        </OnboardingCoach>
      )}
    />
  );
}

function OnboardingContactsStep() {
  const onboarding = useOnboarding();
  const [contactsResolved, setContactsResolved] = useState(false);
  const [firstContactId, setFirstContactId] = useState("");

  const handleContactsResolved = useCallback((contacts: ContactListRow[]) => {
    setFirstContactId(contacts[0]?.id ?? "");
    setContactsResolved(true);
  }, []);

  function continueFromContacts() {
    void onboarding.moveTo(firstContactId ? "contact" : "final");
  }

  return (
    <ReadOnlyContacts
      beforeList={(
        <OnboardingCoach
          nextDisabled={!contactsResolved}
          onNext={continueFromContacts}
          routeId="contacts"
          title="Aquí organizas y priorizas tu red"
        >
          <p>
            Por defecto, esta vista muestra sólo los contactos que quieres priorizar para hacer networking. En
            Coffeecito, esos contactos se marcan como Foco.
          </p>
          <p>
            Cambia el filtro de “Foco” a “Todos” para revisar tu red completa y marcar como Foco a las personas que
            quieras priorizar.
          </p>
          <p>
            También puedes arrastrar una tarjeta para actualizar su estado, crear nuevos contactos o gestionar varios
            desde la tabla inferior.
          </p>
        </OnboardingCoach>
      )}
      onContactsResolved={handleContactsResolved}
    />
  );
}

function OnboardingContactStep() {
  const onboarding = useOnboarding();
  const [profile, setProfile] = useState<ContactProfileData | null>(null);
  const [contactId, setContactId] = useState("");
  const [error, setError] = useState("");

  const loadProfile = useCallback(async (id: string) => {
    const nextProfile = await readContactProfile(id);
    setProfile(nextProfile);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadFirstContact() {
      try {
        const contacts = await readContactListRows();
        if (!active) return;
        const firstContact = contacts[0];
        if (!firstContact) {
          void onboarding.moveTo("final");
          return;
        }
        setContactId(firstContact.id);
        const nextProfile = await readContactProfile(firstContact.id);
        if (active) {
          if (nextProfile) setProfile(nextProfile);
          else void onboarding.moveTo("final");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "No pudimos leer el contacto.");
      }
    }
    void loadFirstContact();
    return () => {
      active = false;
    };
  }, []);

  const coach = (
    <OnboardingCoach nextDisabled={!profile} routeId="contact" title="Cada contacto tiene una ficha con su historia">
      <p>
        Aquí puedes editar la información del contacto y mantener todo el contexto de la relación en un solo lugar.
      </p>
      <p>
        Registra interacciones —mensajes, citas, correos o llamadas— y edítalas para incorporar minutas y notas.
      </p>
      <p>
        También puedes registrar personas referidas durante esas interacciones. Si una se vuelve relevante, puedes
        convertirla en contacto y comenzar a darle seguimiento en Coffeecito.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </OnboardingCoach>
  );

  if (!profile) {
    return <section className="onboarding-route onboarding-contact-loading">{coach}</section>;
  }

  return (
    <ContactProfile
      onboardingCoach={coach}
      onReload={() => void loadProfile(contactId)}
      profile={profile}
    />
  );
}

function OnboardingGoogleStep() {
  return (
    <div className="onboarding-google-step">
      <OnboardingCoach routeId="google" title="Importa tus contactos de forma masiva">
        <p>Si quieres avanzar más rápido, puedes importar contactos desde un archivo vCard o desde tu cuenta de Google.</p>
        <p>Si prefieres, también puedes construir tu red manualmente dentro de Coffeecito, paso a paso.</p>
      </OnboardingCoach>
      <AccountPage view="google-onboarding" />
    </div>
  );
}

function OnboardingFinalStep() {
  const onboarding = useOnboarding();

  async function goBack() {
    try {
      const contacts = await readContactListRows();
      void onboarding.moveTo(contacts.length ? "contact" : "contacts");
    } catch {
      void onboarding.moveTo("contacts");
    }
  }

  return (
    <section className="onboarding-route">
      <OnboardingCoach nextLabel="Fin del tutorial" onBack={goBack} routeId="final" title="Ya tienes lo esencial">
        <p>Ahora ya conoces el flujo base para avanzar con mayor intención y continuidad.</p>
        <p>
          Coach seguirá acompañándote con sugerencias para ayudarte a mantener tu red al día y decidir mejor tus
          próximos pasos.
        </p>
      </OnboardingCoach>
    </section>
  );
}

function OnboardingCoach({
  children,
  nextDisabled = false,
  nextLabel,
  onBack,
  onNext,
  routeId,
  title
}: {
  children: ReactNode;
  nextDisabled?: boolean;
  nextLabel?: string;
  onBack?: () => void;
  onNext?: () => void;
  routeId: OnboardingStep;
  title: string;
}) {
  const onboarding = useOnboarding();
  const navigation = onboardingRouteNavigation(routeId);
  const stepIndex = ONBOARDING_FLOW.findIndex((entry) => entry.id === routeId);

  function goBack() {
    if (onBack) {
      onBack();
      return;
    }
    if (!navigation.back || navigation.back === "intro") {
      onboarding.openIntro();
      return;
    }
    void onboarding.moveTo(navigation.back);
  }

  function goNext() {
    if (onNext) {
      onNext();
      return;
    }
    if (!navigation.next) {
      void onboarding.complete();
      return;
    }
    void onboarding.moveTo(navigation.next as OnboardingStep);
  }

  return (
    <CoachModule
      mode="onboarding"
      nextDisabled={nextDisabled || (routeId === "final" && onboarding.completing)}
      nextLabel={nextLabel ?? (navigation.next ? "Siguiente" : "Finalizar")}
      onBack={routeId === "starting_point" && !onboarding.replaying ? undefined : goBack}
      onExit={onboarding.replaying ? () => void onboarding.exit(routeId) : undefined}
      onNext={goNext}
      progress={`Paso ${stepIndex} de ${ONBOARDING_FLOW.length - 1}`}
      title={title}
    >
      {children}
      <OnboardingError />
    </CoachModule>
  );
}

function OnboardingError() {
  const onboarding = useOnboarding();
  return onboarding.error ? <p className="form-error" role="alert">{onboarding.error}</p> : null;
}
