"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  canRenderSystemSurface,
  initialSystemAccessState,
  loadSystemAccessState,
  type SystemAccessState,
  type SystemSurface
} from "../lib/systemAccess";

const SystemAccessContext = createContext<SystemAccessState>(initialSystemAccessState());

export function SystemAccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SystemAccessState>(initialSystemAccessState);

  useEffect(() => {
    let active = true;
    loadSystemAccessState().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
    };
  }, []);

  return <SystemAccessContext.Provider value={state}>{children}</SystemAccessContext.Provider>;
}

export function useSystemAccess() {
  return useContext(SystemAccessContext);
}

export function SystemCapabilityGate({ children, surface }: { children: ReactNode; surface: SystemSurface }) {
  const state = useSystemAccess();

  if (state.status === "checking") {
    return <section className="panel">Revisando acceso...</section>;
  }

  if (!canRenderSystemSurface(state, surface)) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Acceso restringido</h2>
            <span className="panel-caption">Sistema</span>
          </div>
        </div>
        <p className="meta">
          {state.status === "error" ? state.message : "Tu usuario no tiene permiso para esta vista."}
        </p>
      </section>
    );
  }

  return <>{children}</>;
}
