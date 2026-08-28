"use client";

import type { ContactFilters } from "../lib/contactFilters";
import { NETWORKING_STATUSES } from "../lib/contactActions";
import { statusClass } from "../lib/format";
import { objectiveTypeLabel } from "../lib/objectiveActions";
import type { ObjectiveRow } from "../lib/readModel";
import { Icon } from "./ui/Icon";

type ContactFilterControlsProps = {
  filters: ContactFilters;
  filtersOpen: boolean;
  quickQuery: string;
  objectiveOptions?: ObjectiveRow[];
  summary?: string;
  onFiltersChange: (filters: ContactFilters) => void;
  onFiltersOpenChange: (open: boolean) => void;
  onQuickQueryChange: (value: string) => void;
};

export function ContactFilterControls({
  filters,
  filtersOpen,
  objectiveOptions = [],
  quickQuery,
  summary,
  onFiltersChange,
  onFiltersOpenChange,
  onQuickQueryChange
}: ContactFilterControlsProps) {
  function updateFilter<K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  function updateTriStateFilter(key: "networkingFocus" | "isHeadhunter", value: ContactFilters[typeof key]) {
    updateFilter(key, value);
  }

  function toggleStatus(status: string) {
    const current = new Set(filters.networkingStatuses ?? []);
    if (current.has(status)) current.delete(status);
    else current.add(status);
    onFiltersChange({ ...filters, networkingStatus: "", networkingStatuses: Array.from(current) });
  }

  const selectedStatuses = filters.networkingStatuses?.length ? filters.networkingStatuses : filters.networkingStatus ? [filters.networkingStatus] : [];
  const selectedObjectiveIds = new Set(filters.objectiveIds);
  const objectivesByType = groupObjectivesByType(objectiveOptions);

  function toggleObjective(objectiveId: string) {
    const current = new Set(filters.objectiveIds);
    if (current.has(objectiveId)) current.delete(objectiveId);
    else current.add(objectiveId);
    onFiltersChange({ ...filters, hashtag: "", objectiveIds: Array.from(current) });
  }

  return (
    <div className="contact-filter-controls">
      <div className="contacts-filter-main">
        <div className="contacts-quick-search">
          <Icon name="search" />
          <input
            aria-label="Buscador universal"
            placeholder="Buscador universal"
            value={quickQuery}
            onChange={(event) => onQuickQueryChange(event.target.value)}
          />
        </div>
        <TriStateFilterSelect
          label="Foco"
          value={filters.networkingFocus}
          onChange={(value) => updateTriStateFilter("networkingFocus", value)}
        />
        <TriStateFilterSelect
          label="Headhunter"
          value={filters.isHeadhunter}
          onChange={(value) => updateTriStateFilter("isHeadhunter", value)}
        />
        <button className="contacts-filter-toggle" onClick={() => onFiltersOpenChange(!filtersOpen)} type="button">
          <Icon name={filtersOpen ? "collapse" : "expand"} />
          <span>Mas filtros</span>
        </button>
        {summary ? <span className="contacts-filter-summary">{summary}</span> : null}
      </div>
      {filtersOpen ? (
        <div className="contacts-filter-expanded">
          <div className="contacts-expanded-filter-row">
            <span>Estado</span>
            <div className="contacts-status-filter-row" aria-label="Filtrar por estado networking">
              {NETWORKING_STATUSES.map((status) => (
                <StatusFilterButton
                  active={selectedStatuses.includes(status)}
                  key={status}
                  label={status}
                  status={status}
                  onClick={() => toggleStatus(status)}
                />
              ))}
            </div>
          </div>
          <div className="contacts-hashtag-filter" aria-label="Filtro por objetivos">
            <span>Objetivos</span>
            <div className="contacts-hashtag-scroll">
              {objectiveOptions.length ? (
                Array.from(objectivesByType.entries()).map(([type, objectives]) => (
                  <div className="contacts-objective-filter-group" key={type}>
                    <strong>{objectiveTypeLabel(type)}</strong>
                    <div>
                      {objectives.map((objective) => (
                        <button
                          className={selectedObjectiveIds.has(objective.id) ? "active" : ""}
                          key={objective.id}
                          onClick={() => toggleObjective(objective.id)}
                          type="button"
                        >
                          {objective.objective_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <button disabled type="button">sin objetivos</button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupObjectivesByType(objectives: ObjectiveRow[]) {
  const grouped = new Map<ObjectiveRow["objective_type"], ObjectiveRow[]>();
  for (const objective of objectives) {
    const current = grouped.get(objective.objective_type) ?? [];
    current.push(objective);
    grouped.set(objective.objective_type, current);
  }
  return grouped;
}

function TriStateFilterSelect({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: "all" | "true" | "false") => void;
  value: "all" | "true" | "false";
}) {
  return (
    <label className="contacts-filter-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as "all" | "true" | "false")}>
        <option value="true">Si</option>
        <option value="false">No</option>
        <option value="all">Todos</option>
      </select>
    </label>
  );
}

function StatusFilterButton({
  active,
  label,
  onClick,
  status
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  status: string;
}) {
  const className = `contacts-status-filter ${statusClass(status)} ${active ? "active" : ""}`;
  return (
    <button className={className} onClick={onClick} type="button">
      {label}
    </button>
  );
}
