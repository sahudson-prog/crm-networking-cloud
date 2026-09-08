"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readActiveTodos,
  readAllInteractions,
  readAllActiveContacts,
  readAppSummary,
  readDashboardReferrals,
  readExternalSourcesForInteractions,
  readInteractionParticipants,
  readUserSetting,
  buildHeadhunterCompanies,
  readStatusCounts
} from "../lib/cloudData";
import { DEFAULT_CONTACT_FILTERS, filterContacts, objectiveOptionsForContacts, type ContactFilters } from "../lib/contactFilters";
import { buildDashboardKpis, parseLocalDate } from "../lib/kpiCalculations";
import { readObjectives } from "../lib/objectiveActions";
import { buildObjectiveMetrics } from "../lib/objectiveMetrics";
import type {
  ContactRow,
  DashboardReferralRow,
  ExternalInteractionSourceRow,
  HeadhunterCompanyRow,
  InteractionParticipantRow,
  InteractionRow,
  KpiPeriodMode,
  KpiTrend,
  AppSummary,
  ObjectiveRow,
  StatusCount,
  TodoRow
} from "../lib/readModel";
import { CoachPreview } from "./CoachPreview";
import { ContactFilterControls } from "./ContactFilterControls";
import { DashboardKpis } from "./DashboardKpis";
import { HeadhunterCompanies } from "./HeadhunterCompanies";
import { groupParticipantsByInteraction, groupSourcesByInteraction, InteractionTimelineList } from "./InteractionTimelineList";
import { ObjectiveMetricsTable } from "./ObjectiveMetricsTable";
import { ReferralActions } from "./ReferralActions";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

type LoadState = {
  loading: boolean;
  error: string;
  summary: AppSummary;
  statusCounts: StatusCount[];
  contacts: ContactRow[];
  allInteractions: InteractionRow[];
  participants: InteractionParticipantRow[];
  sources: ExternalInteractionSourceRow[];
  todos: TodoRow[];
  allObjectives: ObjectiveRow[];
  kpis: KpiTrend[];
  headhunterCompanies: HeadhunterCompanyRow[];
  referrals: DashboardReferralRow[];
  networkingStartValue: string;
};

const emptySummary: AppSummary = {
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
  const [quickQuery, setQuickQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [contactFilters, setContactFilters] = useState<ContactFilters>(DEFAULT_CONTACT_FILTERS);
  const [selectedHeadhunterDomains, setSelectedHeadhunterDomains] = useState<Set<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const [showIndividualCoachSuggestions, setShowIndividualCoachSuggestions] = useState(true);
  const [state, setState] = useState<LoadState>({
    loading: true,
    error: "",
    summary: emptySummary,
    statusCounts: [],
    contacts: [],
    allInteractions: [],
    participants: [],
    sources: [],
    todos: [],
    allObjectives: [],
    kpis: [],
    headhunterCompanies: [],
    referrals: [],
    networkingStartValue: ""
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [summary, statusCounts, contacts, allInteractions, todos, referrals, networkingStartValue, allObjectives] = await Promise.all([
          readAppSummary(),
          readStatusCounts(),
          readAllActiveContacts(),
          readAllInteractions(),
          readActiveTodos(),
          readDashboardReferrals(),
          readUserSetting("Fecha_Inicio_Networking"),
          readObjectives({ activeOnly: true })
        ]);
        const interactionIds = allInteractions.map((interaction) => interaction.id);
        const [participants, sources] = await Promise.all([
          readInteractionParticipants(),
          readExternalSourcesForInteractions(interactionIds)
        ]);
        const kpis = buildDashboardKpis({
          contacts,
          interactions: allInteractions,
          participants,
          mode: periodMode,
          networkingStartDate: parseLocalDate(networkingStartValue)
        });
        const headhunterCompanies = buildHeadhunterCompanies(contacts, allInteractions, participants);

        if (!cancelled) {
          setState({
            loading: false,
            error: "",
            summary,
            statusCounts,
            contacts,
            allInteractions,
            participants,
            sources,
            todos,
            allObjectives,
            kpis,
            headhunterCompanies,
            referrals,
            networkingStartValue
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

  const filteredContacts = useMemo(
    () => filterContacts(state.contacts, quickQuery, contactFilters),
    [contactFilters, quickQuery, state.contacts]
  );
  const networkingStartDate = useMemo(() => parseLocalDate(state.networkingStartValue), [state.networkingStartValue]);
  const dashboardInteractionsBase = useMemo(
    () => filterInteractionsFromDate(state.allInteractions, networkingStartDate),
    [networkingStartDate, state.allInteractions]
  );
  const objectiveOptions = useMemo(
    () => state.allObjectives.length ? state.allObjectives : objectiveOptionsForContacts(state.contacts),
    [state.allObjectives, state.contacts]
  );
  const filteredContactIds = useMemo(() => new Set(filteredContacts.map((contact) => contact.id)), [filteredContacts]);
  const contactMap = useMemo(() => new Map(state.contacts.map((contact) => [contact.id, contact])), [state.contacts]);
  const filteredParticipants = useMemo(
    () => state.participants.filter((participant) => participant.contact_id && filteredContactIds.has(participant.contact_id)),
    [filteredContactIds, state.participants]
  );
  const filteredInteractionIds = useMemo(
    () => new Set(filteredParticipants.map((participant) => participant.interaction_id)),
    [filteredParticipants]
  );
  const filteredInteractionsBase = useMemo(
    () => dashboardInteractionsBase.filter((interaction) => filteredInteractionIds.has(interaction.id)),
    [dashboardInteractionsBase, filteredInteractionIds]
  );
  const filteredKpis = useMemo(
    () => buildDashboardKpis({
      contacts: filteredContacts,
      interactions: filteredInteractionsBase,
      participants: filteredParticipants,
      mode: periodMode,
      networkingStartDate
    }),
    [filteredContacts, filteredInteractionsBase, filteredParticipants, networkingStartDate, periodMode]
  );
  const filteredHeadhunterCompanies = useMemo(
    () => buildHeadhunterCompanies(filteredContacts, filteredInteractionsBase, filteredParticipants),
    [filteredContacts, filteredInteractionsBase, filteredParticipants]
  );
  const filteredTodos = useMemo(
    () => state.todos.filter((todo) => !todo.object_id || filteredContactIds.has(todo.object_id)),
    [filteredContactIds, state.todos]
  );
  const objectiveMetrics = useMemo(
    () => buildObjectiveMetrics({
      objectives: state.allObjectives,
      contacts: filteredContacts,
      interactions: filteredInteractionsBase,
      participants: filteredParticipants,
      networkingStartDate
    }),
    [filteredContacts, filteredInteractionsBase, filteredParticipants, networkingStartDate, state.allObjectives]
  );
  const filteredReferrals = useMemo(
    () => state.referrals.filter((referral) => filteredContactIds.has(referral.referredByContactId) || Boolean(referral.linkedContactId && filteredContactIds.has(referral.linkedContactId))),
    [filteredContactIds, state.referrals]
  );
  const participantsByInteraction = useMemo(() => groupParticipantsByInteraction(state.participants), [state.participants]);
  const sourcesByInteraction = useMemo(() => groupSourcesByInteraction(state.sources), [state.sources]);
  const filteredInteractions = useMemo(() => {
    if (!selectedHeadhunterDomains.size) return filteredInteractionsBase.slice(0, 12);
    const selectedInteractionIds = new Set(
      filteredHeadhunterCompanies
        .filter((row) => selectedHeadhunterDomains.has(row.domain))
        .flatMap((row) => row.interactionIds)
    );
    return filteredInteractionsBase.filter((interaction) => selectedInteractionIds.has(interaction.id)).slice(0, 12);
  }, [filteredHeadhunterCompanies, filteredInteractionsBase, selectedHeadhunterDomains]);

  function toggleHeadhunterDomain(domain: string) {
    setSelectedHeadhunterDomains((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  if (state.loading) return <section className="panel">Cargando dashboard...</section>;
  if (state.error) return <section className="panel">Error: {state.error}</section>;

  return (
    <div className="grid">
      <div className="dashboard-filter-bar">
        <ContactFilterControls
          filters={contactFilters}
          filtersOpen={filtersOpen}
          objectiveOptions={objectiveOptions}
          quickQuery={quickQuery}
          summary={`Mostrando ${filteredContacts.length} de ${state.contacts.length} contactos`}
          onFiltersChange={setContactFilters}
          onFiltersOpenChange={setFiltersOpen}
          onQuickQueryChange={setQuickQuery}
        />
      </div>

      <Panel title="KPIs" caption="Resumen de actividad y objetivos">
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
        <DashboardKpis trends={filteredKpis} />
      </Panel>

      <Panel title="Objetivos" caption="Resumen segun filtros actuales">
        <ObjectiveMetricsTable rows={objectiveMetrics} />
      </Panel>

      <Panel
        title="Coach IA"
        caption={
          <span className="coach-panel-caption">
            {filteredTodos.length} sugerencias activas
            {filteredTodos.length ? (
              <>
                {" · "}
                <button type="button" onClick={() => setShowIndividualCoachSuggestions((value) => !value)}>
                  {showIndividualCoachSuggestions ? "ver agrupado" : "ver detallado"}
                </button>
              </>
            ) : null}
          </span>
        }
        className="coach-panel"
      >
        <CoachPreview
          todos={filteredTodos}
          total={filteredTodos.length}
          interactions={filteredInteractionsBase}
          showIndividualSuggestions={showIndividualCoachSuggestions}
          onExecuted={() => setReloadToken((value) => value + 1)}
        />
      </Panel>

      <Panel
        title="Ultimas interacciones"
        caption={
          selectedHeadhunterDomains.size
            ? "Filtradas por empresas headhunter seleccionadas"
            : "Interacciones segun filtros actuales"
        }
      >
        <InteractionTimelineList
          contactsById={contactMap}
          emptyMessage="Sin interacciones para los filtros actuales."
          interactions={filteredInteractions}
          participantsByInteraction={participantsByInteraction}
          showContactContext
          sourcesByInteraction={sourcesByInteraction}
        />
      </Panel>

      <Panel title="Empresas headhunter" caption="Resumen por empresa/dominio headhunter">
        <HeadhunterCompanies
          rows={filteredHeadhunterCompanies}
          selectedDomains={selectedHeadhunterDomains}
          onToggleDomain={toggleHeadhunterDomain}
          onClearSelection={() => setSelectedHeadhunterDomains(new Set())}
        />
      </Panel>

      <Panel title="Contactos referidos" caption="Referidos segun filtros actuales">
        <ReferralActions rows={filteredReferrals} />
      </Panel>
    </div>
  );
}

function filterInteractionsFromDate(interactions: InteractionRow[], minimumDate: Date | null) {
  if (!minimumDate) return interactions;
  const minimumTime = startOfLocalDay(minimumDate).getTime();
  return interactions.filter((interaction) => {
    if (!interaction.occurred_at) return false;
    const occurredAt = new Date(interaction.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) return false;
    return occurredAt.getTime() >= minimumTime;
  });
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
