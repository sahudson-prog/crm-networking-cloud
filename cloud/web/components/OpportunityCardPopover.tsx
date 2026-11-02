"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OPPORTUNITY_STAGES, opportunityResultsForStage, type Opportunity, type OpportunityResult, type OpportunityStage } from "../lib/opportunityModel";
import { Button } from "./ui/Button";

export type OpportunityCardAction = { kind: "stage" | "finalize"; row: Opportunity; anchor: HTMLButtonElement };

export function OpportunityCardPopover({ action, onClose, onMove, onFinalize }: {
  action: OpportunityCardAction;
  onClose: () => void;
  onMove: (row: Opportunity, stage: OpportunityStage) => void;
  onFinalize: (row: Opportunity, result: OpportunityResult, note: string) => Promise<boolean>;
}) {
  const titleId = useId();
  const popover = useRef<HTMLElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const savingRef = useRef(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const [result, setResult] = useState<OpportunityResult | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function close(restoreFocus = true) {
    if (savingRef.current) return;
    if (restoreFocus) action.anchor.focus();
    onClose();
  }

  useEffect(() => {
    function positionAtAnchor() {
      const rect = action.anchor.getBoundingClientRect();
      const width = popover.current?.offsetWidth ?? 300;
      const height = popover.current?.offsetHeight ?? 220;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 6);
      setPosition({ left, top });
    }
    function outside(event: PointerEvent) {
      if (!popover.current?.contains(event.target as Node) && event.target !== action.anchor) close(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }
    const frame = window.requestAnimationFrame(() => { positionAtAnchor();
      (action.kind === "finalize" ? firstField.current : popover.current?.querySelector("button"))?.focus(); });
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionAtAnchor);
    window.addEventListener("scroll", positionAtAnchor, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionAtAnchor);
      window.removeEventListener("scroll", positionAtAnchor, true);
    };
  }, [action, onClose]);

  async function confirm() {
    if (!result || saving) return;
    savingRef.current = true; setSaving(true); setError("");
    const saved = await onFinalize(action.row, result, note);
    savingRef.current = false; setSaving(false);
    if (saved) {
      close(false);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".opportunity-situation-filter button")?.focus());
    }
    else setError("No pudimos confirmar el cierre. Actualiza el tablero antes de reintentar.");
  }

  return createPortal(<section ref={popover} className="activity-sync-popover opportunity-action-popover"
      role="dialog" aria-labelledby={titleId} style={position}>
    <div className="activity-sync-popover-heading"><strong id={titleId}>
      {action.kind === "finalize" ? "Finalizar oportunidad" : "Mover a otra etapa"}
    </strong></div>
    {action.kind === "stage" ? <div className="opportunity-stage-options">
      {OPPORTUNITY_STAGES.filter(([stage]) => stage !== action.row.stage).map(([stage, label]) =>
        <Button key={stage} tone="ghost" onClick={() => { onMove(action.row, stage); onClose(); }}>{label}</Button>)}
    </div> : <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      <label className="field"><span>Resultado</span><select ref={firstField} required value={result}
        disabled={saving} onChange={(event) => setResult(event.target.value as OpportunityResult | "")}>
        <option value="">Seleccionar resultado</option>
        {opportunityResultsForStage(action.row.stage).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="field"><span>Causa de cierre <small>(opcional)</small></span>
        <textarea maxLength={500} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <p role="alert" className="opportunity-editor-feedback danger-text">{error}</p> : null}
      <div className="modal-actions">
        <Button disabled={saving} onClick={() => close()}>Cancelar</Button>
        <Button type="submit" tone="primary" disabled={saving || !result}>{saving ? "Guardando..." : "Confirmar"}</Button>
      </div>
    </form>}
  </section>, document.body);
}
