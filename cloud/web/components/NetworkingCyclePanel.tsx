"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BriefcaseBusiness, Handshake, Megaphone } from "lucide-react";
import {
  adoptConfirmedOwnClose, closeNetworkingCycle, expectedNetworkingContext, localDateTimeValue,
  networkingContextFromCycles, readNetworkingCycles, startNetworkingCycle, type NetworkingCycle
} from "../lib/networkingCycles";
import { NETWORKING_CYCLE_RESULTS, type NetworkingCycleResult } from "../lib/networkingCycleModel";
import { createCycleCloseFlow } from "../lib/networkingCycleCloseFlow";
import { firstSelectableStartInstant, localDateTimeCandidates, localDateTimeToIso, startInputMin, startIsOnOrAfterClose,
  timezoneOffsetLabel, type RepeatedTimeChoice } from "../lib/networkingCycleTime";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

function suggestedName() {
  return `Búsqueda laboral · ${new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(new Date())}`;
}

export function NetworkingCyclePanel({ onReadyChange, onCycleChange }: {
  onReadyChange?: (ready: boolean) => void;
  onCycleChange?: () => void;
}) {
  const [cycles, setCycles] = useState<NetworkingCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [startFieldError, setStartFieldError] = useState("");
  const [stale, setStale] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [start, setStart] = useState(() => localDateTimeValue());
  const [startChoice, setStartChoice] = useState<RepeatedTimeChoice | "">("");
  const [resetStatus, setResetStatus] = useState(false);
  const [clearFocus, setClearFocus] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [end, setEnd] = useState(() => localDateTimeValue());
  const [endChoice, setEndChoice] = useState<RepeatedTimeChoice | "">("");
  const [result, setResult] = useState<NetworkingCycleResult | "">("");
  const requestId = useRef<string>(crypto.randomUUID());
  const closeRequestId = useRef<string>(crypto.randomUUID());
  const closeSubmitPending = useRef(false);
  const closeFlow = useRef(createCycleCloseFlow(closeNetworkingCycle, readNetworkingCycles, adoptConfirmedOwnClose));
  const createDialog = useRef<HTMLDialogElement>(null);
  const closeDialog = useRef<HTMLDialogElement>(null);
  const active = cycles.find((cycle) => cycle.status === "active") ?? null;
  const needsConfiguration = Boolean(active && !active.started_at);
  const ready = Boolean(active?.started_at && !stale);
  const hasHistory = cycles.some((cycle) => cycle.status === "closed");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const previousClosedAt = cycles.filter((cycle) => cycle.status === "closed" && cycle.closed_at)
    .reduce<string | null>((latest, cycle) => !latest || Date.parse(cycle.closed_at!) > Date.parse(latest)
      ? cycle.closed_at : latest, null);
  const startMinimum = useMemo(() => previousClosedAt ? startInputMin(previousClosedAt, timezone) : undefined,
    [previousClosedAt, timezone]);
  const startCandidates = candidatesFor(start, timezone);
  const startBeforePreviousClose = Boolean(previousClosedAt && startCandidates.length
    && startIsOnOrAfterClose(start, timezone, previousClosedAt, startChoice || undefined) === false);
  const startDateError = startFieldError || (startBeforePreviousClose
    ? "El inicio no puede ser anterior al cierre del proceso anterior." : "");
  const endCandidates = candidatesFor(end, timezone);

  useEffect(() => { onReadyChange?.(ready); }, [onReadyChange, ready]);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (creating && !createDialog.current?.open) createDialog.current?.showModal(); }, [creating]);
  useEffect(() => { if (closing && !closeDialog.current?.open) closeDialog.current?.showModal(); }, [closing]);

  function openCreate() {
    setStart(localDateTimeValue());
    setStartChoice("");
    setResetStatus(false);
    setClearFocus(false);
    setError("");
    setStartFieldError("");
    setCreating(true);
  }

  function openClose() {
    setEnd(localDateTimeValue());
    setEndChoice("");
    setResult("");
    setError("");
    setClosing(true);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [rows, expected] = await Promise.all([readNetworkingCycles(), expectedNetworkingContext()]);
      setCycles(rows);
      const changed = expected.token !== networkingContextFromCycles(rows).token;
      setStale(changed);
      if (changed) setError("El ciclo cambió en otra pestaña. Actualiza esta página antes de guardar.");
    } catch (cause) {
      setStale(true);
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }

  async function createOrConfigure() {
    if (previousClosedAt && startIsOnOrAfterClose(start, timezone, previousClosedAt,
      startChoice || undefined) !== true) {
      setStartFieldError("El inicio debe ser igual o posterior al cierre del proceso anterior.");
      return;
    }
    setWorking(true);
    setError("");
    setStartFieldError("");
    try {
      await startNetworkingCycle({
        requestId: requestId.current, name, localStart: start,
        repeatedTimeChoice: startChoice || undefined,
        resetStatus: needsConfiguration ? false : resetStatus,
        clearFocus: needsConfiguration ? false : clearFocus,
        legacyCycleId: needsConfiguration ? active?.id : undefined
      });
      requestId.current = crypto.randomUUID();
      createDialog.current?.close();
      await load();
      onCycleChange?.();
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("networking_cycle_date_overlap")) {
        setStartFieldError("La fecha se superpone con otro proceso. Actualiza la página y vuelve a elegir el inicio.");
      } else {
        setError(messageFor(cause));
      }
    } finally {
      setWorking(false);
    }
  }

  async function finish() {
    if (!active || !result || closeSubmitPending.current) return;
    try {
      localDateTimeToIso(end, timezone, endChoice || undefined);
    } catch (cause) {
      setError(messageFor(cause));
      return;
    }
    closeSubmitPending.current = true;
    setWorking(true);
    setError("");
    try {
      const outcome = await closeFlow.current({ requestId: closeRequestId.current, cycleId: active.id,
        localEnd: end, result, repeatedTimeChoice: endChoice || undefined });
      if (outcome.kind === "ignored") return;
      if (outcome.kind === "failed") {
        setError(messageFor(outcome.error));
        return;
      }
      if (outcome.kind === "unconfirmed") {
        setStale(true);
        setError("No pudimos confirmar si el cierre se guardó. Recarga la página antes de intentar otra acción.");
        return;
      }
      closeRequestId.current = crypto.randomUUID();
      setClosing(false);
      if (closeDialog.current?.open) closeDialog.current.close();
      setResult("");
      setName(suggestedName());
      setStart(localDateTimeValue());
      setStartChoice("");
      setResetStatus(false);
      setClearFocus(false);
      if (outcome.kind === "closed" || outcome.kind === "closed_elsewhere") {
        setCycles(outcome.cycles);
        setStale(outcome.kind === "closed_elsewhere");
        if (outcome.kind === "closed_elsewhere") {
          setError("El proceso fue finalizado en otra pestaña. Actualiza esta página antes de iniciar otro.");
        }
        onCycleChange?.();
      } else {
        setStale(true);
        setError("El proceso se finalizó, pero no pudimos actualizar la vista. Recarga la página para confirmar su estado.");
      }
    } finally {
      closeSubmitPending.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="networking-cycle-panel" aria-labelledby="my-cycle-title">
      <div className="panel-header">
        <h2 className="panel-title" id="my-cycle-title"><Icon name="target" /> Mi objetivo</h2>
      </div>
      {loading ? <p role="status">Leyendo tu ciclo...</p> : null}
      <div className="networking-plan-grid">
        <article className={`networking-plan ${active ? "is-active" : ""}`}>
          <div className="networking-plan-heading">
            <BriefcaseBusiness className="networking-plan-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
            <h3>Encontrar tu próximo trabajo</h3>
          </div>
          {active ? (
            <div className="networking-process-summary">
              <strong>{active.cycle_name || "Búsqueda laboral"}</strong>
              <span>Inicio: {formatDate(active.started_at, active.timezone_name)}</span>
            </div>
          ) : <p>{hasHistory ? "Tu búsqueda anterior terminó. Puedes comenzar otra cuando quieras." : "Organiza tu búsqueda laboral en un proceso."}</p>}
          <div className="networking-plan-actions">
            {active?.started_at ? (
              <Button className="networking-process-action" disabled={working || stale} onClick={openClose}>Finalizar proceso</Button>
            ) : (
              <Button className="networking-process-action" disabled={working || stale || loading} onClick={openCreate} tone="primary">Comenzar proceso</Button>
            )}
          </div>
        </article>
        <article className="networking-plan is-unavailable">
          <div className="networking-plan-heading"><Handshake className="networking-plan-icon" size={22} strokeWidth={1.8} aria-hidden="true" /><h3>Generar nuevos negocios</h3></div>
          <span className="networking-plan-status">Próximamente</span>
          <span className="networking-plan-pending">Avísame · pendiente de habilitación</span>
        </article>
        <article className="networking-plan is-unavailable">
          <div className="networking-plan-heading"><Megaphone className="networking-plan-icon" size={22} strokeWidth={1.8} aria-hidden="true" /><h3>Posicionar tu marca</h3></div>
          <span className="networking-plan-status">Próximamente</span>
          <span className="networking-plan-pending">Avísame · pendiente de habilitación</span>
        </article>
      </div>
      {!creating && !closing && error ? <p className="form-error" role="alert">{error}</p> : null}
      {creating ? (
        <dialog ref={createDialog} className="modal-card networking-process-dialog" aria-labelledby="create-process-title"
          onCancel={(event) => { if (working) event.preventDefault(); }} onClose={() => setCreating(false)}>
          <header className="modal-head">
            <h2 id="create-process-title">{needsConfiguration ? "Completar proceso" : "Comenzar proceso"}</h2>
            <Button icon="close" square aria-label="Cerrar diálogo" disabled={working} onClick={() => createDialog.current?.close()} />
          </header>
          <p>{needsConfiguration
            ? "Este proceso conserva tus Prioridades. Su fecha de inicio aún es desconocida."
            : "Define el inicio de tu búsqueda laboral."}</p>
          <div className="networking-cycle-form">
            <label className="field"><span>Nombre del proceso</span>
              <input maxLength={120} disabled={working} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field"><span>Inicio: fecha y hora</span>
              <input type="datetime-local" step="1" disabled={working} min={startMinimum}
                max={localDateTimeValue()} value={start}
                aria-invalid={Boolean(startDateError) || Boolean(start && !startCandidates.length)}
                aria-describedby={[previousClosedAt ? "start-boundary-help" : "", startDateError ? "start-boundary-error" : ""].filter(Boolean).join(" ") || undefined}
                onChange={(event) => { setStart(event.target.value); setStartChoice(""); setStartFieldError(""); }} />
            </label>
            {previousClosedAt ? <small id="start-boundary-help">Cierre anterior: {formatDateTime(previousClosedAt, timezone)}
              {` (${timezone}, ${timezoneOffsetLabel(new Date(previousClosedAt), timezone)}). `}
              {firstSelectableStartInstant(previousClosedAt) > Date.parse(previousClosedAt)
                ? `Primera hora seleccionable: ${formatDateTime(new Date(firstSelectableStartInstant(previousClosedAt)).toISOString(), timezone)}. `
                : ""}
              Puedes iniciar otro proceso desde la primera hora seleccionable, incluso el mismo día.</small> : null}
            {startDateError ? <small className="form-error" id="start-boundary-error" role="alert">{startDateError}</small> : null}
            {start && !startCandidates.length ? <small role="alert">Esa hora no existe en {timezone} por el cambio de horario.</small> : null}
            {startCandidates.length > 1 ? (
              <label className="field"><span>Hora repetida: elige el instante</span>
                <select value={startChoice} onChange={(event) => { setStartChoice(event.target.value as RepeatedTimeChoice | ""); setStartFieldError(""); }}>
                  <option value="">Selecciona una opción</option>
                  <option value="earlier">Primera vez ({timezoneOffsetLabel(startCandidates[0], timezone)})</option>
                  <option value="later">Segunda vez ({timezoneOffsetLabel(startCandidates[startCandidates.length - 1], timezone)})</option>
                </select>
              </label>
            ) : null}
            <small>Zona horaria: {timezone}. Puedes indicar un inicio anterior a tu uso de Coffeecito.</small>
            {!needsConfiguration && hasHistory ? (
              <div className="networking-cycle-options">
                <label><input type="checkbox" checked={resetStatus} disabled={working}
                  onChange={(event) => setResetStatus(event.target.checked)} /> Reiniciar estados a Pendiente</label>
                <label><input type="checkbox" checked={clearFocus} disabled={working}
                  onChange={(event) => setClearFocus(event.target.checked)} /> Limpiar foco de networking</label>
                <small>Estas opciones afectan solo a contactos activos, incluidos headhunters.</small>
              </div>
            ) : null}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="modal-actions">
            <Button disabled={working} onClick={() => createDialog.current?.close()}>Cancelar</Button>
            <Button disabled={working || stale || startBeforePreviousClose || !name.trim() || !start || !startCandidates.length
              || (startCandidates.length > 1 && !startChoice)} tone="primary" onClick={() => void createOrConfigure()}>
              {working ? "Guardando..." : needsConfiguration ? "Completar proceso" : "Comenzar proceso"}
            </Button>
          </footer>
        </dialog>
      ) : null}
      {closing && active ? (
        <dialog ref={closeDialog} className="modal-card networking-process-dialog" aria-labelledby="close-process-title"
          onCancel={(event) => { if (closeSubmitPending.current) event.preventDefault(); }} onClose={() => setClosing(false)}>
          <header className="modal-head">
            <h2 id="close-process-title">Finalizar proceso</h2>
            <Button icon="close" square aria-label="Cerrar diálogo" disabled={working}
              onClick={() => { if (!closeSubmitPending.current) closeDialog.current?.close(); }} />
          </header>
          <p>Las Prioridades quedan en este proceso; contactos e interacciones se conservan. No se iniciará otro automáticamente.</p>
          <label className="field"><span>Fin: fecha y hora</span>
            <input type="datetime-local" step="1" value={end} max={localDateTimeValue()} disabled={working}
              onChange={(event) => { setEnd(event.target.value); setEndChoice(""); }} />
          </label>
          {end && !endCandidates.length ? <small role="alert">Esa hora no existe en {timezone} por el cambio de horario.</small> : null}
          {endCandidates.length > 1 ? (
            <label className="field"><span>Hora repetida: elige el instante</span>
              <select value={endChoice} onChange={(event) => setEndChoice(event.target.value as RepeatedTimeChoice | "")}>
                <option value="">Selecciona una opción</option>
                <option value="earlier">Primera vez ({timezoneOffsetLabel(endCandidates[0], timezone)})</option>
                <option value="later">Segunda vez ({timezoneOffsetLabel(endCandidates[endCandidates.length - 1], timezone)})</option>
              </select>
            </label>
          ) : null}
          <label className="field"><span>Resultado</span>
            <select value={result} disabled={working} onChange={(event) => setResult(event.target.value as NetworkingCycleResult | "")}>
              <option value="">Selecciona un resultado</option>
              {NETWORKING_CYCLE_RESULTS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
          <small>Si eliges un fin anterior, el estado y foco observados hoy no representan necesariamente esa fecha.</small>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="modal-actions">
            <Button disabled={working} onClick={() => { if (!closeSubmitPending.current) closeDialog.current?.close(); }}>Cancelar</Button>
            <Button disabled={working || stale || !end || !result || !endCandidates.length
              || (endCandidates.length > 1 && !endChoice)} tone="primary" onClick={() => void finish()}>
              {working ? "Finalizando..." : "Finalizar proceso"}
            </Button>
          </footer>
        </dialog>
      ) : null}
    </section>
  );
}

function formatDate(value: string | null, zone: string | null) {
  if (!value) return "Desconocido";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: zone || "UTC" }).format(new Date(value));
}

function formatDateTime(value: string, zone: string) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: zone }).format(date);
  const time = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: zone }).format(date);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value)?.[1] ?? "";
  return `${day}, ${time}${/[1-9]/.test(fraction) ? `.${fraction}` : ""}`;
}

function messageFor(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "No pudimos guardar el ciclo.";
  if (message.includes("networking_context_stale")) return "El ciclo cambió en otra pestaña. Actualiza antes de guardar.";
  if (message.includes("cycle_already_closed")) return "Este proceso ya fue finalizado en otra sesión. Recarga la página para ver el cierre.";
  if (message.includes("cycle_request_conflict")) return "El intento de cierre tiene datos distintos a los ya registrados. Recarga la página antes de continuar.";
  if (message.includes("networking_cycle_date_overlap")) return "El período se superpone con otro ciclo.";
  if (message.includes("cycle_end_invalid")) return "El fin debe ser posterior al inicio y no puede estar en el futuro.";
  if (message.includes("cycle_start_invalid")) return "El inicio no puede estar en el futuro.";
  return message;
}

function candidatesFor(value: string, timezone: string) {
  try { return localDateTimeCandidates(value, timezone); } catch { return []; }
}
