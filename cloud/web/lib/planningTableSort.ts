import { NETWORKING_STATUSES } from "./contactActions";
import { OBJECTIVE_PRIORITIES } from "./cycleObjectiveActions";
import type { ObjectiveMetricRow } from "./objectiveMetrics";
import type { HeadhunterCompanyRow } from "./readModel";

export type SortSelection<Key extends string> = { key: Key; direction: "asc" | "desc" };
export type PrioritySortKey = "objectiveName" | "objectiveType" | "priorityLevel" | "opportunities" | "contactCount" | "coffeeCount" | "lastInteractionAt" | "networkingStatus";
export type HeadhunterSortKey = "domain" | "contactCount" | "status" | "lastInteractionAt" | "daysSince" | "type" | "subject";
const stableId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const text = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });
const number = (value: number | null): number | null => value !== null && Number.isFinite(value) ? value : null;
export function planningDate(value: string | null): number | null {
  return value ? number(Date.parse(value)) : null;
}
function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return typeof a === "number" && typeof b === "number" ? a - b : text(String(a), String(b));
}
function priority(value: ObjectiveMetricRow["priorityLevel"]) {
  const index = OBJECTIVE_PRIORITIES.findIndex(p => p.value === value);
  return index < 0 ? 0 : OBJECTIVE_PRIORITIES.length - index;
}
const status = (value: string) => NETWORKING_STATUSES.indexOf(value as typeof NETWORKING_STATUSES[number]);

export function sortPriorityRows(rows: readonly ObjectiveMetricRow[], opportunityCounts: ReadonlyMap<string, number> | undefined,
  selection: SortSelection<PrioritySortKey> | null, supplementalUnavailable = false): ObjectiveMetricRow[] {
  const opportunities = (row: ObjectiveMetricRow) => opportunityCounts?.get(row.objectiveId) ?? 0;
  const value = (row: ObjectiveMetricRow, key: PrioritySortKey): string | number | null => {
    if (key === "priorityLevel") return priority(row.priorityLevel);
    if (key === "opportunities") return opportunities(row);
    if (key === "lastInteractionAt") return supplementalUnavailable ? null : planningDate(row.lastInteractionAt);
    if (key === "networkingStatus") return supplementalUnavailable ? null : status(row.networkingStatus);
    return row[key];
  };
  return [...rows].sort((a, b) => {
    const order = selection
      ? compare(value(a, selection.key), value(b, selection.key)) * (selection.direction === "asc" ? 1 : -1)
      : priority(b.priorityLevel) - priority(a.priorityLevel)
        || opportunities(a) - opportunities(b) || a.coffeeCount - b.coffeeCount || a.contactCount - b.contactCount;
    return order || stableId(a.objectiveId, b.objectiveId);
  });
}

export function sortHeadhunterRows(rows: readonly HeadhunterCompanyRow[], selection: SortSelection<HeadhunterSortKey> | null): HeadhunterCompanyRow[] {
  const company = (row: HeadhunterCompanyRow) => row.domain === "NO EMAIL" ? "" : row.domain;
  const value = (row: HeadhunterCompanyRow, key: HeadhunterSortKey): string | number | null => {
    if (key === "lastInteractionAt") return planningDate(row.lastInteractionAt);
    if (key === "daysSince") return number(row.daysSince);
    if (key === "status") return status(row.status);
    if (key === "domain") return company(row);
    return row[key] || (typeof row[key] === "number" ? 0 : "");
  };
  return [...rows].sort((a, b) => {
    const left = selection ? value(a, selection.key) : null;
    const right = selection ? value(b, selection.key) : null;
    // Missing dates/ages stay first in either direction; other columns keep their own primary order.
    const direction = selection?.direction === "desc" && left !== null && right !== null ? -1 : 1;
    const order = selection
      ? compare(left, right) * direction
      : compare(planningDate(a.lastInteractionAt), planningDate(b.lastInteractionAt))
        || status(a.status) - status(b.status) || text(company(a), company(b));
    return order || stableId(a.domain, b.domain);
  });
}
