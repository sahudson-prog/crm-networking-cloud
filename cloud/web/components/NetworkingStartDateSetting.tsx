"use client";

import { useEffect, useState } from "react";
import { readNetworkingStartIso } from "../lib/syncDate";
import { saveUserSetting } from "../lib/userSettingsActions";
import { Button } from "./ui/Button";

const NETWORKING_START_SETTING = "Fecha_Inicio_Networking";

type NetworkingStartDateSettingProps = {
  onSaved?: (date: string) => void;
};

export function NetworkingStartDateSetting({ onSaved }: NetworkingStartDateSettingProps) {
  const [draftDate, setDraftDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [savedDate, setSavedDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    readNetworkingStartIso()
      .then((value) => {
        if (!active) return;
        const dateValue = toDateInputValue(value);
        setDraftDate(dateValue);
        setSavedDate(dateValue);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "No pude leer la fecha configurada.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const changed = draftDate !== savedDate;
  const canSave = Boolean(draftDate) && changed && !loading && !saving;

  async function saveDate() {
    if (!canSave) return;
    const confirmed = window.confirm(
      "Cambiar esta fecha afectara las proximas revisiones historicas de correos y citas. Si la adelantas, se revisara menos historial; si la atrasas, se revisara mas. Tambien puede cambiar los indicadores del Dashboard porque la fecha define desde cuando cuenta la actividad de networking. Guardar el cambio?"
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveUserSetting(NETWORKING_START_SETTING, draftDate);
      setSavedDate(draftDate);
      onSaved?.(draftDate);
      setMessage("Fecha guardada. Las proximas revisiones usaran este inicio.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude guardar la fecha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-setting-panel">
      <div className="account-setting-copy">
        <strong>Fecha de inicio de networking</strong>
        <span>Usaremos esta fecha para limitar la busqueda de correos y reuniones relevantes. El calendario tambien revisa 3 meses hacia adelante.</span>
      </div>
      <div className="account-setting-row">
        <label className="field account-setting-date">
          <span>Fecha de inicio</span>
          <input disabled={loading || saving} type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} />
        </label>
        <Button disabled={!canSave} icon="check" onClick={saveDate} tone="primary">
          {saving ? "Guardando..." : "Guardar fecha"}
        </Button>
      </div>
      {changed && draftDate ? <p className="meta">Cambio pendiente: presiona guardar para confirmar esta nueva fecha.</p> : null}
      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

function toDateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
