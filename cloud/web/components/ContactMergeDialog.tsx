"use client";

import { useEffect, useState } from "react";
import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge";
import { contactRowToMergeSource, defaultContactMergeResult } from "../lib/contactMerge";
import type { ContactRow } from "../lib/readModel";
import { ContactMergeWorkspace } from "./ContactMergeWorkspace";
import { Button } from "./ui/Button";

type ContactMergeDialogProps = {
  open: boolean;
  sources: ContactMergeSource[];
  availableContacts?: ContactRow[];
  title?: string;
  description?: string;
  note?: string;
  saveLabel?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (result: ContactMergeResult, sources: ContactMergeSource[]) => void;
};

export function ContactMergeDialog({
  availableContacts = [],
  description = "Elige que datos conservar antes de ajustar la propuesta.",
  note = "Esta propuesta se aplicara recien cuando confirmes la seleccion en el preview de sincronizacion.",
  onClose,
  onSave,
  open,
  saveLabel = "Ajustar propuesta",
  saving = false,
  sources,
  title = "Fusionar contactos"
}: ContactMergeDialogProps) {
  const [dialogSources, setDialogSources] = useState<ContactMergeSource[]>(sources);
  const [result, setResult] = useState<ContactMergeResult>(() => defaultContactMergeResult(sources));

  useEffect(() => {
    if (!open) return;
    setDialogSources(sources);
    setResult(defaultContactMergeResult(sources));
  }, [open, sources]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card contact-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-merge-title">
        <header className="modal-head">
          <div>
            <h2 id="contact-merge-title">{title}</h2>
            <p>{description}</p>
          </div>
          <Button icon="close" square aria-label="Cerrar fusion de contactos" onClick={onClose} />
        </header>

        <div className="contact-merge-dialog-body">
          <ContactMergeWorkspace
            availableContacts={availableContacts}
            onAddContact={(contactId) => {
              const contact = availableContacts.find((item) => item.id === contactId);
              if (!contact || dialogSources.length >= 3 || dialogSources.some((source) => source.id === contact.id)) return;
              setDialogSources((current) => [...current, contactRowToMergeSource(contact, "Guardado")]);
            }}
            onChange={setResult}
            note={note}
            sources={dialogSources}
            actions={(
              <>
                <Button icon="close" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button icon="check" disabled={saving || dialogSources.length < 2} onClick={() => onSave(result, dialogSources)} tone="primary">{saveLabel}</Button>
              </>
            )}
          />
        </div>
      </section>
    </div>
  );
}
