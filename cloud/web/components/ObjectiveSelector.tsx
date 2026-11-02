"use client";

import { useEffect, useMemo, useState } from "react";
import {
  OBJECTIVE_TYPES,
  objectivePriorityLabel,
  objectiveTypeLabel,
  readObjectives
} from "../lib/cycleObjectiveActions";
import type { ObjectiveRow } from "../lib/readModel";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";

type ObjectiveSelectorProps = {
  disabled?: boolean;
  selectedObjectiveIds: string[];
  onChange: (objectiveIds: string[]) => void;
  choices?: Pick<ObjectiveRow, "id" | "objective_name" | "objective_type" | "priority_level">[];
  choicesLoading?: boolean;
  choicesError?: string;
};

export function ObjectiveSelector({ disabled = false, selectedObjectiveIds, onChange,
  choices, choicesLoading = false, choicesError = "" }: ObjectiveSelectorProps) {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (choices) return;
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
        setError(readError instanceof Error ? readError.message : "No pude leer Prioridades.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [choices]);

  const visibleObjectives = choices ?? objectives;
  const visibleLoading = choices ? choicesLoading : loading;
  const visibleError = choices ? choicesError : error;
  const selected = useMemo(() => new Set(selectedObjectiveIds), [selectedObjectiveIds]);
  const grouped = useMemo(() => groupObjectives(visibleObjectives), [visibleObjectives]);

  function toggleObjective(objectiveId: string) {
    const next = new Set(selectedObjectiveIds);
    if (next.has(objectiveId)) next.delete(objectiveId);
    else next.add(objectiveId);
    onChange(Array.from(next));
  }

  return (
    <div className="objective-selector">
      <div className="objective-selector-head">
        <span>Prioridades</span>
        {visibleLoading ? <small>Leyendo...</small> : null}
      </div>
      {visibleError ? <small className="danger-text">{visibleError}</small> : null}
      {!visibleLoading && !visibleObjectives.length && !visibleError ? <EmptyValue>Sin prioridades definidas</EmptyValue> : null}
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
                    disabled={disabled || Boolean(visibleError) || visibleLoading}
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
      {choices && !visibleLoading && !visibleError ? selectedObjectiveIds.filter((id) =>
        !visibleObjectives.some((objective) => objective.id === id)).map((id) =>
        <button className="objective-chip active" key={id} type="button" disabled={disabled}
          onClick={() => toggleObjective(id)} aria-label="Desvincular prioridad conservada">
          Prioridad conservada (no disponible) <Icon name="close" />
        </button>) : null}
    </div>
  );
}

export function ObjectiveChips({ objectives }: { objectives: ObjectiveRow[] }) {
  if (!objectives.length) return <EmptyValue>sin prioridades</EmptyValue>;
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

function groupObjectives(objectives: Pick<ObjectiveRow, "id" | "objective_name" | "objective_type" | "priority_level">[]) {
  const grouped = new Map<ObjectiveRow["objective_type"], typeof objectives>();
  for (const objective of objectives) {
    const current = grouped.get(objective.objective_type) ?? [];
    current.push(objective);
    grouped.set(objective.objective_type, current);
  }
  return grouped;
}
