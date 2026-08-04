"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  saveContactFromEditor,
  type ContactEditorInput
} from "../lib/contactActions";
import { buildContactEditorInputWithPatch, type ContactDraftPatch } from "../lib/contactDraft";
import { cleanContactCompany, cleanContactRole, joinCompact } from "../lib/format";
import { saveReferralFromEditor } from "../lib/referralActions";
import type { ContactReferralRow, ContactRow } from "../lib/readModel";
import { ContactEditorDialog } from "./ContactEditorDialog";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";
import { ContactSearchSelect } from "./ui/ContactSearchSelect";
import { Icon } from "./ui/Icon";

type ReferralEditorDialogProps = {
  contacts: ContactRow[];
  open: boolean;
  referral?: ContactReferralRow | null;
  referrerContact: ContactRow;
  onClose: () => void;
  onContactSaved?: () => void;
  onSaved?: () => void;
};

type QuickUpdateKey = "company" | "role" | "email" | "phone";

export function ReferralEditorDialog({
  contacts,
  open,
  referral,
  referrerContact,
  onClose,
  onContactSaved,
  onSaved
}: ReferralEditorDialogProps) {
  const [referredName, setReferredName] = useState("");
  const [referredCompany, setReferredCompany] = useState("");
  const [referredRole, setReferredRole] = useState("");
  const [referredEmail, setReferredEmail] = useState("");
  const [referredPhone, setReferredPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [linkedContactId, setLinkedContactId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [contactEditorInitial, setContactEditorInitial] = useState<Partial<ContactEditorInput> | undefined>();
  const [quickUpdates, setQuickUpdates] = useState<Set<QuickUpdateKey>>(new Set());

  useEffect(() => {
    if (!open) return;
    setReferredName(referral?.referredName === "Referido sin nombre" ? "" : referral?.referredName || "");
    setReferredCompany(cleanContactCompany(referral?.referredCompany));
    setReferredRole(cleanContactRole(referral?.referredRole));
    setReferredEmail(referral?.referredEmail || "");
    setReferredPhone(referral?.referredPhone || "");
    setNotes(referral?.notes || "");
    setLinkedContactId(referral?.linkedContactId || "");
    setMessage("");
    setContactEditorOpen(false);
    setContactEditorInitial(undefined);
    setQuickUpdates(new Set());
  }, [open, referral]);

  useEffect(() => {
    setQuickUpdates(new Set());
  }, [linkedContactId]);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === linkedContactId) ?? null,
    [contacts, linkedContactId]
  );
  const cleanEmail = normalizeEmail(referredEmail);
  const emailIsValid = !cleanEmail || isValidEmail(cleanEmail);
  const phoneIsValid = !referredPhone.trim() || isValidPhone(referredPhone);
  const quickReferralData = useMemo(
    () => ({
      company: cleanContactCompany(referredCompany),
      role: cleanContactRole(referredRole),
      email: cleanEmail,
      phone: referredPhone.trim()
    }),
    [cleanEmail, referredCompany, referredPhone, referredRole]
  );
  const quickCandidates = useMemo(
    () => buildQuickUpdateCandidates(selectedContact, quickReferralData, emailIsValid, phoneIsValid),
    [emailIsValid, phoneIsValid, quickReferralData, selectedContact]
  );
  const pendingContactInput = useMemo(
    () => (selectedContact ? buildQuickContactInput(selectedContact, quickReferralData, quickUpdates) : null),
    [quickReferralData, quickUpdates, selectedContact]
  );
  const hasReferralContent = Boolean(
    referredName.trim() ||
      referredCompany.trim() ||
      referredRole.trim() ||
      referredEmail.trim() ||
      referredPhone.trim() ||
      notes.trim()
  );
  const canSave = hasReferralContent && emailIsValid && phoneIsValid && !saving && !contactEditorOpen;
  const fieldsDisabled = saving || contactEditorOpen;

  if (!open) return null;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage("");
    try {
      if (pendingContactInput && quickUpdates.size) {
        await saveContactFromEditor(pendingContactInput);
        onContactSaved?.();
      }
      await saveReferralFromEditor({
        referralId: referral?.id,
        referredByContactId: referrerContact.id,
        linkedContactId: linkedContactId || null,
        referredName,
        referredCompany,
        referredRole,
        referredEmail,
        referredPhone,
        notes,
        status: referral?.status === "converted" || referral?.status === "dismissed" ? referral.status : "active",
        source: "contact_profile"
      });
      onSaved?.();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude guardar el referido.");
    } finally {
      setSaving(false);
    }
  }

  function openContactEditor() {
    if (selectedContact) {
      setContactEditorInitial(pendingContactInput ?? undefined);
      setContactEditorOpen(true);
      return;
    }

    setContactEditorInitial({
      displayName: referredName,
      company: referredCompany,
      role: referredRole,
      networkingStatus: "Pendiente",
      networkingFocus: true,
      isHeadhunter: false,
      headhunterDomains: [],
      emails: cleanEmail ? [cleanEmail] : [],
      phones: referredPhone.trim() ? [referredPhone.trim()] : [],
      source: "referral_editor"
    });
    setContactEditorOpen(true);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card referral-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="referral-editor-title">
        <header className="modal-head">
          <div>
            <h2 id="referral-editor-title">Referidos y contactos</h2>
            <p>Guarda el apunte del referido y vincula un contacto solo cuando corresponda.</p>
          </div>
          <Button icon="close" square aria-label="Cerrar editor de referido" onClick={onClose} />
        </header>

        <div className="referral-editor-body">
          <section className="referral-editor-column">
            <div className="referral-editor-section-title">
              <h3>Referido</h3>
              <em>datos rescatados de tus apuntes</em>
            </div>
            <label className="field">
              <span>Quien refiere</span>
              <input disabled value={referrerContact.display_name || "Contacto sin nombre"} />
            </label>
            <label className="field">
              <span>Nombre</span>
              <input disabled={fieldsDisabled} value={referredName} onChange={(event) => setReferredName(event.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Empresa</span>
                <input disabled={fieldsDisabled} value={referredCompany} onChange={(event) => setReferredCompany(event.target.value)} />
              </label>
              <label className="field">
                <span>Cargo</span>
                <input disabled={fieldsDisabled} value={referredRole} onChange={(event) => setReferredRole(event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Correo</span>
              <input
                className={emailIsValid ? "" : "invalid"}
                disabled={fieldsDisabled}
                title={emailIsValid ? "" : "Debe tener formato de correo, por ejemplo nombre@empresa.cl."}
                value={referredEmail}
                onChange={(event) => setReferredEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Telefono</span>
              <input
                className={phoneIsValid ? "" : "invalid"}
                disabled={fieldsDisabled}
                title={phoneIsValid ? "" : "Debe tener al menos 7 digitos. Puedes incluir +, espacios o guiones."}
                value={referredPhone}
                onChange={(event) => setReferredPhone(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Notas adicionales</span>
              <textarea disabled={fieldsDisabled} value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
            </label>
          </section>

          <div className="referral-link-symbol" aria-hidden="true">link</div>

          <section className="referral-editor-column">
            <h3>Contacto</h3>
            <label className="field">
              <span>Contacto vinculado</span>
              <ContactSearchSelect
                contacts={contacts}
                disabled={fieldsDisabled}
                onChange={setLinkedContactId}
                placeholder="Buscar contacto existente"
                value={linkedContactId}
              />
            </label>

            {selectedContact ? (
              <LinkedContactCard
                candidates={quickCandidates}
                contact={selectedContact}
                quickUpdates={quickUpdates}
                referralData={quickReferralData}
                onToggleQuickUpdate={(key) => {
                  setQuickUpdates((previous) => {
                    const next = new Set(previous);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  });
                }}
              />
            ) : (
              <div className="linked-contact-card empty-linked-contact">
                <strong>Sin contacto vinculado</strong>
                <span>Puedes guardar solo el referido o crear un contacto desde este apunte.</span>
              </div>
            )}

            <div className="referral-contact-actions">
              <Button icon={selectedContact ? "edit" : "plus"} onClick={openContactEditor}>
                {selectedContact ? "Editar contacto" : "Crear contacto"}
              </Button>
              <Button disabled={fieldsDisabled || !linkedContactId} onClick={() => setLinkedContactId("")}>
                Sin vinculo
              </Button>
            </div>
          </section>
        </div>

        {!hasReferralContent ? <div className="modal-message">Agrega al menos un dato del referido para guardar.</div> : null}
        {message ? <div className="modal-message danger-text">{message}</div> : null}

        <footer className="modal-actions">
          <Button disabled={fieldsDisabled} onClick={onClose}>Cancelar</Button>
          <Button disabled={!canSave} onClick={save} tone="primary">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>
        </footer>

        <ContactEditorDialog
          contact={selectedContact}
          initialValues={contactEditorInitial}
          open={contactEditorOpen}
          onClose={() => setContactEditorOpen(false)}
          onSaved={(contactId) => {
            setLinkedContactId(contactId);
            setContactEditorOpen(false);
            onContactSaved?.();
          }}
        />
      </section>
    </div>
  );
}

function LinkedContactCard({
  candidates,
  contact,
  onToggleQuickUpdate,
  quickUpdates,
  referralData
}: {
  candidates: Set<QuickUpdateKey>;
  contact: ContactRow;
  onToggleQuickUpdate: (key: QuickUpdateKey) => void;
  quickUpdates: Set<QuickUpdateKey>;
  referralData: QuickReferralData;
}) {
  const emails = (contact.contact_emails ?? []).map((item) => item.email);
  const phones = (contact.contact_phones ?? []).map((item) => item.phone);
  return (
    <div className="linked-contact-card">
      <div className="linked-contact-card-head">
        <strong>{contact.display_name || "Contacto sin nombre"}</strong>
        <StatusBadge status={contact.networking_status || "Pendiente"} />
      </div>
      <div className="linked-contact-fields">
        <LinkedContactField
          actionLabel="Actualizar desde referido"
          canApply={candidates.has("company")}
          isSelected={quickUpdates.has("company")}
          label="Empresa"
          nextValue={referralData.company}
          value={cleanContactCompany(contact.company) || "Sin empresa"}
          onToggle={() => onToggleQuickUpdate("company")}
        />
        <LinkedContactField
          actionLabel="Actualizar desde referido"
          canApply={candidates.has("role")}
          isSelected={quickUpdates.has("role")}
          label="Cargo"
          nextValue={referralData.role}
          value={cleanContactRole(contact.role) || "Sin cargo"}
          onToggle={() => onToggleQuickUpdate("role")}
        />
        <LinkedContactField
          actionLabel="Agregar desde referido"
          canApply={candidates.has("email")}
          isSelected={quickUpdates.has("email")}
          label="Correos"
          nextValue={referralData.email}
          value={joinCompact(emails)}
          onToggle={() => onToggleQuickUpdate("email")}
        />
        <LinkedContactField
          actionLabel="Agregar desde referido"
          canApply={candidates.has("phone")}
          isSelected={quickUpdates.has("phone")}
          label="Telefonos"
          nextValue={referralData.phone}
          value={joinCompact(phones)}
          onToggle={() => onToggleQuickUpdate("phone")}
        />
      </div>
    </div>
  );
}

function LinkedContactField({
  actionLabel,
  canApply,
  isSelected,
  label,
  nextValue,
  onToggle,
  value
}: {
  actionLabel: string;
  canApply: boolean;
  isSelected: boolean;
  label: string;
  nextValue: string;
  onToggle: () => void;
  value: string;
}) {
  return (
    <div className="linked-contact-field">
      <dt>{label}</dt>
      <dd>
        {canApply ? (
          <button
            aria-label={actionLabel}
            className={`quick-referral-button ${isSelected ? "selected" : ""}`}
            onClick={onToggle}
            title={actionLabel}
            type="button"
          >
            <Icon name={isSelected ? "check" : "arrowRight"} />
          </button>
        ) : (
          <span className="quick-referral-spacer" />
        )}
        <span className={value === "Sin empresa" || value === "Sin cargo" ? "empty-meta" : ""}>{value}</span>
        {isSelected && nextValue ? <span className="pending-contact-value">{nextValue}</span> : null}
      </dd>
    </div>
  );
}

type QuickReferralData = {
  company: string;
  role: string;
  email: string;
  phone: string;
};

function buildQuickUpdateCandidates(
  contact: ContactRow | null,
  referralData: QuickReferralData,
  emailIsValid: boolean,
  phoneIsValid: boolean
) {
  const candidates = new Set<QuickUpdateKey>();
  if (!contact) return candidates;

  if (referralData.company && cleanContactCompany(contact.company) !== referralData.company) candidates.add("company");
  if (referralData.role && cleanContactRole(contact.role) !== referralData.role) candidates.add("role");

  const emails = (contact.contact_emails ?? []).map((item) => normalizeEmail(item.email));
  if (referralData.email && emailIsValid && !emails.includes(referralData.email)) candidates.add("email");

  const phones = (contact.contact_phones ?? []).map((item) => normalizePhone(item.phone));
  const referredPhone = normalizePhone(referralData.phone);
  if (referredPhone && phoneIsValid && !phones.includes(referredPhone)) candidates.add("phone");

  return candidates;
}

function buildQuickContactInput(contact: ContactRow, referralData: QuickReferralData, quickUpdates: Set<QuickUpdateKey>) {
  const patch: ContactDraftPatch = { source: "referral_quick_update" };
  if (quickUpdates.has("company")) patch.company = referralData.company;
  if (quickUpdates.has("role")) patch.role = referralData.role;
  if (quickUpdates.has("email") && referralData.email) patch.emailsToAdd = [referralData.email];
  if (quickUpdates.has("phone") && referralData.phone) patch.phonesToAdd = [referralData.phone];
  return buildContactEditorInputWithPatch(contact, patch);
}
