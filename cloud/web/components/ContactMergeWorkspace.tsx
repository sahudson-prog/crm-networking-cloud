"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CONTACT_MERGE_STATUS_ORDER,
  defaultContactMergeResult,
  type ContactMergeResult,
  type ContactMergeSource,
  uniqueEmails,
  uniquePhones
} from "../lib/contactMerge";
import { cleanContactCompany, cleanContactRole } from "../lib/format";
import { phoneIdentitiesFor } from "../lib/phoneIdentity";
import type { ContactRow } from "../lib/readModel";
import { StatusBadge } from "./StatusBadge";
import { ContactSearchSelect } from "./ui/ContactSearchSelect";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";

type ContactMergeWorkspaceProps = {
  actions?: ReactNode;
  availableContacts?: ContactRow[];
  note?: string;
  onAddContact?: (contactId: string) => void;
  onChange?: (result: ContactMergeResult) => void;
  sources: ContactMergeSource[];
};

export function ContactMergeWorkspace({
  actions,
  availableContacts = [],
  note = "Al guardar, las interacciones, referidos, ToDos e IDs externos quedan asociados al contacto resultante.",
  onAddContact,
  onChange,
  sources
}: ContactMergeWorkspaceProps) {
  const initialResult = useMemo(() => defaultContactMergeResult(sources), [sources]);
  const allEmails = useMemo(() => uniqueEmails(sources.flatMap((source) => source.emails)), [sources]);
  const allPhones = useMemo(() => uniquePhones(sources.flatMap((source) => source.phones)), [sources]);

  const [name, setName] = useState(initialResult.name);
  const [company, setCompany] = useState(initialResult.company);
  const [role, setRole] = useState(initialResult.role);
  const [selectedEmails, setSelectedEmails] = useState(() => new Set(initialResult.emails));
  const [selectedPhones, setSelectedPhones] = useState(() => new Set(initialResult.phones));
  const [focus, setFocus] = useState(initialResult.focus);
  const [headhunter, setHeadhunter] = useState(initialResult.headhunter);
  const [networkingStatus, setNetworkingStatus] = useState(initialResult.networkingStatus);
  const [addContactId, setAddContactId] = useState("");

  useEffect(() => {
    setName(initialResult.name);
    setCompany(initialResult.company);
    setRole(initialResult.role);
    setSelectedEmails(new Set(initialResult.emails));
    setSelectedPhones(new Set(initialResult.phones));
    setFocus(initialResult.focus);
    setHeadhunter(initialResult.headhunter);
    setNetworkingStatus(initialResult.networkingStatus);
  }, [initialResult]);

  useEffect(() => {
    onChange?.({
      company,
      emails: Array.from(selectedEmails),
      focus,
      headhunter,
      name,
      networkingStatus,
      phones: Array.from(selectedPhones),
      role
    });
  }, [company, focus, headhunter, name, networkingStatus, onChange, role, selectedEmails, selectedPhones]);

  const identity = { company, name, role };
  const addableContacts = availableContacts.filter((contact) => !sources.some((source) => source.id === contact.id));

  return (
    <div className={`merge-comparison-grid sources-${Math.min(Math.max(sources.length, 1), 3)}`}>
      {sources.length < 3 && onAddContact ? (
        <div className="merge-add-contact">
          <div>
            <strong>Agregar contacto guardado</strong>
            <span>{sources.length ? "Suma otro contacto a esta fusion." : "Elige 2 o 3 contactos para fusionar."}</span>
          </div>
          <div className="merge-add-contact-control">
            <ContactSearchSelect
              contacts={addableContacts}
              emptyOption={null}
              onChange={setAddContactId}
              placeholder="Buscar contacto guardado"
              value={addContactId}
            />
            <button
              className="button secondary"
              disabled={!addContactId || sources.length >= 3}
              onClick={() => {
                onAddContact(addContactId);
                setAddContactId("");
              }}
              type="button"
            >
              <Icon name="plus" />
              <span>Agregar</span>
            </button>
          </div>
        </div>
      ) : null}

      {sources.map((source) => (
        <SourceCard
          contact={source}
          identity={identity}
          key={`${source.kind}-${source.id}`}
          onPickAppData={() => {
            setFocus(source.focus);
            setHeadhunter(source.headhunter);
            setNetworkingStatus(source.networkingStatus);
          }}
          onPickIdentity={() => {
            setName(source.name);
            setCompany(cleanContactCompany(source.company));
            setRole(cleanContactRole(source.role));
          }}
          onToggleEmail={(email) => setSelectedEmails((current) => (
            toggleComparableSetValue(current, preferredComparableValue(allEmails, email, sameEmail), sameEmail)
          ))}
          onTogglePhone={(phone) => setSelectedPhones((current) => (
            toggleComparableSetValue(current, preferredComparableValue(allPhones, phone, samePhone), samePhone)
          ))}
          selectedEmails={selectedEmails}
          selectedPhones={selectedPhones}
        />
      ))}

      <article className="merge-contact-card merge-result-card">
        <div className="merge-card-top">
          <span>Resultado</span>
          <strong>Contacto final</strong>
        </div>

        <div className="merge-identity-block merge-result-identity">
          <input
            aria-label="Nombre resultante"
            className="merge-identity-name-input"
            onChange={(event) => setName(event.target.value)}
            placeholder="Nombre"
            value={name}
          />
          <div className="merge-identity-meta-inputs">
            <input
              aria-label="Empresa resultante"
              onChange={(event) => setCompany(event.target.value)}
              placeholder="Sin empresa"
              value={company}
            />
            <input
              aria-label="Cargo resultante"
              onChange={(event) => setRole(event.target.value)}
              placeholder="Sin cargo"
              value={role}
            />
          </div>
        </div>

        <ResultChecklist items={allEmails} label="Correos" selected={selectedEmails} onChange={setSelectedEmails} />
        <ResultChecklist items={allPhones} label="Telefonos" selected={selectedPhones} onChange={setSelectedPhones} />

        <div className="merge-result-settings">
          <MergeSwitch checked={focus} label="Foco networking" onChange={setFocus} />
          <MergeSwitch checked={headhunter} label="Headhunter" onChange={setHeadhunter} />
          <label className="merge-status-select">
            <span>Estado networking</span>
            <select value={networkingStatus} onChange={(event) => setNetworkingStatus(event.target.value)}>
              {CONTACT_MERGE_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="merge-result-note">
          <Icon name="link" />
          <span>{note}</span>
        </div>

        {actions ? <div className="merge-result-actions">{actions}</div> : null}
      </article>
    </div>
  );
}

function SourceCard({
  contact,
  identity,
  onPickAppData,
  onPickIdentity,
  onToggleEmail,
  onTogglePhone,
  selectedEmails,
  selectedPhones
}: {
  contact: ContactMergeSource;
  identity: Pick<ContactMergeSource, "company" | "name" | "role">;
  onPickAppData: () => void;
  onPickIdentity: () => void;
  onToggleEmail: (value: string) => void;
  onTogglePhone: (value: string) => void;
  selectedEmails: Set<string>;
  selectedPhones: Set<string>;
}) {
  const identitySelected =
    sameValue(identity.name, contact.name) &&
    sameValue(identity.company, cleanContactCompany(contact.company)) &&
    sameValue(identity.role, cleanContactRole(contact.role));
  const showAppData = contact.kind === "Guardado";

  return (
    <article className="merge-contact-card merge-source-card">
      <div className="merge-card-top">
        <span>{contact.kind}</span>
      </div>

      <button
        className={`merge-identity-block merge-source-identity ${identitySelected ? "selected" : ""}`}
        onClick={onPickIdentity}
        type="button"
      >
        <strong>{contact.name || "Nombre"}</strong>
        <IdentityMeta contact={contact} />
      </button>

      <SourceValueList
        isSelected={(email) => hasComparableValue(selectedEmails, email, sameEmail)}
        items={contact.emails}
        label="Correos"
        onToggle={onToggleEmail}
      />
      <SourceValueList
        isSelected={(phone) => hasComparableValue(selectedPhones, phone, samePhone)}
        items={contact.phones}
        label="Telefonos"
        onToggle={onTogglePhone}
      />

      {showAppData ? (
        <button
          className="merge-app-data-block merge-source-app-data"
          onClick={onPickAppData}
          type="button"
        >
          <div>
            <span>Foco</span>
            <strong>{contact.focus ? "Si" : "No"}</strong>
          </div>
          <div>
            <span>Headhunter</span>
            <strong>{contact.headhunter ? "Si" : "No"}</strong>
          </div>
          <div>
            <span>Estado</span>
            <StatusBadge status={contact.networkingStatus} />
          </div>
        </button>
      ) : null}
    </article>
  );
}

function SourceValueList({
  items,
  isSelected,
  label,
  onToggle
}: {
  isSelected: (value: string) => boolean;
  items: string[];
  label: string;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="merge-value-block">
      <div>
        {items.length ? (
          items.map((item) => (
            <button
              className={`merge-source-value ${isSelected(item) ? "selected" : ""}`}
              key={item}
              onClick={() => onToggle(item)}
              type="button"
            >
              {item}
            </button>
          ))
        ) : (
          <EmptyValue>{label === "Correos" ? "sin correos" : "sin telefonos"}</EmptyValue>
        )}
      </div>
    </div>
  );
}

function ResultChecklist({
  items,
  label,
  onChange,
  selected
}: {
  items: string[];
  label: string;
  onChange: (values: Set<string>) => void;
  selected: Set<string>;
}) {
  return (
    <div className="merge-value-block merge-result-checklist">
      <div>
        {items.length ? (
          items.map((item) => (
            <label key={item}>
              <input
                checked={selected.has(item)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(item);
                  else next.delete(item);
                  onChange(next);
                }}
                type="checkbox"
              />
              <strong>{item}</strong>
            </label>
          ))
        ) : (
          <EmptyValue>{label === "Correos" ? "sin correos" : "sin telefonos"}</EmptyValue>
        )}
      </div>
    </div>
  );
}

function MergeSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="contact-editor-toggle merge-toggle">
      <span>{label}</span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <i />
    </label>
  );
}

function IdentityMeta({ contact }: { contact: ContactMergeSource }) {
  const company = cleanContactCompany(contact.company);
  const role = cleanContactRole(contact.role);

  return (
    <span className="merge-identity-meta">
      {company || <EmptyValue>Sin empresa</EmptyValue>}
      <span aria-hidden="true">·</span>
      {role || <EmptyValue>Sin cargo</EmptyValue>}
    </span>
  );
}

function sameValue(left?: string | null, right?: string | null) {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

function toggleComparableSetValue(current: Set<string>, value: string, isSame: (left: string, right: string) => boolean) {
  const next = new Set(current);
  const existing = Array.from(next).find((item) => isSame(item, value));
  if (existing) next.delete(existing);
  else next.add(value);
  return next;
}

function hasComparableValue(values: Set<string>, value: string, isSame: (left: string, right: string) => boolean) {
  return Array.from(values).some((item) => isSame(item, value));
}

function preferredComparableValue(values: string[], value: string, isSame: (left: string, right: string) => boolean) {
  return values.find((item) => isSame(item, value)) ?? value;
}

function sameEmail(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function samePhone(left: string, right: string) {
  const leftIdentities = phoneIdentitiesFor(left);
  for (const identity of phoneIdentitiesFor(right)) {
    if (leftIdentities.has(identity)) return true;
  }
  return false;
}
