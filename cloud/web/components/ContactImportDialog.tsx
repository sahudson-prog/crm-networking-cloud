"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { FileUp } from "lucide-react";
import { readCurrentGoogleConnectionState, googleConnectionHasCapability } from "../lib/connectedAccounts";
import { readGoogleOAuthOperationEligibility } from "../lib/googleSyncAuthorization";
import { googleDataSessionEligibility, GOOGLE_DATA_SESSION_REQUIRED_MESSAGE } from "../lib/googleDataSessionGuard";
import { supabase } from "../lib/supabaseClient";
import { GoogleContactsSyncPanel } from "./GoogleContactsSyncPanel";
import { VCardImportPanel } from "./VCardImportPanel";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { VCardHelp } from "./VCardHelp";
import { Button } from "./ui/Button";

type GoogleImportOptions = ComponentProps<typeof GoogleContactsSyncPanel> & { enabled: boolean };

/** One entry component, shared by Contactos, Cuenta and the import tutorial step. */
export function ContactImportButton({ google }: { google?: GoogleImportOptions } = {}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (google?.resumeImport) setOpen(true); }, [google?.resumeImport]);
  return <>
    <Button aria-haspopup="dialog" onClick={event => { trigger.current = event.currentTarget; setOpen(true); }}><FileUp aria-hidden="true" size={16} />Importar contactos</Button>
    {open && <ContactImportDialog google={google} onClose={() => { setOpen(false); trigger.current?.focus(); }} />}
  </>;
}

function ContactImportDialog({ google: suppliedGoogle, onClose }: { google?: GoogleImportOptions; onClose: () => void }) {
  useBodyScrollLock(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [method, setMethod] = useState<"file" | "google">(suppliedGoogle?.resumeImport ? "google" : "file");
  const [googleMounted, setGoogleMounted] = useState(Boolean(suppliedGoogle?.resumeImport));
  const [loadedGoogle, setLoadedGoogle] = useState<GoogleImportOptions>({ enabled: false });
  const [gateMessage, setGateMessage] = useState("");
  const google = suppliedGoogle ?? loadedGoogle;

  // Contactos has no AccountPage state. Read the same effective gates only on opening.
  // Authorization and callback resumption remain in the existing panel and Cuenta flow.
  useEffect(() => {
    if (suppliedGoogle) return;
    let active = true;
    void (async () => {
      try {
        const enabled = await readGoogleOAuthOperationEligibility("contacts");
        if (!enabled || !active) return;
        const [connection, session] = await Promise.all([
          readCurrentGoogleConnectionState({ registerRememberedScopes: false }),
          supabase?.auth.getSession()
        ]);
        if (active) setLoadedGoogle({
          enabled,
          authorizationRedirectPath: "/cuenta",
          googleAccessToken: connection.accessToken,
          googleCapabilityAvailable: googleConnectionHasCapability(connection, "contacts_read"),
          googleDisabledReason: googleDataSessionEligibility(session?.data.session?.user).allowed ? "" : GOOGLE_DATA_SESSION_REQUIRED_MESSAGE
        });
      } catch {
        if (active) setGateMessage("No pudimos verificar la disponibilidad de Google Contacts. Puedes importar desde archivo o cerrar y reintentar.");
      }
    })();
    return () => { active = false; };
  }, [suppliedGoogle]);

  useEffect(() => { if (google.resumeImport) setMethod("google"); }, [google.resumeImport]);
  useEffect(() => { if (method === "google") setGoogleMounted(true); }, [method]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    // Existing previews render inside this top-layer dialog, without changing their engines.
    // Keep focus on the innermost review/merge surface and restore it on return.
    let activeSurface: HTMLElement = node;
    const returnFocus = new Map<HTMLElement, HTMLElement>();
    const observer = new MutationObserver(() => {
      const surface = Array.from(node.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1) ?? node;
      if (surface === activeSurface) return;
      if (node.contains(activeSurface)) {
        if (document.activeElement instanceof HTMLElement) returnFocus.set(surface, document.activeElement);
        surface.querySelector<HTMLElement>('button:not([disabled])')?.focus();
      } else {
        const previous = returnFocus.get(activeSurface);
        if (previous?.isConnected) previous.focus();
        else surface.querySelector<HTMLElement>('button:not([disabled])')?.focus();
      }
      activeSurface = surface;
    });
    observer.observe(node, { childList: true, subtree: true });
    return () => { observer.disconnect(); node.close(); };
  }, []);

  function dismiss() {
    const nested = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[role="dialog"]') ?? []).at(-1);
    if (nested) nested.querySelector<HTMLButtonElement>(':scope > .modal-head button[aria-label^="Cerrar"]:not([disabled])')?.click();
    else { dialog.current?.close(); onClose(); }
  }

  return createPortal(<dialog ref={dialog} className="modal-card contact-import-dialog" aria-labelledby={`${id}-title`} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); dismiss(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const node = event.currentTarget;
    const surface = Array.from(node.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1) ?? node;
    const items = Array.from(surface.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), summary, [tabindex="0"]')).filter(item => item.tabIndex >= 0 && item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="modal-head">
      <h2 id={`${id}-title`}>Importar contactos</h2>
      <Button aria-label="Cerrar importación" icon="close" square onClick={dismiss} />
    </header>
    {google.enabled && <div role="tablist" aria-label="Método de importación" className="vcard-help-tabs">
      {(["file", "google"] as const).map((item, index) => <button type="button" role="tab" key={item} id={`${id}-${item}`} aria-controls={`${id}-${item}-panel`} aria-selected={method === item} tabIndex={method === item ? 0 : -1} className={`button ${method === item ? "primary" : "secondary"}`} onClick={() => setMethod(item)} onKeyDown={event => {
        const next = event.key === "Home" ? "file" : event.key === "End" ? "google" : event.key === "ArrowRight" || event.key === "ArrowLeft" ? (index ? "file" : "google") : null;
        if (next) { event.preventDefault(); setMethod(next); document.getElementById(`${id}-${next}`)?.focus(); }
      }}>{item === "file" ? "Desde archivo" : "Desde Google"}</button>)}
    </div>}
    <div className="contact-import-content">
      <div className="contact-import-file-panel" hidden={google.enabled && method !== "file"} role={google.enabled ? "tabpanel" : undefined} aria-labelledby={google.enabled ? `${id}-file` : undefined} id={`${id}-file-panel`}>
        <VCardImportPanel presentation="dialog" sourceHelp={<VCardHelp inline />} />
      </div>
      {google.enabled && <div className="contact-import-google-panel" hidden={method !== "google"} role="tabpanel" aria-labelledby={`${id}-google`} id={`${id}-google-panel`}>
        {(googleMounted || method === "google") && <GoogleContactsSyncPanel {...google} compact iconOnlyActions={false} registerRememberedScopes={false} />}
      </div>}
      {gateMessage && <p className="meta" role="status">{gateMessage}</p>}
    </div>
  </dialog>, document.body);
}
