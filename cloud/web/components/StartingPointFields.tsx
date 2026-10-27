"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState
} from "react";
import {
  EMPTY_STARTING_POINT,
  PROFESSIONAL_SITUATION_OPTIONS,
  normalizeStartingPoint,
  validateStartingPoint,
  type StartingPointErrors,
  type StartingPointValues
} from "../lib/startingPoint";
import {
  readCurrentUserStartingPoint,
  saveCurrentUserStartingPoint
} from "../lib/startingPointActions";
import { networkingStartBounds } from "../lib/syncDate";
import { Button } from "./ui/Button";

export type StartingPointFieldsHandle = {
  save: () => Promise<boolean>;
};

type StartingPointFieldsProps = {
  mode: "account" | "onboarding";
  onReadyChange?: (ready: boolean) => void;
  onSaved?: (values: StartingPointValues) => void;
  onSavingChange?: (saving: boolean) => void;
  requireComplete?: boolean;
  showSaveAction?: boolean;
};

export const StartingPointFields = forwardRef<StartingPointFieldsHandle, StartingPointFieldsProps>(
  function StartingPointFields(
    {
      mode,
      onReadyChange,
      onSaved,
      onSavingChange,
      requireComplete = mode === "onboarding",
      showSaveAction = mode === "account"
    },
    ref
  ) {
    const [draft, setDraft] = useState<StartingPointValues>(EMPTY_STARTING_POINT);
    const [saved, setSaved] = useState<StartingPointValues>(EMPTY_STARTING_POINT);
    const [errors, setErrors] = useState<StartingPointErrors>({});
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const maximumDate = useMemo(() => networkingStartBounds().maximumDate, []);
    const changed = JSON.stringify(normalizeStartingPoint(draft)) !== JSON.stringify(saved);

    useEffect(() => {
      let active = true;
      setLoading(true);
      setLoadError("");
      setSaveError("");
      onReadyChange?.(false);
      readCurrentUserStartingPoint()
        .then((values) => {
          if (!active) return;
          const normalized = normalizeStartingPoint(values);
          setDraft(normalized);
          setSaved(normalized);
          setErrors({});
          onReadyChange?.(true);
        })
        .catch((error) => {
          if (!active) return;
          setLoadError(error instanceof Error ? error.message : "No pudimos leer estos datos.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [onReadyChange, reloadKey]);

    async function save() {
      if (loading || saving || loadError) return false;
      const changedFields = (Object.keys(draft) as Array<keyof StartingPointValues>)
        .filter((key) => normalizeStartingPoint(draft)[key] !== saved[key]);
      const fieldsToSave = requireComplete
        ? (["fullName", "professionalSituationCode", "networkingStartDate"] as Array<keyof StartingPointValues>)
        : changedFields;
      if (fieldsToSave.length === 0) return true;
      const allErrors = validateStartingPoint(draft);
      const nextErrors = requireComplete
        ? allErrors
        : Object.fromEntries(
            Object.entries(allErrors).filter(([key]) => fieldsToSave.includes(key as keyof StartingPointValues))
          ) as StartingPointErrors;
      setErrors(nextErrors);
      setMessage("");
      setSaveError("");
      if (Object.keys(nextErrors).length > 0) return false;

      setSaving(true);
      onSavingChange?.(true);
      try {
        const persisted = normalizeStartingPoint(await saveCurrentUserStartingPoint(draft, fieldsToSave));
        setDraft(persisted);
        setSaved(persisted);
        setErrors({});
        setMessage("Tu punto de partida quedó guardado.");
        onSaved?.(persisted);
        return true;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "No pudimos guardar estos datos.");
        return false;
      } finally {
        setSaving(false);
        onSavingChange?.(false);
      }
    }

    useImperativeHandle(ref, () => ({ save }), [draft, loadError, loading, saving]);

    function update<Key extends keyof StartingPointValues>(key: Key, value: StartingPointValues[Key]) {
      setDraft((current) => ({ ...current, [key]: value }));
      setErrors((current) => ({ ...current, [key]: undefined }));
      setSaveError("");
      setMessage("");
    }

    return (
      <div className={`starting-point-fields mode-${mode}`} aria-busy={loading || saving}>
        <div className="starting-point-field-grid">
          <label className="field starting-point-field">
            <span>¿Cómo te llamamos?</span>
            <input
              autoComplete="name"
              disabled={loading || saving}
              maxLength={160}
              value={draft.fullName}
              onChange={(event) => update("fullName", event.target.value)}
              aria-describedby={errors.fullName ? "starting-point-name-error" : undefined}
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName ? <small className="form-error" id="starting-point-name-error">{errors.fullName}</small> : null}
          </label>

          <label className="field starting-point-field">
            <span>¿Cuál es tu situación profesional?</span>
            <select
              disabled={loading || saving}
              value={draft.professionalSituationCode}
              onChange={(event) => update("professionalSituationCode", event.target.value as StartingPointValues["professionalSituationCode"])}
              aria-describedby={errors.professionalSituationCode ? "starting-point-situation-error" : undefined}
              aria-invalid={Boolean(errors.professionalSituationCode)}
            >
              <option value="">Selecciona una opción</option>
              {PROFESSIONAL_SITUATION_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
            {errors.professionalSituationCode ? (
              <small className="form-error" id="starting-point-situation-error">{errors.professionalSituationCode}</small>
            ) : null}
          </label>

          <label className="field starting-point-field">
            <span>¿Desde cuándo haces networking?</span>
            <input
              disabled={loading || saving}
              max={maximumDate}
              type="date"
              value={draft.networkingStartDate}
              onChange={(event) => update("networkingStartDate", event.target.value)}
              aria-describedby={`starting-point-date-help${errors.networkingStartDate ? " starting-point-date-error" : ""}`}
              aria-invalid={Boolean(errors.networkingStartDate)}
            />
            <small className="starting-point-help" id="starting-point-date-help">
              Será la referencia para medir tus avances y recuperar interacciones históricas disponibles. No amplía las ventanas ni permisos de importación.
            </small>
            {errors.networkingStartDate ? (
              <small className="form-error" id="starting-point-date-error">{errors.networkingStartDate}</small>
            ) : null}
          </label>
        </div>

        {loading ? <p className="meta" role="status">Cargando tu punto de partida...</p> : null}
        {loadError ? (
          <div className="starting-point-feedback" role="alert">
            <p className="form-error">{loadError}</p>
            {!saving ? <Button onClick={() => setReloadKey((value) => value + 1)} tone="ghost">Reintentar</Button> : null}
          </div>
        ) : null}
        {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
        {message ? <p className="meta" role="status">{message}</p> : null}
        {showSaveAction && !loadError ? (
          <div className="starting-point-actions">
            <Button disabled={loading || saving || !changed} icon="check" onClick={() => void save()} tone="primary">
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
);
