"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ActivitySyncButton } from "./ActivitySyncButton";
import { InteractionSyncPreferencesProvider } from "./InteractionSyncPreferencesProvider";
import { OnboardingProvider, useOnboarding } from "./OnboardingProvider";
import { SystemAccessProvider, useSystemAccess } from "./SystemAccess";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { InvitationButton } from "./InvitationButton";
import { canRenderSystemSurface } from "../lib/systemAccess";
import { expectedNetworkingCycleId } from "../lib/networkingCycles";

const ShellActionsContext = createContext<{ onSignOut?: () => void }>({});

export function useShellActions() {
  return useContext(ShellActionsContext);
}

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  return (
    <SystemAccessProvider>
      <InteractionSyncPreferencesProvider>
        <OnboardingProvider>
          <ShellActionsContext.Provider value={{ onSignOut }}>
            <ShellContent>{children}</ShellContent>
          </ShellActionsContext.Provider>
        </OnboardingProvider>
      </InteractionSyncPreferencesProvider>
    </SystemAccessProvider>
  );
}

function ShellContent({ children }: { children: ReactNode }) {
  const utilities = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const onboarding = useOnboarding();
  const systemAccess = useSystemAccess();
  const isOnboarding = pathname.startsWith("/onboarding");
  const isSystem = pathname.startsWith("/sistema");
  const isAccount = pathname.startsWith("/cuenta");
  const isObjectives = pathname === "/objetivos" || pathname === "/onboarding/objetivos";
  const isContacts = pathname === "/"
    || pathname === "/contactos"
    || pathname === "/onboarding/contactos"
    || pathname === "/onboarding/contacto";
  const showSystem = canRenderSystemSurface(systemAccess, "system");
  const headerReady = !onboarding.loading && onboarding.routeReady && !onboarding.loadFailed;
  useEffect(() => { void expectedNetworkingCycleId().catch(() => undefined); }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 780px)");
    const arrange = () => { if (utilities.current) utilities.current.open = !media.matches; };
    arrange();
    media.addEventListener("change", arrange);
    return () => media.removeEventListener("change", arrange);
  }, [headerReady]);

  if (onboarding.loadFailed) {
    return (
      <main className="app-shell onboarding-route-gate" role="alert">
        <p>{onboarding.error}</p>
        <Button onClick={onboarding.retry}>Reintentar</Button>
      </main>
    );
  }

  if (onboarding.loading || !onboarding.routeReady) {
    return <main className="app-shell onboarding-route-loading" role="status">Preparando recorrido...</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link aria-label="Coffeecito" className="shell-brand-lockup" href="/contactos">
          <img alt="" aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
          <span>Coffeecito</span>
        </Link>
        <nav className="nav-primary" aria-label="Navegacion principal">
          <Link className={`nav-link ${isObjectives ? "active" : ""}`} href="/objetivos">
            <Icon name="target" />
            Objetivos
          </Link>
          <Link className={`nav-link ${isContacts ? "active" : ""}`} href="/contactos">
            <Icon name="users" />
            Contactos
          </Link>
        </nav>
        <div className="nav-utility">
          {!isOnboarding ? <InvitationButton /> : null}
          <details ref={utilities} className="shell-utility-overflow" onKeyDown={(event) => {
            if (event.key === "Escape" && window.matchMedia("(max-width: 780px)").matches) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}>
            <summary className="nav-link nav-link-icon" aria-label="Más acciones" title="Más acciones"><Icon name="more" /></summary>
            <div className="shell-utility-items">
          {!isOnboarding ? (
            <button aria-label="Ver tutorial" className="nav-tutorial-link" onClick={onboarding.replay} type="button">
              <span className="nav-tutorial-label-full">Ver tutorial</span>
              <span className="nav-tutorial-label-compact">Tutorial</span>
            </button>
          ) : null}
          {showSystem ? (
            <Link
              aria-label="Sistema"
              className={`nav-link nav-link-icon ${isSystem ? "active" : ""}`}
              href="/sistema"
              title="Sistema"
            >
              <Icon name="settings" />
              <span className="sr-only">Sistema</span>
            </Link>
          ) : null}
          <ActivitySyncButton variant="focus_incremental" square />
            </div>
          </details>
          <Link
            aria-label="Cuenta"
            className={`nav-link nav-link-icon ${isAccount ? "active" : ""}`}
            href="/cuenta"
            title="Cuenta"
          >
            <Icon name="user" />
            <span className="sr-only">Cuenta</span>
          </Link>
        </div>
      </header>
      {children}
    </main>
  );
}
