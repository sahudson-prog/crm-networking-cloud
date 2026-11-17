"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ApplicationShellContent } from "./ApplicationShellContent";
import { InteractionSyncPreferencesProvider } from "./InteractionSyncPreferencesProvider";
import { OnboardingProvider } from "./OnboardingProvider";
import { SystemAccessProvider } from "./SystemAccess";

const ShellActionsContext = createContext<{ onSignOut?: () => void }>({});
export function useShellActions() { return useContext(ShellActionsContext); }

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  return <SystemAccessProvider><InteractionSyncPreferencesProvider><OnboardingProvider>
    <ShellActionsContext.Provider value={{ onSignOut }}><ShellContent>{children}</ShellContent></ShellActionsContext.Provider>
  </OnboardingProvider></InteractionSyncPreferencesProvider></SystemAccessProvider>;
}

function ShellContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === null) return <p role="status">Cargando…</p>;
  return path.startsWith("/onboarding") ? <>{children}</> : <ApplicationShellContent>{children}</ApplicationShellContent>;
}
