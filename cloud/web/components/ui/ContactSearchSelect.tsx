"use client";

import { useEffect, useMemo, useState } from "react";
import { formatContactCompanyRole, joinCompact } from "../../lib/format";
import type { ContactRow } from "../../lib/readModel";

type ContactSearchSelectProps = {
  contacts: ContactRow[];
  disabled?: boolean;
  emptyOption?: { title: string; caption: string } | null;
  onChange: (contactId: string) => void;
  placeholder?: string;
  value: string;
};

const MAX_VISIBLE_OPTIONS = 8;

export function ContactSearchSelect({
  contacts,
  disabled = false,
  emptyOption = { title: "Sin vinculo", caption: "Guardar solo el referido" },
  onChange,
  placeholder = "Buscar contacto",
  value
}: ContactSearchSelectProps) {
  const selected = useMemo(() => contacts.find((contact) => contact.id === value) ?? null, [contacts, value]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected ? contactOptionLabel(selected) : "");
  }, [selected]);

  const filtered = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery || selected?.id === value) return contacts.slice(0, MAX_VISIBLE_OPTIONS);
    return contacts
      .filter((contact) => contactSearchText(contact).includes(cleanQuery))
      .slice(0, MAX_VISIBLE_OPTIONS);
  }, [contacts, query, selected?.id, value]);

  function selectContact(contactId: string) {
    onChange(contactId);
    setOpen(false);
  }

  return (
    <div className="contact-search-select">
      <input
        disabled={disabled}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value.trim()) onChange("");
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        value={query}
      />
      {open && !disabled ? (
        <div className="contact-search-options">
          {emptyOption ? (
            <button className="contact-search-option" onMouseDown={() => selectContact("")} type="button">
              <strong>{emptyOption.title}</strong>
              <span>{emptyOption.caption}</span>
            </button>
          ) : null}
          {filtered.map((contact) => (
            <button
              className={`contact-search-option ${contact.id === value ? "selected" : ""}`}
              key={contact.id}
              onMouseDown={() => selectContact(contact.id)}
              type="button"
            >
              <strong>{contact.display_name || "Contacto sin nombre"}</strong>
              <span>{formatContactCompanyRole(contact.company, contact.role)}</span>
            </button>
          ))}
          {!filtered.length ? <span className="contact-search-empty">Sin coincidencias.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function contactSearchText(contact: ContactRow) {
  return [
    contact.display_name,
    contact.company,
    contact.role,
    ...(contact.contact_emails ?? []).map((item) => item.email),
    ...(contact.contact_phones ?? []).map((item) => item.phone)
  ]
    .join(" ")
    .toLowerCase();
}

function contactOptionLabel(contact: ContactRow) {
  const methods = joinCompact([
    (contact.contact_emails ?? [])[0]?.email,
    (contact.contact_phones ?? [])[0]?.phone
  ], "");
  const suffix = joinCompact([formatContactCompanyRole(contact.company, contact.role), methods], "");
  return suffix ? `${contact.display_name || "Contacto sin nombre"} - ${suffix}` : contact.display_name || "Contacto sin nombre";
}
