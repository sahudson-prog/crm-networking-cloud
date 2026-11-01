import { useState } from "react";
import { objectivePriorityLabel, objectiveTypeLabel } from "../lib/cycleObjectiveActions";
import type { ObjectiveMetricRow } from "../lib/objectiveMetrics";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";
import { StatusBadge } from "./StatusBadge";

export function ObjectiveMetricsTable({ rows, opportunityCounts, supplementalUnavailable = false }: {
  rows: ObjectiveMetricRow[]; opportunityCounts?: ReadonlyMap<string, number>; supplementalUnavailable?: boolean;
}) {
  const [showInactiveObjectives, setShowInactiveObjectives] = useState(false);
  const visibleRows = showInactiveObjectives ? rows : rows.filter((row) => row.contactCount > 0 || row.coffeeCount > 0 || (opportunityCounts?.get(row.objectiveId) ?? 0) > 0);

  if (!rows.length) {
    return <EmptyValue>sin prioridades para mostrar</EmptyValue>;
  }

  return (
    <>
      <label className="objective-metrics-toggle">
        <input
          checked={showInactiveObjectives}
          type="checkbox"
          onChange={(event) => setShowInactiveObjectives(event.target.checked)}
        />
        Mostrar prioridades sin actividad
      </label>
      {visibleRows.length ? (
        <div className="objective-metrics-wrap" tabIndex={0} role="region" aria-label="Indicadores por Prioridad">
          <table className="objective-metrics-table">
            <thead>
              <tr>
                <th>Objetivo</th>
                <th>Tipo</th>
                <th>Prioridad</th>
                {opportunityCounts ? <th>Oportunidades</th> : null}
                <th>Contactos</th>
                <th>Cafes</th>
                <th>Ultima actividad</th>
                <th>Mayor estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.objectiveId}>
                  <td>
                    <strong>{row.objectiveName}</strong>
                  </td>
                  <td>{objectiveTypeLabel(row.objectiveType)}</td>
                  <td>
                    <PriorityStars priority={row.priorityLevel} />
                  </td>
                  {opportunityCounts ? <td>{opportunityCounts.get(row.objectiveId) ?? 0}</td> : null}
                  <td>
                    {row.contactCount}
                    {row.focusContactCount !== row.contactCount ? (
                      <span className="objective-metrics-muted"> · {row.focusContactCount} foco</span>
                    ) : null}
                  </td>
                  <td>{row.coffeeCount}</td>
                  <td>{supplementalUnavailable ? <EmptyValue>No disponible</EmptyValue> : formatLastActivity(row.daysSinceLastInteraction)}</td>
                  <td>{supplementalUnavailable ? <EmptyValue>No disponible</EmptyValue> : row.networkingStatus ? <StatusBadge status={row.networkingStatus} /> : <EmptyValue>sin estado</EmptyValue>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="objective-metrics-empty">
          <EmptyValue>sin prioridades con actividad para los filtros actuales</EmptyValue>
        </div>
      )}
    </>
  );
}

function PriorityStars({ priority }: { priority: ObjectiveMetricRow["priorityLevel"] }) {
  const activeStars = priority === "HIGH" ? 3 : priority === "MEDIUM" ? 2 : 1;
  return (
    <span className="objective-metrics-priority" title={`Prioridad ${objectivePriorityLabel(priority)}`}>
      {Array.from({ length: activeStars }).map((_, index) => (
        <Icon key={index} name="star" />
      ))}
    </span>
  );
}

function formatLastActivity(days: number | null) {
  if (days === null) return <EmptyValue>sin actividad</EmptyValue>;
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  return remainingDays ? `${months}m ${remainingDays}d` : `${months}m`;
}
