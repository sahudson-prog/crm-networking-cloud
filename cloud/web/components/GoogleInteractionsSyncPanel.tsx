"use client";

import { useEffect, useState } from "react";
import { GOOGLE_CONTACTS_READONLY_SCOPE } from "../lib/googleContactsClient";
import {
  GOOGLE_INTERACTIONS_READONLY_SCOPES,
  GoogleInteractionClientError
} from "../lib/googleInteractionClient";
import {
  syncGoogleInteractions,
  type SyncGoogleInteractionsResult
} from "../lib/googleInteractionSyncFlow";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { formatGoogleInteractionHistoricalMessage } from "../lib/interactionSyncText";
import {
  externalIdsFromInteractionPreview,
  interactionPreviewChanges
} from "../lib/interactionSyncPreview";
import { requireCurrentUserCapability } from "../lib/accessControl";
import { googleConnectionHasCapability, readCurrentGoogleConnectionState } from "../lib/connectedAccounts";
import { GOOGLE_AUTH_LOGIN_SCOPES, invalidateActiveGoogleDataAuthorization, reconnectGoogle } from "../lib/googleAuthSession";
import {
  ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
  ACTIVITY_SYNC_MAX_CALENDAR_PAGES,
  ACTIVITY_SYNC_MAX_CONTACT_PAGES,
  ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
  ACTIVITY_SYNC_MAX_MAIL_PAGES
} from "../lib/interactionSyncLimits";
import { calendarFutureWindowIso, readNetworkingStartIso } from "../lib/syncDate";
import { supabase } from "../lib/supabaseClient";
import { createSyncRunId, writeSyncRunLogStep } from "../lib/syncRunLog";
import { loadActivitySyncLimitValues, type ActivitySyncLimitValues } from "../lib/usageLimitSettings";
import { InteractionSyncResultSummary } from "./InteractionSyncResultSummary";
import { SyncPreviewDialog } from "./SyncPreviewDialog";
import { Button } from "./ui/Button";
import { ProviderButton } from "./ui/ProviderIcon";

const GOOGLE_ACCOUNT_READONLY_SCOPES = [
  ...GOOGLE_AUTH_LOGIN_SCOPES,
  GOOGLE_CONTACTS_READONLY_SCOPE,
  GOOGLE_INTERACTIONS_READONLY_SCOPES
].join(" ");

type ActivitySyncResource = "mail" | "calendar";

type ActivityImportStats = {
  contactsInScope: number;
  linkedCalendar: number;
  linkedMail: number;
  totalContacts: number;
};

type GoogleInteractionsState = {
  accessToken: string;
  activeResource: ActivitySyncResource | null;
  applying: boolean;
  connectedAccountId: string | null;
  error: string;
  lastRun: SyncGoogleInteractionsResult | null;
  loading: boolean;
  message: string;
  previewOpen: boolean;
  stats: ActivityImportStats;
  syncLimits: ActivitySyncLimitValues;
  userEmail: string;
};

const initialState: GoogleInteractionsState = {
  accessToken: "",
  activeResource: null,
  applying: false,
  connectedAccountId: null,
  error: "",
  lastRun: null,
  loading: false,
  message: "",
  previewOpen: false,
  stats: {
    contactsInScope: 0,
    linkedCalendar: 0,
    linkedMail: 0,
    totalContacts: 0
  },
  syncLimits: {
    calendarEvents: ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
    calendarPages: ACTIVITY_SYNC_MAX_CALENDAR_PAGES,
    contactPages: ACTIVITY_SYNC_MAX_CONTACT_PAGES,
    mailMessages: ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
    mailPages: ACTIVITY_SYNC_MAX_MAIL_PAGES
  },
  userEmail: ""
};

type GoogleInteractionsSyncPanelProps = {
  calendarDisabledReason?: string;
  compact?: boolean;
  googleAccessToken?: string;
  googleCalendarAvailable?: boolean;
  googleConnected?: boolean;
  googleConnectionLoading?: boolean;
  googleMailAvailable?: boolean;
  mailDisabledReason?: string;
  networkingStartReady?: boolean;
  registerRememberedScopes?: boolean;
};

export function GoogleInteractionsSyncPanel({
  calendarDisabledReason = "",
  compact = false,
  googleAccessToken,
  googleCalendarAvailable = true,
  googleConnected = true,
  googleConnectionLoading = false,
  googleMailAvailable = true,
  mailDisabledReason = "",
  networkingStartReady = true,
  registerRememberedScopes = true
}: GoogleInteractionsSyncPanelProps) {
  const [state, setState] = useState<GoogleInteractionsState>(initialState);
  const activeResource = state.activeResource ?? "mail";
  const previewChanges = interactionPreviewChanges(state.lastRun);
  const effectiveAccessToken = googleAccessToken ?? state.accessToken;
  const mailActionDisabledReason = compact ? mailDisabledReason
    || googleResourceDisabledReason({
      accessToken: effectiveAccessToken,
      available: googleMailAvailable,
      connected: googleConnected,
      loading: googleConnectionLoading,
      networkingStartReady,
      serviceLabel: "correos"
    }) : "";
  const calendarActionDisabledReason = compact ? calendarDisabledReason
    || googleResourceDisabledReason({
      accessToken: effectiveAccessToken,
      available: googleCalendarAvailable,
      connected: googleConnected,
      loading: googleConnectionLoading,
      networkingStartReady,
      serviceLabel: "calendario"
    }) : "";

  useEffect(() => {
    let active = true;
    Promise.all([readCurrentGoogleConnectionState({ registerRememberedScopes }), loadActivitySyncLimitValues(), loadActivityImportStats()]).then(([googleConnection, syncLimits, stats]) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        stats,
        syncLimits,
        userEmail: googleConnection.userEmail
      }));
    });
    return () => {
      active = false;
    };
  }, [registerRememberedScopes]);

  async function connectGoogle() {
    try {
      await reconnectGoogle(GOOGLE_ACCOUNT_READONLY_SCOPES, `${window.location.origin}/cuenta`);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude conectar Google."
      }));
    }
  }

  async function reviewMail() {
    await runSync(true, "mail");
  }

  async function reviewCalendar() {
    await runSync(true, "calendar");
  }

  async function applyInteractions(selectedChanges?: SyncPreviewChange[]) {
    if (!state.activeResource) {
      setState((current) => ({ ...current, error: "Primero revisa correos o citas antes de aplicar cambios." }));
      return;
    }

    const externalIds = externalIdsFromInteractionPreview(selectedChanges ?? interactionPreviewChanges(state.lastRun));

    if (!externalIds.length) {
      setState((current) => ({ ...current, error: "No hay correos o citas seleccionadas para aplicar." }));
      return;
    }

    await runSync(false, state.activeResource, externalIds);
  }

  async function runSync(dryRun: boolean, resource: ActivitySyncResource, externalIds: string[] = []) {
    const disabledReason = resource === "calendar" ? calendarActionDisabledReason : mailActionDisabledReason;
    if (disabledReason) {
      setState((current) => ({
        ...current,
        activeResource: resource,
        applying: false,
        error: disabledReason,
        loading: false,
        message: "",
        previewOpen: true
      }));
      return;
    }

    if (!googleConnected) {
      setState((current) => ({
        ...current,
        activeResource: resource,
        applying: false,
        error: "Primero conecta Google para autorizar lectura de correos y calendario.",
        loading: false,
        message: "",
        previewOpen: true
      }));
      return;
    }

    try {
      await requireCurrentUserCapability("interactions.import_google", "importar correos y citas desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        activeResource: resource,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        message: "",
        previewOpen: true
      }));
      return;
    }

    const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    setState((current) => ({
      ...current,
      accessToken: googleConnection.accessToken,
      connectedAccountId: googleConnection.account?.id ?? null,
      userEmail: googleConnection.userEmail
    }));

    if (!googleConnection.connected || !googleConnection.accessToken || !googleConnectionHasCapability(googleConnection, capabilityForResource(resource))) {
      setState((current) => ({
        ...current,
        error: "",
        loading: true,
        message: "Reconectando Google..."
      }));
      await connectGoogle();
      return;
    }

    if (!googleConnection.userEmail) {
      setState((current) => ({
        ...current,
        error: "No pude identificar el correo del usuario conectado."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      activeResource: resource,
      applying: !dryRun,
      error: "",
      lastRun: dryRun ? null : current.lastRun,
      loading: dryRun,
      message: dryRun ? reviewMessage(resource) : applyMessage(resource)
    }));

    const runId = createSyncRunId();
    let stepOrder = 0;
    const resourceLabel = resource === "calendar" ? "calendar" : "mail";
    const logStep = (step: string, detail?: string | null, status: "info" | "running" | "success" | "warning" | "error" = "info", metadata?: Record<string, unknown>) => {
      stepOrder += 1;
      void writeSyncRunLogStep({
        detail,
        metadata,
        operation: dryRun ? "review" : "apply",
        provider: "google",
        resourceType: resourceLabel,
        runId,
        scopeLabel: "cuenta",
        status,
        step,
        stepOrder
      });
    };
    logStep("Inicio", dryRun ? "Revision solicitada." : `${externalIds.length} elemento(s) seleccionados.`, "running");

    try {
      const historicalStart = await readNetworkingStartIso();
      const calendarFutureWindow = calendarFutureWindowIso();
      const syncLimits = await loadActivitySyncLimitValues();
      logStep("Parametros", `Fecha inicio: ${formatLogDate(historicalStart)}.`, "info", {
        calendar_events_limit: syncLimits.calendarEvents,
        mail_messages_limit: syncLimits.mailMessages
      });
      const result = await syncGoogleInteractions({
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        calendarFutureTimeMax: calendarFutureWindow.until,
        calendarFutureTimeMin: calendarFutureWindow.from,
        calendarTimeMin: historicalStart,
        dryRun,
        forceFullSync: true,
        focusedOnly: true,
        gmailSince: historicalStart,
        includeCalendar: resource === "calendar",
        includeMail: resource === "mail",
        maxCalendarEvents: syncLimits.calendarEvents,
        maxMailMessages: syncLimits.mailMessages,
        maxPages: resource === "calendar" ? syncLimits.calendarPages : syncLimits.mailPages,
        saveCursors: false,
        saveReadDiagnostics: resource === "calendar" && dryRun,
        ...(externalIds.length ? { externalIds } : {}),
        userEmail: googleConnection.userEmail
      });
      if (hasGoogleInteractionAuthFailure(result)) {
        invalidateActiveGoogleDataAuthorization();
        setState((current) => ({
          ...current,
          accessToken: "",
          activeResource: resource,
          applying: false,
          error: "El permiso de Google vencio o no incluye Gmail/Calendar. Vuelve a conectar Google.",
          loading: false,
          message: "",
          previewOpen: true,
          stats: current.stats,
          syncLimits
        }));
        logStep("Autorizacion Google invalidada", "Google rechazo el token actual para este servicio.", "warning", {
          errors: result.errors
        });
        return;
      }

      setState((current) => ({
        ...current,
        activeResource: resource,
        applying: false,
        error: result.errors.map((error) => error.message).join(" ") || "",
        lastRun: result,
        loading: false,
        message: formatGoogleInteractionHistoricalMessage(result),
        previewOpen: dryRun,
        stats: current.stats,
        syncLimits
      }));
      logStep(dryRun ? "Preview listo" : "Aplicacion terminada", interactionLogSummary(result, resource), result.ok ? "success" : "warning", {
        errors: result.errors,
        warnings: result.warnings
      });
      if (!dryRun && result.ok) {
        const stats = await loadActivityImportStats();
        setState((current) => ({ ...current, stats }));
      }
    } catch (error) {
      logStep("Error", error instanceof Error ? error.message : "No pude sincronizar correos y calendario.", "error");
      if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
        invalidateActiveGoogleDataAuthorization();
        setState((current) => ({
          ...current,
          accessToken: "",
          activeResource: resource,
          applying: false,
          error: "El permiso de Google vencio o no incluye Gmail/Calendar. Vuelve a conectar Google.",
          loading: false,
          message: "",
          previewOpen: true
        }));
        return;
      }

      setState((current) => ({
        ...current,
        activeResource: resource,
        applying: false,
        error: error instanceof Error ? error.message : "No pude sincronizar correos y calendario.",
        loading: false,
        message: "",
        previewOpen: true
      }));
    }
  }

  const syncFeedback = (
    <>
      <SyncPreviewDialog
        applying={state.applying}
        changes={previewChanges}
        description={previewDescription(activeResource)}
        feedbackMessage={state.message}
        onApply={(selectedChanges) => applyInteractions(selectedChanges)}
        onClose={() => setState((current) => ({ ...current, previewOpen: false }))}
        open={state.previewOpen}
        tabKeys={["new", "modified", "skipped"]}
        title={activeResource === "calendar" ? "Cambios desde Google Calendar" : "Cambios desde Gmail"}
      />
    </>
  );

  if (compact) {
    return (
      <>
        <div className="connected-service-action">
          <div className="connected-service-action-main">
            <strong>Correos</strong>
            <span>{state.stats.linkedMail} vinculados</span>
          </div>
          <div className="toolbar connected-service-action-controls">
            {mailActionDisabledReason && !state.loading ? (
              <span className="connected-service-action-reason">{mailActionDisabledReason}</span>
            ) : null}
            <Button disabled={Boolean(mailActionDisabledReason) || state.loading || state.applying} icon="mail" onClick={reviewMail} tone="primary">
              {googleConnectionLoading ? "Verificando..." : state.loading && activeResource === "mail" ? "Revisando..." : "Importar"}
            </Button>
            <Button icon="trash" onClick={() => confirmImportedDataDelete("correos")} tone="danger">
              Borrar importados
            </Button>
          </div>
        </div>
        <div className="connected-service-action">
          <div className="connected-service-action-main">
            <strong>Citas calendario</strong>
            <span>{state.stats.linkedCalendar} vinculadas</span>
          </div>
          <div className="toolbar connected-service-action-controls">
            {calendarActionDisabledReason && !state.loading ? (
              <span className="connected-service-action-reason">{calendarActionDisabledReason}</span>
            ) : null}
            <Button disabled={Boolean(calendarActionDisabledReason) || state.loading || state.applying} icon="calendar" onClick={reviewCalendar} tone="primary">
              {googleConnectionLoading ? "Verificando..." : state.loading && activeResource === "calendar" ? "Revisando..." : "Importar"}
            </Button>
            <Button icon="trash" onClick={() => confirmImportedDataDelete("citas")} tone="danger">
              Borrar importadas
            </Button>
          </div>
        </div>
        <div className="connected-service-feedback">{syncFeedback}</div>
      </>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Importar actividad</h2>
          <span className="panel-caption">Fuerza una nueva lectura de datos de Google para contactos en foco. Puede reemplazar datos fuente ya vinculados; tus minutas se conservan.</span>
        </div>
        <div className="toolbar">
          <ProviderButton label={state.accessToken ? "Reconectar Google" : "Conectar Google"} name="google" onClick={connectGoogle} />
          <Button disabled={state.loading || state.applying} icon="mail" onClick={state.accessToken ? reviewMail : connectGoogle} tone="primary">
            {state.loading && activeResource === "mail" ? "Revisando..." : state.accessToken ? "Importar" : "Conectar Google"}
          </Button>
          <Button disabled={state.loading || state.applying} icon="calendar" onClick={state.accessToken ? reviewCalendar : connectGoogle} tone="primary">
            {state.loading && activeResource === "calendar" ? "Revisando..." : state.accessToken ? "Importar" : "Conectar Google"}
          </Button>
        </div>
      </div>

      <div className="activity-import-stats" aria-label="Resumen de actividad importada">
        <span><strong>{state.stats.totalContacts}</strong> contactos</span>
        <span><strong>{state.stats.contactsInScope}</strong> en foco</span>
        <span><strong>{state.stats.linkedMail}</strong> correos vinculados</span>
        <span><strong>{state.stats.linkedCalendar}</strong> citas vinculadas</span>
      </div>

      {syncFeedback}
    </section>
  );
}

function googleResourceDisabledReason(input: {
  accessToken: string;
  available: boolean;
  connected: boolean;
  loading: boolean;
  networkingStartReady: boolean;
  serviceLabel: string;
}) {
  if (input.loading) return "Estamos verificando la autorización de Google.";
  if (!input.connected || !input.accessToken) return "Autoriza Google para importar.";
  if (!input.available) return `Actualiza la autorización de Google para habilitar ${input.serviceLabel}.`;
  if (!input.networkingStartReady) return "Define primero la fecha de inicio de networking.";
  return "";
}

async function loadActivityImportStats(): Promise<ActivityImportStats> {
  if (!supabase) {
    return { contactsInScope: 0, linkedCalendar: 0, linkedMail: 0, totalContacts: 0 };
  }

  const [
    totalContacts,
    contactsInScope,
    linkedMail,
    linkedCalendar
  ] = await Promise.all([
    countRows("contacts", { is_active: true }),
    countRows("contacts", { is_active: true, networking_focus: true }),
    countRows("external_interaction_sources", { is_active: true, provider: "google", source_service: "gmail" }),
    countRows("external_interaction_sources", { is_active: true, provider: "google", source_service: "calendar" })
  ]);

  return { contactsInScope, linkedCalendar, linkedMail, totalContacts };
}

async function countRows(table: string, filters: Record<string, string | boolean>) {
  if (!supabase) return 0;
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  Object.entries(filters).forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  const { count } = await query;
  return count ?? 0;
}


function reviewMessage(resource: ActivitySyncResource) {
  return resource === "calendar" ? "Revisando citas sin guardar cambios..." : "Revisando correos sin guardar cambios...";
}

function capabilityForResource(resource: ActivitySyncResource) {
  return resource === "calendar" ? "calendar_read" : "gmail_read";
}

function hasGoogleInteractionAuthFailure(result: SyncGoogleInteractionsResult) {
  return result.errors.some((error) => error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
}

function applyMessage(resource: ActivitySyncResource) {
  return resource === "calendar" ? "Sincronizando citas seleccionadas..." : "Sincronizando correos seleccionados...";
}

function previewDescription(resource: ActivitySyncResource) {
  if (resource === "calendar") {
    return "Revisa las citas detectadas. Las que no selecciones quedan pendientes para otra sincronizacion.";
  }
  return "Revisa los correos detectados. Los que no selecciones quedan pendientes para otra sincronizacion.";
}

function interactionLogSummary(result: SyncGoogleInteractionsResult, resource: ActivitySyncResource) {
  const run = resource === "calendar" ? result.calendar : result.mail;
  const read = resource === "calendar"
    ? `${result.googleRead.calendarEvents} citas leidas`
    : `${result.googleRead.mailMessages} correos leidos`;
  if (!run) return `${read}; sin lote aplicable.`;
  return `${read}; ${run.counts.created} nuevos, ${run.counts.updated} modificados, ${run.counts.skipped} omitidos, ${run.counts.failed} fallidos.`;
}

function formatLogDate(value: string | null) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-CL");
}

function confirmImportedDataDelete(kind: string) {
  window.alert(
    `Pendiente: borrar ${kind} importados requiere definir si se conservan o eliminan notas, minutas y datos asociados. No se borro nada.`
  );
}
