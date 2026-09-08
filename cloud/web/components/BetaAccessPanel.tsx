"use client";

import { useEffect, useMemo, useState } from "react";
import {
  authorizeBetaAccessEmail,
  betaAllowlistLabel,
  betaEffectiveAccessLabel,
  betaRegistrationLabel,
  loadBetaAccessAllowlist,
  normalizeAdminEmailInput,
  revokeBetaAccessEmail,
  type BetaAccessRow
} from "../lib/betaAccessAdminActions";
import { Button } from "./ui/Button";

export function BetaAccessPanel() {
  const [rows, setRows] = useState<BetaAccessRow[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  const normalizedEmail = useMemo(() => normalizeAdminEmailInput(email), [email]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await loadBetaAccessAllowlist());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pude cargar acceso beta.");
    } finally {
      setLoading(false);
    }
  }

  async function authorize() {
    if (!normalizedEmail) return;
    setSavingEmail(normalizedEmail);
    setMessage("");
    setError("");
    try {
      await authorizeBetaAccessEmail(normalizedEmail, note);
      setEmail("");
      setNote("");
      setMessage("Email autorizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude autorizar el email.");
    } finally {
      setSavingEmail("");
    }
  }

  async function revoke(row: BetaAccessRow) {
    if (row.registered) {
      const confirmed = window.confirm(
        `Revocar el acceso de ${row.email}? La persona no podra entrar, pero sus datos no se borraran.`
      );
      if (!confirmed) return;
    }

    setSavingEmail(row.email);
    setMessage("");
    setError("");
    try {
      await revokeBetaAccessEmail(row.email);
      setMessage("Acceso revocado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude revocar el acceso.");
    } finally {
      setSavingEmail("");
    }
  }

  async function reauthorize(row: BetaAccessRow) {
    setSavingEmail(row.email);
    setMessage("");
    setError("");
    try {
      await authorizeBetaAccessEmail(row.email, row.note);
      setMessage("Email reautorizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No pude reautorizar el email.");
    } finally {
      setSavingEmail("");
    }
  }

  return (
    <section className="maintenance-service-group beta-access-panel">
      <div className="maintenance-service-header">
        <h3>Acceso beta</h3>
        <span>{loading ? "cargando" : `${rows.length} email(s)`}</span>
      </div>

      <p className="meta">
        Autoriza emails para entrar a Coffeecito y revisa si una cuenta registrada tiene acceso efectivo.
      </p>

      <div className="beta-access-form">
        <label className="field">
          <span>Email</span>
          <input
            placeholder="usuario@empresa.com"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Nota admin</span>
          <input
            placeholder="opcional"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button disabled={!normalizedEmail || Boolean(savingEmail)} icon="check" onClick={authorize} tone="primary">
          {savingEmail === normalizedEmail ? "Autorizando..." : "Autorizar"}
        </Button>
      </div>

      {message ? <p className="meta">{message}</p> : null}
      {error ? <p className="form-error">{friendlyBetaAccessError(error)}</p> : null}

      <div className="beta-access-list">
        {loading ? <span className="empty">Cargando acceso beta...</span> : null}
        {!loading && !rows.length ? <span className="empty">Aun no hay emails autorizados.</span> : null}
        {rows.map((row) => (
          <details className="beta-access-row" key={row.email}>
            <summary>
              <div className="beta-access-main">
                <strong>{row.email}</strong>
                <span>{betaEffectiveAccessLabel(row)}</span>
              </div>
              <span className={`beta-access-pill ${row.allowlistStatus}`}>
                {betaAllowlistLabel(row.allowlistStatus)}
              </span>
              <span className="beta-access-pill neutral">Registrado: {betaRegistrationLabel(row)}</span>
              <div className="beta-access-actions">
                {row.allowlistStatus === "revoked" ? (
                  <Button
                    disabled={savingEmail === row.email}
                    icon="check"
                    onClick={(event) => {
                      event.preventDefault();
                      void reauthorize(row);
                    }}
                  >
                    Reautorizar
                  </Button>
                ) : (
                  <Button
                    disabled={savingEmail === row.email}
                    icon="close"
                    onClick={(event) => {
                      event.preventDefault();
                      void revoke(row);
                    }}
                    tone="danger"
                  >
                    Revocar
                  </Button>
                )}
              </div>
            </summary>

            <div className="beta-access-detail">
              <AccessDetail label="Autorizado" value={formatDate(row.authorizedAt)} />
              <AccessDetail label="Revocado" value={formatDate(row.revokedAt)} />
              <AccessDetail label="Usuario" value={row.userId || "sin usuario registrado"} />
              <AccessDetail label="Proveedor login" value={row.authProvider || "sin dato"} />
              <AccessDetail label="Cuenta" value={row.accountStatus || "sin perfil"} />
              <AccessDetail label="Beta" value={row.betaAccessStatus || "sin perfil"} />
              <AccessDetail label="Plan" value={row.planCode || "sin plan"} />
              <AccessDetail label="Roles" value={row.roles.length ? row.roles.join(", ") : "sin roles"} />
              <AccessDetail
                label="Capacidades"
                value={row.capabilities.length ? row.capabilities.join(", ") : "sin capacidades efectivas"}
              />
              <AccessDetail label="Nota" value={row.note || "sin nota"} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function AccessDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "sin dato";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function friendlyBetaAccessError(message: string) {
  if (message.includes("admin.manage_access")) return "Tu usuario no tiene permiso para administrar acceso beta.";
  if (message.includes("invalid email")) return "Revisa el formato del email.";
  if (message.includes("cannot revoke own app access")) {
    return "No puedes revocar tu propio acceso desde Coffeecito. Usa otro administrador para hacerlo.";
  }
  return message;
}
