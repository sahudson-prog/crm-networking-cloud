"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { loadAdminAccessState, type AdminAccessState } from "../lib/adminAccess";
import {
  cleanUsageLimitOverrides,
  LIMIT_OVERRIDES_SETTING,
  loadUsageLimitOverrides,
  type LimitOverride,
  type LimitOverrides
} from "../lib/usageLimitSettings";
import {
  effectiveProviderLimit,
  resetWindowLabel,
  scaleDescription,
  USAGE_LIMIT_DEFINITIONS,
  usageLimitDefinitionsByImpact,
  type UsageCapacityContext,
  type UsageLimitDefinition
} from "../lib/usageLimitCatalog";
import { saveUserSetting } from "../lib/userSettingsActions";
import { Button } from "./ui/Button";
import { AccessAdminPanel } from "./AccessAdminPanel";
import { DataDiagnosticsPanel } from "./DataDiagnosticsPanel";
import { ProgressBar } from "./ui/ProgressBar";

type UsageEventRow = {
  limit_type: string;
  units: number;
  created_at: string;
};

export function AdminMaintenancePage() {
  const [admin, setAdmin] = useState<AdminAccessState>({
    allowed: false,
    capabilityCode: "admin.manage_access",
    checked: false,
    email: "",
    message: "",
    status: "denied"
  });
  const [capacity, setCapacity] = useState<UsageCapacityContext>({ activeUsers: 1 });
  const [drafts, setDrafts] = useState<LimitOverrides>({});
  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadAdminAccessState("admin.manage_access").then((state) => {
      if (active) setAdmin(state);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!admin.allowed) return;
    let active = true;
    Promise.all([loadUsageLimitOverrides(), loadUsageEvents(), loadCapacityContext()])
      .then(([nextDrafts, nextEvents, nextCapacity]) => {
        if (!active) return;
        setDrafts(nextDrafts);
        setEvents(nextEvents);
        setCapacity(nextCapacity);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "No pude cargar la mantencion.");
      });
    return () => {
      active = false;
    };
  }, [admin.allowed]);

  const usageByLimit = useMemo(() => usageMap(events), [events]);
  const orderedDefinitions = useMemo(() => usageLimitDefinitionsByImpact(), []);
  const groupedDefinitions = useMemo(() => groupDefinitionsByProvider(orderedDefinitions), [orderedDefinitions]);

  if (!admin.checked) {
    return <section className="panel">Revisando acceso...</section>;
  }

  if (!admin.allowed) {
    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Mantencion admin</h2>
            <span className="panel-caption">Acceso restringido</span>
          </div>
          <Link className="button secondary" href="/sistema">Volver a Sistema</Link>
        </div>
        <p className="meta">
          {admin.message || "Esta vista es para administradores."}
        </p>
        {admin.status === "missing_model" ? (
          <p className="meta">
            Ejecuta primero el modelo de acceso v0.1 y el bootstrap del primer administrador.
          </p>
        ) : null}
      </section>
    );
  }

  async function saveChanges() {
    const confirmed = window.confirm("Guardar estos limites cambia los parametros de mantencion beta. ¿Confirmas el cambio?");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveUserSetting(LIMIT_OVERRIDES_SETTING, JSON.stringify(cleanUsageLimitOverrides(drafts)));
      setMessage("Parametros guardados.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude guardar los parametros.");
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(id: string, key: keyof LimitOverride, value: string) {
    const numericValue = Math.max(0, Math.floor(Number(value) || 0));
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [key]: numericValue
      }
    }));
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Mantencion admin</h2>
          <span className="panel-caption">Limites, proveedores y acumulados de uso</span>
        </div>
        <div className="toolbar">
          <Link className="button secondary" href="/sistema">Volver a Sistema</Link>
          <Link className="button secondary" href="/sistema/headhunters">Empresas headhunter</Link>
          <Button disabled={saving} icon="check" onClick={saveChanges} tone="primary">
            {saving ? "Guardando..." : "Guardar parametros"}
          </Button>
        </div>
      </div>

      <p className="meta">
        Esta vista muestra seguros internos editables junto al limite declarado del proveedor asociado. Las barras usan eventos internos registrados por la app; cuando conectemos metricas reales de Google/Supabase, estos mismos parametros serviran como tablero operativo.
      </p>
      <p className="meta">Admin actual: {admin.email || "sesion activa local"}</p>

      <div className="maintenance-capacity-grid">
        <div className="maintenance-capacity-item">
          <strong>Orden</strong>
          <span>Mayor espera o impacto primero; lo que se libera minuto a minuto queda abajo.</span>
        </div>
        <div className="maintenance-capacity-item">
          <strong>Usuarios considerados</strong>
          <span>{formatNumber(capacity.activeUsers)}</span>
        </div>
        <div className="maintenance-capacity-item">
          <strong>Ajuste automatico</strong>
          <span>Las cuotas por usuario multiplican el indicador agregado por usuarios considerados.</span>
        </div>
      </div>

      <div className="maintenance-service-list">
        <AccessAdminPanel />
        <DataDiagnosticsPanel />

        {groupedDefinitions.map((group) => (
          <section className="maintenance-service-group" key={group.provider}>
            <div className="maintenance-service-header">
              <h3>{group.provider}</h3>
              <span>{group.definitions.length} parametro(s)</span>
            </div>
            <div className="maintenance-limit-list">
              {group.definitions.map((definition) => (
                <UsageLimitCard
                  capacity={capacity}
                  definition={definition}
                  key={definition.id}
                  override={drafts[definition.id]}
                  usedUnits={usageByLimit.get(definition.id) ?? definition.observedDefault ?? 0}
                  onChange={updateDraft}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function UsageLimitCard({
  capacity,
  definition,
  onChange,
  override,
  usedUnits
}: {
  capacity: UsageCapacityContext;
  definition: UsageLimitDefinition;
  onChange: (id: string, key: keyof LimitOverride, value: string) => void;
  override?: LimitOverride;
  usedUnits: number;
}) {
  const appMax = override?.appMax ?? definition.appDefault;
  const providerBase = override?.providerMax ?? definition.providerDefault;
  const providerMax = effectiveProviderLimit(definition, providerBase, capacity);
  const hasObservedReference = definition.observedDefault !== undefined;
  const tone = providerMax && usedUnits / providerMax >= 0.9 ? "danger" : providerMax && usedUnits / providerMax >= 0.7 ? "warning" : "primary";

  return (
    <article className="maintenance-limit-card">
      <div className="maintenance-limit-main">
        <div>
          <strong>{definition.title}</strong>
          <span>{definition.settingKind === "run_limit" ? "tope por revision" : "cuota proveedor"}</span>
        </div>
        <p>{definition.description}</p>
        <p>{definition.impactSummary}</p>
        {hasObservedReference ? <p>{definition.observedSource}</p> : null}
      </div>

      <label className="field">
        <span>Seguro app</span>
        <input min={0} type="number" value={appMax} onChange={(event) => onChange(definition.id, "appMax", event.target.value)} />
        <small className="meta">{definition.appUnit}</small>
      </label>

      <label className="field">
        <span>Limite proveedor base</span>
        <input min={0} type="number" value={providerBase} onChange={(event) => onChange(definition.id, "providerMax", event.target.value)} />
        <small className="meta">{definition.providerUnit}</small>
      </label>

      <div className="maintenance-limit-usage">
        <ProgressBar
          compact
          detail={`${formatUsageNumber(usedUnits)} / ${formatUsageNumber(providerMax)}`}
          label="Acumulado"
          max={providerMax}
          tone={tone}
          value={usedUnits}
        />
        <span className="meta">{resetWindowLabel(definition.resetWindow)}</span>
        <span className="meta">{scaleDescription(definition, capacity)}</span>
        {definition.observedNote ? <span className="meta">{definition.observedNote}</span> : null}
      </div>
    </article>
  );
}

function groupDefinitionsByProvider(definitions: UsageLimitDefinition[]) {
  const groups = new Map<string, UsageLimitDefinition[]>();
  for (const definition of definitions) {
    const current = groups.get(definition.provider) ?? [];
    current.push(definition);
    groups.set(definition.provider, current);
  }
  return [...groups.entries()]
    .map(([provider, groupDefinitions]) => ({
      definitions: groupDefinitions.sort((left, right) => right.impactRank - left.impactRank),
      maxImpact: Math.max(...groupDefinitions.map((definition) => definition.impactRank)),
      provider
    }))
    .sort((left, right) => right.maxImpact - left.maxImpact);
}

async function loadUsageEvents() {
  if (!supabase) return [];
  const oldest = oldestWindowStartIso();
  const { data, error } = await supabase
    .from("usage_events")
    .select("limit_type,units,created_at")
    .gte("created_at", oldest)
    .in("limit_type", USAGE_LIMIT_DEFINITIONS.map((definition) => definition.id));
  if (error) throw error;
  return (data ?? []) as UsageEventRow[];
}

async function loadCapacityContext(): Promise<UsageCapacityContext> {
  if (!supabase) return { activeUsers: 1 };
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) return { activeUsers: 1 };
  return { activeUsers: Math.max(1, count ?? 1) };
}

function usageMap(events: UsageEventRow[]) {
  const now = new Date();
  const result = new Map<string, number>();
  for (const definition of USAGE_LIMIT_DEFINITIONS) {
    const start = resetWindowStart(now, definition.resetWindow);
    const matchingEvents = events
      .filter((event) => event.limit_type === definition.id)
      .filter((event) => definition.resetWindow === "none" || new Date(event.created_at) >= start);
    if (!matchingEvents.length) continue;
    const total = matchingEvents.reduce((sum, event) => sum + (Number(event.units) || 0), 0);
    result.set(definition.id, total);
  }
  return result;
}

function resetWindowStart(now: Date, window: UsageLimitDefinition["resetWindow"]) {
  if (window === "minute") return new Date(now.getTime() - 60 * 1000);
  if (window === "day") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (window === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(0);
}

function oldestWindowStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL").format(value);
}

function formatUsageNumber(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value);
}
