"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearAuthCallbackReturnTo,
  consumeAuthCallbackReturnTo,
  createSingleAuthCallbackCompletion,
  prepareAuthCallbackExchange
} from "../../../lib/authCallback";
import { clearPendingActivitySyncAuthorization } from "../../../lib/activitySyncAuthorization";
import { clearPendingGoogleDataAction } from "../../../lib/googleDataAuthorizationIntent";
import {
  clearPendingGoogleDataConnection,
  clearRememberedGoogleRequestedScopes,
  googleDataConnectionReturnPrincipalStatus,
  isGoogleDataConnectionCallback
} from "../../../lib/googleAuthSession";
import { GOOGLE_DATA_PRINCIPAL_MISMATCH_MESSAGE } from "../../../lib/googleDataSessionGuard";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const completionRef = useRef<(() => Promise<{
    completed: boolean;
    failureMessage: string;
    returnTo: string;
  }>) | null>(null);
  const [failureMessage, setFailureMessage] = useState("");

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
        return { completed: false, failureMessage: "", returnTo };
      }

      if (supabase && isGoogleDataConnectionCallback(returnTo)) {
        let principalStatus: ReturnType<typeof googleDataConnectionReturnPrincipalStatus> = "mismatch";
        try {
          const { data, error } = await supabase.auth.getSession();
          if (!error) {
            principalStatus = googleDataConnectionReturnPrincipalStatus(returnTo, {
              email: data.session?.user.email ?? "",
              userId: data.session?.user.id ?? ""
            });
          }
        } catch {
          principalStatus = "mismatch";
        }
        if (principalStatus !== "match") {
          clearRememberedGoogleRequestedScopes();
          clearPendingGoogleDataAction();
          clearPendingActivitySyncAuthorization();
          clearAuthCallbackReturnTo();
          await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
          return {
            completed: false,
            failureMessage: GOOGLE_DATA_PRINCIPAL_MISMATCH_MESSAGE,
            returnTo: "/"
          };
        }
      }

      return { completed: true, failureMessage: "", returnTo };
    }

    completionRef.current ??= createSingleAuthCallbackCompletion(completeCallback);
    void completionRef.current().then(({ completed, failureMessage: nextFailureMessage, returnTo }) => {
      if (!active) return;
      if (completed) router.replace(returnTo);
      else setFailureMessage(nextFailureMessage || "No pudimos confirmar tu acceso. Puedes volver a intentarlo.");
    }).catch(() => {
      clearPendingGoogleDataConnection();
      clearAuthCallbackReturnTo();
      if (active) setFailureMessage("No pudimos confirmar tu acceso. Puedes volver a intentarlo.");
    });

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="app-shell">
      <section className="panel" style={{ margin: "64px auto", maxWidth: 520 }}>
        <p className="panel-caption">Coffeecito</p>
        <h1 className="brand-title">{failureMessage ? "No pudimos completar el acceso" : "Completando acceso..."}</h1>
        <p className="brand-subtitle" style={{ marginTop: 8 }}>
          {failureMessage
            ? failureMessage
            : "Estamos verificando tu sesión de forma segura."}
        </p>
        {failureMessage ? (
          <a className="button secondary" href="/" style={{ marginTop: 18 }}>
            Volver al inicio
          </a>
        ) : null}
      </section>
    </main>
  );
}
