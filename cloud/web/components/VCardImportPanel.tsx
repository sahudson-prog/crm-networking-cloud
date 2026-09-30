"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { readAllActiveContacts } from "../lib/cloudData";
import { saveContactFromEditor } from "../lib/contactActions";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import {
  buildVCardPreviewChanges,
  importSelectedVCardContacts,
  MAX_VCARD_FILE_BYTES,
  parseVCardContacts,
  selectVCardContacts,
  type VCardImportContact
} from "../lib/vcardImport";
import { SyncPreviewDialog, type SyncPreviewTabDefinition } from "./SyncPreviewDialog";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

const VCARD_PREVIEW_TABS: readonly SyncPreviewTabDefinition[] = [
  {
    key: "new",
    label: "Nuevos",
    matches: (change) => change.metadata?.vcardCategory === "new"
  },
  {
    description: "Coinciden por correo o teléfono con contactos existentes. Puedes importarlos igualmente como nuevos.",
    key: "possible_duplicate",
    label: "Posibles duplicados",
    matches: (change) => change.metadata?.vcardCategory === "possible_duplicate"
  }
];

export function VCardImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [changes, setChanges] = useState<SyncPreviewChange[]>([]);
  const [contactsById, setContactsById] = useState<Map<string, VCardImportContact>>(new Map());
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"error" | "info">("info");
  const [invalidCount, setInvalidCount] = useState(0);
  const [open, setOpen] = useState(false);
  const tabs = useMemo(
    () => VCARD_PREVIEW_TABS.filter((tab) => tab.key === "new" || changes.some(tab.matches)),
    [changes]
  );

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setFeedbackMessage("");
    setFeedbackTone("info");
    if (!file.name.toLowerCase().endsWith(".vcf")) {
      setFeedbackMessage("Selecciona un archivo con extensión .vcf.");
      setFeedbackTone("error");
      return;
    }
    if (file.size > MAX_VCARD_FILE_BYTES) {
      setFeedbackMessage("El archivo vCard supera el límite de 2 MB.");
      setFeedbackTone("error");
      return;
    }

    setLoading(true);
    try {
      const parsed = parseVCardContacts(await file.text());
      const existingContacts = await readAllActiveContacts();
      const nextChanges = buildVCardPreviewChanges(parsed.contacts, existingContacts);
      setChanges(nextChanges);
      setContactsById(new Map(parsed.contacts.map((contact) => [contact.id, contact])));
      setInvalidCount(parsed.invalidCount);
      setOpen(true);
    } catch (error) {
      setFeedbackMessage(error instanceof Error ? error.message : "No pudimos leer el archivo vCard.");
      setFeedbackTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function applySelection(selectedChanges: SyncPreviewChange[]) {
    const selectedContacts = selectVCardContacts(
      [...contactsById.values()],
      selectedChanges.map((change) => change.id)
    );
    if (!selectedContacts.length) return;

    setApplying(true);
    setFeedbackMessage("");
    try {
      const result = await importSelectedVCardContacts(selectedContacts, saveContactFromEditor);
      const importedText = `${result.importedCount} ${result.importedCount === 1 ? "contacto importado" : "contactos importados"}`;
      const failedText = result.failedCount
        ? `. ${result.failedCount} ${result.failedCount === 1 ? "contacto no pudo importarse" : "contactos no pudieron importarse"}`
        : "";
      setFeedbackMessage(`${importedText}${failedText}.`);
      setFeedbackTone(result.failedCount ? "error" : "info");
      setOpen(false);
      setChanges([]);
      setContactsById(new Map());
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <div className="account-source-row">
        <div className="account-source-main">
          <span className="connected-service-logo active">
            <Icon name="users" />
          </span>
          <div>
            <strong>Importar contactos desde archivo vCard</strong>
            <span>Compatible con exportaciones de Google, Apple Contacts, Outlook y otros servicios.</span>
          </div>
        </div>
        <div className="account-source-actions">
          <input
            accept=".vcf,text/vcard,text/x-vcard"
            aria-label="Seleccionar archivo vCard"
            className="sr-only"
            onChange={(event) => void handleFileSelection(event)}
            ref={inputRef}
            type="file"
          />
          <Button disabled={loading || applying} icon="plus" onClick={() => inputRef.current?.click()} tone="secondary">
            {loading ? "Leyendo..." : "Importar"}
          </Button>
        </div>
      </div>

      {feedbackMessage ? (
        <p className={feedbackTone === "error" ? "form-error" : "meta"} role={feedbackTone === "error" ? "alert" : "status"}>
          {feedbackMessage}
        </p>
      ) : null}

      <SyncPreviewDialog
        applyLabel="Importar selección"
        applying={applying}
        applyingLabel="Importando..."
        changes={changes}
        description={`Selecciona los contactos que quieres agregar a Coffeecito.${invalidCount ? ` ${invalidCount} ${invalidCount === 1 ? "registro inválido fue omitido" : "registros inválidos fueron omitidos"}.` : ""}`}
        onApply={(selectedChanges) => void applySelection(selectedChanges)}
        onClose={() => setOpen(false)}
        open={open}
        tabs={tabs}
        title="Importar contactos desde vCard"
      />
    </>
  );
}
