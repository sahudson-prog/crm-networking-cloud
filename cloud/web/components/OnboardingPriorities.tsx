"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readObjectives, saveObjective } from "../lib/cycleObjectiveActions";
import { ONBOARDING_PRIORITY_GROUPS, onboardingPriorityChange, onboardingPriorityCount, priorityIdentity } from "../lib/onboardingPriorities";
import type { ObjectiveRow, ObjectiveType } from "../lib/readModel";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function OnboardingPriorities({ onReadyChange, onBusyChange }: {
  onReadyChange: (ready: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<ObjectiveRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [customType, setCustomType] = useState<ObjectiveType | null>(null);
  const [name, setName] = useState("");
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const reload = useCallback(async () => {
    setBusy(true); setError("");
    try { setRows(await readObjectives()); }
    catch { setError("No pudimos leer tus prioridades. Reintenta antes de continuar."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { onReadyChange(!busy && !error && onboardingPriorityCount(rows) > 0); }, [rows, busy, error, onReadyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { if (customType) dialog.current?.showModal(); }, [customType]);
  async function change(type: ObjectiveType, value: string, selected: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const current = await readObjectives();
      const input = onboardingPriorityChange(current, type, value, selected);
      if (input) await saveObjective(input);
      setRows(await readObjectives());
      dialog.current?.close(); setCustomType(null); setName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar la prioridad. Reintenta."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="onboarding-priorities" aria-busy={busy}>
    <div className="panel-header"><h2 className="panel-title"><Icon name="tag" /> Elige al menos una prioridad</h2></div>
    {ONBOARDING_PRIORITY_GROUPS.map(group => {
      const names = [...new Map([...group.names, ...rows.filter(row => row.objective_type === group.type).map(row => row.objective_name)].map(value => [priorityIdentity(value), value])).values()];
      return <div className="onboarding-priority-group" key={group.type}>
        <h3>{group.label}</h3><div className="onboarding-priority-options">{names.map(value => {
          const selected = rows.some(row => row.objective_type === group.type && priorityIdentity(row.objective_name) === priorityIdentity(value) && row.is_active);
          return <button type="button" className="objective-chip onboarding-priority-chip" key={value}
            aria-pressed={selected} disabled={busy}
            onClick={() => void change(group.type, value, !selected)}>{value}</button>;
        })}<Button className="onboarding-priority-add" icon="plus" disabled={busy} onClick={() => { setName(""); setCustomType(group.type); }}>Escribir otra…</Button></div>
      </div>;
    })}
    {error ? <p className="form-error" role="alert">{error} <Button disabled={busy} onClick={() => void reload()}>Reintentar lectura</Button></p> : null}
    {customType ? <dialog ref={dialog} className="modal-card" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setCustomType(null)} aria-labelledby="onboarding-custom-priority">
      <h2 id="onboarding-custom-priority">Nueva prioridad</h2>
      <label className="field"><span>Nombre</span><input autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <footer className="modal-actions"><Button disabled={busy} onClick={() => dialog.current?.close()}>Cancelar</Button>
        <Button tone="primary" disabled={busy || !name.trim()} onClick={() => void change(customType, name, true)}>Crear prioridad</Button></footer>
    </dialog> : null}
  </div>;
}
