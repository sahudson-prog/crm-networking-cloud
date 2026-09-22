"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type AuthCallbackDiagnostic,
  type AuthCallbackExchangeResult,
  clearAuthCallbackReturnTo,
  consumeAuthCallbackReturnTo,
  createSingleAuthCallbackCompletion,
  prepareAuthCallbackExchange
} from "../../../lib/authCallback";
import { clearPendingGoogleDataConnection } from "../../../lib/googleAuthSession";
import { supabase, supabaseProjectHost } from "../../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const completionRef = useRef<(
    () => Promise<AuthCallbackExchangeResult & { returnTo: string }>
  ) | null>(null);
  const [failed, setFailed] = useState(false);
  const [diagnostic, setDiagnostic] = useState<AuthCallbackDiagnostic | null>(null);

  useEffect(() => {
    let active = true;

    async function completeCallback() {
      const returnTo = consumeAuthCallbackReturnTo(window.location.origin);
      const exchange = prepareAuthCallbackExchange(window.location.href, supabase?.auth ?? null);
      window.history.replaceState(window.history.state, "", exchange.cleanedUrl);
      const result = await exchange.completion;
      if (!result.completed) {
        clearPendingGoogleDataConnection();
        clearAuthCallbackReturnTo();
      }
      return { ...result, returnTo };
    }

    completionRef.current ??= createSingleAuthCallbackCompletion(completeCallback);
    void completionRef.current().then((result) => {
      if (!active) return;
      if (result.completed) {
        router.replace(result.returnTo);
        return;
      }
      reportSafeAuthCallbackFailure(result.diagnostic);
      setDiagnostic(result.diagnostic);
      setFailed(true);
    }).catch(() => {
      clearPendingGoogleDataConnection();
      clearAuthCallbackReturnTo();
      if (active) {
        const unexpectedDiagnostic: AuthCallbackDiagnostic = { category: "exchange_exception" };
        reportSafeAuthCallbackFailure(unexpectedDiagnostic);
        setDiagnostic(unexpectedDiagnostic);
        setFailed(true);
      }
    });

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="app-shell">
      <section className="panel" style={{ margin: "64px auto", maxWidth: 520 }}>
        <p className="panel-caption">Coffeecito</p>
        <h1 className="brand-title">{failed ? "No pudimos completar el acceso" : "Completando acceso..."}</h1>
        <p className="brand-subtitle" style={{ marginTop: 8 }}>
          {failed
            ? "El enlace de acceso no es válido o ya expiró. Vuelve a iniciar sesión."
            : "Estamos verificando tu sesión de forma segura."}
        </p>
        {failed && diagnostic ? (
          <p className="meta" style={{ marginTop: 8 }}>
            Diagnóstico: {formatDiagnostic(diagnostic)}
          </p>
        ) : null}
        {failed ? (
          <a className="button secondary" href="/" style={{ marginTop: 18 }}>
            Volver al inicio
          </a>
        ) : null}
      </section>
    </main>
  );
}

function formatDiagnostic(diagnostic: AuthCallbackDiagnostic) {
  return [diagnostic.category, diagnostic.code, diagnostic.name, diagnostic.status]
    .filter((value) => value !== undefined)
    .join(" · ");
}

function reportSafeAuthCallbackFailure(diagnostic: AuthCallbackDiagnostic) {
  console.warn("Coffeecito auth callback failed", {
    callbackOrigin: window.location.origin,
    category: diagnostic.category,
    code: diagnostic.code,
    name: diagnostic.name,
    status: diagnostic.status,
    supabaseHost: supabaseProjectHost
  });
}
