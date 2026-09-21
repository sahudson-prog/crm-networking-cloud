"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type DiagnosticTableConfig = {
  columns: string[];
  defaultOrder?: string;
  label: string;
  searchColumns: string[];
  table: string;
};

type DiagnosticCell = string | number | boolean | null | string[] | Record<string, unknown> | Array<Record<string, unknown>>;
type DiagnosticRow = Record<string, DiagnosticCell>;
type DiagnosticScope = "Global" | "Sistema" | "Todos" | "Usuario";
type SortDirection = "asc" | "desc";

type DataDiagnosticsState = {
  error: string;
  loading: boolean;
  rows: DiagnosticRow[];
};

type DiagnosticSummaryRow = {
  error: string;
  label: string;
  rowCount: number | null;
  scope: DiagnosticScope;
  table: string;
};

type DiagnosticSummaryState = {
  error: string;
  loading: boolean;
  rows: DiagnosticSummaryRow[];
};

const DIAGNOSTIC_SCOPES: DiagnosticScope[] = ["Usuario", "Sistema", "Global", "Todos"];
const MAX_DIAGNOSTIC_ROWS = 500;

const DIAGNOSTIC_TABLES: DiagnosticTableConfig[] = [
  {
    columns: ["id", "email", "full_name", "created_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Perfiles",
    searchColumns: ["email", "full_name"],
    table: "profiles"
  },
  {
    columns: ["user_id", "plan_code", "account_status", "beta_access_status", "created_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Acceso usuario",
    searchColumns: ["plan_code", "account_status", "beta_access_status"],
    table: "user_access_profiles"
  },
  {
    columns: ["user_id", "role_code", "assignment_reason", "is_active", "starts_at", "expires_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Roles usuario",
    searchColumns: ["role_code", "assignment_reason"],
    table: "user_role_assignments"
  },
  {
    columns: ["user_id", "capability_code", "override_mode", "override_reason", "is_active", "starts_at", "expires_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Excepciones capacidad",
    searchColumns: ["capability_code", "override_mode", "override_reason"],
    table: "user_capability_overrides"
  },
  {
    columns: ["capability_code", "display_name", "capability_area", "description", "is_active", "updated_at"],
    defaultOrder: "capability_area",
    label: "Global · Capacidades",
    searchColumns: ["capability_code", "display_name", "capability_area", "description"],
    table: "app_capabilities"
  },
  {
    columns: ["role_code", "display_name", "description", "is_system_role", "is_active", "updated_at"],
    defaultOrder: "display_name",
    label: "Global · Roles",
    searchColumns: ["role_code", "display_name", "description"],
    table: "app_roles"
  },
  {
    columns: ["role_code", "capability_code", "granted_at"],
    defaultOrder: "role_code",
    label: "Global · Capacidades por rol",
    searchColumns: ["role_code", "capability_code"],
    table: "app_role_capabilities"
  },
  {
    columns: ["plan_code", "display_name", "tier_rank", "description", "is_public", "is_active", "updated_at"],
    defaultOrder: "tier_rank",
    label: "Global · Planes",
    searchColumns: ["plan_code", "display_name", "description"],
    table: "subscription_plans"
  },
  {
    columns: ["plan_code", "capability_code", "capability_limit_json", "granted_at"],
    defaultOrder: "plan_code",
    label: "Global · Capacidades por plan",
    searchColumns: ["plan_code", "capability_code"],
    table: "subscription_plan_capabilities"
  },
  {
    columns: ["id", "display_name", "normalized_name", "organization_type", "billing_contact_email", "status", "updated_at"],
    defaultOrder: "display_name",
    label: "Sistema · Organizaciones",
    searchColumns: ["display_name", "normalized_name", "organization_type", "billing_contact_email", "status"],
    table: "organizations"
  },
  {
    columns: ["organization_id", "user_id", "membership_role", "membership_status", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Membresias organizacion",
    searchColumns: ["membership_role", "membership_status"],
    table: "organization_memberships"
  },
  {
    columns: ["user_id", "organization_id", "sponsored_plan_code", "sponsorship_status", "starts_at", "ends_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Sistema · Patrocinios plan",
    searchColumns: ["sponsored_plan_code", "sponsorship_status"],
    table: "user_plan_sponsorships"
  },
  {
    columns: ["setting_key", "setting_value", "value_json", "created_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Configuracion",
    searchColumns: ["setting_key", "setting_value"],
    table: "user_settings"
  },
  {
    columns: ["provider", "service_type", "auth_type", "enabled", "capabilities", "created_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Global · Conectores servicio",
    searchColumns: ["provider", "service_type", "auth_type"],
    table: "service_connectors"
  },
  {
    columns: ["id", "provider", "account_email", "scopes", "capabilities", "status", "connected_at", "revoked_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Cuentas conectadas",
    searchColumns: ["provider", "account_email", "status"],
    table: "connected_accounts"
  },
  {
    columns: ["id", "display_name", "company", "role", "networking_status", "networking_focus", "is_active", "updated_at"],
    defaultOrder: "display_name",
    label: "Usuario · Contactos app",
    searchColumns: ["display_name", "company", "role", "networking_status"],
    table: "contacts"
  },
  {
    columns: ["contact_id", "provider", "external_id", "is_active", "last_seen_at", "metadata", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · IDs externos contacto",
    searchColumns: ["provider", "external_id"],
    table: "external_contact_ids"
  },
  {
    columns: ["provider", "external_id", "display_name", "company", "role", "emails", "phones", "is_deleted", "last_seen_at"],
    defaultOrder: "display_name",
    label: "Usuario · Espejo contactos",
    searchColumns: ["external_id", "display_name", "company", "role"],
    table: "external_contact_snapshots"
  },
  {
    columns: ["contact_id", "email", "normalized_email", "domain", "is_primary", "source", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Correos contacto",
    searchColumns: ["email", "normalized_email", "domain", "source"],
    table: "contact_emails"
  },
  {
    columns: ["contact_id", "phone", "normalized_phone", "normalized_phone_last8", "is_primary", "source", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Telefonos contacto",
    searchColumns: ["phone", "normalized_phone", "normalized_phone_last8", "source"],
    table: "contact_phones"
  },
  {
    columns: ["id", "objective_name", "objective_type", "priority_level", "objective_description", "is_active", "created_at", "updated_at"],
    defaultOrder: "objective_name",
    label: "Usuario · Objetivos",
    searchColumns: ["objective_name", "objective_type", "priority_level", "objective_description"],
    table: "objectives"
  },
  {
    columns: ["contact_id", "objective_id", "assigned_by_actor", "assigned_at", "created_at", "updated_at"],
    defaultOrder: "assigned_at",
    label: "Usuario · Contactos por objetivo",
    searchColumns: ["assigned_by_actor"],
    table: "contact_objective_assignments"
  },
  {
    columns: ["id", "display_name", "normalized_name", "notes", "is_active", "created_at", "updated_at"],
    defaultOrder: "display_name",
    label: "Global · Maestro headhunters",
    searchColumns: ["display_name", "normalized_name", "notes"],
    table: "headhunter_companies"
  },
  {
    columns: ["company_id", "domain", "normalized_domain", "is_primary", "is_active", "created_at", "updated_at"],
    defaultOrder: "normalized_domain",
    label: "Global · Dominios headhunters",
    searchColumns: ["domain", "normalized_domain"],
    table: "headhunter_company_domains"
  },
  {
    columns: ["id", "interaction_type", "direction", "occurred_at", "subject", "source_detail", "is_deleted", "prevent_reimport", "updated_at"],
    defaultOrder: "occurred_at",
    label: "Usuario · Interacciones",
    searchColumns: ["interaction_type", "direction", "subject", "source_detail"],
    table: "interactions"
  },
  {
    columns: ["interaction_id", "contact_id", "email_identity", "role", "created_at"],
    defaultOrder: "created_at",
    label: "Usuario · Participantes interaccion",
    searchColumns: ["email_identity", "role"],
    table: "interaction_participants"
  },
  {
    columns: ["provider", "source_service", "external_id", "source_subject", "sync_status", "prevent_reimport", "last_seen_at"],
    defaultOrder: "last_seen_at",
    label: "Usuario · Origenes actividad",
    searchColumns: ["external_id", "source_subject", "source_service", "sync_status"],
    table: "external_interaction_sources"
  },
  {
    columns: ["provider", "source_service", "external_id", "subject", "candidate_status", "exclusion_reason", "occurred_at", "updated_at"],
    defaultOrder: "occurred_at",
    label: "Usuario · Lecturas actividad",
    searchColumns: ["external_id", "subject", "candidate_status", "exclusion_reason", "source_service"],
    table: "external_interaction_read_diagnostics"
  },
  {
    columns: ["referred_by_contact_id", "linked_contact_id", "referred_name", "referred_company", "referred_role", "referred_email", "status", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Referidos",
    searchColumns: ["referred_name", "referred_company", "referred_role", "referred_email", "status"],
    table: "referrals"
  },
  {
    columns: ["todo_type", "engine_type", "action_scope", "user_mode", "enabled", "display_name", "description", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Config Coach",
    searchColumns: ["todo_type", "engine_type", "action_scope", "user_mode", "display_name", "description"],
    table: "todo_configs"
  },
  {
    columns: ["provider", "resource_type", "operation", "scope_label", "step", "status", "detail", "created_at"],
    defaultOrder: "created_at",
    label: "Usuario · Logs sync",
    searchColumns: ["provider", "resource_type", "operation", "scope_label", "step", "status", "detail"],
    table: "sync_run_logs"
  },
  {
    columns: ["provider", "resource_type", "cursor_label", "status", "last_synced_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Cursores sync",
    searchColumns: ["provider", "resource_type", "cursor_label", "status"],
    table: "sync_cursors"
  },
  {
    columns: ["action_name", "actor_type", "status", "object_type", "error_message", "created_at", "executed_at"],
    defaultOrder: "created_at",
    label: "Usuario · Acciones internas",
    searchColumns: ["action_name", "actor_type", "status", "object_type", "error_message"],
    table: "action_invocations"
  },
  {
    columns: ["processor_id", "processor_type", "object_type", "object_id", "object_updated_at", "last_reviewed_at", "last_fingerprint", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Revision objetos",
    searchColumns: ["processor_id", "processor_type", "object_type", "last_fingerprint"],
    table: "object_review_state"
  },
  {
    columns: ["source_type", "source_filename", "status", "imported_at", "created_at", "updated_at"],
    defaultOrder: "created_at",
    label: "Usuario · Importaciones",
    searchColumns: ["source_type", "source_filename", "status"],
    table: "import_batches"
  },
  {
    columns: ["export_type", "file_hash", "created_at", "updated_at"],
    defaultOrder: "created_at",
    label: "Usuario · Exportaciones",
    searchColumns: ["export_type", "file_hash"],
    table: "data_exports"
  },
  {
    columns: ["actor", "action", "object_type", "object_id", "created_at"],
    defaultOrder: "created_at",
    label: "Usuario · Auditoria",
    searchColumns: ["actor", "action", "object_type"],
    table: "audit_log"
  },
  {
    columns: ["limit_type", "period", "max_units", "used_units", "hard_stop", "created_at", "updated_at"],
    defaultOrder: "updated_at",
    label: "Usuario · Limites uso",
    searchColumns: ["limit_type", "period"],
    table: "usage_limits"
  },
  {
    columns: ["limit_type", "units", "event_source", "created_at"],
    defaultOrder: "created_at",
    label: "Usuario · Uso",
    searchColumns: ["limit_type", "event_source"],
    table: "usage_events"
  },
  {
    columns: ["todo_type", "status", "summary", "reason", "object_type", "object_id", "created_at", "resolved_at"],
    defaultOrder: "created_at",
    label: "Usuario · Sugerencias Coach",
    searchColumns: ["todo_type", "status", "summary", "reason"],
    table: "todos"
  },
  {
    columns: ["metric_key", "period_type", "period_start", "value_numeric", "details_json", "created_at"],
    defaultOrder: "period_start",
    label: "Usuario · Metricas guardadas",
    searchColumns: ["metric_key", "period_type"],
    table: "metric_snapshots"
  }
];

export function DataDiagnosticsPanel() {
  const [selectedScope, setSelectedScope] = useState<DiagnosticScope>("Usuario");
  const [query, setQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState("contacts");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; direction: SortDirection } | null>(null);
  const [state, setState] = useState<DataDiagnosticsState>({
    error: "",
    loading: false,
    rows: []
  });
  const [summaryState, setSummaryState] = useState<DiagnosticSummaryState>({
    error: "",
    loading: false,
    rows: []
  });

  const scopedTables = useMemo(
    () => DIAGNOSTIC_TABLES.filter((table) => selectedScope === "Todos" || scopeFromLabel(table.label) === selectedScope),
    [selectedScope]
  );

  const config = useMemo(
    () => scopedTables.find((table) => table.table === selectedTable) ?? scopedTables[0] ?? DIAGNOSTIC_TABLES[0],
    [scopedTables, selectedTable]
  );

  const visibleRows = useMemo(
    () => sortRows(filterRowsByColumns(state.rows, columnFilters, config.columns), sort),
    [columnFilters, config.columns, sort, state.rows]
  );

  useEffect(() => {
    if (!scopedTables.some((table) => table.table === selectedTable)) {
      setSelectedTable(scopedTables[0]?.table ?? DIAGNOSTIC_TABLES[0].table);
    }
  }, [scopedTables, selectedTable]);

  useEffect(() => {
    setColumnFilters({});
    setSort(null);
  }, [config.table]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    loadRows(config, query)
      .then((rows) => {
        if (!active) return;
        setState({ error: "", loading: false, rows });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          error: error instanceof Error ? error.message : "No pude cargar datos crudos.",
          loading: false,
          rows: []
        });
      });
    return () => {
      active = false;
    };
  }, [config, query]);

  useEffect(() => {
    let active = true;
    setSummaryState((current) => ({ ...current, loading: true }));
    loadTableSummaries(scopedTables)
      .then((rows) => {
        if (!active) return;
        setSummaryState({ error: "", loading: false, rows });
      })
      .catch((error) => {
        if (!active) return;
        setSummaryState({
          error: error instanceof Error ? error.message : "No pude cargar el resumen de tablas.",
          loading: false,
          rows: []
        });
      });
    return () => {
      active = false;
    };
  }, [scopedTables]);

  return (
    <section className="maintenance-service-group">
      <div className="maintenance-service-header">
        <h3>Datos crudos</h3>
        <span>{state.loading ? "cargando" : `${visibleRows.length} filas visibles`}</span>
      </div>

      <div className="diagnostic-controls">
        <label className="field">
          <span>Alcance</span>
          <select value={selectedScope} onChange={(event) => setSelectedScope(event.target.value as DiagnosticScope)}>
            {DIAGNOSTIC_SCOPES.map((scope) => (
              <option key={scope} value={scope}>{scope}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tabla</span>
          <select value={selectedTable} onChange={(event) => setSelectedTable(event.target.value)}>
            {scopedTables.map((table) => (
              <option key={table.table} value={table.table}>{table.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Buscar</span>
          <input
            placeholder="Texto contenido en la tabla"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="diagnostic-summary">
        <div className="diagnostic-summary-head">
          <strong>Resumen del alcance seleccionado</strong>
          <span>{summaryState.loading ? "calculando" : `${summaryState.rows.length} tablas`}</span>
        </div>
        {summaryState.error ? <p className="form-error">{summaryState.error}</p> : null}
        <div className="diagnostic-summary-grid">
          {summaryState.rows.map((row) => (
            <button
              className={`diagnostic-summary-card ${row.table === config.table ? "active" : ""}`}
              key={row.table}
              onClick={() => setSelectedTable(row.table)}
              type="button"
            >
              <span>{shortLabel(row.label)}</span>
              <strong>{row.error ? "error" : row.rowCount ?? "-"}</strong>
            </button>
          ))}
        </div>
      </div>

      {state.error ? <p className="form-error">{friendlyError(state.error, config.table)}</p> : null}

      <div className="table-wrap diagnostic-table-wrap">
        <table className="table">
          <thead>
            <tr>
              {config.columns.map((column) => (
                <th key={column}>
                  <button
                    className="diagnostic-column-button"
                    onClick={() => toggleSort(column, setSort)}
                    type="button"
                  >
                    {column}
                    {sort?.column === column ? <span>{sort.direction === "asc" ? " ↑" : " ↓"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {config.columns.map((column) => (
                <th key={`filter-${column}`}>
                  <input
                    className="diagnostic-column-filter"
                    onChange={(event) => setColumnFilters((current) => ({
                      ...current,
                      [column]: event.target.value
                    }))}
                    placeholder="filtrar"
                    value={columnFilters[column] ?? ""}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {config.columns.map((column) => (
                  <td key={`${rowKey(row, index)}-${column}`}>{formatCell(row[column])}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={config.columns.length}>Sin filas para esta busqueda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function loadRows(config: DiagnosticTableConfig, query: string) {
  if (!supabase) return [];
  const search = sanitizeSearch(query);
  let request = supabase
    .from(config.table)
    .select(config.columns.join(","))
    .limit(MAX_DIAGNOSTIC_ROWS);

  if (config.defaultOrder) {
    request = request.order(config.defaultOrder, { ascending: false });
  }

  if (search) {
    request = request.or(config.searchColumns.map((column) => `${column}.ilike.%${search}%`).join(","));
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as unknown as DiagnosticRow[];
}

async function loadTableSummaries(tables: DiagnosticTableConfig[]): Promise<DiagnosticSummaryRow[]> {
  if (!supabase) return [];
  const client = supabase;
  return Promise.all(tables.map(async (table) => {
    const { count, error } = await client
      .from(table.table)
      .select("*", { count: "exact", head: true });

    return {
      error: error?.message ?? "",
      label: table.label,
      rowCount: error ? null : count ?? 0,
      scope: scopeFromLabel(table.label),
      table: table.table
    };
  }));
}

function filterRowsByColumns(
  rows: DiagnosticRow[],
  columnFilters: Record<string, string>,
  columns: string[]
) {
  const activeFilters = columns
    .map((column) => ({ column, value: sanitizeSearch(columnFilters[column] ?? "").toLowerCase() }))
    .filter((filter) => filter.value);

  if (!activeFilters.length) return rows;
  return rows.filter((row) => activeFilters.every((filter) => (
    formatCell(row[filter.column]).toLowerCase().includes(filter.value)
  )));
}

function sortRows(rows: DiagnosticRow[], sort: { column: string; direction: SortDirection } | null) {
  if (!sort) return rows;
  return [...rows].sort((left, right) => {
    const leftValue = sortableValue(left[sort.column]);
    const rightValue = sortableValue(right[sort.column]);
    const result = leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
    return sort.direction === "asc" ? result : -result;
  });
}

function sortableValue(value: DiagnosticCell | undefined) {
  return formatCell(value).toLowerCase();
}

function toggleSort(
  column: string,
  setSort: (updater: (current: { column: string; direction: SortDirection } | null) => { column: string; direction: SortDirection } | null) => void
) {
  setSort((current) => {
    if (current?.column !== column) return { column, direction: "asc" };
    if (current.direction === "asc") return { column, direction: "desc" };
    return null;
  });
}

function sanitizeSearch(value: string) {
  return value.trim().replace(/[,%]/g, " ").replace(/\s+/g, " ");
}

function scopeFromLabel(label: string): DiagnosticScope {
  if (label.startsWith("Global ·")) return "Global";
  if (label.startsWith("Sistema ·")) return "Sistema";
  return "Usuario";
}

function shortLabel(label: string) {
  return label.replace(/^(Usuario|Sistema|Global) · /, "");
}

function formatCell(value: DiagnosticCell | undefined): string {
  if (value === undefined || value === null || value === "") return "sin datos";
  if (Array.isArray(value)) return value.map((item) => formatCell(item as DiagnosticCell)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function rowKey(row: DiagnosticRow, index: number) {
  const id = row.id ?? row.external_id ?? row.created_at ?? row.run_id;
  return `${id ?? "row"}-${index}`;
}

function friendlyError(message: string, table: string) {
  if (message.includes(table)) return `No pude leer ${table}. Puede faltar una migracion o permiso.`;
  return message;
}
