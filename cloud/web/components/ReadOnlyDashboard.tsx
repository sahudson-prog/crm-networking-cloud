"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeGlobalActivitySync, getGlobalActivitySyncSnapshot, getGlobalActivitySyncServerSnapshot } from "../lib/activitySyncExecution";
import { Binoculars, Building2, ChartColumn, ChartSpline, Handshake, MessagesSquare } from "lucide-react";
import { readTrackingSnapshot } from "../lib/trackingRead";
import { buildTracking, defaultTrackingFilters, type TrackingSnapshot } from "../lib/trackingModel";
import { useTrackingViewFilters } from "./useTrackingViewFilters";
import { readDashboardDetails, type DashboardDetails } from "../lib/dashboardDetails";
import { buildHeadhunterCompanies } from "../lib/cloudData";
import { DEFAULT_CONTACT_FILTERS, filterContacts, type ContactFilters } from "../lib/contactFilters";
import { buildObjectiveMetrics, type ObjectiveMetricRow } from "../lib/objectiveMetrics";
import type { ObjectiveRow } from "../lib/readModel";
import { ContactFilterControls } from "./ContactFilterControls";
import { TrackingView, TrackingPyramid, TrackingBars } from "./TrackingView";
import { ObjectiveMetricsTable } from "./ObjectiveMetricsTable";
import { HeadhunterCompanies } from "./HeadhunterCompanies";
import { InteractionTimelineList, groupParticipantsByInteraction, groupSourcesByInteraction } from "./InteractionTimelineList";
import { ReferralActions } from "./ReferralActions";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";

const noSelectedDomains = new Set<string>();

export function ReadOnlyDashboard({ view = "all" }: { view?: "all" | "home" | "planning" | "interactions" | "referrals" } = {}) {
  const calendarSyncedAt = useSyncExternalStore(subscribeGlobalActivitySync, getGlobalActivitySyncSnapshot,
    getGlobalActivitySyncServerSnapshot).lastSuccess?.calendar;
  const [snapshot, setSnapshot] = useState<TrackingSnapshot | null>(null);
  const [details, setDetails] = useState<DashboardDetails | null>(null);
  const savedFilters = useTrackingViewFilters();
  const { setFilters, setQuickQuery, setSelectedDomains } = savedFilters;
  const hideFilters = view === "interactions" || view === "referrals";
  // These embedded blocks have no filter controls. Ignore optional URL selections
  // without clearing the state still editable in Inicio/Planificar. Foco and cycle rules remain below.
  const filters = hideFilters ? defaultTrackingFilters : savedFilters.filters;
  const quickQuery = hideFilters ? "" : savedFilters.quickQuery;
  const selectedDomains = hideFilters ? noSelectedDomains : savedFilters.selectedDomains;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(true), [detailError, setDetailError] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true); setError(false); setDetailLoading(true); setDetailError(false);
    readTrackingSnapshot().then(value => {
      buildTracking(value);
      if (generation.current !== current) return;
      setSnapshot(value);
      setFilters(f => ({ ...f, priorityIds: f.priorityIds.filter(id => value.priorities.some(p => p.id === id)) }));
    }).catch(() => { if (generation.current === current) setError(true); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    readDashboardDetails().then(value => { if (generation.current === current) setDetails(value); })
      .catch(() => { if (generation.current === current) setDetailError(true); })
      .finally(() => { if (generation.current === current) setDetailLoading(false); });
    return () => { generation.current++; };
  }, [revision, calendarSyncedAt]);
  const model = useMemo(() => snapshot ? buildTracking(snapshot, filters) : null, [snapshot, filters]);
  const objectives = useMemo<ObjectiveRow[]>(() => (snapshot?.priorities ?? []).map(p => ({
    ...p, objective_name_normalized: p.objective_name, objective_description: "", is_active: true, created_at: "", updated_at: ""
  })), [snapshot]);
  const contactFilterValues = useMemo<ContactFilters>(() => ({ ...DEFAULT_CONTACT_FILTERS,
    networkingFocus: "true", objectiveIds: filters.priorityIds,
    isHeadhunter: filters.headhunters === "only" ? "true" : filters.headhunters === "exclude" ? "false" : "all"
  }), [filters]);
  const baseContacts = useMemo(() => filterContacts(details?.contacts ?? [], "", {
    ...DEFAULT_CONTACT_FILTERS, objectiveIds: filters.priorityIds,
    isHeadhunter: filters.headhunters === "all" ? "all" : filters.headhunters === "only" ? "true" : "false"
  }), [details, filters]);
  const filteredContacts = useMemo(() => filterContacts(baseContacts, quickQuery, { ...DEFAULT_CONTACT_FILTERS }), [baseContacts, quickQuery]);
  const cycleInteractions = useMemo(() => {
    const start = snapshot?.cycle?.started_at;
    return (details?.interactions ?? []).filter(i => !start || (i.occurred_at && Date.parse(i.occurred_at) >= Date.parse(start)));
  }, [details, snapshot]);
  const contactIds = useMemo(() => new Set(filteredContacts.map(c => c.id)), [filteredContacts]);
  const participants = useMemo(() => (details?.participants ?? []).filter(p => p.contact_id && contactIds.has(p.contact_id)), [details, contactIds]);
  const interactionIds = useMemo(() => new Set(participants.map(p => p.interaction_id)), [participants]);
  const interactions = useMemo(() => cycleInteractions.filter(i => interactionIds.has(i.id)), [cycleInteractions, interactionIds]);
  const companies = useMemo(() => buildHeadhunterCompanies(filteredContacts, interactions, participants), [filteredContacts, interactions, participants]);
  const latest = useMemo(() => {
    if (!selectedDomains.size) return interactions.slice(0, 12);
    const ids = new Set(companies.filter(c => selectedDomains.has(c.domain)).flatMap(c => c.interactionIds));
    return interactions.filter(i => ids.has(i.id)).slice(0, 12);
  }, [interactions, companies, selectedDomains]);
  const contactMap = useMemo(() => new Map((details?.contacts ?? []).map(c => [c.id, c])), [details]);
  const participantMap = useMemo(() => groupParticipantsByInteraction(details?.participants ?? []), [details]);
  const sourceMap = useMemo(() => groupSourcesByInteraction(details?.sources ?? []), [details]);
  const rows = useMemo<ObjectiveMetricRow[]>(() => {
    if (model?.state !== "ready") return [];
    const supplemental = new Map(buildObjectiveMetrics({ objectives, contacts: baseContacts,
      interactions: cycleInteractions, participants: details?.participants ?? [] }).map(row => [row.objectiveId, row]));
    return model.priorities.map(p => ({
      objectiveId: p.id, objectiveName: p.objective_name, objectiveType: p.objective_type, priorityLevel: p.priority_level,
      contactCount: p.contactCount, focusContactCount: p.contactCount, coffeeCount: p.coffeeCount,
      lastInteractionAt: supplemental.get(p.id)?.lastInteractionAt ?? null,
      daysSinceLastInteraction: supplemental.get(p.id)?.daysSinceLastInteraction ?? null,
      networkingStatus: supplemental.get(p.id)?.networkingStatus ?? ""
    }));
  }, [model, objectives, baseContacts, cycleInteractions, details]);
  const opportunityCounts = useMemo(() => new Map(model?.state === "ready" ? model.priorities.map(p => [p.id, p.opportunityCount]) : []), [model]);
  const referrals = useMemo(() => (details?.referrals ?? []).filter(r => contactIds.has(r.referredByContactId) || Boolean(r.linkedContactId && contactIds.has(r.linkedContactId))), [details, contactIds]);
  const detailFeedback = <div className="tracking-feedback" aria-live="polite">
    {detailError ? <span role="alert" className="danger-text">No pudimos actualizar el detalle. {details ? "Se conserva la lectura anterior." : ""} <Button onClick={() => setRevision(v => v + 1)}>Reintentar detalle</Button></span>
      : detailLoading ? (details ? "Actualizando detalle..." : "Leyendo detalle...") : null}
  </div>;
  const cycleFeedback = <>
    {model?.state === "no_cycle" ? <p className="empty-value">No hay una búsqueda activa. Puedes iniciarla en Objetivos.</p> : null}
    {model?.state === "unknown_start" ? <p className="empty-value">Configura el inicio y la zona horaria en Objetivos para ver tus avances.</p> : null}
  </>;
  const blockClass = view === "all" ? "" : "functional-block";
  return <div className={`grid tracking-dashboard ${view === "all" ? "" : "structural-view"}`} aria-label={view === "all" ? "Seguimiento" : "Filtros y bloques de seguimiento"}>
    {!hideFilters ? <div className="dashboard-filter-bar">
      <ContactFilterControls filters={contactFilterValues} filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen}
        objectiveOptions={objectives} quickQuery={quickQuery} onQuickQueryChange={setQuickQuery}
        quickSearchLabel="Buscar en interacciones y empresas" quickSearchDisabled={!details}
        focusLocked showStatusFilter={false}
        onFiltersChange={next => setFilters(current => ({ ...current, priorityIds: next.objectiveIds,
          headhunters: next.isHeadhunter === "true" ? "only" : next.isHeadhunter === "false" ? "exclude" : "all" }))} />
      {view === "home" ? <p className="filter-scope-note">La búsqueda se aplica a interacciones, empresas headhunter y referidos. No cambia estos indicadores.</p> : null}
    </div> : null}
    <div className="tracking-feedback" aria-live="polite">
      {error ? <span role="alert" className="danger-text">No pudimos verificar todos los datos. {snapshot ? "Se conserva la última lectura, sin actualizar." : ""} <Button onClick={() => setRevision(v => v + 1)}>Reintentar</Button></span>
        : loading ? (snapshot ? "Actualizando..." : "Leyendo seguimiento...") : null}
    </div>
    {view === "home" ? <div className="structural-home-blocks">
      <Panel title="Indicadores de avance" icon={<ChartColumn aria-hidden="true" />} className={blockClass}>
        {model?.state === "ready" ? <TrackingPyramid model={model} /> : cycleFeedback}
      </Panel>
      <Panel title="Evolución de contactos Coffeecitados" icon={<ChartSpline aria-hidden="true" />} className={blockClass}>
        {model?.state === "ready" ? <TrackingBars key={snapshot!.cycle!.id} model={model} standalone
          groupHeadhunters={filters.groupHeadhunters}
          onGroupChange={value => setFilters(current => ({ ...current, groupHeadhunters: value }))} /> : cycleFeedback}
      </Panel>
    </div> : null}
    {view === "all" ? <Panel title="¿Cómo voy?" className="tracking-main-panel">
      {model?.state === "ready" ? <TrackingView key={snapshot!.cycle!.id} model={model}
        groupHeadhunters={filters.groupHeadhunters}
        onGroupChange={value => setFilters(current => ({ ...current, groupHeadhunters: value }))} /> : null}
      {model?.state === "no_cycle" ? <p className="empty-value">No hay una búsqueda activa. Puedes iniciarla en Objetivos.</p> : null}
      {model?.state === "unknown_start" ? <p className="empty-value">Configura el inicio y la zona horaria en Objetivos para ver tus avances.</p> : null}
    </Panel> : null}
    {view === "all" || view === "planning" ? <Panel title={view === "all" ? "Objetivos" : "Progreso de tus prioridades - ¿dónde debo enfocarme?"} icon={<Binoculars aria-hidden="true" />} className={blockClass} caption="Resumen según filtros actuales">
      {model?.state === "ready" ? <ObjectiveMetricsTable rows={rows} opportunityCounts={opportunityCounts} supplementalUnavailable={!details || detailError} /> : <span className="empty-value">Sin indicadores disponibles.</span>}
    </Panel> : null}
    {view !== "home" ? detailFeedback : null}
    {view === "all" || view === "interactions" ? <Panel title="Últimas interacciones" icon={<MessagesSquare aria-hidden="true" />} className={blockClass} caption={hideFilters ? "Interacciones de contactos en foco" : selectedDomains.size ? "Filtradas por empresas headhunter seleccionadas" : "Interacciones según filtros actuales"}>
      {details ? <InteractionTimelineList contactsById={contactMap} interactions={latest} participantsByInteraction={participantMap} sourcesByInteraction={sourceMap} showContactContext
        emptyMessage="Sin interacciones para los filtros actuales." /> : <span className="empty-value">{detailLoading ? "Leyendo interacciones..." : "Detalle no disponible."}</span>}
    </Panel> : null}
    {view === "all" || view === "planning" ? <Panel title={view === "all" ? "Empresas headhunter" : "Último contacto con Headhunters"} icon={<Building2 aria-hidden="true" />} className={blockClass} caption="Resumen por empresa/dominio headhunter">
      {details ? <HeadhunterCompanies rows={companies} selectedDomains={selectedDomains}
        onToggleDomain={domain => setSelectedDomains(old => { const next = new Set(old); if (next.has(domain)) next.delete(domain); else next.add(domain); return next; })}
        onClearSelection={() => setSelectedDomains(new Set())} /> : <span className="empty-value">{detailLoading ? "Leyendo empresas..." : "Detalle no disponible."}</span>}
    </Panel> : null}
    {view === "all" || view === "referrals" ? <Panel title={view === "all" ? "Contactos referidos" : "Referidos"} icon={<Handshake aria-hidden="true" />} className={blockClass} caption={hideFilters ? "Referidos de contactos en foco" : "Referidos según filtros actuales"}>
      {details ? <ReferralActions rows={referrals} /> : <span className="empty-value">{detailLoading ? "Leyendo referidos..." : "Detalle no disponible."}</span>}
    </Panel> : null}
  </div>;
}
