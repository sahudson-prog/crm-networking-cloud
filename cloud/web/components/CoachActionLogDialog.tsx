"use client";

import { useEffect, useMemo, useState } from "react";
import { readCoachActionLog, type CoachActionLogRow, type CoachHistoryActor, type CoachHistoryStatus } from "../lib/coachLog";
import {
  buildCoachDetail,
  buildCoachSummary,
  compactSummaryName,
  formatCoachDate,
  parseCoachEvidence,
  shortContactName
} from "../lib/coachText";
import { statusClass } from "../lib/format";
import { Button } from "./ui/Button";

type CoachActionLogDialogProps = {
  open: boolean;
  contactId?: string;
  onClose: () => void;
};

type StatusFilter = "all" | CoachHistoryStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "done", label: "done" },
  { value: "dismissed", label: "dismissed" },
  { value: "expired", label: "expired" },
  { value: "auto_resolved", label: "auto resolved" }
];

export function CoachActionLogDialog({ open, contactId, onClose }: CoachActionLogDialogProps) {
  const [rows, setRows] = useState<CoachActionLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const filteredRows = useMemo(
    () => (filter === "all" ? rows : rows.filter((row) => row.status === filter)),
    [filter, rows]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    readCoachActionLog({ contactId })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No pude leer el historial.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <section className="modal-card coach-log-dialog" role="dialog" aria-modal="true" aria-labelledby="coach-log-title">
        <header className="modal-head">
          <div>
            <h2 id="coach-log-title">Historial de sugerencias</h2>
            <p>Sugerencias que ya no estan vigentes.</p>
          </div>
          <Button icon="close" onClick={onClose} square aria-label="Cerrar historial" />
        </header>

        <div className="coach-log-filters" aria-label="Filtrar historial por estado">
          {STATUS_FILTERS.map((item) => (
            <button
              className={`coach-log-filter ${filter === item.value ? "active" : ""}`}
              key={item.value}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="coach-log-body">
          {loading ? <span className="empty">Leyendo historial...</span> : null}
          {error ? <span className="danger-text">{error}</span> : null}
          {!loading && !error && !filteredRows.length ? <span className="empty">No hay sugerencias cerradas para este filtro.</span> : null}
          {!loading && !error
            ? filteredRows.map((row) => <CoachActionLogItem key={row.id} row={row} />)
            : null}
        </div>

        <footer className="modal-actions">
          <Button onClick={onClose}>Cerrar</Button>
        </footer>
      </section>
    </div>
  );
}

function CoachActionLogItem({ row }: { row: CoachActionLogRow }) {
  const message = buildLogMessage(row);
  const detail = buildCoachDetail(
    { todo_type: row.todoType, reason: row.reason },
    parseCoachEvidence(JSON.stringify({ regla: row.ruleName })),
    row.interaction
  );

  return (
    <details className="coach-log-item">
      <summary>
        <span className="coach-log-title">{message}</span>
        <span className="coach-log-stamp">
          <span className={`coach-log-pill ${row.status}`}>
            {statusLabel(row.status)} <span>by {actorLabel(row.actorType)}</span>
          </span>
          <span className="coach-log-date">{formatDateTime(row.eventAt)}</span>
        </span>
      </summary>
      <div className="coach-log-detail">
        <p>
          <strong>Motivo de cierre:</strong> {row.reason || "sin motivo registrado"}
        </p>
        <p>
          <strong>Detalle de la regla:</strong> {readableRule(row.ruleName || row.todoType)}
        </p>
        <p>
          <strong>Evidencia:</strong> {row.evidenceDetail || detail || "sin evidencia registrada"}
        </p>
        <div className="coach-log-actions">
          {row.contactId ? (
            <a className="coach-contact-link" href={`/contactos?contactId=${encodeURIComponent(row.contactId)}`}>
              Ir a {shortContactName(row.contactName)}
            </a>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function buildLogMessage(row: CoachActionLogRow) {
  const summary = buildCoachSummary(
    { todo_type: row.todoType, summary: row.summary },
    row.currentStatus,
    row.suggestedStatus
  );
  const hasStatusChange = Boolean(row.currentStatus || row.suggestedStatus);
  if (!hasStatusChange) return <span className="coach-log-message-text">{summary.prefix}</span>;

  return (
    <span className="coach-log-message-text">
      {summary.prefix} <strong>{compactSummaryName(row.summary || row.contactName)}</strong> de{" "}
      <StatusText value={row.currentStatus || "sin estado"} /> a <StatusText value={row.suggestedStatus || "sin estado"} />.
    </span>
  );
}

function StatusText({ value }: { value: string }) {
  return <span className={`coach-state ${statusClass(value)}`}>{value}</span>;
}

function statusLabel(status: CoachHistoryStatus) {
  if (status === "auto_resolved") return "auto resolved";
  return status;
}

function actorLabel(actorType: CoachHistoryActor) {
  if (actorType === "user") return "usuario";
  if (actorType === "rule") return "Coach";
  if (actorType === "ai") return "IA";
  return "sistema";
}

function readableRule(value: string) {
  if (!value) return "sin regla registrada";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return formatCoachDate(value);
}
