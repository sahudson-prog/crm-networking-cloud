"use client";

import { useEffect, useState } from "react";
import { expectedNetworkingContext, networkingContextFromCycles, readNetworkingCycles } from "../lib/networkingCycles";
import { OpportunityBoard, WingedBriefcase } from "./OpportunityBoard";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";

/** The same active-cycle gate previously supplied by ObjectivesPage. */
export function OpportunityWorkspace() {
  const [state, setState] = useState<"loading" | "ready" | "empty" | "unknown_start" | "stale" | "error">("loading");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState("loading");
    Promise.all([readNetworkingCycles(), expectedNetworkingContext()]).then(([cycles, expected]) => {
      if (!active) return;
      const cycle = cycles.find(item => item.status === "active");
      setState(expected.token !== networkingContextFromCycles(cycles).token ? "stale"
        : !cycle ? "empty" : !cycle.started_at ? "unknown_start" : "ready");
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [revision]);
  if (state === "ready") return <OpportunityBoard />;
  return <Panel title="Oportunidades" icon={<WingedBriefcase />} className="functional-block">
    {state === "loading" ? <p role="status">Leyendo oportunidades...</p> : null}
    {state === "empty" ? <p className="empty-value">No hay una búsqueda activa. Puedes iniciarla en Objetivos.</p> : null}
    {state === "unknown_start" ? <p className="empty-value">Configura el inicio en Objetivos para ver tus oportunidades.</p> : null}
    {state === "stale" ? <p role="alert">El ciclo cambió en otra pestaña. Actualiza esta página antes de guardar.</p> : null}
    {state === "error" ? <p role="alert">No pudimos verificar la búsqueda activa. <Button onClick={() => setRevision(v => v + 1)}>Reintentar</Button></p> : null}
  </Panel>;
}
