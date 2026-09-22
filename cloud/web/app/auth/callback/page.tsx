"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearAuthCallbackReturnTo,
  consumeAuthCallbackReturnTo,
  createSingleAuthCallbackCompletion,
  prepareAuthCallbackExchange
} from "../../../lib/authCallback";
import { clearPendingGoogleDataConnection } from "../../../lib/googleAuthSession";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const completionRef = useRef<(() => Promise<{ completed: boolean; returnTo: string }>) | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function completeCallback() {
      const returnTo = consumeAuthCallbackReturnTo(window.location.origin);
      const exchange = prepareAuthCallbackExchange(window.location.href, supabase?.auth ?? null);
      window.history.replaceState(window.history.state, "", exchange.cleanedUrl);
      const completed = await exchange.completion;
      if (!completed) {
        clearPendingGoogleDataConnection();
        clearAuthCallbackReturnTo();
      }
      return { completed, returnTo };
    }

    completionRef.current ??= createSingleAuthCallbackCompletion(completeCallback);
    void completionRef.current().then(({ completed, returnTo }) => {
      if (!active) return;
      if (completed) router.replace(returnTo);
      else setFailed(true);
    }).catch(() => {
      clearPendingGoogleDataConnection();
      clearAuthCallbackReturnTo();
      if (active) setFailed(true);
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
        {failed ? (
          <a className="button secondary" href="/" style={{ marginTop: 18 }}>
            Volver al inicio
          </a>
        ) : null}
      </section>
    </main>
  );
}
