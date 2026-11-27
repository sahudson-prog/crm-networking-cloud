"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  contactToEditorInput,
  deactivateContacts,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  saveContactFromEditor,
  type ContactEditorInput
} from "../lib/contactActions";
import type { ContactRow } from "../lib/readModel";
import { readHeadhunterCompanyMaster } from "../lib/headhunterCompanyActions";
import {
  normalizeHeadhunterCompanyName,
  type HeadhunterCompanyMasterRow
} from "../lib/headhunterCompanyMaster";
import { Button } from "./ui/Button";
import { INVALID_PHONE_MESSAGE } from "../lib/phoneValidation";
import { ContactDeactivationButton } from "./ContactDeactivationButton";
import { ContactDeactivationConfirmDialog } from "./ContactDeactivationConfirmDialog";
import { ObjectiveSelector } from "./ObjectiveSelector";

type ContactEditorDialogProps = {
  contact?: ContactRow | null;
  initialValues?: Partial<ContactEditorInput>;
  open: boolean;
  onClose: () => void;
  onSaved?: (contactId: string) => void;
};

const NETWORKING_STATUSES = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

export function ContactEditorDialog({ contact, initialValues, open, onClose, onSaved }: ContactEditorDialogProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [networkingStatus, setNetworkingStatus] = useState("Pendiente");
  const [networkingFocus, setNetworkingFocus] = useState(true);
  const [isHeadhunter, setIsHeadhunter] = useState(false);
  const [preservedHeadhunterDomains, setPreservedHeadhunterDomains] = useState<string[]>([]);
  const [emailValues, setEmailValues] = useState<string[]>([""]);
  const [phoneValues, setPhoneValues] = useState<string[]>([""]);
  const [objectiveIds, setObjectiveIds] = useState<string[]>([]);
  const [objectivesTouched, setObjectivesTouched] = useState(false);
  const [headhunterMaster, setHeadhunterMaster] = useState<HeadhunterCompanyMasterRow[] | null>(null);
  const [companyInputFocused, setCompanyInputFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialSnapshot = useRef("");
  const editorSession = useRef<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); opener?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>(deleteConfirmOpen ? '.contact-deactivation-dialog button' : discardOpen ? '[role="alertdialog"] button' : 'input')?.focus();
  }, [open, discardOpen, deleteConfirmOpen]);

  useEffect(() => {
    if (!open) { editorSession.current = null; return; }
    const session = contact?.id || initialValues?.contactId || "new";
    if (editorSession.current === session) return;
    editorSession.current = session;
    const base = contact ? contactToEditorInput(contact) : undefined;
    const source = initialValues ? { ...base, ...initialValues } : base;
    initialSnapshot.current = JSON.stringify([
      source?.displayName ?? "", source?.company ?? "", source?.role ?? "",
      source?.networkingStatus ?? "Pendiente", source?.networkingFocus ?? true,
      source?.isHeadhunter ?? false, withEmptyRow(source?.emails ?? []),
      withEmptyRow(source?.phones ?? []), source?.objectiveIds ?? []
    ]);
    setAttempted(false);
    setDiscardOpen(false);
    setDetailsOpen(Boolean(contact));
    setDisplayName(source?.displayName ?? "");
    setCompany(source?.company ?? "");
    setRole(source?.role ?? "");
    setNetworkingStatus(source?.networkingStatus ?? "Pendiente");
    setNetworkingFocus(source?.networkingFocus ?? true);
    setIsHeadhunter(source?.isHeadhunter ?? false);
    setPreservedHeadhunterDomains(source?.headhunterDomains ?? []);
    setEmailValues(withEmptyRow(source?.emails ?? []));
    setPhoneValues(withEmptyRow(source?.phones ?? []));
    setObjectiveIds(source?.objectiveIds ?? []);
    setObjectivesTouched(false);
    setMessage("");
    setDeleteConfirmOpen(false);
    setDeleteError("");
    setCompanyInputFocused(false);
  }, [contact, initialValues, open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    readHeadhunterCompanyMaster()
      .then((rows) => {
        if (active) setHeadhunterMaster(rows);
      })
      .catch(() => {
        if (!active) return;
        setHeadhunterMaster([]);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const emails = useMemo(() => emailValues.map(normalizeEmail).filter(Boolean), [emailValues]);
  const phones = useMemo(() => phoneValues.map((phone) => phone.trim()).filter(Boolean), [phoneValues]);
  const invalidEmails = emails.filter((email) => !isValidEmail(email));
  const invalidPhones = phones.filter((phone) => !isValidPhone(phone));
  const companyMatches = useMemo(() => {
    if (!isHeadhunter || !headhunterMaster?.length) return [];
    const query = normalizeHeadhunterCompanyName(company);
    if (!query) return [];
    return headhunterMaster
      .filter((row) => row.normalizedName.includes(query))
      .slice(0, 8);
  }, [company, headhunterMaster, isHeadhunter]);
  const showCompanyMatches = companyInputFocused && companyMatches.length > 0;
  const canSave = Boolean(displayName.trim()) && !invalidEmails.length && !invalidPhones.length && !saving && !deleting;
  const dirty = initialSnapshot.current !== JSON.stringify([
    displayName, company, role, networkingStatus, networkingFocus, isHeadhunter,
    emailValues, phoneValues, objectiveIds
  ]);

  function requestClose() {
    if (saving || deleting) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }

  if (!open) return null;

  async function save() {
    setAttempted(true);
    if (!canSave) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await saveContactFromEditor({
        contactId: contact?.id || initialValues?.contactId,
        displayName,
        company,
        role,
        networkingStatus,
        networkingFocus,
        isHeadhunter,
        headhunterDomains: preservedHeadhunterDomains,
        emails,
        phones,
        objectiveIds: objectivesTouched ? objectiveIds : undefined,
        source: initialValues?.source || "contact_editor"
      });
      onSaved?.(result.contactId);
      onClose();
    } catch (error) {
      setMessage(readableContactError(error));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!contact) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deactivateContacts([contact.id], "contact_profile");
      setDeleteConfirmOpen(false);
      onClose();
      router.replace("/contactos");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "No pude eliminar el contacto.");
    } finally {
      setDeleting(false);
    }
  }

  return (
      <dialog ref={dialogRef} className="modal-card contact-editor-dialog contact-editor-native" aria-labelledby="contact-editor-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(node => node.getClientRects().length && !node.closest('[inert]'));
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        onCancel={(event) => { event.preventDefault(); if (saving || deleting) return; if (deleteConfirmOpen) setDeleteConfirmOpen(false); else if (discardOpen) setDiscardOpen(false); else requestClose(); }}>
        <div className="contact-editor-content" inert={deleteConfirmOpen || undefined}>
        <header className="modal-head">
          <div>
            <h2 id="contact-editor-title">{contact ? "Editar contacto" : "Crear contacto"}</h2>
            <p>{contact ? "Actualiza los datos de este contacto." : "Agrega a alguien a tu red. Puedes completar sus datos después."}</p>
          </div>
          <div className="contact-editor-head-actions">
            <Button disabled={saving || deleting} icon="close" square aria-label="Cerrar editor de contacto" onClick={requestClose} />
          </div>
        </header>

        {discardOpen ? <div className="contact-discard-confirm" role="alertdialog" aria-modal="true" aria-labelledby="contact-discard-title">
          <h3 id="contact-discard-title">¿Descartar los cambios?</h3>
          <p>La información que ingresaste no se guardará.</p>
          <div className="modal-actions">
            <Button autoFocus onClick={() => setDiscardOpen(false)}>Seguir editando</Button>
            <Button tone="danger" onClick={onClose}>{contact ? "Descartar cambios" : "Descartar contacto"}</Button>
          </div>
        </div> : <>
        <div className="contact-editor-scroll">
        <fieldset className="contact-editor-body" disabled={saving || deleting} aria-label="Datos del contacto">
          <label className="field">
            <span className="contact-form-field-label">Nombre <b className="danger-text">*</b></span>
            <input autoFocus required aria-invalid={attempted && !displayName.trim()} aria-describedby={attempted && !displayName.trim() ? "contact-name-error" : undefined} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nombre del contacto" />
            {attempted && !displayName.trim() ? <small id="contact-name-error" className="danger-text">El nombre es obligatorio.</small> : null}
          </label>

          <div className="field-row">
            <label className="field">
              <span className="contact-form-field-label">Empresa</span>
              <div className="headhunter-company-field">
                <input
                  autoComplete="off"
                  value={company}
                  onBlur={() => setCompanyInputFocused(false)}
                  onChange={(event) => setCompany(event.target.value)}
                  onFocus={() => setCompanyInputFocused(true)}
                  placeholder="Sin empresa"
                />
                {showCompanyMatches ? (
                  <div className="headhunter-company-menu">
                    {companyMatches.map((row) => (
                      <button
                        key={row.id}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setCompany(row.displayName);
                          setCompanyInputFocused(false);
                        }}
                        type="button"
                      >
                        {row.displayName}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
            <label className="field">
              <span className="contact-form-field-label">Cargo</span>
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Sin cargo" />
            </label>
          </div>
          <div className="field-row">
            <ContactValueList
              attempted={attempted}
              label="Correo"
              placeholder="correo@empresa.cl"
              values={emailValues}
              invalidMessage="Debe tener formato de correo, por ejemplo nombre@empresa.cl."
              isValid={(value) => isValidEmail(normalizeEmail(value))}
              onChange={setEmailValues}
            />
            <ContactValueList
              attempted={attempted}
              label="Teléfono"
              placeholder="+56 9 1234 5678"
              values={phoneValues}
              invalidMessage={INVALID_PHONE_MESSAGE}
              isValid={isValidPhone}
              validateOnBlur={false}
              onChange={setPhoneValues}
            />
          </div>

          <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className="contact-editor-details">
          <summary className="contact-form-section-title">Más detalles</summary>
          <div className="field-row contact-editor-state-row">
            <label className="field">
              <span className="contact-form-field-label">Estado networking</span>
              <select value={networkingStatus} onChange={(event) => setNetworkingStatus(event.target.value)}>
                {NETWORKING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <div className="contact-editor-switches">
              <ToggleField active={networkingFocus} label="Foco networking" description="Define si quieres incluir este contacto en tu networking y seguimiento, o mantenerlo oculto y fuera de tu gestión." onChange={setNetworkingFocus} />
              <ToggleField active={isHeadhunter} label="Headhunter" description="Trabaja en una consultora de reclutamiento." onChange={setIsHeadhunter} />
            </div>
          </div>

          <div className="contact-editor-priorities">
          <h3 className="contact-form-subsection-title">Prioridades</h3>
          <p>Selecciona los objetivos y prioridades en los que este contacto puede ayudarte a avanzar.</p>
          <ObjectiveSelector
            hideHeading
            disabled={saving}
            selectedObjectiveIds={objectiveIds}
            onChange={(nextIds) => {
              setObjectiveIds(nextIds);
              setObjectivesTouched(true);
            }}
          />
          </div>
          </details>
        </fieldset>

        {message ? <div className="modal-message danger-text">{message}</div> : null}
        </div>

        <footer className="modal-actions">
          {contact ? (
            <ContactDeactivationButton
              disabled={saving || deleting}
              label="Eliminar contacto"
              onClick={() => setDeleteConfirmOpen(true)}
            />
          ) : null}
          <Button disabled={saving || deleting} onClick={requestClose}>Cancelar</Button>
          <Button disabled={saving || deleting} onClick={save} tone="primary">
            {saving ? "Guardando..." : contact ? "Guardar cambios" : "Crear contacto"}
          </Button>
        </footer>
      </>}
      </div>
      {deleteConfirmOpen && contact ? (
        <ContactDeactivationConfirmDialog
          busy={deleting}
          contactCount={1}
          contactName={contact.display_name}
          error={deleteError}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={deactivate}
        />
      ) : null}
    </dialog>
  );
}

function ContactValueList({
  attempted,
  invalidMessage,
  isValid,
  validateOnBlur = true,
  label,
  onChange,
  placeholder,
  values
}: {
  attempted: boolean;
  invalidMessage: string;
  isValid: (value: string) => boolean;
  validateOnBlur?: boolean;
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  const [touched, setTouched] = useState<Set<number>>(new Set());
  function updateValue(index: number, value: string) {
    onChange(values.map((current, currentIndex) => (currentIndex === index ? value : current)));
  }

  function removeValue(index: number) {
    const next = values.filter((_, currentIndex) => currentIndex !== index);
    onChange(next.length ? next : [""]);
  }

  return (
    <div className="field contact-editor-value-list">
      <span className="contact-form-field-label">{label}</span>
      <div className="contact-editor-value-rows">
        {values.map((value, index) => {
          const invalid = (attempted || (validateOnBlur && touched.has(index))) && Boolean(value.trim()) && !isValid(value);
          return (
            <div className="contact-editor-value-row" key={`${label}-${index}`}>
              <input
                aria-label={`${label} ${index + 1}`}
                aria-invalid={invalid}
                onBlur={() => setTouched((previous) => new Set(previous).add(index))}
                className={invalid ? "invalid" : ""}
                onChange={(event) => updateValue(index, event.target.value)}
                placeholder={placeholder}
                title={invalid ? invalidMessage : ""}
                value={value}
              />
              {index === 0 ? <Button icon="plus" square aria-label={`Agregar ${label.toLowerCase()} adicional`} onClick={() => onChange([...values, ""])} /> : <Button
                aria-label={`Eliminar ${label.toLowerCase()}`}
                disabled={values.length === 1 && !value.trim()}
                icon="trash"
                onClick={() => removeValue(index)}
                square
              />}
              {invalid ? <small className="danger-text">{invalidMessage}</small> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleField({
  active,
  label,
  description,
  onChange
}: {
  active: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="contact-editor-toggle">
      <span><strong className="contact-form-subsection-title">{label}</strong><small>{description}</small></span>
      <input checked={active} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <i aria-hidden="true" />
    </label>
  );
}

function withEmptyRow(values: string[]) {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  return clean.length ? clean : [""];
}

function readableContactError(error: unknown) {
  const message = error instanceof Error ? error.message : "No pude guardar el contacto.";
  if (message.includes("uq_contact_emails_user_normalized") || message.includes("uq_contact_emails_contact_normalized")) {
    return "Uno de esos correos esta repetido en este contacto.";
  }
  if (message.includes("uq_contact_phones_user_normalized") || message.includes("uq_contact_phones_contact_normalized")) {
    return "Uno de esos telefonos esta repetido en este contacto.";
  }
  return message;
}
