"use client";

import { useState } from "react";
import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge";
import { ContactMergeWorkspace } from "./ContactMergeWorkspace";
import { Button } from "./ui/Button";

const exampleContacts: ContactMergeSource[] = [
  {
    company: "Astara",
    emails: ["alberto.villate.g@astara.com"],
    focus: true,
    headhunter: false,
    id: "app",
    kind: "Guardado",
    name: "Alberto Villate",
    networkingStatus: "Contactado",
    phones: ["+56 9 9221 5817", "+56 2 2837 1378"],
    role: "Director"
  },
  {
    company: "",
    emails: [],
    focus: false,
    headhunter: false,
    id: "google-a",
    kind: "Importado",
    name: "Alberto V",
    networkingStatus: "Pendiente",
    phones: ["+56 2 2837 1378"],
    role: ""
  },
  {
    company: "Astara Latam",
    emails: ["avillate@astara.com"],
    focus: false,
    headhunter: true,
    id: "referral",
    kind: "Guardado",
    name: "Alberto Villate G.",
    networkingStatus: "Agendado",
    phones: [],
    role: "Board member"
  }
];

export function ContactMergePreview() {
  const [result, setResult] = useState<ContactMergeResult | null>(null);

  return (
    <div className="merge-preview">
      <div className="merge-preview-head">
        <div>
          <h3>Fusionar contactos</h3>
          <p>Ejemplo visual para resolver duplicados desde sync, ficha, contactos o Coach.</p>
        </div>
        <span className="merge-preview-limit">2-3 contactos</span>
      </div>

      <ContactMergeWorkspace
        sources={exampleContacts}
        onChange={setResult}
        actions={(
          <>
            <Button icon="close">Cancelar</Button>
            <Button icon="check" tone="primary">Ajustar propuesta</Button>
          </>
        )}
      />

      {result ? (
        <span className="panel-caption">
          Resultado demo: {result.name || "sin nombre"} - {result.emails.length} correos - {result.phones.length} telefonos.
        </span>
      ) : null}
    </div>
  );
}
