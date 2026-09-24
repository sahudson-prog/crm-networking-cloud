"use client";

import { useState } from "react";
import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge";
import { ContactMergeWorkspace } from "./ContactMergeWorkspace";
import { Button } from "./ui/Button";

const exampleContacts: ContactMergeSource[] = [
  {
    company: "Empresa Demo",
    emails: ["principal@example.invalid"],
    focus: true,
    headhunter: false,
    id: "app",
    kind: "Guardado",
    name: "Contacto Demo Principal",
    networkingStatus: "Contactado",
    phones: ["000000005", "000000006"],
    role: "Director"
  },
  {
    company: "",
    emails: [],
    focus: false,
    headhunter: false,
    id: "google-a",
    kind: "Fuente conectada",
    name: "Contacto Demo P.",
    networkingStatus: "Pendiente",
    phones: ["000000006"],
    role: ""
  },
  {
    company: "Empresa Demo Regional",
    emails: ["alternativo@example.invalid"],
    focus: false,
    headhunter: true,
    id: "referral",
    kind: "Guardado",
    name: "Contacto Demo Alternativo",
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
            <Button icon="check" tone="primary">Guardar cambios</Button>
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
