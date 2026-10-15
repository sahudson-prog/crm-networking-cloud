"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readContactRequests, updateContactRequest } from "../lib/contactRequestAdmin";
import {
  CONTACT_REQUEST_IDENTITY_STATUSES,
  CONTACT_REQUEST_IDENTITY_STATUS_LABELS,
  CONTACT_REQUEST_PRIVACY_SUBREASON_LABELS,
  CONTACT_REQUEST_REASON_LABELS,
  CONTACT_REQUEST_STATUSES,
  CONTACT_REQUEST_STATUS_LABELS,
  type ContactRequestIdentityStatus,
  type ContactRequestRow,
  type ContactRequestStatus
} from "../lib/contactRequests";
import { Button } from "./ui/Button";

export function ContactRequestsAdminPage() {
  const [requests, setRequests] = useState<ContactRequestRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<ContactRequestStatus>("received");
  const [identityStatus, setIdentityStatus] = useState<ContactRequestIdentityStatus>("not_required");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const selected = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? requests[0] ?? null,
    [requests, selectedId]
  );

  useEffect(() => {
    let active = true;
    readContactRequests()
      .then((rows) => {
        if (!active) return;
        setRequests(rows);
        setSelectedId(rows[0]?.id ?? "");
        setError("");
      })
      .catch(() => {
        if (active) setError("No pudimos cargar las solicitudes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setStatus(selected.status);
    setIdentityStatus(selected.identity_verification_status);
    setFeedback("");
  }, [selected]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const updated = await updateContactRequest({
        id: selected.id,
        identityVerificationStatus: selected.reason === "privacy" ? identityStatus : "not_required",
        status
      });
      setRequests((current) => current.map((request) => request.id === updated.id ? updated : request));
      setFeedback("Solicitud actualizada.");
    } catch {
      setError("No pudimos actualizar la solicitud.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel contact-requests-admin">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Solicitudes de contacto</h2>
          <span className="panel-caption">Consultas, soporte y privacidad</span>
        </div>
        <Link className="button secondary" href="/sistema">Volver a Sistema</Link>
      </div>

      {loading ? <span className="empty">Cargando solicitudes...</span> : null}
      {!loading && !requests.length && !error ? <span className="empty">Aún no hay solicitudes.</span> : null}

      {requests.length ? (
        <div className="contact-requests-layout">
          <div className="contact-requests-list" role="list" aria-label="Solicitudes">
            {requests.map((request) => (
              <button
                aria-pressed={request.id === selected?.id}
                className={`contact-request-list-item ${request.id === selected?.id ? "active" : ""}`}
                key={request.id}
                onClick={() => setSelectedId(request.id)}
                type="button"
              >
                <strong>{request.requester_name || request.requester_email}</strong>
                <span>{CONTACT_REQUEST_REASON_LABELS[request.reason]}</span>
                <small>{formatDate(request.created_at)} · {CONTACT_REQUEST_STATUS_LABELS[request.status]}</small>
              </button>
            ))}
          </div>

          {selected ? (
            <article className="contact-request-detail">
              <header>
                <div>
                  <h3>{selected.requester_name || "Sin nombre"}</h3>
                  <a href={`mailto:${selected.requester_email}`}>{selected.requester_email}</a>
                </div>
                <span>{formatDate(selected.created_at)}</span>
              </header>

              <dl className="contact-request-facts">
                <div><dt>Motivo</dt><dd>{CONTACT_REQUEST_REASON_LABELS[selected.reason]}</dd></div>
                {selected.privacy_subreason ? (
                  <div><dt>Solicitud</dt><dd>{CONTACT_REQUEST_PRIVACY_SUBREASON_LABELS[selected.privacy_subreason]}</dd></div>
                ) : null}
                <div><dt>Cuenta asociada</dt><dd>{selected.user_id ? "Sí" : "No"}</dd></div>
              </dl>

              <div className="contact-request-message">
                <strong>Mensaje</strong>
                <p>{selected.message}</p>
              </div>

              <div className="field-row contact-request-admin-fields">
                <label className="field">
                  <span>Estado</span>
                  <select value={status} onChange={(event) => setStatus(event.target.value as ContactRequestStatus)}>
                    {CONTACT_REQUEST_STATUSES.map((value) => (
                      <option key={value} value={value}>{CONTACT_REQUEST_STATUS_LABELS[value]}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Verificación de identidad</span>
                  <select
                    disabled={selected.reason !== "privacy"}
                    value={selected.reason === "privacy" ? identityStatus : "not_required"}
                    onChange={(event) => setIdentityStatus(event.target.value as ContactRequestIdentityStatus)}
                  >
                    {CONTACT_REQUEST_IDENTITY_STATUSES
                      .filter((value) => selected.reason === "privacy" ? value !== "not_required" : value === "not_required")
                      .map((value) => (
                        <option key={value} value={value}>{CONTACT_REQUEST_IDENTITY_STATUS_LABELS[value]}</option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="toolbar contact-request-admin-actions">
                <Button disabled={saving} icon="check" onClick={save} tone="primary">
                  {saving ? "Guardando..." : "Guardar estados"}
                </Button>
              </div>
            </article>
          ) : null}
        </div>
      ) : null}

      {feedback ? <p className="form-success">{feedback}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
