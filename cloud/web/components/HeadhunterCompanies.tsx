import { useState } from "react";
import type { HeadhunterCompanyRow } from "../lib/readModel";
import { interactionLabel, shortDate } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";

import { TableSortHeader } from "./ui/TableSortHeader";
import { planningDate, sortHeadhunterRows, type HeadhunterSortKey, type SortSelection } from "../lib/planningTableSort";

type HeadhunterCompaniesProps = {
  rows: HeadhunterCompanyRow[];
  selectedDomains?: Set<string>;
  onToggleDomain?: (domain: string) => void;
  onClearSelection?: () => void;
};

export function HeadhunterCompanies({
  rows,
  selectedDomains = new Set(),
  onToggleDomain,
  onClearSelection
}: HeadhunterCompaniesProps) {
  const [sort, setSort] = useState<SortSelection<HeadhunterSortKey> | null>(null);
  const currentSort: SortSelection<HeadhunterSortKey> = sort ?? { key: "lastInteractionAt", direction: "asc" };
  const sortedRows = sortHeadhunterRows(rows, sort);
  function toggleSort(key: HeadhunterSortKey) {
    setSort({ key, direction: currentSort.key === key && currentSort.direction === "asc" ? "desc" : "asc" });
  }
  const header = (key: HeadhunterSortKey, label: string) => <TableSortHeader sortKey={key} label={label} current={currentSort} onSort={toggleSort} />;
  if (!rows.length) return <span className="empty">Sin empresas headhunter para mostrar.</span>;
  const selectedCount = selectedDomains.size;

  return (
    <div className="hh-company-module">
      <div className="module-toolbar">
        <span className="meta">
          {selectedCount
            ? `${selectedCount} empresa${selectedCount === 1 ? "" : "s"} seleccionada${selectedCount === 1 ? "" : "s"}`
            : "Selecciona empresas para filtrar interacciones"}
        </span>
        <Button icon="close" square aria-label="Limpiar empresas seleccionadas" disabled={!selectedCount} onClick={onClearSelection} />
      </div>
      <div className="table-wrap compact-table">
        <table className="table hh-company-table">
          <thead>
            <tr>
              <th className="select-col">Filtrar</th>
              {header("domain", "Empresa headhunter")}
              {header("contactCount", "Contactos")}
              {header("status", "Estado")}
              {header("lastInteractionAt", "Ultimo contacto")}
              {header("daysSince", "Dias")}
              {header("type", "Tipo")}
              {header("subject", "Asunto")}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const selected = selectedDomains.has(row.domain);
              return (
                <tr className={selected ? "selected-row" : ""} key={row.domain}>
                  <td className="select-col">
                    <input
                      aria-label={`Filtrar ${displayDomain(row.domain)}`}
                      checked={selected}
                      onChange={() => onToggleDomain?.(row.domain)}
                      type="checkbox"
                    />
                  </td>
                  <td className={row.domain === "NO EMAIL" ? "danger-text" : ""}>{displayDomain(row.domain)}</td>
                  <td>{row.contactCount}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td>{planningDate(row.lastInteractionAt) === null ? "Sin registro" : shortDate(row.lastInteractionAt)}</td>
                  <td>{row.daysSince ?? "Sin registro"}</td>
                  <td>{interactionLabel(row.type)}</td>
                  <td>{row.subject || "sin asunto"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function displayDomain(value: string) {
  return value === "NO EMAIL" ? "sin email" : value;
}
