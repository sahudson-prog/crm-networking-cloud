"use client";

import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PublicSiteLinks } from "./PublicSiteLinks";
import { supabase, supabaseConfigError } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";
import { Button } from "./ui/Button";
import { ProviderIcon } from "./ui/ProviderIcon";
import {
  applyAccessRevalidationResult,
  resetAppAccessForLogout,
  resolveBootstrappedAppAccessForSession,
  shouldPreservePrivateUiDuringAccessRevalidation,
  type AppAccessGateState
} from "../lib/appAccess";
import {
  buildPasswordlessEmailCredentials,
  canSubmitPasswordlessEmail,
  captchaStatusMessage,
  TURNSTILE_SITE_KEY,
  type CaptchaStatus
} from "../lib/authCaptcha";
import { clearRememberedGoogleRequestedScopes, signInWithGoogleForAuth } from "../lib/googleAuthSession";
import { cleanLegacyImplicitAuthFragment, prepareAuthCallback } from "../lib/authCallback";
import {
  clearLegalAcceptanceIntent,
  hasCurrentLegalAcceptanceIntent,
  recordCurrentLegalAcceptance,
  rememberLegalAcceptanceIntent,
  resolveLegalAcceptanceForSession,
  type LegalAcceptanceGateState
} from "../lib/legalAcceptance";
import { LegalAcceptanceCheckbox } from "./LegalAcceptanceCheckbox";
import { LegalAcceptanceGate } from "./LegalAcceptanceGate";
import { TurnstileWidget } from "./TurnstileWidget";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [access, setAccess] = useState<AppAccessGateState>({ status: "checking" });
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>(TURNSTILE_SITE_KEY ? "pending" : "not_configured");
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);
  const [legalIntentChecked, setLegalIntentChecked] = useState(false);
  const [legalGateChecked, setLegalGateChecked] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState(false);
  const [legalAcceptance, setLegalAcceptance] = useState<LegalAcceptanceGateState>({ status: "checking" });
  const accessRequestId = useRef(0);
  const accessRef = useRef<AppAccessGateState>({ status: "checking" });
  const sessionRef = useRef<Session | null>(null);
  const legalAcceptanceRef = useRef<LegalAcceptanceGateState>({ status: "checking" });
  const legalUserIdRef = useRef("");

  function commitAccess(nextAccess: AppAccessGateState) {
    accessRef.current = nextAccess;
    setAccess(nextAccess);
  }

  function commitSession(nextSession: Session | null) {
    sessionRef.current = nextSession;
    setSession(nextSession);
  }

  function commitLegalAcceptance(nextAcceptance: LegalAcceptanceGateState) {
    legalAcceptanceRef.current = nextAcceptance;
    setLegalAcceptance(nextAcceptance);
  }

  useEffect(() => {
    const cleanUrl = cleanLegacyImplicitAuthFragment(window.location.href);
    if (cleanUrl) window.history.replaceState(window.history.state, "", cleanUrl);
    setLegalIntentChecked(hasCurrentLegalAcceptanceIntent(window.sessionStorage));

    if (!supabase) {
      setSessionLoading(false);
      commitAccess(resetAppAccessForLogout());
      return;
    }

    let active = true;

    async function resolveSessionAccess(currentSession: Session | null, event = "INITIAL_LOAD") {
      const requestId = accessRequestId.current + 1;
      accessRequestId.current = requestId;
      const preservePrivateUi = shouldPreservePrivateUiDuringAccessRevalidation({
        currentAccess: accessRef.current,
        event,
        nextSession: currentSession,
        previousSession: sessionRef.current
      });
      commitSession(currentSession);

      if (!currentSession || !supabase) {
        commitAccess(resetAppAccessForLogout());
        legalUserIdRef.current = "";
        commitLegalAcceptance({ status: "checking" });
        return;
      }

      if (!preservePrivateUi) commitAccess({ status: "checking" });
      try {
        const resolution = await resolveBootstrappedAppAccessForSession(currentSession, supabase);
        if (!active || requestId !== accessRequestId.current) return;
        const nextAccess = applyAccessRevalidationResult(accessRef.current, resolution, preservePrivateUi);
        commitAccess(nextAccess);
        if (preservePrivateUi && resolution.status === "error") {
          setMessage(resolution.message);
        }
        if (nextAccess.status !== "allowed") {
          legalUserIdRef.current = "";
          commitLegalAcceptance({ status: "checking" });
          return;
        }

        const preserveAcceptedLegalState = preservePrivateUi
          && legalAcceptanceRef.current.status === "accepted"
          && legalUserIdRef.current === currentSession.user.id;
        if (preserveAcceptedLegalState) return;

        commitLegalAcceptance({ status: "checking" });
        const nextLegalAcceptance = await resolveLegalAcceptanceForSession(supabase, window.sessionStorage);
        if (!active || requestId !== accessRequestId.current) return;
        legalUserIdRef.current = currentSession.user.id;
        commitLegalAcceptance(nextLegalAcceptance);
      } catch {
        if (!active || requestId !== accessRequestId.current) return;
        if (preservePrivateUi) {
          setMessage("No se pudo revalidar el acceso. La sesión vigente se mantiene activa.");
          return;
        }
        commitAccess({ status: "error", message: "No se pudo revisar el acceso." });
      }
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        void resolveSessionAccess(data.session);
      })
      .catch(() => {
        if (!active) return;
        setMessage("No se pudo revisar la sesion. Intenta recargar la pagina.");
        commitAccess({ status: "error", message: "No se pudo revisar la sesion." });
      })
      .finally(() => {
        if (!active) return;
        setSessionLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === "INITIAL_SESSION") return;
      setMessage("");
      void resolveSessionAccess(currentSession, event);
      setSessionLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (!legalIntentChecked) {
      setMessage("Debes aceptar los Términos y confirmar la lectura de la Política de Privacidad para continuar.");
      return;
    }
    if (!canSubmitPasswordlessEmail({
      captchaStatus,
      captchaToken,
      siteKey: TURNSTILE_SITE_KEY
    })) {
      setMessage(captchaStatusMessage(captchaStatus) || "Completa la verificación para continuar.");
      return;
    }

    setMessage("Enviando link de acceso...");
    const captchaTokenForAttempt = captchaToken;
    setCaptchaToken("");
    setCaptchaStatus("pending");

    try {
      const { error } = await supabase.auth.signInWithOtp(buildPasswordlessEmailCredentials({
        captchaToken: captchaTokenForAttempt,
        email,
        emailRedirectTo: prepareAuthCallback(window.location.origin)
      }));
      setMessage(error ? "No pudimos enviar el link. Intenta nuevamente." : "Listo. Revisa tu correo para entrar.");
    } catch {
      setMessage("No pudimos enviar el link. Intenta nuevamente.");
    } finally {
      setTurnstileResetKey((current) => current + 1);
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    if (!legalIntentChecked) {
      setMessage("Debes aceptar los Términos y confirmar la lectura de la Política de Privacidad para continuar.");
      return;
    }
    setSigningInWithGoogle(true);
    setMessage("Abriendo Google...");
    try {
      await signInWithGoogleForAuth(window.location.origin);
    } catch {
      setSigningInWithGoogle(false);
      setMessage("No pude iniciar sesión con Google. Intenta nuevamente o usa el acceso por email.");
    }
  }

  const handleCaptchaError = useCallback(() => {
    setCaptchaToken("");
    setCaptchaStatus("error");
    setMessage("No pudimos verificar la solicitud. Intenta nuevamente.");
  }, []);

  const handleCaptchaExpired = useCallback(() => {
    setCaptchaToken("");
    setCaptchaStatus("expired");
    setMessage("La verificación expiró. Intenta nuevamente.");
  }, []);

  const handleCaptchaResolved = useCallback((token: string) => {
    setCaptchaToken(token);
    setCaptchaStatus("resolved");
    setMessage("");
  }, []);

  async function signOut() {
    if (!supabase) return;
    clearRememberedGoogleRequestedScopes();
    clearLegalAcceptanceIntent(window.sessionStorage);
    setLegalIntentChecked(false);
    setLegalGateChecked(false);
    accessRequestId.current += 1;
    setSigningOut(true);
    setMessage("");
    commitAccess({ status: "checking" });

    const { error } = await supabase.auth.signOut();
    if (error) {
      commitAccess({ status: "error", message: "No pude cerrar sesión. Intenta nuevamente." });
      setSigningOut(false);
      return;
    }

    commitSession(null);
    commitAccess(resetAppAccessForLogout());
    legalUserIdRef.current = "";
    commitLegalAcceptance({ status: "checking" });
    setSigningOut(false);
  }

  function updateLegalIntent(checked: boolean) {
    setLegalIntentChecked(checked);
    rememberLegalAcceptanceIntent(window.sessionStorage, checked);
    if (checked) setMessage("");
  }

  async function acceptLegalContract() {
    if (!supabase || !legalGateChecked || acceptingLegal) return;
    setAcceptingLegal(true);
    const resolution = await recordCurrentLegalAcceptance(supabase);
    if (resolution.status === "accepted") {
      clearLegalAcceptanceIntent(window.sessionStorage);
      commitLegalAcceptance(resolution);
      setLegalGateChecked(false);
    } else {
      commitLegalAcceptance(resolution.status === "required"
        ? { status: "error", message: "No se pudo registrar la aceptación legal." }
        : resolution);
    }
    setAcceptingLegal(false);
  }

  async function retryAccessCheck() {
    if (!supabase || !session) return;
    const requestId = accessRequestId.current + 1;
    accessRequestId.current = requestId;
    commitAccess({ status: "checking" });
    try {
      const resolution = await resolveBootstrappedAppAccessForSession(session, supabase);
      if (requestId !== accessRequestId.current) return;
      commitAccess(resolution);
      if (resolution.status === "allowed") {
        commitLegalAcceptance({ status: "checking" });
        const nextLegalAcceptance = await resolveLegalAcceptanceForSession(supabase, window.sessionStorage);
        if (requestId !== accessRequestId.current) return;
        legalUserIdRef.current = session.user.id;
        commitLegalAcceptance(nextLegalAcceptance);
      }
    } catch {
      if (requestId !== accessRequestId.current) return;
      commitAccess({ status: "error", message: "No se pudo revisar el acceso." });
    }
  }

  if (
    sessionLoading
    || signingOut
    || (session && access.status === "checking")
    || (session && access.status === "allowed" && legalAcceptance.status === "checking")
  ) {
    return <main className="app-shell">Cargando...</main>;
  }

  if (!session) {
    return (
      <main className="auth-landing">
        <div aria-hidden="true" className="auth-landing-background" />
        <section aria-labelledby="auth-landing-title" className="auth-landing-content">
          <div aria-label="Coffeecito" className="auth-brand-lockup">
            <img aria-hidden="true" src="/brand/coffeecito-isotipo.svg" />
            <span className="auth-brand-wordmark">Coffeecito</span>
          </div>
          <div className="auth-landing-copy">
            <h1 id="auth-landing-title">Networking simple, estructurado y orientado a resultados.</h1>
            <p>
              Coffeecito te ayuda a organizar tus contactos, dar seguimiento a tus relaciones y avanzar hacia tus
              objetivos profesionales.
            </p>
          </div>
          <div className="auth-entry-panel">
            {supabaseConfigError ? (
              <div className="banner auth-config-banner">
                <strong>Falta conectar Supabase.</strong>
                <br />
                Crea el archivo <code>.env.local</code> con la URL del proyecto y la anon key publica. Despues reinicia
                esta app web.
              </div>
            ) : null}
            {!supabaseConfigError ? (
              <div className="auth-entry-actions">
                <LegalAcceptanceCheckbox
                  checked={legalIntentChecked}
                  id="pre-auth-legal-acceptance"
                  onChange={updateLegalIntent}
                />
                <button
                  className="button primary auth-google-button"
                  disabled={signingInWithGoogle || !legalIntentChecked}
                  onClick={signInWithGoogle}
                  type="button"
                >
                  <ProviderIcon name="google" />
                  <span>{signingInWithGoogle ? "Abriendo Google..." : "Continuar con Google"}</span>
                </button>
                {message ? <span className="meta auth-entry-message">{message}</span> : null}
                {legalIntentChecked ? (
                  <details className="auth-email-fallback">
                    <summary>Continuar con email</summary>
                    <form onSubmit={signIn} className="grid" style={{ marginTop: 12 }}>
                      <input
                        className="search"
                        type="email"
                        required
                        placeholder="tu correo"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                      {TURNSTILE_SITE_KEY ? (
                        <TurnstileWidget
                          key={turnstileResetKey}
                          onError={handleCaptchaError}
                          onExpired={handleCaptchaExpired}
                          onResolved={handleCaptchaResolved}
                          siteKey={TURNSTILE_SITE_KEY}
                        />
                      ) : (
                        <span className="auth-captcha-message">{captchaStatusMessage("not_configured")}</span>
                      )}
                      <button
                        className="button secondary"
                        disabled={!canSubmitPasswordlessEmail({
                          captchaStatus,
                          captchaToken,
                          siteKey: TURNSTILE_SITE_KEY
                        })}
                        type="submit"
                      >
                        Enviar link de acceso
                      </button>
                      {TURNSTILE_SITE_KEY && captchaStatus !== "resolved" ? (
                        <span className="auth-captcha-message">{captchaStatusMessage(captchaStatus)}</span>
                      ) : null}
                    </form>
                  </details>
                ) : (
                  <div className="auth-email-fallback">
                    <button aria-disabled="true" className="auth-email-fallback-disabled" disabled type="button">
                      Continuar con email
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <PublicSiteLinks />
        </section>
      </main>
    );
  }

  if (access.status === "denied") {
    return (
      <main className="app-shell">
        <section className="panel" style={{ maxWidth: 520, margin: "64px auto" }}>
          <p className="panel-caption">Coffeecito</p>
          <h1 className="brand-title">No pudimos confirmar tu acceso</h1>
          <p className="brand-subtitle" style={{ marginTop: 8 }}>
            Puedes volver a intentarlo.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <Button icon="sync" onClick={retryAccessCheck}>Reintentar</Button>
            <Button icon="close" onClick={signOut}>
              Cerrar sesión
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (access.status === "error") {
    return (
      <main className="app-shell">
        <section className="panel" style={{ maxWidth: 520, margin: "64px auto" }}>
          <p className="panel-caption">Coffeecito</p>
          <h1 className="brand-title">No pude revisar el acceso</h1>
          <p className="brand-subtitle" style={{ marginTop: 8 }}>
            {access.message || "Hubo un problema técnico al revisar si esta cuenta puede entrar. Intenta nuevamente o cierra sesión."}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <Button icon="sync" onClick={retryAccessCheck}>
              Reintentar
            </Button>
            <Button icon="close" onClick={signOut} tone="ghost">
              Cerrar sesión
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (legalAcceptance.status !== "accepted") {
    return (
      <LegalAcceptanceGate
        accepting={acceptingLegal}
        checked={legalGateChecked}
        error={legalAcceptance.status === "error" ? legalAcceptance.message : undefined}
        onAccept={() => void acceptLegalContract()}
        onCheckedChange={setLegalGateChecked}
        onSignOut={() => void signOut()}
      />
    );
  }

  return <>{isValidElement<{ onSignOut?: () => void }>(children) ? cloneElement(children, { onSignOut: signOut }) : children}</>;
}
