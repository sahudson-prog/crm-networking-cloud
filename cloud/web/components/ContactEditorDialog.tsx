"use client";

import { useEffect, useMemo, useState } from "react";
import {
  contactToEditorInput,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  saveContactFromEditor,
  type ContactEditorInput
} from "../lib/contactActions";
import type { ContactRow } from "../lib/readModel";
import { Button } from "./ui/Button";
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
  const [displayName, setDisplayName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [networkingStatus, setNetworkingStatus] = useState("Pendiente");
  const [networkingFocus, setNetworkingFocus] = useState(true);
  const [isHeadhunter, setIsHeadhunter] = useState(false);
  const [headhunterDomainsText, setHeadhunterDomainsText] = useState("");
  const [emailValues, setEmailValues] = useState<string[]>([""]);
  const [phoneValues, setPhoneValues] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
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
    setHeadhunterDomainsText((source?.headhunterDomains ?? []).join("\n"));
    setEmailValues(withEmptyRow(source?.emails ?? []));
    setPhoneValues(withEmptyRow(source?.phones ?? []));
    setMessage("");
  }, [contact, initialValues, open]);

  const emails = useMemo(() => emailValues.map(normalizeEmail).filter(Boolean), [emailValues]);
  const phones = useMemo(() => phoneValues.map((phone) => phone.trim()).filter(Boolean), [phoneValues]);
  const headhunterDomains = useMemo(() => splitLines(headhunterDomainsText), [headhunterDomainsText]);
  const invalidEmails = emails.filter((email) => !isValidEmail(email));
  const invalidPhones = phones.filter((phone) => !isValidPhone(phone));
  const canSave = Boolean(displayName.trim()) && !invalidEmails.length && !invalidPhones.length && !saving;

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
        headhunterDomains,
        emails,
        phones,
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
              <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Sin empresa" />
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

          <label className="field">
            <span>Empresas headhunter</span>
            <textarea
              value={headhunterDomainsText}
              onChange={(event) => setHeadhunterDomainsText(event.target.value)}
              placeholder="@empresa.cl, una por linea"
              rows={3}
            />
          </label>
        </div>

        {message ? <div className="modal-message danger-text">{message}</div> : null}

        <footer className="modal-actions">
          <Button onClick={onClose}>Cancelar</Button>
          <Button disabled={!canSave} onClick={save} tone="primary">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </footer>
      </section>
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

function splitLines(value: string) {
  return value
    .split(/[\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withEmptyRow(values: string[]) {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  return clean.length ? clean : [""];
}

function readableContactError(error: unknown) {
  const message = error instanceof Error ? error.message : "No pude guardar el contacto.";
  if (message.includes("uq_contact_emails_user_normalized")) {
    return "Uno de esos correos ya existe en otro contacto.";
  }
  if (message.includes("uq_contact_phones_user_normalized")) {
    return "Uno de esos telefonos ya existe en otro contacto.";
  }
  return message;
}
