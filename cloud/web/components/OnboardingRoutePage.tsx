"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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

  if (onboarding.loading || !onboarding.routeReady) {
    return <p className="onboarding-route-loading" role="status">Preparando recorrido...</p>;
  }

  if (routeId === "intro") return <OnboardingIntro />;
  if (routeId === "objectives") return <OnboardingObjectivesStep />;
  if (routeId === "contacts") return <OnboardingContactsStep />;
  if (routeId === "contact") return <OnboardingContactStep />;
  if (routeId === "google") return <OnboardingGoogleStep />;
  return <OnboardingFinalStep />;
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
          <OnboardingIntroSlides />
        </div>
        <OnboardingError />
        <div className="onboarding-intro-actions">
          <Button
            className="onboarding-intro-defer"
            onClick={() => void (onboarding.replaying ? onboarding.exit() : onboarding.defer())}
            tone="ghost"
          >
            Ahora no
          </Button>
          <Button className="onboarding-intro-start" icon="arrowRight" onClick={() => void onboarding.start()} tone="primary">
            Empecemos
          </Button>
        </div>
      </section>
    </main>
  );
}

function OnboardingObjectivesStep() {
  return (
    <ObjectivesPage
      onboardingCoach={(
        <OnboardingCoach routeId="objectives" title="Comencemos definiendo tus objetivos">
          <p>
            Aquí defines qué quieres lograr con tu red: por ejemplo, acercarte a una empresa, explorar un cargo o
            avanzar hacia una nueva oportunidad.
          </p>
          <p>
            Puedes crear objetivos reales desde esta misma página, o continuar y volver a completarlos después.
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
        Desde esta ficha puedes registrar contexto sobre la relación, revisar interacciones anteriores y dejar más
        claro cuál podría ser el próximo paso.
      </p>
      <p>
        También puedes identificar posibles referidos, preparar tu siguiente café o iniciar desde aquí una nueva
        conversación o una cita.
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
      nextDisabled={nextDisabled}
      nextLabel={nextLabel ?? (navigation.next ? "Siguiente" : "Finalizar")}
      onBack={goBack}
      onExit={() => void onboarding.exit(routeId)}
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
