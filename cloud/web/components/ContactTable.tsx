"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatContactCompanyRole, joinCompact } from "../lib/format";
import type { ContactRow } from "../lib/readModel";
import { StatusBadge } from "./StatusBadge";

export function ContactTable({ contacts }: { contacts: ContactRow[] }) {
  const [query, setQuery] = useState("");
  const [focusOnly, setFocusOnly] = useState(true);

  const filtered = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (focusOnly && !contact.networking_focus) return false;
      if (!cleanQuery) return true;
      const haystack = [
        contact.display_name,
        contact.company,
        contact.role,
        ...(contact.contact_emails ?? []).map((item) => item.email),
        ...(contact.contact_phones ?? []).map((item) => item.phone)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(cleanQuery);
    });
  }, [contacts, focusOnly, query]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Contactos</h2>
          <span className="panel-caption">{filtered.length} visibles de {contacts.length} cargados</span>
        </div>
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar contacto, empresa, correo o telefono"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className={`button ${focusOnly ? "primary" : ""}`} onClick={() => setFocusOnly(!focusOnly)} type="button">
            En foco
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Telefono</th>
              <th>Empresa / cargo</th>
              <th>Estado</th>
              <th>HH</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => (
              <tr key={contact.id}>
                <td>
                  <Link className="table-link" href={`/contactos?contactId=${encodeURIComponent(contact.id)}`}>
                    <strong>{contact.display_name || "sin nombre"}</strong>
                  </Link>
                </td>
                <td>{joinCompact((contact.contact_emails ?? []).map((item) => item.email))}</td>
                <td>{joinCompact((contact.contact_phones ?? []).map((item) => item.phone))}</td>
                <td>{formatContactCompanyRole(contact.company, contact.role)}</td>
                <td><StatusBadge status={contact.networking_status} /></td>
                <td>{contact.is_headhunter ? "Si" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
