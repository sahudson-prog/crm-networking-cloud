"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readActiveTodos,
  readAllInteractions,
  readDashboardKpis,
  readHeadhunterCompanies,
  readMirrorSummary,
  readReferralActions,
  readStatusCounts
} from "../lib/cloudData";
import type {
  HeadhunterCompanyRow,
  InteractionRow,
  KpiPeriodMode,
  KpiTrend,
  MirrorSummary,
  ReferralActionRow,
  StatusCount,
  TodoRow
} from "../lib/readModel";
import { CoachPreview } from "./CoachPreview";
import { DashboardKpis } from "./DashboardKpis";
import { HeadhunterCompanies } from "./HeadhunterCompanies";
import { RecentInteractionCards } from "./RecentCards";
import { ReferralActions } from "./ReferralActions";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

type LoadState = {
  loading: boolean;
  error: string;
  summary: MirrorSummary;
  statusCounts: StatusCount[];
  interactions: InteractionRow[];
  allInteractions: InteractionRow[];
  todos: TodoRow[];
  kpis: KpiTrend[];
  headhunterCompanies: HeadhunterCompanyRow[];
  referrals: ReferralActionRow[];
};

const emptySummary: MirrorSummary = {
  contacts: 0,
  activeContacts: 0,
  focusContacts: 0,
  headhunters: 0,
  interactions: 0,
  todos: 0,
  importBatches: 0
};

export function ReadOnlyDashboard() {
  const [periodMode, setPeriodMode] = useState<KpiPeriodMode>("weekly");
  const [selectedHeadhunterDomains, setSelectedHeadhunterDomains] = useState<Set<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<LoadState>({
    loading: true,
    error: "",
    summary: emptySummary,
    statusCounts: [],
    interactions: [],
    allInteractions: [],
    todos: [],
    kpis: [],
    headhunterCompanies: [],
    referrals: []
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [summary, statusCounts, allInteractions, todos, kpis, headhunterCompanies, referrals] = await Promise.all([
          readMirrorSummary(),
          readStatusCounts(),
          readAllInteractions(),
          readActiveTodos(),
          readDashboardKpis(periodMode),
          readHeadhunterCompanies(),
          readReferralActions()
        ]);

        if (!cancelled) {
          setState({
            loading: false,
            error: "",
            summary,
            statusCounts,
            interactions: allInteractions.slice(0, 8),
            allInteractions,
            todos,
            kpis,
            headhunterCompanies,
            referrals
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : "No se pudo leer Supabase."
          }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [periodMode, reloadToken]);

  const filteredInteractions = useMemo(() => {
    if (!selectedHeadhunterDomains.size) return state.interactions;
    const selectedInteractionIds = new Set(
      state.headhunterCompanies
        .filter((row) => selectedHeadhunterDomains.has(row.domain))
        .flatMap((row) => row.interactionIds)
    );
    return state.allInteractions.filter((interaction) => selectedInteractionIds.has(interaction.id)).slice(0, 8);
  }, [selectedHeadhunterDomains, state.allInteractions, state.headhunterCompanies, state.interactions]);

  function toggleHeadhunterDomain(domain: string) {
    setSelectedHeadhunterDomains((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  if (state.loading) return <section className="panel">Leyendo la replica cloud...</section>;
  if (state.error) return <section className="panel">Error: {state.error}</section>;

  return (
    <div className="grid">
      <Panel title="KPIs" caption="Replica inicial del bloque superior del dashboard local">
        <div className="section-toolbar">
          <span className="metric-label">Periodo KPI</span>
          <div className="button-group">
            <Button tone={periodMode === "weekly" ? "primary" : "secondary"} onClick={() => setPeriodMode("weekly")}>
              Semanal
            </Button>
            <Button tone={periodMode === "monthly" ? "primary" : "secondary"} onClick={() => setPeriodMode("monthly")}>
              Mensual
            </Button>
          </div>
        </div>
        <DashboardKpis trends={state.kpis} />
      </Panel>

      <Panel title="Coach IA" caption={`${state.summary.todos} sugerencias activas`} className="coach-panel">
        <CoachPreview
          todos={state.todos}
          total={state.summary.todos}
          interactions={state.allInteractions}
          onExecuted={() => setReloadToken((value) => value + 1)}
        />
      </Panel>

      <Panel title="Empresas headhunter" caption="Resumen por empresa/dominio HH">
        <HeadhunterCompanies
          rows={state.headhunterCompanies}
          selectedDomains={selectedHeadhunterDomains}
          onToggleDomain={toggleHeadhunterDomain}
          onClearSelection={() => setSelectedHeadhunterDomains(new Set())}
        />
      </Panel>

      <Panel
        title="Ultimas interacciones"
        caption={
          selectedHeadhunterDomains.size
            ? "Filtradas por empresas headhunter seleccionadas"
            : "Primer bloque comparable con la tabla local"
        }
      >
        <RecentInteractionCards interactions={filteredInteractions} />
      </Panel>

      <Panel title="Referidos sugeridos por accionar" caption="Referidos activos con origen/interaccion disponible">
        <ReferralActions rows={state.referrals} />
      </Panel>
    </div>
  );
}
