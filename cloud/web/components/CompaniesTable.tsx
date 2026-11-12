"use client";

import { useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import type { ContactListRow } from "../lib/readModel";
import { cleanContactCompany } from "../lib/format";
import { NETWORKING_STATUSES } from "../lib/contactActions";
import { StatusBadge } from "./StatusBadge";
import { formatLastInteractionAge } from "./ContactInteractionAge";
import { Panel } from "./ui/Panel";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/** A view over the already filtered contacts, not a company master or a new read. */
export function CompaniesTable({ contacts, selected, onSelectionChange }: {
  contacts: ContactListRow[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
}) {
  const [sort, setSort] = useState<{ key: "company" | "count" | "status" | "lastInteraction"; direction: "asc" | "desc" }>({ key: "company", direction: "asc" });
  const rows = useMemo(() => {
    const groups = new Map<string, { count: number; statusRank: number; latest: ContactListRow | null }>();
    for (const contact of contacts) {
      const company = cleanContactCompany(contact.company);
      const group = groups.get(company) ?? { count: 0, statusRank: -1, latest: null };
      const rank = NETWORKING_STATUSES.indexOf(contact.networking_status as typeof NETWORKING_STATUSES[number]);
      // Reuse the list reader's result (including its eligibility rules and age), not raw interactions.
      const time = contact.last_interaction_at && contact.days_since_last_interaction !== null ? Date.parse(contact.last_interaction_at) : NaN;
      const latest = Number.isFinite(time) && (!group.latest || time > Date.parse(group.latest.last_interaction_at!)) ? contact : group.latest;
      groups.set(company, { count: group.count + 1, statusRank: Math.max(group.statusRank, rank), latest });
    }
    return [...groups].map(([company, group]) => ({ company, ...group })).sort((a, b) => {
      const nameOrder = (a.company || "Sin empresa").localeCompare(b.company || "Sin empresa", "es");
      const comparison = sort.key === "count" ? a.count - b.count || nameOrder
        : sort.key === "status" ? a.statusRank - b.statusRank || nameOrder
        : sort.key === "lastInteraction" ? (a.latest?.days_since_last_interaction ?? Infinity) - (b.latest?.days_since_last_interaction ?? Infinity) || nameOrder : nameOrder;
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [contacts, sort]);

  function toggle(company: string) {
    const next = new Set(selected);
    if (next.has(company)) next.delete(company); else next.add(company);
    onSelectionChange(next);
  }
  function header(key: "company" | "count" | "status" | "lastInteraction", label: string) {
    const active = sort.key === key;
    return <th aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
      <button className={`contacts-sort-header ${active ? "active" : ""}`} title={`Ordenar por ${label}`} type="button" onClick={() => setSort(current => ({
        key, direction: current.key === key ? current.direction === "asc" ? "desc" : "asc" : key === "lastInteraction" ? "desc" : "asc"
      }))}><span>{label}</span>{active ? <Icon name={sort.direction === "desc" ? "sortDesc" : "sortAsc"} /> : null}</button>
    </th>;
  }
  return <Panel title="Empresas" icon={<Building2 aria-hidden="true" />} className="functional-block companies-block"
    caption="Contactos agrupados por el nombre de empresa registrado, según los filtros de Contactos.">
    <div className="companies-toolbar">
      <span className="meta" aria-live="polite">{selected.size ? `${selected.size} grupos seleccionados para filtrar la tabla superior.` : "Selecciona empresas para filtrar la tabla superior."} La selección masiva de contactos se conserva.</span>
      <Button onClick={() => onSelectionChange(new Set())} disabled={!selected.size}>Limpiar selección de empresas</Button>
    </div>
    <div className="table-wrap contacts-table-wrap companies-table-wrap">
      <table className="table companies-table" aria-label="Empresas de los contactos">
        <colgroup>
          <col className="companies-select-col"/><col className="companies-name-col"/>
          <col className="companies-count-col"/><col className="companies-status-col"/><col className="companies-interaction-col"/>
        </colgroup>
        <thead><tr><th aria-label="Filtrar contactos por empresa" />{header("company", "Empresa")}{header("count", "Contactos")}{header("status", "Estado más avanzado")}{header("lastInteraction", "Última interacción")}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.company} className={selected.has(row.company) ? "selected-row" : ""}>
          <td><input type="checkbox" aria-label={`Filtrar contactos de ${row.company || "Sin empresa"}`}
            checked={selected.has(row.company)} onChange={() => toggle(row.company)} /></td>
          <td><span className="companies-name-value" title={row.company || "Sin empresa"}>{row.company || <span className="empty-value">Sin empresa</span>}</span></td><td>{row.count}</td>
          <td><StatusBadge status={NETWORKING_STATUSES[row.statusRank] ?? ""} /></td>
          <td>{formatLastInteractionAge(row.latest?.days_since_last_interaction ?? null, row.latest?.last_interaction_at ?? null)}</td>
        </tr>)}
        {!rows.length ? <tr><td colSpan={5} className="empty-value">No hay contactos para los filtros actuales.</td></tr> : null}</tbody>
      </table>
    </div>
  </Panel>;
}
