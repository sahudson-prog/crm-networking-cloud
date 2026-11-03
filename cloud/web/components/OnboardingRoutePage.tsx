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
    return <p className="onboarding-route-loading" role="status">Preparando tu tutorial...</p>;
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
        title="Cuéntame de ti."
      >
        <p id="starting-point-step-title">
          ¿Cómo te llamas y cuál es tu situación profesional? Con estos datos podremos personalizar tu experiencia.
          Puedes actualizarlos después en Cuenta.
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
        <OnboardingCoach routeId="objectives" title="Define tu objetivo y tus prioridades."
          nextDisabled={!onboarding.replaying && !cycleReady}>
          <p>
            Define tu objetivo de networking y establece las prioridades que te interesa perseguir. Esto te ayudará a
            enfocar tus conversaciones y encontrar oportunidades que tengan sentido para ti.
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
          title="Tu red, organizada a tu manera."
        >
          <p>
            Aquí administras tus contactos: eliges a quiénes poner en foco para hacer networking, actualizas su estado
            de avance y marcas a los headhunters para agruparlos por consultora.
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
    <OnboardingCoach nextDisabled={!profile} routeId="contact" title="La historia de cada contacto.">
      <p>
        Cada contacto tiene una ficha donde puedes editar sus datos y registrar mensajes, citas, correos o llamadas,
        con notas y minutas. También podrás anotar contactos referidos para darles seguimiento y seguir ampliando tu red.
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
      <OnboardingCoach routeId="google" title="Comienza con tus contactos.">
        <p>
          Puedes importar tus contactos desde un archivo vCard o crearlos uno a uno en Coffeecito. Aquí puedes ver cómo
          exportar contactos desde Google o desde Apple.
        </p>
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
      <OnboardingCoach nextLabel="Ir a Contactos" onBack={goBack} routeId="final" title="Ya puedes empezar.">
        <p>
          Ahora ya conoces las funciones básicas para avanzar. Yo te acompañaré con sugerencias para mantener tu red
          ordenada y al día.
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
