"use client";

import Link from "next/link";
import { FormEvent, useCallback, useState } from "react";
import { TURNSTILE_SITE_KEY, type CaptchaStatus } from "../lib/authCaptcha";
import {
  CONTACT_REQUEST_PRIVACY_SUBREASON_LABELS,
  CONTACT_REQUEST_REASON_LABELS,
  validateContactRequestInput,
  type ContactRequestPrivacySubreason,
  type ContactRequestReason
} from "../lib/contactRequests";
import { supabase } from "../lib/supabaseClient";
import { TurnstileWidget } from "./TurnstileWidget";
import { PublicSiteLinks } from "./PublicSiteLinks";
import { Button } from "./ui/Button";

export function PublicContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<ContactRequestReason | "">("");
  const [privacySubreason, setPrivacySubreason] = useState<ContactRequestPrivacySubreason | "">("");
  const [message, setMessage] = useState("");
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>(TURNSTILE_SITE_KEY ? "pending" : "not_configured");
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const resolveCaptcha = useCallback((token: string) => {
    setCaptchaToken(token);
    setCaptchaStatus("resolved");
  }, []);
  const expireCaptcha = useCallback(() => {
    setCaptchaToken("");
    setCaptchaStatus("expired");
  }, []);
  const failCaptcha = useCallback(() => {
    setCaptchaToken("");
    setCaptchaStatus("error");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const validation = validateContactRequestInput({ email, message, name, privacySubreason, reason });
    if (!validation.ok) {
      setFeedback({ text: validation.message, tone: "error" });
      return;
    }
    if (!TURNSTILE_SITE_KEY || captchaStatus !== "resolved" || !captchaToken) {
      setFeedback({
        text: TURNSTILE_SITE_KEY
          ? "Completa la verificación para continuar."
          : "El formulario no está disponible en este entorno.",
        tone: "error"
      });
      return;
    }

    setSubmitting(true);
    try {
      const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token ?? "";
      const response = await fetch("/api/contact-requests", {
        body: JSON.stringify({ ...validation.value, turnstileToken: captchaToken }),
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        method: "POST"
      });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message || "No pudimos enviar la solicitud.");

      setName("");
      setEmail("");
      setReason("");
      setPrivacySubreason("");
      setMessage("");
      setFeedback({ text: "Recibimos tu mensaje. Lo revisaremos a la brevedad.", tone: "success" });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "No pudimos enviar la solicitud.",
        tone: "error"
      });
    } finally {
      setSubmitting(false);
      setCaptchaToken("");
      setCaptchaStatus(TURNSTILE_SITE_KEY ? "pending" : "not_configured");
      setTurnstileResetKey((current) => current + 1);
    }
  }

  return (
    <main className="public-contact-page">
      <div className="public-contact-shell">
        <Link aria-label="Coffeecito" className="public-contact-brand" href="/">
          <img alt="" aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
          <span>Coffeecito</span>
        </Link>

        <section className="public-contact-intro">
          <p className="public-contact-kicker">Contacto</p>
          <h1>¿En qué podemos ayudarte?</h1>
          <p>Envíanos tu consulta, un problema o una solicitud relacionada con tus datos personales.</p>
        </section>

        <form className="public-contact-form" onSubmit={submit}>
          <label className="field">
            <span>Nombre (opcional)</span>
            <input autoComplete="name" maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
          </label>
          <label className="field">
            <span>Email</span>
            <input autoComplete="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="field">
            <span>Motivo</span>
            <select
              onChange={(event) => {
                const nextReason = event.target.value as ContactRequestReason | "";
                setReason(nextReason);
                if (nextReason !== "privacy") setPrivacySubreason("");
              }}
              required
              value={reason}
            >
              <option value="">Selecciona un motivo</option>
              {Object.entries(CONTACT_REQUEST_REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {reason === "privacy" ? (
            <label className="field">
              <span>Solicitud de privacidad (opcional)</span>
              <select onChange={(event) => setPrivacySubreason(event.target.value as ContactRequestPrivacySubreason | "")} value={privacySubreason}>
                <option value="">Selecciona un submotivo</option>
                {Object.entries(CONTACT_REQUEST_PRIVACY_SUBREASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field public-contact-message-field">
            <span>Mensaje</span>
            <textarea maxLength={5000} onChange={(event) => setMessage(event.target.value)} required rows={7} value={message} />
          </label>

          <p className="public-contact-warning">No incluyas contraseñas, tokens, códigos de acceso ni otros secretos.</p>

          {TURNSTILE_SITE_KEY ? (
            <TurnstileWidget
              className="public-contact-turnstile"
              key={turnstileResetKey}
              onError={failCaptcha}
              onExpired={expireCaptcha}
              onResolved={resolveCaptcha}
              siteKey={TURNSTILE_SITE_KEY}
            />
          ) : (
            <p className="form-error">El formulario no está disponible en este entorno.</p>
          )}

          {feedback ? <p className={feedback.tone === "error" ? "form-error" : "form-success"}>{feedback.text}</p> : null}

          <div className="public-contact-actions">
            <Link className="button secondary" href="/">Volver</Link>
            <Button disabled={submitting || captchaStatus !== "resolved"} icon="mail" tone="primary" type="submit">
              {submitting ? "Enviando..." : "Enviar solicitud"}
            </Button>
          </div>
        </form>
        <PublicSiteLinks />
      </div>
    </main>
  );
}
