import {
  explainInteractionSyncSkipped,
  summarizeGoogleInteractionSync,
  type InteractionSyncServiceSummary
} from "../lib/interactionSyncText";
import type { SyncGoogleInteractionsResult } from "../lib/googleInteractionSyncFlow";

export function InteractionSyncResultSummary({ result }: { result: SyncGoogleInteractionsResult | null }) {
  if (!result) return null;
  const summary = summarizeGoogleInteractionSync(result);
  return (
    <div className="activity-sync-summary" aria-label="Resumen de sincronizacion de actividad">
      <div className="activity-sync-summary-head">
        <strong>{summary.applied ? "Ultima reconstruccion aplicada" : "Ultima revision sin guardar"}</strong>
        <span>{summary.totals.candidates} posibles interacciones</span>
      </div>
      <div className="activity-sync-service-grid">
        <ActivitySyncServiceCard service={summary.mail} applied={summary.applied} />
        <ActivitySyncServiceCard service={summary.calendar} applied={summary.applied} />
      </div>
      <p className="meta">{explainInteractionSyncSkipped(summary.applied)}</p>
    </div>
  );
}

function ActivitySyncServiceCard({
  applied,
  service
}: {
  applied: boolean;
  service: InteractionSyncServiceSummary;
}) {
  return (
    <div className="activity-sync-service-card">
      <div>
        <strong>{service.label}</strong>
        <span className="meta">{service.read} encontrados en Google - {service.pages} paginas</span>
      </div>
      <div className="activity-sync-stats">
        <span><strong>{service.candidates}</strong> posibles</span>
        {applied ? <span><strong>{service.created}</strong> nuevos</span> : null}
        {applied ? <span><strong>{service.updated}</strong> modificados</span> : null}
        {applied ? <span><strong>{service.skipped}</strong> omitidos</span> : null}
        {service.failed ? <span className="danger-text"><strong>{service.failed}</strong> errores</span> : null}
      </div>
    </div>
  );
}
