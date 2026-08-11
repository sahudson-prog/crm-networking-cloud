"use client";

import { useEffect, useMemo, useState } from "react";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "../lib/googleContactsClient";
import {
  GOOGLE_INTERACTIONS_READONLY_SCOPES,
  GoogleInteractionClientError
} from "../lib/googleInteractionClient";
import {
  syncGoogleInteractions,
  type SyncGoogleInteractionsResult
} from "../lib/googleInteractionSyncFlow";
import type { ContactRow } from "../lib/readModel";
import { readNetworkingStartIso } from "../lib/syncDate";
import { supabase } from "../lib/supabaseClient";
import { Button } from "./ui/Button";

const GOOGLE_ACCOUNT_READONLY_SCOPES = [
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_INTERACTIONS_READONLY_SCOPES
].join(" ");

type ActivitySyncButtonProps = {
  contact?: ContactRow;
  onSynced?: () => void;
  showMessage?: boolean;
  square?: boolean;
  variant: "focus_incremental" | "single_contact";
};

type ActivitySyncState = {
  accessToken: string;
  error: string;
  loading: boolean;
  message: string;
  userEmail: string;
};

const initialState: ActivitySyncState = {
  accessToken: "",
  error: "",
  loading: false,
  message: "",
  userEmail: ""
};

export function ActivitySyncButton({
  contact,
  onSynced,
  showMessage = false,
  square = false,
  variant
}: ActivitySyncButtonProps) {
  const [state, setState] = useState<ActivitySyncState>(initialState);

  useEffect(() => {
    let active = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: data.session?.provider_token ?? "",
        userEmail: data.session?.user.email ?? ""
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  const label = variant === "single_contact" ? "Actualizar actividad del contacto" : "Actualizar actividad";
  const contactEmails = useMemo(
    () => (contact?.contact_emails ?? []).map((item) => item.email.trim()).filter(Boolean),
    [contact?.contact_emails]
  );

  async function connectGoogle() {
    if (!supabase) {
      setState((current) => ({ ...current, error: "Supabase no esta configurado." }));
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`,
        scopes: GOOGLE_ACCOUNT_READONLY_SCOPES
      }
    });
  }

  async function runSync() {
    if (!state.accessToken) {
      await connectGoogle();
      return;
    }

    if (!state.userEmail) {
      setState((current) => ({ ...current, error: "No pude identificar el correo del usuario conectado." }));
      return;
    }

    if (variant === "single_contact" && (!contact?.id || !contactEmails.length)) {
      setState((current) => ({ ...current, error: "Este contacto no tiene correos para buscar actividad." }));
      return;
    }

    const confirmed = window.confirm(confirmText(variant, contact?.display_name));
    if (!confirmed) return;

    setState((current) => ({ ...current, error: "", loading: true, message: "Actualizando..." }));
    try {
      const since = await readNetworkingStartIso();
      const result = await syncGoogleInteractions({
        accessToken: state.accessToken,
        calendarQuery: variant === "single_contact" ? contactEmails[0] : null,
        calendarTimeMin: variant === "single_contact" ? since : null,
        contactIds: variant === "single_contact" && contact?.id ? [contact.id] : undefined,
        focusedOnly: variant === "focus_incremental",
        forceFullSync: variant === "single_contact",
        gmailQuery: variant === "single_contact" ? gmailContactQuery(contactEmails) : null,
        gmailSince: variant === "single_contact" ? since : null,
        includeCalendar: true,
        includeMail: true,
        maxCalendarEvents: variant === "single_contact" ? 30 : 20,
        maxMailMessages: variant === "single_contact" ? 30 : 20,
        maxPages: 2,
        saveCursors: variant !== "single_contact",
        userEmail: state.userEmail
      });
      const message = resultMessage(result);
      setState((current) => ({
        ...current,
        error: result.errors.map((error) => error.message).join(" ") || "",
        loading: false,
        message
      }));
      if (!showMessage) window.alert(message);
      if (result.ok) onSynced?.();
    } catch (error) {
      if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
        setState((current) => ({
          ...current,
          accessToken: "",
          error: "El permiso de Google vencio o no incluye Gmail/Calendar. Vuelve a conectar Google.",
          loading: false,
          message: ""
        }));
        return;
      }
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude actualizar la actividad.",
        loading: false,
        message: ""
      }));
    }
  }

  return (
    <span className="activity-sync-control">
      <Button
        aria-label={label}
        className={variant === "focus_incremental" ? "global-activity-sync" : ""}
        disabled={state.loading}
        icon="sync"
        onClick={runSync}
        square={square}
        tone={variant === "focus_incremental" ? "primary" : "secondary"}
      >
        {square ? null : state.loading ? "Actualizando..." : label}
      </Button>
      {showMessage && state.message ? <span className="meta">{state.message}</span> : null}
      {showMessage && state.error ? <span className="form-error">{state.error}</span> : null}
    </span>
  );
}

function confirmText(variant: ActivitySyncButtonProps["variant"], contactName?: string) {
  if (variant === "single_contact") {
    return `Actualizar correos y calendario solo para ${contactName || "este contacto"}?`;
  }
  return "Actualizar correos y calendario para contactos en foco networking?";
}

function gmailContactQuery(emails: string[]) {
  const parts = emails.flatMap((email) => [`from:${email}`, `to:${email}`]);
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

function resultMessage(result: SyncGoogleInteractionsResult) {
  const created = (result.mail?.counts.created ?? 0) + (result.calendar?.counts.created ?? 0);
  const updated = (result.mail?.counts.updated ?? 0) + (result.calendar?.counts.updated ?? 0);
  const skipped = (result.mail?.counts.skipped ?? 0) + (result.calendar?.counts.skipped ?? 0);
  const summary = `${created} nuevos, ${updated} modificados, ${skipped} omitidos.`;
  if (!result.ok) return `Actualizacion incompleta: ${summary}`;
  return `Actualizacion lista: ${summary}`;
}
