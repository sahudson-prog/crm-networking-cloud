"use client";

import { useEffect, useRef, useState } from "react";
import { checkCurrentUserCapability } from "../lib/accessControl";
import {
  reconcilePublicRegistration, PublicRegistrationError, setPublicRegistration,
  type PublicRegistrationAdminState, type PublicRegistrationUncertainty
} from "../lib/publicRegistration";
import { supabase } from "../lib/supabaseClient";
import { Button } from "./ui/Button";

export function PublicRegistrationAdminPanel() {
  const [state, setState] = useState<PublicRegistrationAdminState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const lock = useRef(false);
  const uncertainty = useRef<PublicRegistrationUncertainty | undefined>(undefined);

  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setState(null);
    setMessage("");
    try {
      if (!supabase) throw new PublicRegistrationError("unavailable");
      const result = await reconcilePublicRegistration(supabase, checkCurrentUserCapability, uncertainty.current);
      if (!mounted.current) return;
      uncertainty.current = result.uncertainty;
      setDenied(result.outcome === "denied");
      setState(result.state);
      if (result.state) setEnabled(result.state.enabled);
      else setMessage(result.outcome === "pending"
        ? "La escritura sigue pendiente. Los cambios permanecen bloqueados; vuelve a consultar su estado."
        : result.outcome === "denied" ? "No tienes permiso para administrar el registro libre."
        : "No pudimos consultar el estado. Los cambios permanecen bloqueados.");
    } catch (error) {
      if (!mounted.current) return;
      const forbidden = error instanceof PublicRegistrationError && error.kind === "denied";
      setDenied(forbidden);
      setMessage(forbidden ? "No tienes permiso para administrar el registro libre." : "No pudimos consultar el estado. Los cambios permanecen bloqueados.");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, []);

  async function save() {
    if (lock.current || busy || denied || !state || !supabase || enabled === state.enabled) return;
    const confirmed = window.confirm(enabled
      ? "¿Activar el registro libre? Nuevas personas podrán crear una cuenta sin invitación."
      : "¿Desactivar el registro libre? Se cerrará el alta sin invitación. Los accesos existentes y el programa de invitaciones no cambian.");
    if (!confirmed) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const current = state;
    setState(null);
    try {
      const result = await setPublicRegistration(supabase, checkCurrentUserCapability, current, enabled);
      if (!mounted.current) return;
      uncertainty.current = result.uncertainty;
      setState(result.state);
      if (result.state) setEnabled(result.state.enabled);
      setDenied(result.outcome === "denied");
      setMessage(result.outcome === "saved" ? "Cambio confirmado."
        : result.outcome === "pending" ? "La escritura sigue pendiente. Los cambios permanecen bloqueados; vuelve a consultar su estado."
        : result.outcome === "reconciled" ? "No pudimos confirmar el cambio solicitado. Se volvió a consultar el estado actual; revisa su valor antes de confirmar otro cambio."
        : result.outcome === "denied" ? "No tienes permiso para administrar el registro libre."
        : "No pudimos confirmar el estado actual. Los cambios permanecen bloqueados hasta volver a consultarlo.");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="maintenance-service-group" aria-labelledby="public-registration-title">
    <div className="maintenance-service-header"><h3 id="public-registration-title">Registro libre</h3></div>
    <p className="meta" role="status">{busy ? "Consultando registro libre..." : state ? `Estado actual: ${state.enabled ? "activado" : "desactivado"}.` : "Estado no disponible."}</p>
    {message ? <p className="meta" role="status">{message}</p> : null}
    {!denied ? <form className="grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label><input type="checkbox" role="switch" checked={Boolean(state) && enabled} disabled={busy || !state} onChange={(event) => setEnabled(event.target.checked)} /> Permitir registro sin invitación</label>
      <div className="toolbar">
        <Button type="submit" icon="check" disabled={busy || !state || enabled === state.enabled}>Guardar registro libre</Button>
      </div>
    </form> : null}
    <Button icon="sync" disabled={busy} onClick={() => void load()}>Consultar estado</Button>
  </section>;
}
