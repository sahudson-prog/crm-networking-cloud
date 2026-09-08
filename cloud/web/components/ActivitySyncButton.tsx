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
import {
  ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
  ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
  ACTIVITY_SYNC_MAX_MAIL_PAGES
} from "../lib/interactionSyncLimits";
import { formatGoogleInteractionSyncMessage } from "../lib/interactionSyncText";
import {
  externalIdsFromInteractionPreview,
  interactionPreviewChanges
} from "../lib/interactionSyncPreview";
import { requireCurrentUserCapability } from "../lib/accessControl";
import { googleConnectionHasCapability, readCurrentGoogleConnectionState } from "../lib/connectedAccounts";
import { GOOGLE_AUTH_LOGIN_SCOPES, invalidateActiveGoogleDataAuthorization, reconnectGoogle } from "../lib/googleAuthSession";
import type { ContactRow } from "../lib/readModel";
import { calendarFutureWindowIso, readNetworkingStartIso } from "../lib/syncDate";
import { createSyncRunId, writeSyncRunLogStep } from "../lib/syncRunLog";
import { loadActivitySyncLimitValues } from "../lib/usageLimitSettings";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { SyncPreviewDialog } from "./SyncPreviewDialog";
import { Button } from "./ui/Button";

const GOOGLE_ACCOUNT_READONLY_SCOPES = [
  ...GOOGLE_AUTH_LOGIN_SCOPES,
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_INTERACTIONS_READONLY_SCOPES
].join(" ");

type ActivitySyncButtonProps = {
  contact?: ContactRow;
  onNoticeChange?: (notice: ActivitySyncNotice | null) => void;
  onSynced?: () => void;
  showMessage?: boolean;
  square?: boolean;
  variant: "focus_incremental" | "single_contact";
};

export type ActivitySyncNotice = {
  busy?: boolean;
  text: string;
  tone: "error" | "info";
};

type ActivitySyncState = {
  accessToken: string;
  applying: boolean;
  connectedAccountId: string | null;
  error: string;
  lastRun: SyncGoogleInteractionsResult | null;
  loading: boolean;
  message: string;
  previewOpen: boolean;
  userEmail: string;
};

const initialState: ActivitySyncState = {
  accessToken: "",
  applying: false,
  connectedAccountId: null,
  error: "",
  lastRun: null,
  loading: false,
  message: "",
  previewOpen: false,
  userEmail: ""
};

export function ActivitySyncButton({
  contact,
  onNoticeChange,
  onSynced,
  showMessage = false,
  square = false,
  variant
}: ActivitySyncButtonProps) {
  const [state, setState] = useState<ActivitySyncState>(initialState);
  const previewChanges = interactionPreviewChanges(state.lastRun);
  const notice = useMemo(
    () => activitySyncNotice(state),
    [state.applying, state.error, state.loading, state.message, state.previewOpen]
  );

  useEffect(() => {
    let active = true;
    readCurrentGoogleConnectionState({ registerRememberedScopes: true }).then((googleConnection) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        userEmail: googleConnection.userEmail
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onNoticeChange?.(notice);
  }, [notice, onNoticeChange]);

  useEffect(() => {
    return () => onNoticeChange?.(null);
  }, [onNoticeChange]);

  const label = variant === "single_contact" ? "Actualizar interacciones contacto" : "Actualizar interacciones";
  const contactEmails = useMemo(
    () => (contact?.contact_emails ?? []).map((item) => item.email.trim()).filter(Boolean),
    [contact?.contact_emails]
  );

  async function connectGoogle() {
    await reconnectGoogle(GOOGLE_ACCOUNT_READONLY_SCOPES);
  }

  async function reviewSync() {
    try {
      await requireCurrentUserCapability("interactions.import_google", "actualizar interacciones desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        message: "",
        previewOpen: true
      }));
      return;
    }

    setState((current) => ({ ...current, error: "", loading: true, message: "Conectando con Google..." }));
    const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    const includeMail = googleConnectionHasCapability(googleConnection, "gmail_read");
    const includeCalendar = googleConnectionHasCapability(googleConnection, "calendar_read");
    setState((current) => ({
      ...current,
      accessToken: googleConnection.accessToken,
      connectedAccountId: googleConnection.account?.id ?? null,
      userEmail: googleConnection.userEmail
    }));
    if (!googleConnection.connected || !googleConnection.accessToken || (!includeMail && !includeCalendar)) {
      setState((current) => ({ ...current, error: "", loading: true, message: "Reconectando Google..." }));
      await connectGoogle();
      return;
    }

    if (!googleConnection.userEmail) {
      setState((current) => ({ ...current, error: "No pude identificar el correo del usuario conectado." }));
      return;
    }

    if (variant === "single_contact" && (!contact?.id || !contactEmails.length)) {
      setState((current) => ({ ...current, error: "Este contacto no tiene correos para buscar actividad." }));
      return;
    }

    setState((current) => ({ ...current, error: "", lastRun: null, loading: true, message: "Revisando actividad conectada..." }));
    await runSync({
      accessToken: googleConnection.accessToken,
      connectedAccountId: googleConnection.account?.id ?? null,
      dryRun: true,
      includeCalendar,
      includeMail,
      userEmail: googleConnection.userEmail
    });
  }

  async function applySync(selectedChanges: SyncPreviewChange[]) {
    try {
      await requireCurrentUserCapability("interactions.import_google", "actualizar interacciones desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        message: "",
        previewOpen: true
      }));
      return;
    }

    setState((current) => ({ ...current, error: "", message: "Conectando con Google..." }));
    const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    const includeMail = googleConnectionHasCapability(googleConnection, "gmail_read");
    const includeCalendar = googleConnectionHasCapability(googleConnection, "calendar_read");
    setState((current) => ({
      ...current,
      accessToken: googleConnection.accessToken,
      connectedAccountId: googleConnection.account?.id ?? null,
      userEmail: googleConnection.userEmail
    }));
    if (!googleConnection.connected || !googleConnection.accessToken || (!includeMail && !includeCalendar)) {
      setState((current) => ({ ...current, accessToken: "", error: "", message: "Reconectando Google..." }));
      await connectGoogle();
      return;
    }

    const externalIds = externalIdsFromInteractionPreview(selectedChanges);
    if (!externalIds.length) {
      setState((current) => ({ ...current, error: "No hay actividad seleccionada para aplicar." }));
      return;
    }
    setState((current) => ({ ...current, applying: true, error: "", message: "Aplicando..." }));
    await runSync({
      accessToken: googleConnection.accessToken,
      connectedAccountId: googleConnection.account?.id ?? null,
      dryRun: false,
      externalIds,
      includeCalendar,
      includeMail,
      userEmail: googleConnection.userEmail
    });
  }

  async function runSync(input: {
    accessToken: string;
    connectedAccountId: string | null;
    dryRun: boolean;
    externalIds?: string[];
    includeCalendar: boolean;
    includeMail: boolean;
    userEmail: string;
  }) {
    const runId = createSyncRunId();
    const scopeLabel = variant === "single_contact" ? `contacto:${contact?.display_name ?? contact?.id ?? ""}` : "foco";
    let stepOrder = 0;
    const logStep = (step: string, detail?: string | null, status: "info" | "running" | "success" | "warning" | "error" = "info", metadata?: Record<string, unknown>) => {
      stepOrder += 1;
      void writeSyncRunLogStep({
        detail,
        metadata,
        operation: input.dryRun ? "review" : "apply",
        provider: "google",
        resourceType: "activity",
        runId,
        scopeLabel,
        status,
        step,
        stepOrder
      });
    };
    logStep("Inicio", input.dryRun ? "Actualizacion solicitada." : `${input.externalIds?.length ?? 0} elemento(s) seleccionados.`, "running");

    try {
      const since = await readNetworkingStartIso();
      const calendarFutureWindow = calendarFutureWindowIso();
      const syncLimits = await loadActivitySyncLimitValues();
      logStep("Parametros", `Fecha inicio: ${formatLogDate(since)}.`, "info", {
        calendar_events_limit: syncLimits.calendarEvents,
        contact_id: contact?.id ?? null,
        mail_messages_limit: syncLimits.mailMessages,
        variant
      });
      const result = await syncGoogleInteractions({
        accessToken: input.accessToken,
        calendarQuery: null,
        calendarFutureTimeMax: calendarFutureWindow.until,
        calendarFutureTimeMin: calendarFutureWindow.from,
        calendarTimeMin: since,
        connectedAccountId: input.connectedAccountId,
        contactIds: variant === "single_contact" && contact?.id ? [contact.id] : undefined,
        cursorLabel: variant === "single_contact" && contact?.id ? `contact:${contact.id}` : undefined,
        dryRun: input.dryRun,
        focusedOnly: variant === "focus_incremental",
        gmailQuery: variant === "single_contact" ? gmailContactQuery(contactEmails) : null,
        gmailSince: since,
        includeCalendar: input.includeCalendar,
        includeMail: input.includeMail,
        maxCalendarEvents: syncLimits.calendarEvents || ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
        maxMailMessages: syncLimits.mailMessages || ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
        maxPages: Math.max(syncLimits.calendarPages, syncLimits.mailPages) || ACTIVITY_SYNC_MAX_MAIL_PAGES,
        ...(input.externalIds?.length ? { externalIds: input.externalIds } : {}),
        saveCursors: true,
        saveReadDiagnostics: input.dryRun,
        userEmail: input.userEmail
      });
      const message = resultMessage(result);
      const authFailure = hasGoogleInteractionAuthFailure(result);
      if (authFailure) {
        invalidateActiveGoogleDataAuthorization();
        setState((current) => ({
          ...current,
          accessToken: "",
          applying: false,
          error: "",
          lastRun: result,
          loading: true,
          message: "Reconectando Google...",
          previewOpen: false
        }));
        logStep("Reconectando Google", "Permiso vencido o insuficiente.", "warning", {
          errors: result.errors
        });
        await connectGoogle();
        return;
      }
      setState((current) => ({
        ...current,
        applying: false,
        error: result.errors.map((error) => error.message).join(" ") || "",
        lastRun: result,
        loading: false,
        message,
        previewOpen: input.dryRun
      }));
      logStep(input.dryRun ? "Preview listo" : "Aplicacion terminada", activityLogSummary(result), result.ok ? "success" : "warning", {
        errors: result.errors,
        warnings: result.warnings
      });
      if (!input.dryRun && result.ok) {
        setState((current) => ({ ...current, previewOpen: false }));
        onSynced?.();
      }
    } catch (error) {
      logStep("Error", error instanceof Error ? error.message : "No pude actualizar la actividad.", "error");
      if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
        invalidateActiveGoogleDataAuthorization();
        setState((current) => ({
          ...current,
          accessToken: "",
          applying: false,
          error: "",
          loading: true,
          message: "Reconectando Google...",
          previewOpen: false
        }));
        logStep("Reconectando Google", "Permiso vencido o insuficiente.", "warning");
        await connectGoogle();
        return;
      }
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude actualizar la actividad.",
        loading: false,
        message: "",
        previewOpen: true
      }));
    }
  }

  return (
    <>
      <span className="activity-sync-control">
        <Button
          aria-label={label}
          className={variant === "focus_incremental" ? "global-activity-sync" : ""}
          disabled={state.loading || state.applying}
          icon="sync"
          onClick={reviewSync}
          square={square}
          tone={square ? "secondary" : variant === "focus_incremental" ? "primary" : "secondary"}
        >
          {square ? null : state.loading ? "Revisando..." : state.applying ? "Aplicando..." : label}
        </Button>
        {showMessage && notice ? (
          <span className={`activity-sync-message ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </span>
        ) : null}
      </span>
      <SyncPreviewDialog
        applying={state.applying}
        changes={previewChanges}
        description={previewDescription(variant, contact?.display_name)}
        feedbackMessage={state.error || state.message}
        feedbackTone={state.error ? "error" : "info"}
        onApply={applySync}
        onClose={() => setState((current) => ({ ...current, previewOpen: false }))}
        open={state.previewOpen}
        tabKeys={["new", "modified", "skipped"]}
        title={variant === "single_contact" ? "Actividad del contacto" : "Actividad en foco networking"}
      />
    </>
  );
}

function hasGoogleInteractionAuthFailure(result: SyncGoogleInteractionsResult) {
  return result.errors.some((error) => error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
}

function previewDescription(variant: ActivitySyncButtonProps["variant"], contactName?: string) {
  if (variant === "single_contact") {
    return `Revisa actividad detectada para ${contactName || "este contacto"}. Nada se guarda hasta aplicar la seleccion.`;
  }
  return "Revisa actividad detectada para contactos en foco networking. Nada se guarda hasta aplicar la seleccion.";
}

function gmailContactQuery(emails: string[]) {
  const parts = emails.flatMap((email) => [`from:${email}`, `to:${email}`, `cc:${email}`, `bcc:${email}`]);
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

function resultMessage(result: SyncGoogleInteractionsResult) {
  return formatGoogleInteractionSyncMessage(result);
}

function activitySyncNotice(state: ActivitySyncState): ActivitySyncNotice | null {
  if (state.error) {
    return { text: state.error, tone: "error" };
  }
  if (state.previewOpen || !state.message) {
    return null;
  }
  return { busy: state.loading || state.applying, text: state.message, tone: "info" };
}

function activityLogSummary(result: SyncGoogleInteractionsResult) {
  const mail = result.mail;
  const calendar = result.calendar;
  const newCount = (mail?.counts.created ?? 0) + (calendar?.counts.created ?? 0);
  const modifiedCount = (mail?.counts.updated ?? 0) + (calendar?.counts.updated ?? 0);
  const skippedCount = (mail?.counts.skipped ?? 0) + (calendar?.counts.skipped ?? 0);
  const failedCount = (mail?.counts.failed ?? 0) + (calendar?.counts.failed ?? 0);
  return `${result.googleRead.mailMessages} correos y ${result.googleRead.calendarEvents} citas leidas; ${newCount} nuevos, ${modifiedCount} modificados, ${skippedCount} omitidos, ${failedCount} fallidos.`;
}

function formatLogDate(value: string | null) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CL");
}
