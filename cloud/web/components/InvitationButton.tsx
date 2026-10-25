"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  authorizeInvitation, canAuthorizeInvitation, InvitationError, invitationExpiryLabel,
  invitationRestriction, invitationShareLinks, loadInvitations, shareInvitationNatively,
  type Invitation, type InvitationState
} from "../lib/invitations";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export type InvitationService = {
  load: () => Promise<InvitationState>;
  authorize: (email: string) => ReturnType<typeof authorizeInvitation>;
};

const service: InvitationService = {
  load: () => {
    if (!supabase) return Promise.reject(new InvitationError("No pudimos cargar las invitaciones."));
    return loadInvitations(supabase);
  },
  authorize: (email) => {
    if (!supabase) return Promise.reject(new InvitationError("No pudimos confirmar el resultado.", true));
    return authorizeInvitation(supabase, email);
  }
};

export function InvitationButton({ api = service }: { api?: InvitationService }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const confirmLink = useRef<HTMLButtonElement>(null);
  const shareHeading = useRef<HTMLHeadingElement>(null);
  const shareOrigin = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const request = useRef(0);
  const attemptedEmail = useRef("");
  const [state, setState] = useState<InvitationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState<Invitation | null>(null);
  const [sharing, setSharing] = useState<Invitation | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [now, setNow] = useState(Date.now);

  const refresh = useCallback(async (reconcile = false) => {
    if (busy.current) return;
    const version = ++request.current;
    setLoading(true);
    try {
      const next = await api.load();
      if (!mounted.current || version !== request.current) return;
      setState(next);
      setDenied(false);
      setMessage("");
      if (reconcile) {
        const found = next.invitations.find((row) => row.email === attemptedEmail.current && row.status === "pending");
        setConfirmed(found ?? null);
        setUncertain(false);
        setMessage(found ? "" : "Estado actualizado. Puedes volver a intentar.");
      }
    } catch (error) {
      if (!mounted.current || version !== request.current) return;
      setState(null);
      setDenied(error instanceof InvitationError && error.denied);
      setMessage(error instanceof InvitationError ? error.message : "No pudimos cargar las invitaciones.");
    } finally {
      if (mounted.current && version === request.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { if (!busy.current) void refresh(); };
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !busy.current) void refresh();
    }, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      request.current++;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (confirmed && dialog.current?.open) confirmLink.current?.focus();
  }, [confirmed]);
  useEffect(() => { if (sharing) shareHeading.current?.focus(); }, [sharing]);
  useEffect(() => {
    if (denied && dialog.current?.open) dialog.current.close();
  }, [denied]);

  function open() {
    dialog.current?.showModal();
    emailInput.current?.focus();
    void refresh();
  }

  async function authorize(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || loading || uncertain || !state || !canAuthorizeInvitation(state)) return;
    if (!emailInput.current?.validity.valid || !email.trim()) {
      setInvalid(true);
      emailInput.current?.focus();
      return;
    }
    busy.current = true;
    request.current++;
    setSaving(true);
    setInvalid(false);
    setMessage("");
    setConfirmed(null);
    setSharing(null);
    attemptedEmail.current = email.trim().toLowerCase();
    try {
      const result = await api.authorize(attemptedEmail.current);
      if (!mounted.current) return;
      setState(result.state);
      setConfirmed(result.invitation);
      setMessage(result.existing ? "Ya tienes esta invitación." : "");
      setEmail("");
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof InvitationError ? error.message : "No pudimos confirmar el resultado.");
      setUncertain(!(error instanceof InvitationError) || error.uncertain);
      // Clear stale quotas/permissions after a server rejection. Never retry a mutation automatically.
      setState(null);
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function share(row: Invitation, origin: HTMLElement) {
    if (row.status !== "pending" || !row.email || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) return;
    shareOrigin.current = origin;
    setShareMessage("");
    const result = await shareInvitationNatively(navigator, window.location.origin);
    if (!mounted.current || !dialog.current?.open) return;
    if (result === "fallback") setSharing(row);
    if (result === "cancelled") setShareMessage("Compartir cancelado.");
  }
  function closeSharing() {
    setSharing(null);
    shareOrigin.current?.focus();
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(invitationShareLinks(sharing?.email ?? "", window.location.origin).url);
      if (mounted.current) setShareMessage("Enlace copiado.");
    } catch {
      if (mounted.current) setShareMessage("No pudimos copiar el enlace. Selecciónalo para copiarlo.");
    }
  }

  if (denied) return null;
  const blocked = loading || saving || uncertain || !state || !canAuthorizeInvitation(state);
  const paused = state && (!state.invitations_enabled || !state.registrations_enabled || state.used_capacity >= state.global_capacity);
  const links = sharing && typeof window !== "undefined" ? invitationShareLinks(sharing.email ?? "", window.location.origin) : null;
  return <>
    <button ref={trigger} type="button" className="button secondary invitation-trigger" aria-haspopup="dialog"
      title="Invitar a Coffeecito" aria-label={`Invitar a Coffeecito. ${loading ? "Cargando cupos" : state ? `${state.available_slots} cupos disponibles${paused ? ". Programa en pausa" : ""}` : "Reintentar carga"}`} onClick={open}>
      <span className="invitation-cup"><Icon name="coffee" />{paused ? <span className="invitation-pause" aria-hidden="true">Ⅱ</span> : null}</span>
      <span className="invitation-count">{loading ? "…" : state?.available_slots ?? "!"}</span>
    </button>
    <dialog ref={dialog} className="invitation-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-slots`}
      onClose={() => { setSharing(null); trigger.current?.focus(); }}
      onCancel={(event) => { if (sharing) { event.preventDefault(); closeSharing(); } }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="invitation-head"><h2 id={`${id}-title`}>Invitar a Coffeecito</h2>
        <Button icon="close" square tone="ghost" aria-label="Cerrar invitaciones" onClick={() => dialog.current?.close()} /></header>
      <div className="invitation-body">
        <p id={`${id}-slots`} className="meta">{state ? `${state.available_slots} de ${state.personal_limit} disponibles` : loading ? "Cargando invitaciones…" : "Cupos no disponibles"}</p>
        {state && invitationRestriction(state) ? <p className="invitation-notice">{invitationRestriction(state)}</p> : null}
        {state?.available_slots === 0 && state.next_expiry_at ? <p className="meta">Próxima recuperación: <time dateTime={state.next_expiry_at}>{invitationExpiryLabel(state.next_expiry_at, now)}</time></p> : null}
        <form className="invitation-form" onSubmit={authorize} noValidate aria-busy={saving}>
          <label className="field" htmlFor={`${id}-email`}><span>Email</span>
            <input ref={emailInput} id={`${id}-email`} type="email" required autoComplete="email" value={email} disabled={blocked}
              aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={(event) => { setEmail(event.target.value); setInvalid(false); }} /></label>
          <Button tone="primary" type="submit" disabled={blocked}>{saving ? "Autorizando…" : "Autorizar"}</Button>
          {invalid ? <p id={`${id}-error`} className="form-error">Introduce un email válido.</p> : null}
        </form>
        <div role="status" aria-live="polite">
          {message ? <p className="invitation-notice">{message}</p> : null}
          {confirmed ? <p className="invitation-success">Invitación autorizada. Avísale a tu contacto usando <button ref={confirmLink} type="button" className="invitation-inline-share"
            onClick={(event) => void share(confirmed, event.currentTarget)}>este link!</button></p> : null}
          {shareMessage ? <p className="meta">{shareMessage}</p> : null}
        </div>
        {(uncertain || (!loading && !state)) ? <Button icon="sync" disabled={loading || saving} onClick={() => void refresh(uncertain)}>Revisar estado</Button> : null}
        {sharing && links ? <section className="invitation-share" aria-label="Compartir invitación">
          <div className="invitation-share-head"><h3 ref={shareHeading} tabIndex={-1}>Compartir</h3><Button icon="close" square tone="ghost" aria-label="Cerrar opciones para compartir" onClick={closeSharing} /></div>
          <p>{sharing.email}</p><div className="invitation-share-options">
            <a className="button ghost" href={links.mail}><Icon name="mail" />Correo</a>
            <a className="button ghost" href={links.whatsapp} target="_blank" rel="noopener noreferrer"><Icon name="chat" />WhatsApp</a>
            <Button icon="link" tone="ghost" onClick={copyLink}>Copiar enlace</Button>
          </div><input readOnly aria-label="Enlace de invitación" value={links.url} onFocus={(event) => event.currentTarget.select()} />
        </section> : null}
        <section className="invitation-list" aria-label="Tus invitaciones">
          {loading ? <p className="meta">Cargando…</p> : state?.invitations.length === 0 ? <p className="meta">Aún no hay invitaciones.</p> : state?.invitations.map((row) => <div className="invitation-row" key={row.id}>
            <div><strong>{row.email ?? "Registro confirmado"}</strong><p>{row.status === "registered" ? "Registrada" : <>Pendiente · <time dateTime={row.expires_at!} title={new Date(row.expires_at!).toLocaleString("es-CL")}>{invitationExpiryLabel(row.expires_at!, now)}</time></>}</p></div>
            {row.status === "pending" && row.email ? <Button icon="share" tone="ghost" square disabled={!row.expires_at || Date.parse(row.expires_at) <= now}
              aria-label={`Compartir invitación para ${row.email}`} onClick={(event) => void share(row, event.currentTarget)} /> : null}
          </div>)}
        </section>
      </div>
      <footer className="invitation-footer"><Button onClick={() => dialog.current?.close()}>Listo</Button></footer>
    </dialog>
  </>;
}
