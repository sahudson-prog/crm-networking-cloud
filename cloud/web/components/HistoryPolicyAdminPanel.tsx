"use client";
import { useEffect, useState } from "react";
import { readHistoryPolicy, saveHistoryPolicy, type HistoryPolicy } from "../lib/historyPolicy";
import { Button } from "./ui/Button";
export function HistoryPolicyAdminPanel() {
  const [policy, setPolicy] = useState<HistoryPolicy | null>(null);
  const [months, setMonths] = useState("6"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    readHistoryPolicy("UTC").then(value => { if (active) { setPolicy(value); setMonths(String(value.max_months)); setError(""); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [reload]);
  async function save() {
    if (!policy || busy) return;
    setBusy(true); setError("");
    try { await saveHistoryPolicy(Number(months), policy.revision); setReload(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "No pudimos guardar el límite."); }
    finally { setBusy(false); }
  }
  return <section className="maintenance-service-group">
    <h3>Historia de networking</h3>
    <label className="field"><span>Máximo de meses hacia atrás</span>
      <input type="number" min={1} max={12} step={1} value={months} disabled={busy || !policy} onChange={e => setMonths(e.target.value)} />
    </label>
    <div className="toolbar"><Button icon="check" disabled={busy || !policy || !Number.isInteger(Number(months)) || Number(months)<1 || Number(months)>12}
      onClick={() => void save()}>Guardar límite</Button>
      {error ? <Button onClick={() => setReload(v => v + 1)} disabled={busy}>Reintentar lectura</Button> : null}</div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
