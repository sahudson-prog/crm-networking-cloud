"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          callback: (token: string) => void;
          "error-callback": () => void;
          "expired-callback": () => void;
          sitekey: string;
        }
      ) => string;
      remove?: (widgetId: string) => void;
      reset?: (widgetId: string) => void;
    };
  }
}

export function TurnstileWidget({
  className = "auth-turnstile",
  onError,
  onExpired,
  onResolved,
  siteKey
}: {
  className?: string;
  onError: () => void;
  onExpired: () => void;
  onResolved: (token: string) => void;
  siteKey: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef("");

  useEffect(() => {
    let active = true;
    const scriptId = "cloudflare-turnstile-script";

    function renderTurnstile() {
      if (!active || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        callback: onResolved,
        "error-callback": onError,
        "expired-callback": onExpired,
        sitekey: siteKey
      });
    }

    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      if (window.turnstile) renderTurnstile();
      else existingScript.addEventListener("load", renderTurnstile);

      return () => {
        active = false;
        existingScript.removeEventListener("load", renderTurnstile);
        if (widgetIdRef.current && window.turnstile?.remove) window.turnstile.remove(widgetIdRef.current);
      };
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.id = scriptId;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.addEventListener("load", renderTurnstile);
    script.addEventListener("error", onError);
    document.body.appendChild(script);

    return () => {
      active = false;
      script.removeEventListener("load", renderTurnstile);
      script.removeEventListener("error", onError);
      if (widgetIdRef.current && window.turnstile?.remove) window.turnstile.remove(widgetIdRef.current);
    };
  }, [onError, onExpired, onResolved, siteKey]);

  return <div className={className} ref={containerRef} />;
}
