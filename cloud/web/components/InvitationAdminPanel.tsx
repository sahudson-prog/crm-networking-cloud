"use client";

import { useEffect, useRef, useState } from "react";
import { checkCurrentUserCapability } from "../lib/accessControl";
import {
  InvitationError, invitationRpc, loadInvitationAdminState, type InvitationAdminState
} from "../lib/invitations";
import { supabase } from "../lib/supabaseClient";
import { Button } from "./ui/Button";

export function InvitationAdminPanel() {
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<InvitationAdminState | null>(null);
  const [invitations, setInvitations] = useState(false);
  const [registrations, setRegistrations] = useState(false);
  const [capacity, setCapacity] = useState("");
  const [invitationId, setInvitationId] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);

  async function load() {
    setLoaded(false);
    try {
      const capability = await checkCurrentUserCapability("admin.manage_access");
      if (!mounted.current) return;
      setAllowed(capability.allowed);
      if (!capability.allowed || !supabase) return;
      const next = await loadInvitationAdminState(supabase);
      if (!mounted.current) return;
      setState(next);
      setInvitations(next.invitations_enabled);
      setRegistrations(next.registrations_enabled);
      setCapacity(String(next.global_capacity));
    } catch {
      if (mounted.current) { setState(null); setMessage("No pudimos consultar el programa. Los controles permanecen bloqueados."); }
    } finally {
      if (mounted.current) setLoaded(true);
    }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);

  async function mutate(name: string, args: Record<string, unknown>, confirmation: string) {
    if (lock.current || !allowed || !loaded || !supabase || !window.confirm(confirmation)) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const permission = await checkCurrentUserCapability("admin.manage_access");
      if (!permission.allowed) throw new InvitationError("No tienes permiso para gestionar invitaciones.");
      await invitationRpc(supabase, name, args, true);
      if (!mounted.current) return;
      setMessage("Operación confirmada.");
      setReason("");
      await load();
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof InvitationError ? error.message : "No pudimos confirmar la operación.");
      // A lost response may have committed. Require a fresh read before another mutation.
      setState(null);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!loaded && !allowed) return <p className="meta">Revisando invitaciones…</p>;
  if (!allowed) return null;
  return <section className="invitation-admin" aria-labelledby="invitation-admin-title">
    <h3 id="invitation-admin-title">Invitaciones Beta</h3>
    <p role="status">{message}</p>
    {!state ? <Button icon="sync" disabled={busy || !loaded} onClick={() => void load()}>Consultar estado</Button> : <>
      <p className="meta">{state.used_capacity} de {state.global_capacity} lugares ocupados o reservados.</p>
      <form className="invitation-admin-settings" onSubmit={(event) => {
        event.preventDefault();
        void mutate("admin_update_invitation_program_v1", {
          p_invitations_enabled: invitations, p_registrations_enabled: registrations, p_global_capacity: Number(capacity)
        }, `Confirmar programa: nuevas invitaciones ${invitations ? "habilitadas" : "en pausa"}; nuevos registros ${registrations ? "habilitados" : "suspendidos"}; capacidad ${capacity}.`);
      }}>
        <fieldset disabled={busy || !loaded}>
          <label><input type="checkbox" checked={invitations} onChange={(event) => setInvitations(event.target.checked)} />Permitir nuevas invitaciones</label>
          <label><input type="checkbox" checked={registrations} onChange={(event) => setRegistrations(event.target.checked)} />Permitir nuevos registros por invitación</label>
          <label className="field"><span>Capacidad global</span><input type="number" required min="1" max="100000" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
          <Button type="submit" icon="check" disabled={busy || !loaded}>Guardar controles</Button>
        </fieldset>
      </form>
      <details><summary>Cancelar una pendiente o levantar un bloqueo</summary>
        <p className="meta">Cancelar impide una reinvitación hasta que se levante el bloqueo. No modifica registros confirmados.</p>
        <label className="field"><span>Motivo o justificación</span><textarea maxLength={500} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
        <form onSubmit={(event) => {
          event.preventDefault();
          void mutate("admin_cancel_invitation_v1", { p_invitation_id: invitationId.trim(), p_reason: reason.trim() }, "¿Cancelar esta invitación pendiente y bloquear la reinvitación?");
        }}>
          <label className="field"><span>ID de invitación pendiente</span><input required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" value={invitationId} disabled={busy} onChange={(event) => setInvitationId(event.target.value)} /></label>
          <Button type="submit" icon="close" disabled={busy || !loaded || !reason.trim()}>Cancelar pendiente</Button>
        </form>
        <form onSubmit={(event) => {
          event.preventDefault();
          void mutate("admin_lift_invitation_email_block_v1", { p_email: email.trim(), p_reason: reason.trim() }, "¿Levantar el bloqueo de reinvitación de este email? No autoriza ni registra una nueva invitación.");
        }}>
          <label className="field"><span>Email bloqueado</span><input type="email" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
          <Button type="submit" icon="check" disabled={busy || !loaded || !reason.trim()}>Levantar bloqueo</Button>
        </form>
      </details>
    </>}
  </section>;
}
