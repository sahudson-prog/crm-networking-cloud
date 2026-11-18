"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { operationPhase, type OperationState } from "../../lib/operationState";
import { Button } from "./Button";

export function OperationStatus({ label, ...state }: OperationState & { label: string }) {
  const phase = operationPhase(state);
  const confirming = Boolean(state.confirming);
  const previousPhase = useRef(phase);
  const confirmationPending = useRef(!state.resolved);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!state.resolved || confirming || phase === "error") confirmationPending.current = true;
    const newlyConfirmed = phase === "ready" && previousPhase.current !== "ready" && confirmationPending.current;
    if (phase === "ready") confirmationPending.current = false;
    previousPhase.current = phase;
    if (confirming || phase === "error") {
      clearTimeout(timer.current);
      setConfirmed(false);
    }
    if (!newlyConfirmed) return;
    clearTimeout(timer.current);
    setConfirmed(true);
    timer.current = setTimeout(() => setConfirmed(false), 3000);
  }, [phase, state.resolved, confirming]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const visible = phase !== "ready" || confirmed;
  const text = phase === "error" ? state.error! : phase === "busy" ? "Verificando los datos." : "Datos confirmados.";
  const Glyph = phase === "error" ? CircleAlert : phase === "busy" ? LoaderCircle : CircleCheck;
  return <span className="operation-status" data-phase={visible ? phase : "idle"}>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{label}: {text}</span>
    {/* Expiry removes the icon, not a focused control or an open detail. */}
    {visible || focused || open ? <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="operation-status-trigger" aria-label={`${label}: ${text}`}
          aria-busy={Boolean(state.busy || confirming || !state.resolved && !state.error)} title={text}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
          {visible ? <Glyph size={18} aria-hidden="true" /> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content className="operation-status-detail" side="bottom" align="start" sideOffset={6}
        collisionPadding={12} aria-label={`Estado de ${label}`}>
        <p>{text}</p>
        {phase === "error" && state.onRetry ? <Button icon="sync" disabled={state.busy} onClick={state.onRetry}>Reintentar lectura</Button> : null}
        <Popover.Close asChild><Button icon="close" square aria-label="Cerrar estado" /></Popover.Close>
      </Popover.Content></Popover.Portal>
    </Popover.Root> : null}
  </span>;
}
