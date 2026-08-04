import type { HeadhunterCompanyRow } from "../lib/readModel";
import { interactionLabel, shortDate } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";

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
              <th>Empresa headhunter</th>
              <th>Contactos</th>
              <th>Estado</th>
              <th>Ultimo contacto</th>
              <th>Dias</th>
              <th>Tipo</th>
              <th>Asunto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
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
                  <td>{shortDate(row.lastInteractionAt)}</td>
                  <td>{row.daysSince ?? "sin registro"}</td>
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
