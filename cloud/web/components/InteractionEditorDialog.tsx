"use client";

import { useEffect, useRef, useState } from "react";
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
  const [dateText, setDateText] = useState("");
  const [dateTouched, setDateTouched] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
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
    const localTimestamp = formatDateTimeLocal(interaction?.occurred_at) || formatDateTimeLocal(new Date().toISOString());
    setOccurredAt(localTimestamp);
    setDateText(displayCivilDate(localTimestamp.slice(0, 10)));
    setDateTouched(false);
    setSubject(interaction?.subject || "");
    setNotes(interaction?.user_notes_raw || "");
    setPreventReimport(Boolean(interaction?.metadata?.prevent_reimport));
    setConfirmingDelete(false);
    setDeleting(false);
    setMessage("");
  }, [interaction, open]);

  const title = interaction ? "Editar interacción" : "Registrar interacción";
  const validDate = parseCivilDate(dateText);
  const canSave = Boolean(occurredAt && validDate) && !saving && !deleting;

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
        occurredAt: interaction?.occurred_at && occurredAt === formatDateTimeLocal(interaction.occurred_at) ? interaction.occurred_at : occurredAt,
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

          <div className="interaction-when">
            <div className="field">
              <span id="interaction-date-label">Fecha</span>
              <div className="interaction-date-shortcuts">
                {[{ label: "Hoy", days: 0 }, { label: "Ayer", days: 1 }].map(({ label, days }) => <Button key={label} onClick={() => {
                  const day = new Date(); day.setDate(day.getDate() - days);
                  const date = formatDateTimeLocal(day.toISOString()).slice(0, 10);
                  setDateText(displayCivilDate(date));
                  setDateTouched(false);
                  setOccurredAt(`${date}T${occurredAt.slice(11) || formatDateTimeLocal(new Date().toISOString()).slice(11)}`);
                }}>{label}</Button>)}
                <Button onClick={() => dateInput.current?.focus()}>Otra fecha</Button>
              </div>
              <input ref={dateInput} aria-labelledby="interaction-date-label" type="text" inputMode="numeric" placeholder="dd/mm/aaaa" maxLength={10} value={dateText}
                aria-invalid={dateTouched && !validDate} aria-describedby={dateTouched && !validDate ? "interaction-date-error" : undefined}
                onBlur={() => setDateTouched(true)} onChange={(event) => {
                setDateText(event.target.value);
                const date = parseCivilDate(event.target.value);
                if (date) setOccurredAt(`${date}T${occurredAt.slice(11)}`);
              }} />
              {dateTouched && !validDate ? <small id="interaction-date-error" className="danger-text">Ingresa una fecha válida en formato dd/mm/aaaa.</small> : null}
            </div>
            <div className="interaction-time-fields">
              <label className="field"><span>Hora</span><select aria-label="Hora" value={occurredAt.slice(11, 13)} onChange={event => setOccurredAt(`${occurredAt.slice(0, 11)}${event.target.value}${occurredAt.slice(13)}`)}>
                {Array.from({ length: 24 }, (_, n) => String(n).padStart(2, "0")).map(hour => <option key={hour} value={hour}>{hour}</option>)}
              </select></label>
              <span aria-hidden="true">:</span>
              <label className="field"><span>Minutos</span><select aria-label="Minutos" value={occurredAt.slice(14, 16)} onChange={event => setOccurredAt(`${occurredAt.slice(0, 14)}${event.target.value}${occurredAt.slice(16)}`)}>
                {Array.from({ length: 60 }, (_, n) => String(n).padStart(2, "0")).map(minute => <option key={minute} value={minute}>{minute}</option>)}
              </select></label>
            </div>
          </div>
            <label className="field">
              <span>Título</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Resumen breve" />
            </label>

          <label className="field">
            <span>Notas de la interacción</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="¿Qué conversaron? Agrega los detalles que quieras recordar."
              rows={5}
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
                {saving ? "Guardando..." : interaction ? "Guardar cambios" : "Registrar interacción"}
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
  return local.toISOString().slice(0, -1);
}

function displayCivilDate(value: string) {
  return value.split("-").reverse().join("/");
}

function parseCivilDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "";
  const iso = value.split("/").reverse().join("-");
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : "";
}
