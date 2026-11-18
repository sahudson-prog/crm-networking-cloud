"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import { ApplicationShellContent } from "./ApplicationShellContent";
import { InteractionSyncPreferencesProvider } from "./InteractionSyncPreferencesProvider";
import { OnboardingProvider } from "./OnboardingProvider";
import { SystemAccessProvider } from "./SystemAccess";
import { ViewSkeleton } from "./ui/ViewSkeleton";

const ShellActionsContext = createContext<{ onSignOut?: () => void }>({});
export function useShellActions() { return useContext(ShellActionsContext); }

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  return <SystemAccessProvider><InteractionSyncPreferencesProvider><OnboardingProvider>
    <ShellActionsContext.Provider value={{ onSignOut }}><ShellContent>{children}</ShellContent></ShellActionsContext.Provider>
  </OnboardingProvider></InteractionSyncPreferencesProvider></SystemAccessProvider>;
}

function ShellContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === null) return <main className="app-shell"><ViewSkeleton kind="list" rows={3} label="Coffeecito" /></main>;
  return path.startsWith("/onboarding") ? <>{children}</> : <ApplicationShellContent>{children}</ApplicationShellContent>;
}
