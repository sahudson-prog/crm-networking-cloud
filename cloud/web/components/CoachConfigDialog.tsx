"use client";

import { useEffect, useMemo, useState } from "react";
import {
  readTodoConfigs,
  saveTodoConfigModes,
  TODO_CONFIG_MODES,
  todoConfigCanAutoApply,
  todoConfigCondition,
  todoConfigExample,
  todoConfigLabel,
  todoConfigScope,
  type TodoConfigEngine,
  type TodoConfigMode,
  type TodoConfigRow
} from "../lib/coachConfig";
import { Button } from "./ui/Button";

type CoachConfigDialogProps = {
  open: boolean;
  onClose: () => void;
  onOpenHistory?: () => void;
  onSaved?: () => void;
};

const ENGINE_LABELS: Record<TodoConfigEngine, string> = {
  RULE: "Reglas",
  HYBRID: "Hibridas",
  AI: "IA"
};

export function CoachConfigDialog({ open, onClose, onOpenHistory, onSaved }: CoachConfigDialogProps) {
  const [configs, setConfigs] = useState<TodoConfigRow[]>([]);
  const [draftModes, setDraftModes] = useState<Record<string, TodoConfigMode>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMessage("");
      try {
        const rows = await readTodoConfigs();
        if (cancelled) return;
        setConfigs(rows);
        setDraftModes(Object.fromEntries(rows.map((row) => [row.id, row.user_mode])));
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "No pude cargar la configuracion.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groupedConfigs = useMemo(() => {
    return {
      RULE: configs.filter((config) => config.engine_type === "RULE"),
      HYBRID: configs.filter((config) => config.engine_type === "HYBRID"),
      AI: configs.filter((config) => config.engine_type === "AI")
    };
  }, [configs]);

  const changedCount = configs.filter((config) => draftModes[config.id] && draftModes[config.id] !== config.user_mode).length;

  if (!open) return null;

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const safeModes = Object.fromEntries(
        configs.map((config) => {
          const requestedMode = draftModes[config.id] ?? config.user_mode;
          const mode = requestedMode === "execute_without_asking" && !todoConfigCanAutoApply(config)
            ? "confirm_always"
            : requestedMode;
          return [config.id, mode];
        })
      ) as Record<string, TodoConfigMode>;

      await saveTodoConfigModes(configs, safeModes);
      setMessage("Configuracion guardada.");
      onSaved?.();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card coach-config-dialog" role="dialog" aria-modal="true" aria-labelledby="coach-config-title">
        <header className="modal-head">
          <div>
            <h2 id="coach-config-title">Configurar automatizaciones</h2>
            <p>Elige que comentarios puede hacer el Coach y cuando debe actuar solo.</p>
          </div>
          <Button icon="close" square aria-label="Cerrar configuracion" onClick={onClose} />
        </header>

        <div className="coach-config-body">
          {loading ? <div className="muted-text">Leyendo configuracion...</div> : null}
          {!loading && !configs.length ? <div className="muted-text">No hay reglas configurables todavia.</div> : null}

          {(["RULE", "HYBRID", "AI"] as TodoConfigEngine[]).map((engine) => {
            const rows = groupedConfigs[engine];
            if (!rows.length) return null;
            return (
              <section className="coach-config-group" key={engine}>
                <h3>{ENGINE_LABELS[engine]}</h3>
                <div className="coach-config-list">
                  {rows.map((config) => (
                    <ConfigRow
                      config={config}
                      key={config.id}
                      mode={draftModes[config.id] ?? config.user_mode}
                      onModeChange={(mode) => setDraftModes((previous) => ({ ...previous, [config.id]: mode }))}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {message ? <div className="modal-message">{message}</div> : null}

        <footer className="modal-actions coach-config-actions">
          <Button icon="history" onClick={onOpenHistory}>
            Historial
          </Button>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button disabled={saving || !changedCount} onClick={save} tone="primary">
              Guardar cambios
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ConfigRow({
  config,
  mode,
  onModeChange
}: {
  config: TodoConfigRow;
  mode: TodoConfigMode;
  onModeChange: (mode: TodoConfigMode) => void;
}) {
  const canAutoApply = todoConfigCanAutoApply(config);
  const scopeLabel = todoConfigScope(config) === "in_app" ? "Accion en la app" : "Accion fuera de la app";

  return (
    <article className="coach-config-row">
      <div className="coach-config-copy">
        <div className="coach-config-title">
          <strong>{todoConfigLabel(config)}</strong>
          <span>{scopeLabel}</span>
        </div>
        <p>{todoConfigExample(config)}</p>
        <small>{todoConfigCondition(config)}</small>
      </div>
      <fieldset className="coach-config-options" aria-label={`Preferencia para ${todoConfigLabel(config)}`}>
        {TODO_CONFIG_MODES.map((option) => {
          const disabled = option.value === "execute_without_asking" && !canAutoApply;
          return (
            <label className={disabled ? "disabled" : ""} key={option.value}>
              <input
                checked={mode === option.value}
                disabled={disabled}
                name={`todo-config-${config.id}`}
                onChange={() => onModeChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </fieldset>
    </article>
  );
}
