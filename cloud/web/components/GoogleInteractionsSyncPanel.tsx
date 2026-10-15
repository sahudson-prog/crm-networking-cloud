"use client";

import { useEffect, useState } from "react";
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GoogleInteractionClientError,
  listGoogleGmailUserLabels,
  type GoogleGmailLabel
} from "../lib/googleInteractionClient";
import {
  applyGoogleGmailHistoricalBootstrap,
  reviewGoogleGmailHistoricalBootstrap,
  syncGoogleInteractions,
  type GoogleGmailHistoricalBootstrapSnapshot,
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
import { invalidateActiveGoogleDataAuthorization, reconnectGoogle } from "../lib/googleAuthSession";
import { beginGoogleDataAuthorization } from "../lib/googleDataAuthorizationIntent";
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
import { ProviderButton, ProviderIcon } from "./ui/ProviderIcon";

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
  gmailLabels: GoogleGmailLabel[];
  gmailLabelsError: string;
  gmailLabelsLoading: boolean;
  lastRun: SyncGoogleInteractionsResult | null;
  loading: boolean;
  message: string;
  previewOpen: boolean;
  selectedGmailLabelId: string;
  bootstrapSnapshot: GoogleGmailHistoricalBootstrapSnapshot | null;
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
  gmailLabels: [],
  gmailLabelsError: "",
  gmailLabelsLoading: true,
  lastRun: null,
  loading: false,
  message: "",
  previewOpen: false,
  selectedGmailLabelId: "",
  bootstrapSnapshot: null,
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
  authorizationRedirectPath?: string;
  calendarDisabledReason?: string;
  compact?: boolean;
  googleAccessToken?: string;
  googleCalendarAvailable?: boolean;
  googleConnected?: boolean;
  googleConnectionLoading?: boolean;
  googleMailAvailable?: boolean;
  mailDisabledReason?: string;
  networkingStartReady?: boolean;
  onResumeMailImportHandled?: () => void;
  registerRememberedScopes?: boolean;
  resumeMailImport?: boolean;
  showCalendarAction?: boolean;
};

export function GoogleInteractionsSyncPanel({
  authorizationRedirectPath = "/cuenta",
  calendarDisabledReason = "",
  compact = false,
  googleAccessToken,
  googleCalendarAvailable = true,
  googleConnected = true,
  googleConnectionLoading = false,
  googleMailAvailable = true,
  mailDisabledReason = "",
  networkingStartReady = true,
  onResumeMailImportHandled,
  registerRememberedScopes = true,
  resumeMailImport = false,
  showCalendarAction = true
}: GoogleInteractionsSyncPanelProps) {
  const [state, setState] = useState<GoogleInteractionsState>(initialState);
  const [gmailLabelsReloadKey, setGmailLabelsReloadKey] = useState(0);
  const [historicalImportOpen, setHistoricalImportOpen] = useState(false);
  const activeResource = state.activeResource ?? "mail";
  const previewChanges = interactionPreviewChanges(state.lastRun);
  const effectiveAccessToken = googleAccessToken?.trim() || state.accessToken;
  const mailAuthorizationRequired = !googleConnected || !effectiveAccessToken || !googleMailAvailable;
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
    void (async () => {
      const [googleConnection, syncLimits, stats] = await Promise.all([
        readCurrentGoogleConnectionState({ registerRememberedScopes }),
        loadActivitySyncLimitValues(),
        loadActivityImportStats()
      ]);
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        stats,
        syncLimits,
        userEmail: googleConnection.userEmail
      }));
    })();
    return () => {
      active = false;
    };
  }, [registerRememberedScopes]);

  useEffect(() => {
    let active = true;
    const accessToken = effectiveAccessToken.trim();
    if (!accessToken || !googleMailAvailable) {
      setState((current) => ({
        ...current,
        gmailLabels: [],
        gmailLabelsError: "",
        gmailLabelsLoading: false,
        selectedGmailLabelId: ""
      }));
      return () => {
        active = false;
      };
    }

    setState((current) => ({
      ...current,
      gmailLabelsError: "",
      gmailLabelsLoading: true
    }));
    void listGoogleGmailUserLabels({ accessToken })
      .then((gmailLabels) => {
        if (!active) return;
        const sortedLabels = gmailLabels.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
        setState((current) => ({
          ...current,
          gmailLabels: sortedLabels,
          gmailLabelsError: "",
          gmailLabelsLoading: false,
          selectedGmailLabelId: sortedLabels.some((label) => label.id === current.selectedGmailLabelId)
            ? current.selectedGmailLabelId
            : ""
        }));
      })
      .catch((error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          gmailLabels: [],
          gmailLabelsError: gmailLabelsErrorMessage(error),
          gmailLabelsLoading: false,
          selectedGmailLabelId: ""
        }));
      });

    return () => {
      active = false;
    };
  }, [effectiveAccessToken, gmailLabelsReloadKey, googleMailAvailable]);

  useEffect(() => {
    if (!resumeMailImport || googleConnectionLoading) return;
    if (googleMailAvailable && effectiveAccessToken) {
      setState((current) => ({
        ...current,
        error: "",
        message: "Autorización Gmail lista. Selecciona una etiqueta para revisar el histórico."
      }));
    }
    setHistoricalImportOpen(true);
    onResumeMailImportHandled?.();
  }, [effectiveAccessToken, googleConnectionLoading, googleMailAvailable, resumeMailImport]);

  async function connectGoogle(resource: ActivitySyncResource) {
    try {
      const redirectTo = `${window.location.origin}${authorizationRedirectPath}`;
      if (resource === "mail") {
        await beginGoogleDataAuthorization("import_gmail_history", redirectTo);
      } else {
        await reconnectGoogle([GOOGLE_CALENDAR_READONLY_SCOPE], redirectTo);
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude conectar Google."
      }));
    }
  }

  async function reviewMail() {
    await runMailBootstrapReview();
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

    if (!externalIds.length && state.activeResource !== "mail") {
      setState((current) => ({ ...current, error: "No hay correos o citas seleccionadas para aplicar." }));
      return;
    }

    if (state.activeResource === "mail") {
      await applyMailBootstrap(externalIds);
      return;
    }
    await runSync(false, state.activeResource, externalIds);
  }

  async function runMailBootstrapReview() {
    try {
      await requireCurrentUserCapability("interactions.import_google", "importar correos desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        activeResource: "mail",
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        previewOpen: false
      }));
      return;
    }
    if (mailActionDisabledReason) {
      setState((current) => ({
        ...current,
        activeResource: "mail",
        error: mailActionDisabledReason,
        previewOpen: false
      }));
      return;
    }
    if (mailAuthorizationRequired) {
      await connectGoogle("mail");
      return;
    }
    if (!state.selectedGmailLabelId) {
      setState((current) => ({
        ...current,
        activeResource: "mail",
        error: "Selecciona una etiqueta Gmail antes de revisar correos.",
        previewOpen: false
      }));
      return;
    }
    try {
      const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
      if (!googleConnection.connected
        || !googleConnection.accessToken
        || !googleConnectionHasCapability(googleConnection, "gmail_read")) {
        setState((current) => ({ ...current, error: "", loading: true, message: "Reconectando Google..." }));
        await connectGoogle("mail");
        return;
      }
      if (!googleConnection.userEmail) throw new Error("No pude identificar el correo del usuario conectado.");
      const selectedLabel = state.gmailLabels.find((label) => label.id === state.selectedGmailLabelId);
      if (!selectedLabel) throw new Error("La etiqueta Gmail seleccionada ya no esta disponible.");

      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        activeResource: "mail",
        applying: false,
        bootstrapSnapshot: null,
        connectedAccountId: googleConnection.account?.id ?? null,
        error: "",
        lastRun: null,
        loading: true,
        message: "Revisando correos sin guardar cambios...",
        previewOpen: false,
        userEmail: googleConnection.userEmail
      }));

      const runId = createSyncRunId();
      let stepOrder = 0;
      const logStep = (step: string, detail?: string | null, status: "info" | "running" | "success" | "warning" | "error" = "info", metadata?: Record<string, unknown>) => {
        stepOrder += 1;
        void writeSyncRunLogStep({
          detail,
          metadata,
          operation: "review",
          provider: "google",
          resourceType: "mail",
          runId,
          scopeLabel: "cuenta:bootstrap",
          status,
          step,
          stepOrder
        });
      };
      logStep("Inicio", "Revision historica solicitada.", "running");
      const historicalStart = await readNetworkingStartIso();
      const syncLimits = await loadActivitySyncLimitValues();
      const reviewed = await reviewGoogleGmailHistoricalBootstrap({
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        label: { id: selectedLabel.id, name: selectedLabel.name },
        maxMailMessages: syncLimits.mailMessages,
        maxPages: syncLimits.mailPages,
        since: historicalStart,
        userEmail: googleConnection.userEmail
      });
      setHistoricalImportOpen(false);
      setState((current) => ({
        ...current,
        applying: false,
        bootstrapSnapshot: reviewed.snapshot,
        error: reviewed.result.errors.map((error) => error.message).join(" "),
        lastRun: reviewed.result,
        loading: false,
        message: reviewed.snapshot.complete
          ? formatGoogleInteractionHistoricalMessage(reviewed.result)
          : "La revision alcanzo el limite disponible. Puedes aplicar estos correos, pero la importacion historica quedara incompleta.",
        previewOpen: true,
        syncLimits
      }));
      logStep("Preview listo", interactionLogSummary(reviewed.result, "mail"), reviewed.snapshot.complete ? "success" : "warning", {
        complete: reviewed.snapshot.complete,
        truncated_by: reviewed.snapshot.truncatedBy,
        warnings: reviewed.result.warnings
      });
    } catch (error) {
      handleMailBootstrapError(error);
    }
  }

  async function applyMailBootstrap(externalIds: string[]) {
    const snapshot = state.bootstrapSnapshot;
    if (!snapshot) {
      setState((current) => ({ ...current, error: "El preview de correos ya no esta disponible. Vuelve a revisar Gmail." }));
      return;
    }
    try {
      await requireCurrentUserCapability("interactions.import_google", "importar correos desde Google");
      setState((current) => ({
        ...current,
        applying: true,
        error: "",
        message: "Sincronizando correos seleccionados..."
      }));
      const result = await applyGoogleGmailHistoricalBootstrap({
        connectedAccountId: state.connectedAccountId,
        externalIds,
        snapshot
      });
      const stats = result.ok ? await loadActivityImportStats() : state.stats;
      setState((current) => ({
        ...current,
        applying: false,
        bootstrapSnapshot: result.ok ? null : current.bootstrapSnapshot,
        error: result.errors.map((error) => error.message).join(" "),
        lastRun: result,
        loading: false,
        message: snapshot.complete
          ? formatGoogleInteractionHistoricalMessage(result)
          : "Se aplicaron los correos seleccionados, pero la importacion historica quedo incompleta.",
        previewOpen: !result.ok,
        stats
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude aplicar los correos seleccionados.",
        loading: false,
        previewOpen: true
      }));
    }
  }

  function handleMailBootstrapError(error: unknown) {
    if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
      invalidateActiveGoogleDataAuthorization();
      setState((current) => ({
        ...current,
        accessToken: "",
        activeResource: "mail",
        applying: false,
        bootstrapSnapshot: null,
        error: "El permiso de Google vencio o no incluye Gmail. Vuelve a conectar Google.",
        loading: false,
        message: "",
        previewOpen: false
      }));
      return;
    }
    setState((current) => ({
      ...current,
      activeResource: "mail",
      applying: false,
      bootstrapSnapshot: null,
      error: error instanceof Error ? error.message : "No pude revisar los correos de Gmail.",
      loading: false,
      message: "",
      previewOpen: false
    }));
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
      await connectGoogle(resource);
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

  const gmailLabelPicker = (
    <div className="connected-service-label-picker">
      <label className="field connected-service-label-field">
        <span>Etiqueta Gmail</span>
        <select
          aria-label="Etiqueta Gmail para importar"
          disabled={state.gmailLabelsLoading || Boolean(state.gmailLabelsError) || !state.gmailLabels.length || state.loading || state.applying}
          onChange={(event) => setState((current) => ({
            ...current,
            bootstrapSnapshot: null,
            error: "",
            lastRun: null,
            selectedGmailLabelId: event.target.value
          }))}
          value={state.selectedGmailLabelId}
        >
          <option value="">{gmailLabelPlaceholder(state, Boolean(effectiveAccessToken))}</option>
          {state.gmailLabels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
        </select>
      </label>
      {state.gmailLabelsError ? (
        <div className="connected-service-label-feedback">
          <span className="form-error" role="alert">{state.gmailLabelsError}</span>
          <Button
            aria-label="Reintentar carga de etiquetas Gmail"
            disabled={state.gmailLabelsLoading || state.loading || state.applying}
            icon="sync"
            onClick={() => setGmailLabelsReloadKey((current) => current + 1)}
            square
            tone="ghost"
          />
        </div>
      ) : !state.gmailLabelsLoading && effectiveAccessToken && !state.gmailLabels.length ? (
        <span className="connected-service-label-empty" role="status">No hay etiquetas personales en esta cuenta de Gmail.</span>
      ) : null}
    </div>
  );

  const syncFeedback = (
    <>
      <SyncPreviewDialog
        allowEmptyApply={activeResource === "mail" && Boolean(state.bootstrapSnapshot)}
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
        <div className="account-source-row gmail-history-source">
          <div className="account-source-main">
            <span className="connected-service-logo active" title="Google"><ProviderIcon name="google" /></span>
            <div>
              <strong>Seleccionar correos</strong>
              <span>Importa correos antiguos por etiqueta.</span>
            </div>
          </div>
          <div className="account-source-actions">
            <Button
              aria-haspopup="dialog"
              aria-label="Seleccionar correos de Gmail"
              disabled={Boolean(mailActionDisabledReason)}
              icon="plus"
              onClick={() => setHistoricalImportOpen(true)}
              square
              tone="secondary"
            />
          </div>
        </div>
        {mailActionDisabledReason && !state.loading ? (
          <p className="connected-service-action-reason">{mailActionDisabledReason}</p>
        ) : null}
        {historicalImportOpen ? (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-describedby="gmail-history-description"
              aria-labelledby="gmail-history-title"
              aria-modal="true"
              className="modal-card gmail-history-dialog"
              role="dialog"
            >
              <div className="modal-head">
                <div>
                  <h2 id="gmail-history-title">Importar correos antiguos</h2>
                  <p id="gmail-history-description">Elige una etiqueta personal de Gmail. Revisarás los correos antes de guardarlos.</p>
                </div>
                <Button aria-label="Cerrar importación de correos antiguos" icon="close" onClick={() => setHistoricalImportOpen(false)} square tone="ghost" />
              </div>

              {mailAuthorizationRequired ? (
                !mailActionDisabledReason ? (
                  <p className="meta">Autoriza el acceso de solo lectura a Gmail para cargar tus etiquetas y seleccionar correos.</p>
                ) : null
              ) : gmailLabelPicker}
              {mailActionDisabledReason && !state.loading ? (
                <p className="connected-service-action-reason">{mailActionDisabledReason}</p>
              ) : null}
              {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
              {state.message ? <p className="meta" role="status">{state.message}</p> : null}

              <div className="modal-actions">
                <Button
                  aria-label="Borrar correos importados"
                  className="account-icon-action destructive"
                  icon="trash"
                  onClick={() => confirmImportedDataDelete("correos")}
                  square
                  tone="secondary"
                />
                {mailAuthorizationRequired ? (
                  <Button
                    disabled={googleConnectionLoading || Boolean(mailActionDisabledReason)}
                    icon="link"
                    onClick={() => void connectGoogle("mail")}
                    tone="primary"
                  >
                    Autorizar Gmail
                  </Button>
                ) : (
                  <Button
                    aria-label={googleConnectionLoading ? "Verificando Gmail" : state.loading ? "Revisando correos antiguos" : "Importar correos antiguos"}
                    disabled={state.loading || state.applying || Boolean(mailActionDisabledReason) || !state.selectedGmailLabelId}
                    icon="mail"
                    onClick={reviewMail}
                    square
                    tone="primary"
                  />
                )}
              </div>
            </section>
          </div>
        ) : null}
        {showCalendarAction ? <div className="connected-service-action">
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
        </div> : null}
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
          <ProviderButton label={state.accessToken ? "Reconectar Google" : "Conectar Google"} name="google" onClick={() => connectGoogle("mail")} />
          <Button disabled={state.loading || state.applying || (Boolean(state.accessToken) && !state.selectedGmailLabelId)} icon="mail" onClick={reviewMail} tone="primary">
            {state.loading && activeResource === "mail" ? "Revisando..." : state.accessToken ? "Importar" : "Conectar Google"}
          </Button>
          <Button disabled={state.loading || state.applying} icon="calendar" onClick={state.accessToken ? reviewCalendar : () => connectGoogle("calendar")} tone="primary">
            {state.loading && activeResource === "calendar" ? "Revisando..." : state.accessToken ? "Importar" : "Conectar Google"}
          </Button>
        </div>
      </div>

      {gmailLabelPicker}

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

function gmailLabelPlaceholder(state: GoogleInteractionsState, hasAccessToken: boolean) {
  if (state.gmailLabelsLoading) return "Cargando etiquetas...";
  if (state.gmailLabelsError) return "No se pudieron cargar las etiquetas";
  if (hasAccessToken && !state.gmailLabels.length) return "No hay etiquetas personales";
  return "Selecciona una etiqueta";
}

function gmailLabelsErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.trim() : "";
  return detail
    ? `No pude cargar las etiquetas de Gmail. ${detail}`
    : "No pude cargar las etiquetas de Gmail. Reintenta la lectura.";
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
