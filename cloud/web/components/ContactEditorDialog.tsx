"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { ContactDeactivationButton } from "./ContactDeactivationButton";
import { ContactDeactivationConfirmDialog } from "./ContactDeactivationConfirmDialog";
import { ObjectiveSelector } from "./ObjectiveSelector";
import { ProviderButton, type ProviderIconName } from "./ui/ProviderIcon";

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

  useEffect(() => {
    if (!open) return;
    const base = contact ? contactToEditorInput(contact) : undefined;
    const source = initialValues ? { ...base, ...initialValues } : base;
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

  if (!open) return null;

  async function save() {
    if (!canSave) return;
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
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card contact-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-editor-title">
        <header className="modal-head">
          <div>
            <h2 id="contact-editor-title">{contact ? "Editar contacto" : "Crear contacto"}</h2>
            <p>Actualiza los datos base que usa la app para vistas, reglas y acciones.</p>
          </div>
          <div className="contact-editor-head-actions">
            <ProviderSyncPlaceholders />
            <Button icon="close" square aria-label="Cerrar editor de contacto" onClick={onClose} />
          </div>
        </header>

        <div className="contact-editor-body">
          <label className="field">
            <span>Nombre *</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nombre del contacto" />
            {!displayName.trim() ? <small className="danger-text">El nombre es obligatorio.</small> : null}
          </label>

          <div className="field-row">
            <label className="field">
              <span>Empresa</span>
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
              <span>Cargo</span>
              <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Sin cargo" />
            </label>
          </div>
          <div className="field-row">
            <ContactValueList
              label="Correos"
              placeholder="correo@empresa.cl"
              values={emailValues}
              invalidMessage="Debe tener formato de correo, por ejemplo nombre@empresa.cl."
              isValid={(value) => isValidEmail(normalizeEmail(value))}
              onChange={setEmailValues}
            />
            <ContactValueList
              label="Telefonos"
              placeholder="+56 9 1234 5678"
              values={phoneValues}
              invalidMessage="Debe tener al menos 7 digitos. Puedes incluir +, espacios o guiones."
              isValid={isValidPhone}
              onChange={setPhoneValues}
            />
          </div>

          <div className="field-row contact-editor-state-row">
            <label className="field">
              <span>Estado networking</span>
              <select value={networkingStatus} onChange={(event) => setNetworkingStatus(event.target.value)}>
                {NETWORKING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <div className="contact-editor-switches">
              <ToggleField active={networkingFocus} label="Foco networking" onChange={setNetworkingFocus} />
              <ToggleField active={isHeadhunter} label="Headhunter" onChange={setIsHeadhunter} />
            </div>
          </div>

          <ObjectiveSelector
            disabled={saving}
            selectedObjectiveIds={objectiveIds}
            onChange={(nextIds) => {
              setObjectiveIds(nextIds);
              setObjectivesTouched(true);
            }}
          />
        </div>

        {message ? <div className="modal-message danger-text">{message}</div> : null}

        <footer className="modal-actions">
          {contact ? (
            <ContactDeactivationButton
              disabled={saving || deleting}
              label="Eliminar contacto"
              onClick={() => setDeleteConfirmOpen(true)}
            />
          ) : null}
          <Button disabled={saving || deleting} onClick={onClose}>Cancelar</Button>
          <Button disabled={!canSave} onClick={save} tone="primary">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </footer>
      </section>
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
    </div>
  );
}

function ProviderSyncPlaceholders() {
  const providers: Array<{ name: ProviderIconName; label: string }> = [
    { name: "google", label: "Google" },
    { name: "apple", label: "Apple" },
    { name: "microsoft", label: "Microsoft" }
  ];

  return (
    <div className="provider-sync-group" aria-label="Completar desde servicios externos">
      {providers.map((provider) => (
        <ProviderButton
          disabled
          key={provider.label}
          label={`Proximamente: completar esta ficha desde ${provider.label}`}
          name={provider.name}
        />
      ))}
    </div>
  );
}

function ContactValueList({
  invalidMessage,
  isValid,
  label,
  onChange,
  placeholder,
  values
}: {
  invalidMessage: string;
  isValid: (value: string) => boolean;
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  function updateValue(index: number, value: string) {
    onChange(values.map((current, currentIndex) => (currentIndex === index ? value : current)));
  }

  function removeValue(index: number) {
    const next = values.filter((_, currentIndex) => currentIndex !== index);
    onChange(next.length ? next : [""]);
  }

  return (
    <div className="field contact-editor-value-list">
      <span>{label}</span>
      <div className="contact-editor-value-rows">
        {values.map((value, index) => {
          const invalid = Boolean(value.trim()) && !isValid(value);
          return (
            <div className="contact-editor-value-row" key={`${label}-${index}`}>
              <input
                className={invalid ? "invalid" : ""}
                onChange={(event) => updateValue(index, event.target.value)}
                placeholder={placeholder}
                title={invalid ? invalidMessage : ""}
                value={value}
              />
              <Button
                aria-label={`Eliminar ${label.toLowerCase()}`}
                disabled={values.length === 1 && !value.trim()}
                icon="trash"
                onClick={() => removeValue(index)}
                square
              />
            </div>
          );
        })}
      </div>
      <Button icon="plus" onClick={() => onChange([...values, ""])}>
        Agregar
      </Button>
    </div>
  );
}

function ToggleField({
  active,
  label,
  onChange
}: {
  active: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="contact-editor-toggle">
      <span>{label}</span>
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
