"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OBJECTIVE_TYPES,
  objectivePriorityLabel,
  objectiveTypeLabel,
  readObjectives
} from "../lib/objectiveActions";
import type { ObjectiveRow } from "../lib/readModel";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";

type ObjectiveSelectorProps = {
  disabled?: boolean;
  selectedObjectiveIds: string[];
  onChange: (objectiveIds: string[]) => void;
};

export function ObjectiveSelector({ disabled = false, selectedObjectiveIds, onChange }: ObjectiveSelectorProps) {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    readObjectives({ activeOnly: true })
      .then((rows) => {
        if (active) setObjectives(rows);
      })
      .catch((readError) => {
        if (!active) return;
        setObjectives([]);
        setError(readError instanceof Error ? readError.message : "No pude leer objetivos.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => new Set(selectedObjectiveIds), [selectedObjectiveIds]);
  const grouped = useMemo(() => groupObjectives(objectives), [objectives]);

  function toggleObjective(objectiveId: string) {
    const next = new Set(selectedObjectiveIds);
    if (next.has(objectiveId)) next.delete(objectiveId);
    else next.add(objectiveId);
    onChange(Array.from(next));
  }

  return (
    <div className="objective-selector">
      <div className="objective-selector-head">
        <span>Objetivos</span>
        {loading ? <small>Leyendo...</small> : null}
      </div>
      {error ? <small className="danger-text">{error}</small> : null}
      {!loading && !objectives.length && !error ? <EmptyValue>Sin objetivos definidos</EmptyValue> : null}
      {OBJECTIVE_TYPES.map((type) => {
        const rows = grouped.get(type.value) ?? [];
        if (!rows.length) return null;
        return (
          <div className="objective-selector-group" key={type.value}>
            <span>{objectiveTypeLabel(type.value)}</span>
            <div className="objective-chip-row">
              {rows.map((objective) => {
                const active = selected.has(objective.id);
                return (
                  <button
                    className={`objective-chip ${active ? "active" : ""}`}
                    disabled={disabled}
                    key={objective.id}
                    onClick={() => toggleObjective(objective.id)}
                    title={`${objective.objective_name} · Prioridad ${objectivePriorityLabel(objective.priority_level)}`}
                    type="button"
                  >
                    {active ? <Icon name="check" /> : null}
                    <span>{objective.objective_name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ObjectiveChips({ objectives }: { objectives: ObjectiveRow[] }) {
  if (!objectives.length) return <EmptyValue>sin objetivos</EmptyValue>;
  return (
    <div className="objective-chip-row readonly">
      {objectives.map((objective) => (
        <span className="objective-chip readonly" key={objective.id} title={objectiveTypeLabel(objective.objective_type)}>
          {objective.objective_name}
        </span>
      ))}
    </div>
  );
}

function groupObjectives(objectives: ObjectiveRow[]) {
  const grouped = new Map<ObjectiveRow["objective_type"], ObjectiveRow[]>();
  for (const objective of objectives) {
    const current = grouped.get(objective.objective_type) ?? [];
    current.push(objective);
    grouped.set(objective.objective_type, current);
  }
  return grouped;
}
