"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision } from "../lib/networkingDataRevision";
import { readViewCycle, peekViewCycle } from "../lib/viewCycleRead";
import { OpportunityBoard, WingedBriefcase } from "./OpportunityBoard";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";
import { ViewSkeleton } from "./ui/ViewSkeleton";

/** The same active-cycle gate previously supplied by ObjectivesPage. */
export function OpportunityWorkspace() {
  const dataRevision = useSyncExternalStore(subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "unknown_start" | "stale" | "error">(() => {
    const cached = peekViewCycle();
    return cached ? cycleState(cached) : "loading";
  });
  const [revision, setRevision] = useState(0);
  const [readError, setReadError] = useState(false);
  useEffect(() => {
    let active = true;
    readViewCycle().then(value => {
      if (!active) return;
      setReadError(false);
      setState(cycleState(value));
    }).catch(() => { if (active) { setReadError(true); setState(previous => previous === "ready" ? previous : "error"); } });
    return () => { active = false; };
  }, [revision, dataRevision]);
  const errorFeedback = <p role="alert">No pudimos verificar la búsqueda activa. <Button onClick={() => setRevision(v => v + 1)}>Reintentar</Button></p>;
  if (state === "ready") return <>{readError ? errorFeedback : null}<OpportunityBoard enabled={!readError} /></>;
  return <Panel title="Oportunidades" status={{ resolved: state !== "loading" && state !== "error", busy: state === "loading", error: readError || state === "stale" ? "No pudimos verificar la búsqueda activa." : "", onRetry: () => setRevision(v => v + 1) }} icon={<WingedBriefcase />} className="functional-block">
    {state === "loading" ? <ViewSkeleton kind="board" columns={4} label="Oportunidades"/> : null}
    {state === "empty" ? <p className="empty-value">No hay una búsqueda activa. Puedes iniciarla en Objetivos.</p> : null}
    {state === "unknown_start" ? <p className="empty-value">Configura el inicio en Objetivos para ver tus oportunidades.</p> : null}
    {state === "stale" ? <p role="alert">El ciclo cambió en otra pestaña. Actualiza esta página antes de guardar.</p> : null}
    {state === "error" ? errorFeedback : null}
  </Panel>;
}

function cycleState({ cycles, stale }: Awaited<ReturnType<typeof readViewCycle>>) {
  const cycle = cycles.find(item => item.status === "active");
  return stale ? "stale" : !cycle ? "empty" : !cycle.started_at ? "unknown_start" : "ready";
}
