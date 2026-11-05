"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Download, EllipsisVertical } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

const providers = ["Google", "iCloud", "iPhone", "Samsung"] as const;
type Provider = typeof providers[number];
const more = (label: string) => <span className="vcard-help-reference"><EllipsisVertical aria-hidden="true" size={16} /> {label}</span>;
const instructions: Record<Provider, { caption: string; steps: ReactNode[]; url?: string }> = {
  Google: { caption: "Desde un computador", url: "https://contacts.google.com/", steps: [
    "Abre Contactos de Google.",
    "Selecciona los contactos que quieras exportar. Para incluirlos todos, usa «Acciones de selección → Todos».",
    <>Haz clic en {more("Más acciones")} y luego en <span className="vcard-help-reference"><Download aria-hidden="true" size={16} /> Exportar</span>.</>,
    "Elige «vCard (.vcf)» y pulsa «Exportar» para descargar el archivo."
  ] },
  iCloud: { caption: "Desde un computador o tablet", url: "https://www.icloud.com/contacts/", steps: [
    "Abre Contactos de iCloud.",
    "Selecciona los contactos que quieras exportar. Para incluirlos todos, usa «Acciones → Seleccionar todos los contactos».",
    <>Pulsa <span className="vcard-help-reference"><Icon name="share" /> Compartir</span> y elige «Exportar vCard».</>,
    "Guarda el archivo descargado."
  ] },
  iPhone: { caption: "Desde tu iPhone", steps: [
    "Abre la app Contactos y entra en «Listas».",
    "Mantén presionada la lista que quieras exportar.",
    "Pulsa «Exportar», selecciona los campos que quieras incluir y toca «Listo».",
    "Guarda o comparte el archivo para utilizarlo en Coffeecito."
  ] },
  Samsung: { caption: "Desde tu Samsung Galaxy", steps: [
    "Abre la aplicación Contactos.",
    <>Pulsa {more("Más opciones")} y entra en «Ajustes».</>,
    "Selecciona «Exportar contactos».",
    "Elige dónde guardar el archivo y confirma con «Aceptar»."
  ] }
};

export function VCardHelp({ onboarding = false }: { onboarding?: boolean }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    if (provider && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [provider]);
  function open(next: Provider, target: HTMLElement) {
    origin.current = target;
    setProvider(next);
  }
  function close() {
    dialog.current?.close();
    setProvider(null);
    origin.current?.focus();
  }
  function trigger(label: string, initial: Provider) {
    return <button type="button" className="vcard-help-link" aria-haspopup="dialog" onClick={event => open(initial, event.currentTarget)}>{label}</button>;
  }
  const content = provider ? instructions[provider] : null;
  return <>
    {onboarding ? <p>Puedes importar tus contactos desde un archivo vCard o crearlos uno a uno en Coffeecito. Aquí puedes ver cómo exportar contactos desde {trigger("Google", "Google")}, {trigger("Apple", "iCloud")} o {trigger("Samsung", "Samsung")}.</p> : trigger("(cómo?)", "Google")}
    {provider && createPortal(<dialog className="modal-card vcard-help-dialog" ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-subtitle`} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href], [tabindex="0"]'));
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="modal-head">
        <div><h2 id={`${id}-title`}>Cómo descargar tus contactos</h2><p id={`${id}-subtitle`}>Obtén un archivo vCard (.vcf) para importar tus contactos a Coffeecito.</p></div>
        <Button aria-label="Cerrar ayuda" icon="close" square onClick={close} />
      </header>
      <div role="tablist" aria-label="Origen de los contactos" className="vcard-help-tabs">
        {providers.map((item, index) => <button type="button" role="tab" id={`${id}-${item}`} aria-selected={provider === item} aria-controls={`${id}-panel`} tabIndex={provider === item ? 0 : -1} key={item} className={`button ${provider === item ? "primary" : "secondary"}`} onClick={() => setProvider(item)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : null;
          if (next !== null) { event.preventDefault(); setProvider(providers[next]); document.getElementById(`${id}-${providers[next]}`)?.focus(); }
        }}>{item}</button>)}
      </div>
      {content && <section role="tabpanel" tabIndex={0} id={`${id}-panel`} aria-labelledby={`${id}-${provider}`}>
        <p className="meta">{content.caption}</p>
        <ol>{content.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        {provider === "Samsung" && <p className="meta">One UI 7 o posterior. Los menús pueden variar según la versión de One UI.</p>}
        {content.url && <a href={content.url} target="_blank" rel="noopener noreferrer">Abrir Contactos de {provider}</a>}
      </section>}
      <p className="meta">Cuando tengas el archivo, vuelve a Coffeecito y selecciona «Importar archivo vCard».</p>
      <footer className="modal-actions"><Button onClick={close}>Entendido</Button></footer>
    </dialog>, document.body)}
  </>;
}
