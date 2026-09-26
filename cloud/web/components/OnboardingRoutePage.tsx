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
      <section className="onboarding-intro" aria-labelledby="onboarding-intro-title">
        <div className="onboarding-intro-copy">
          <span>Bienvenido a Coffeecito</span>
          <h1 id="onboarding-intro-title">Cómo funciona Coffeecito</h1>
          <p>Una guía breve para convertir tu red en próximos pasos concretos.</p>
        </div>
        <div className="onboarding-flow" aria-label="Flujo principal de Coffeecito">
          <strong>Define tus objetivos</strong>
          <span aria-hidden="true">→</span>
          <strong>Organiza tu red</strong>
          <span aria-hidden="true">→</span>
          <strong>Mantén el contacto</strong>
        </div>
        <OnboardingError />
        <div className="onboarding-intro-actions">
          <Button
            onClick={() => void (onboarding.replaying ? onboarding.exit() : onboarding.defer())}
            tone="ghost"
          >
            Ahora no
          </Button>
          <Button icon="arrowRight" onClick={() => void onboarding.start()} tone="primary">
            Comenzar recorrido
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
        <OnboardingCoach routeId="objectives" title="Partamos por lo que buscas.">
          <p>
            Un objetivo es algo hacia lo que quieres avanzar profesionalmente: por ejemplo, llegar a un cargo,
            acercarte a una empresa o explorar una nueva oportunidad.
          </p>
          <p>
            Puedes crear uno usando los controles de esta página. El objetivo será real y quedará guardado en
            Coffeecito, pero también puedes continuar sin crear uno ahora.
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
    void onboarding.moveTo(firstContactId ? "contact" : "google");
  }

  return (
    <ReadOnlyContacts
      beforeList={(
        <OnboardingCoach
          nextDisabled={!contactsResolved}
          onNext={continueFromContacts}
          routeId="contacts"
          title="Tu red vive acá."
        >
          <p>
            En Contactos puedes organizar a las personas relevantes para tus objetivos y mantener contexto sobre cada
            relación.
          </p>
          <p>
            Coffeecito te ayuda a recordar quién es cada persona, por qué es importante y cuándo conviene retomar el
            contacto.
          </p>
          <p>Los estados, el foco networking, los headhunters y los objetivos te ayudan a ordenar esa atención.</p>
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
          void onboarding.moveTo("google");
          return;
        }
        setContactId(firstContact.id);
        const nextProfile = await readContactProfile(firstContact.id);
        if (active) setProfile(nextProfile);
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
    <OnboardingCoach nextDisabled={!profile} routeId="contact" title="Cada contacto tiene una historia.">
      <p>
        La ficha te ayuda a conservar el contexto de la relación: quién es la persona, cómo se conecta con tus
        objetivos, qué han conversado y cuál podría ser el próximo paso.
      </p>
      <p>
        No necesitas registrar cada detalle. Guarda solo lo suficiente para retomar una conversación sin partir de
        cero.
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
      <OnboardingCoach routeId="google" title="Puedes partir manualmente o apoyarte en Google.">
        <p>
          Coffeecito puede ayudarte a recuperar contactos e interacciones que ya existen en Gmail y Calendar, para que
          no tengas que reconstruir todo desde cero.
        </p>
        <p>Conectar Google es opcional. Puedes continuar el recorrido sin autorizarlo ni importar ahora.</p>
      </OnboardingCoach>
      <AccountPage view="google-onboarding" />
    </div>
  );
}

function OnboardingFinalStep() {
  return (
    <section className="onboarding-route">
      <OnboardingCoach nextLabel="Ir a mis objetivos" routeId="final" title="Ya tienes lo esencial.">
        <ul className="onboarding-summary">
          <li>Define hacia dónde quieres avanzar.</li>
          <li>Organiza las personas de tu red.</li>
          <li>Mantén el contexto y vuelve a conversar en el momento adecuado.</li>
        </ul>
        <div className="onboarding-coach-continuation">
          <h3>Coach seguirá acompañándote.</h3>
          <p>
            A medida que uses Coffeecito, puedo ayudarte a mantener tu red al día con sugerencias, como cambios de
            estado y otros próximos pasos según la información disponible.
          </p>
          <p>Tú decides qué sugerencias aplicar.</p>
        </div>
      </OnboardingCoach>
    </section>
  );
}

function OnboardingCoach({
  children,
  nextDisabled = false,
  nextLabel,
  onNext,
  routeId,
  title
}: {
  children: ReactNode;
  nextDisabled?: boolean;
  nextLabel?: string;
  onNext?: () => void;
  routeId: OnboardingStep;
  title: string;
}) {
  const onboarding = useOnboarding();
  const navigation = onboardingRouteNavigation(routeId);
  const stepIndex = ONBOARDING_FLOW.findIndex((entry) => entry.id === routeId);

  function goBack() {
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
