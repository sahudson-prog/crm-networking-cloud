"use client";

import { useEffect, useState } from "react";
import {
  loadPublicRegistrationStatus, publicRegistrationLoginMessage, type PublicRegistrationAvailability
} from "../lib/publicRegistration";
import { supabase } from "../lib/supabaseClient";

export function usePublicRegistrationStatus() {
  const [state, setState] = useState<PublicRegistrationAvailability>({ status: "checking", enabled: false });
  useEffect(() => {
    let active = true;
    let reading = false;
    let refreshRequested = false;
    const refresh = async () => {
      if (!active || document.visibilityState === "hidden") return;
      if (reading) { refreshRequested = true; return; }
      reading = true;
      do {
        refreshRequested = false;
        const next = await loadPublicRegistrationStatus(supabase);
        // A focus event during this request requires a fresh authoritative read.
        if (active && !refreshRequested) setState(next);
      } while (active && refreshRequested);
      reading = false;
    };
    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return state;
}

export function PublicRegistrationMessage() {
  const state = usePublicRegistrationStatus();
  return <p className="meta" role="status">{publicRegistrationLoginMessage(state)}</p>;
}
