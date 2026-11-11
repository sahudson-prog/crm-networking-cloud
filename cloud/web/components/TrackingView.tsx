"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { nextTrackingPeriodBoundary, trackingPeriods, type PeriodMode, type ReadyTracking } from "../lib/trackingModel";
import { Button } from "./ui/Button";
import { HelpTooltip } from "./ui/HelpTooltip";
import { KpiLineChart } from "./DashboardKpis";

const labels = ["Contactados", "Cafés", "Procesos", "Ofertas recibidas", "Ofertas exitosas"];
const definitions = [
  "Contactos en estado Contactado o superior.",
  "Contactos en estado Cita concretada o Agradecimiento enviado.",
  "Oportunidades en etapa En proceso u Oferta recibida.",
  "Oportunidades en etapa Oferta recibida.",
  "Oportunidades finalizadas con oferta aceptada."
];
const percent = (n: number | null) => n === null ? "Sin base" : `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(n)} %`;

/** Presentation inside the existing dashboard KPI Panel, not another page or card. */
export function TrackingView({ model, groupHeadhunters, onGroupChange }: {
  model: ReadyTracking; groupHeadhunters: boolean; onGroupChange: (value: boolean) => void;
}) {
  return <div className="tracking-overview">
    <TrackingPyramid model={model} />
    <TrackingBars model={model} groupHeadhunters={groupHeadhunters} onGroupChange={onGroupChange} />
  </div>;
}

export function TrackingPyramid({ model }: { model: ReadyTracking }) {
  return <ol className="tracking-pyramid" aria-label="Avances, de base a cima">
      {model.counts.map((count, i) => <li key={labels[i]}>
        <div className="tracking-level-row">
          <span className="tracking-level-label">{labels[i]}</span>
          <div className="tracking-level-slot">
            <HelpTooltip floating className={`tracking-level tracking-level-${i}`} style={{ width: `${100 - i * 13}%` }}
              text={definitions[i]} label={`${labels[i]}: ${count}`}><strong>{count}</strong></HelpTooltip>
          </div>
        </div>
        {i > 0 ? <div className="tracking-conversion">
          <HelpTooltip floating text={`${labels[i]} / ${labels[i - 1]}`}
            label={`${labels[i]} sobre ${labels[i - 1]}: ${percent(model.ratios[i - 1])}`}>
            <ArrowUp size={14} aria-hidden="true" /><span>{percent(model.ratios[i - 1])}</span>
          </HelpTooltip>
        </div> : null}
      </li>)}
    </ol>;
}

export function TrackingBars({ model, groupHeadhunters, onGroupChange, standalone = false }: {
  model: ReadyTracking; groupHeadhunters: boolean; onGroupChange: (value: boolean) => void; standalone?: boolean;
}) {
  const [mode, setMode] = useState<PeriodMode>("weekly");
  const [clock, setClock] = useState(model.now);
  const clockBase = useRef({ server: model.now, wall: Date.now() });
  useEffect(() => {
    clockBase.current = { server: model.now, wall: Date.now() };
    setClock(model.now);
  }, [model.now]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refreshPeriod = () => {
      const now = clockBase.current.server + Date.now() - clockBase.current.wall;
      setClock(now);
      const boundary = nextTrackingPeriodBoundary(now, model.zone, mode);
      timer = setTimeout(refreshPeriod, Math.max(1, boundary - now + 1));
    };
    refreshPeriod();
    return () => clearTimeout(timer);
  }, [model.now, model.zone, mode]);
  const { periods } = trackingPeriods(model, mode, clock);
  const dateLabel = (key: string) => {
    const date = new Date(`${key}T12:00:00Z`);
    return new Intl.DateTimeFormat("es", { day: mode === "weekly" ? "numeric" : undefined, month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
  };
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const axisLabel = (key: string) => mode === "weekly"
    ? `${Number(key.slice(8))} ${months[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`
    : months[Number(key.slice(5, 7)) - 1];
  return <section className={`tracking-coffee ${standalone ? "tracking-coffee-standalone" : ""}`} aria-label="Total cafés">
    <header className="section-toolbar">{standalone ? null : <h3 id="tracking-bars-title">Total cafés</h3>}
      <div className="tracking-chart-controls">
        <Button className="tracking-group-toggle" icon={groupHeadhunters ? "users" : "circleDot"}
          aria-pressed={groupHeadhunters} onClick={() => onGroupChange(!groupHeadhunters)}>Agrupar Headhunters</Button>
        <div className="tracking-period-switch" role="group" aria-label="Períodos">
          {(["monthly", "weekly"] as const).map(value => <button key={value} type="button" className={mode === value ? "active" : ""} aria-pressed={mode === value}
            onClick={() => setMode(value)}>{value === "weekly" ? "Semanal" : "Mensual"}</button>)}
        </div>
      </div>
    </header>
    <KpiLineChart trend={{ title: "Total cafés", points: periods.map(p => ({ label: p ? dateLabel(p.key) : "", total: p ? p.blue + p.green : 0 })) }}
      stackedMode={mode}
      stacked={periods.map(p => p ? { realized: p.blueActual, estimated: p.blueEstimated, future: p.green,
        detail: `${dateLabel(p.key)}${p.partial ? ", período inicial parcial" : ""}`, axisLabel: axisLabel(p.key), visible: true }
        : { realized: 0, estimated: 0, future: 0, detail: "", axisLabel: "", visible: false })} />
    <div className="chart-legend"><span><i className="legend-bar tracking-blue" />contactos con café realizado</span>
      <span><i className="legend-bar tracking-blue-estimated" />contactos con café realizado (fecha estimada)</span>
      <span><i className="legend-bar tracking-green" />contactos con café proyectado</span></div>
  </section>;
}
