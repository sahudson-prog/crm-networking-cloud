"use client";

import { useEffect, useState } from "react";
import { dismissInteraction, saveInteractionFromEditor } from "../lib/interactionActions";
import { interactionLabel } from "../lib/format";
import type { ContactRow, InteractionRow } from "../lib/readModel";
import { Button } from "./ui/Button";

type InteractionEditorDialogProps = {
  contact: ContactRow;
  interaction?: InteractionRow | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

const INTERACTION_TYPES: Array<{ value: InteractionRow["interaction_type"]; label: string }> = [
  { value: "email", label: "Correo" },
  { value: "calendar", label: "Cita" },
  { value: "call", label: "Llamada" },
  { value: "message", label: "Mensaje" },
  { value: "manual", label: "Nota manual" }
];

const DIRECTIONS: Array<{ value: NonNullable<InteractionRow["direction"]>; label: string }> = [
  { value: "outbound", label: "Saliente" },
  { value: "inbound", label: "Entrante" },
  { value: "internal", label: "Interno / nota" },
  { value: "unknown", label: "Sin definir" }
];

export function InteractionEditorDialog({ contact, interaction, open, onClose, onSaved }: InteractionEditorDialogProps) {
  const [interactionType, setInteractionType] = useState<InteractionRow["interaction_type"]>("message");
  const [direction, setDirection] = useState<NonNullable<InteractionRow["direction"]>>("unknown");
  const [occurredAt, setOccurredAt] = useState("");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [preventReimport, setPreventReimport] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setInteractionType(interaction?.interaction_type || "message");
    setDirection((interaction?.direction as NonNullable<InteractionRow["direction"]>) || "unknown");
    setOccurredAt(formatDateTimeLocal(interaction?.occurred_at) || formatDateTimeLocal(new Date().toISOString()));
    setSubject(interaction?.subject || "");
    setNotes(interaction?.user_notes_raw || "");
    setPreventReimport(Boolean(interaction?.metadata?.prevent_reimport));
    setConfirmingDelete(false);
    setDeleting(false);
    setMessage("");
  }, [interaction, open]);

  const title = interaction ? "Editar minuta" : "Agregar interacción";
  const canSave = Boolean(occurredAt) && !saving && !deleting;

  if (!open) return null;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage("");
    try {
      await saveInteractionFromEditor({
        interactionId: interaction?.id,
        contactId: contact.id,
        interactionType,
        direction,
        occurredAt,
        subject,
        userNotesRaw: notes,
        source: interaction ? "contact_profile_edit" : "contact_profile_create"
      });
      onSaved?.();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude guardar la interaccion.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!interaction?.id || saving || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setDeleting(true);
    setMessage("");
    try {
      await dismissInteraction(interaction.id, {
        source: "interaction_editor",
        preventReimport
      });
      onSaved?.();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude eliminar la interaccion.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card interaction-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="interaction-editor-title">
        <header className="modal-head">
          <div>
            <h2 id="interaction-editor-title">{title}</h2>
            <p>{interaction ? interactionLabel(interaction.interaction_type, interaction.direction) : `Nueva interacción con ${contact.display_name || "este contacto"}`}</p>
          </div>
          <Button icon="close" square aria-label="Cerrar editor de interaccion" onClick={onClose} />
        </header>

        <div className="interaction-editor-body">
          <div className="field-row">
            <label className="field">
              <span>Tipo</span>
              <select
                value={interactionType}
                onChange={(event) => {
                  const nextType = event.target.value as InteractionRow["interaction_type"];
                  setInteractionType(nextType);
                  if (!interaction) setDirection("unknown");
                }}
              >
                {INTERACTION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Sentido</span>
              <select value={direction} onChange={(event) => setDirection(event.target.value as NonNullable<InteractionRow["direction"]>)}>
                {DIRECTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Fecha</span>
              <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
            </label>
            <label className="field">
              <span>Título</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Resumen breve" />
            </label>
          </div>

          <label className="field">
            <span>Minuta editable</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Escribe o pega aquí la minuta, conversación o detalle editable."
              rows={9}
            />
          </label>

          {interaction && confirmingDelete ? (
            <label className="interaction-delete-option">
              <input
                checked={preventReimport}
                onChange={(event) => setPreventReimport(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Esta interaccion puede volver a aparecer si sigue existiendo en el origen.</strong>
                <small>Marca esta opcion para eliminarla y evitar que se vuelva a importar en una sincronizacion futura.</small>
              </span>
            </label>
          ) : null}
        </div>

        {message ? <div className="modal-message danger-text">{message}</div> : null}

        <footer className="modal-actions">
          {interaction ? (
            <Button disabled={saving || deleting} onClick={remove} tone="danger">
              {deleting ? "Eliminando..." : confirmingDelete ? "Eliminar de la app" : "Eliminar"}
            </Button>
          ) : null}
          {confirmingDelete ? (
            <Button disabled={deleting} onClick={() => setConfirmingDelete(false)}>
              Cancelar eliminacion
            </Button>
          ) : (
            <>
              <Button disabled={saving || deleting} onClick={onClose}>Cancelar</Button>
              <Button disabled={!canSave} onClick={save} tone="primary">
                {saving ? "Guardando..." : "Guardar cambios"}
              </Button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function formatDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
