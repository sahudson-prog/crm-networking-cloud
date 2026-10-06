"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleInteractionClientError
} from "../lib/googleInteractionClient";
import {
  syncGoogleInteractions,
  type SyncGoogleInteractionsResult
} from "../lib/googleInteractionSyncFlow";
import {
  ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
  ACTIVITY_SYNC_MAX_CALENDAR_PAGES,
  ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
  ACTIVITY_SYNC_MAX_MAIL_PAGES
} from "../lib/interactionSyncLimits";
import {
  GLOBAL_SYNC_SUMMARY_DURATION_MS,
  aggregateGlobalActivityFreshness,
  globalActivityStatusText,
  resolveActivitySyncSelection
} from "../lib/activitySyncStatus";
import {
  activitySyncExecutionHasErrors,
  activitySyncExecutionSummary,
  allActivitySyncServicesSucceeded,
  executeActivitySyncServices,
  freshnessAfterActivitySync,
  type ActivitySyncService,
  type ActivitySyncServiceOutcome
} from "../lib/activitySyncExecution";
import {
  actionableInteractionPreviewChanges,
  externalIdsFromInteractionPreview
} from "../lib/interactionSyncPreview";
import { requireCurrentUserCapability } from "../lib/accessControl";
import { googleConnectionHasCapability, readCurrentGoogleConnectionState } from "../lib/connectedAccounts";
import { invalidateActiveGoogleDataAuthorization } from "../lib/googleAuthSession";
import type { ContactRow } from "../lib/readModel";
import { calendarRollingWindowIso } from "../lib/syncDate";
import { createSyncRunId, writeSyncRunLogStep } from "../lib/syncRunLog";
import { loadActivitySyncLimitValues } from "../lib/usageLimitSettings";
import {
  readGlobalActivityServiceFreshness,
  recordGlobalActivitySyncSuccess,
  type GlobalActivityServiceFreshness
} from "../lib/syncCursorStore";
import { useInteractionSyncPreferences } from "./InteractionSyncPreferencesProvider";
import { Button } from "./ui/Button";

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

type ActivitySyncAttempt = {
  error: string;
  reauthorizationRequired: boolean;
  result: SyncGoogleInteractionsResult | null;
};

type ActivitySyncState = {
  accessToken: string;
  applying: boolean;
  calendarAvailable: boolean;
  connectionKnown: boolean;
  connectedAccountId: string | null;
  error: string;
  gmailAvailable: boolean;
  lastSuccessfulAt: string | null;
  loading: boolean;
  message: string;
  pendingUpdate: boolean;
  reauthorizationRequired: boolean;
  serviceFreshness: GlobalActivityServiceFreshness;
  transientError: boolean;
  transientSummary: string;
  userEmail: string;
};

const initialState: ActivitySyncState = {
  accessToken: "",
  applying: false,
  calendarAvailable: false,
  connectionKnown: false,
  connectedAccountId: null,
  error: "",
  gmailAvailable: false,
  lastSuccessfulAt: null,
  loading: false,
  message: "",
  pendingUpdate: false,
  reauthorizationRequired: false,
  serviceFreshness: { calendar: null, mail: null },
  transientError: false,
  transientSummary: "",
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
  const syncPreferences = useInteractionSyncPreferences();
  const [state, setState] = useState<ActivitySyncState>(initialState);
  const transientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selection = useMemo(() => resolveActivitySyncSelection({
    calendarAvailable: state.calendarAvailable,
    contactFocused: contact?.networking_focus,
    gmailAvailable: state.gmailAvailable,
    preferences: syncPreferences.preferences,
    variant
  }), [
    contact?.networking_focus,
    state.calendarAvailable,
    state.gmailAvailable,
    syncPreferences.preferences,
    variant
  ]);
  const notice = useMemo(
    () => activitySyncNotice(state, {
      connectionRequired: selection.connectionRequired,
      preferencesError: syncPreferences.error,
      preferencesLoading: syncPreferences.loading,
      syncDisabled: selection.syncDisabled,
      variant
    }),
    [selection.connectionRequired, selection.syncDisabled, state, syncPreferences.error, syncPreferences.loading, variant]
  );

  useEffect(() => {
    let active = true;
    if (syncPreferences.loading) return () => {
      active = false;
    };
    readCurrentGoogleConnectionState({ registerRememberedScopes: true }).then(async (googleConnection) => {
        const serviceFreshness = variant === "focus_incremental"
          ? await readGlobalActivityServiceFreshness(googleConnection.account?.id ?? null).catch(() => ({ calendar: null, mail: null }))
          : { calendar: null, mail: null };
        if (!active) return;
        const freshness = aggregateGlobalActivityFreshness(syncPreferences.preferences, serviceFreshness);
        setState((current) => ({
          ...current,
          accessToken: googleConnection.accessToken,
          calendarAvailable: googleConnectionHasCapability(googleConnection, "calendar_read"),
          connectionKnown: true,
          connectedAccountId: googleConnection.account?.id ?? null,
          gmailAvailable: googleConnectionHasCapability(googleConnection, "gmail_read"),
          lastSuccessfulAt: freshness.lastSuccessfulAt,
          pendingUpdate: freshness.pendingUpdate,
          serviceFreshness,
          userEmail: googleConnection.userEmail
        }));
      }).catch((error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          connectionKnown: true,
          error: error instanceof Error ? error.message : "No pude revisar la conexión Google."
        }));
      });
    return () => {
      active = false;
      if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    };
  }, [syncPreferences.loading, syncPreferences.preferences, variant]);

  useEffect(() => {
    onNoticeChange?.(notice);
  }, [notice, onNoticeChange]);

  useEffect(() => {
    return () => onNoticeChange?.(null);
  }, [onNoticeChange]);

  const label = variant === "single_contact" ? "Actualizar interacciones contacto" : "Actualizar interacciones";

  function openSyncSettings() {
    window.location.assign("/cuenta#interaction-sync-preferences");
  }

  async function reviewSync() {
    if (syncPreferences.loading || selection.syncDisabled) return;
    if (!state.connectionKnown || selection.connectionRequired) {
      openSyncSettings();
      return;
    }
    try {
      await requireCurrentUserCapability("interactions.import_google", "actualizar interacciones desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        message: ""
      }));
      return;
    }

    setState((current) => ({
      ...current,
      error: "",
      loading: true,
      message: "Conectando con Google...",
      reauthorizationRequired: false,
      transientError: false,
      transientSummary: ""
    }));
    try {
      const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
      const currentSelection = resolveActivitySyncSelection({
        calendarAvailable: googleConnectionHasCapability(googleConnection, "calendar_read"),
        contactFocused: contact?.networking_focus,
        gmailAvailable: googleConnectionHasCapability(googleConnection, "gmail_read"),
        preferences: syncPreferences.preferences,
        variant
      });
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        calendarAvailable: googleConnectionHasCapability(googleConnection, "calendar_read"),
        connectionKnown: true,
        connectedAccountId: googleConnection.account?.id ?? null,
        gmailAvailable: googleConnectionHasCapability(googleConnection, "gmail_read"),
        userEmail: googleConnection.userEmail
      }));
      if (currentSelection.connectionRequired || !googleConnection.connected || !googleConnection.accessToken) {
        setState((current) => ({
          ...current,
          error: "",
          reauthorizationRequired: true
        }));
        openSyncSettings();
        return;
      }

      if (!googleConnection.userEmail) {
        setState((current) => ({
          ...current,
          error: "No pude identificar el correo del usuario conectado."
        }));
        return;
      }

      if (variant === "focus_incremental") {
        await runGlobalSync({
          accessToken: googleConnection.accessToken,
          connectedAccountId: googleConnection.account?.id ?? null,
          includeCalendar: currentSelection.includeCalendar,
          includeMail: currentSelection.includeMail,
          userEmail: googleConnection.userEmail
        });
        return;
      }

      if (!contact?.id) {
        setState((current) => ({ ...current, error: "No pude identificar el contacto que se debe actualizar." }));
        return;
      }

      await runContactSync({
        accessToken: googleConnection.accessToken,
        connectedAccountId: googleConnection.account?.id ?? null,
        includeCalendar: currentSelection.includeCalendar,
        includeMail: currentSelection.includeMail,
        userEmail: googleConnection.userEmail
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude actualizar las interacciones."
      }));
    } finally {
      setState((current) => ({
        ...current,
        applying: false,
        loading: false,
        message: ""
      }));
    }
  }

  async function runGlobalSync(input: {
    accessToken: string;
    connectedAccountId: string | null;
    includeCalendar: boolean;
    includeMail: boolean;
    userEmail: string;
  }) {
    await runIndependentActivitySync(input, "global");
  }

  async function runContactSync(input: {
    accessToken: string;
    connectedAccountId: string | null;
    includeCalendar: boolean;
    includeMail: boolean;
    userEmail: string;
  }) {
    await runIndependentActivitySync(input, "contact");
  }

  async function runIndependentActivitySync(
    input: {
      accessToken: string;
      connectedAccountId: string | null;
      includeCalendar: boolean;
      includeMail: boolean;
      userEmail: string;
    },
    scope: "global" | "contact"
  ) {
    clearTransientSummary();
    setState((current) => ({
      ...current,
      applying: false,
      error: "",
      loading: true,
      message: "Actualizando…",
      reauthorizationRequired: false,
      transientError: false,
      transientSummary: ""
    }));
    const outcomes = await executeActivitySyncServices({
      includeCalendar: input.includeCalendar,
      includeMail: input.includeMail,
      runService: (service) => runActivityService(input, scope, service)
    });

    const transientSummary = activitySyncExecutionSummary(outcomes);
    const transientError = activitySyncExecutionHasErrors(outcomes);
    const reauthorizationRequired = outcomes.some((outcome) => outcome.reauthorizationRequired);
    const anySuccess = outcomes.some((outcome) => outcome.success);
    if (scope === "global" && allActivitySyncServicesSucceeded(outcomes)) {
      try {
        await recordGlobalActivitySyncSuccess({
          connectedAccountId: input.connectedAccountId,
          services: includedGoogleActivityServices(input),
          syncedAt: new Date().toISOString()
        });
      } catch {}
    }

    setState((current) => {
      const serviceFreshness = scope === "global"
        ? freshnessAfterActivitySync(current.serviceFreshness, outcomes)
        : current.serviceFreshness;
      const freshness = aggregateGlobalActivityFreshness(syncPreferences.preferences, serviceFreshness);
      return {
        ...current,
        accessToken: reauthorizationRequired ? "" : current.accessToken,
        applying: false,
        error: "",
        lastSuccessfulAt: freshness.lastSuccessfulAt,
        loading: false,
        message: "",
        pendingUpdate: freshness.pendingUpdate,
        reauthorizationRequired,
        serviceFreshness,
        transientError,
        transientSummary
      };
    });
    transientTimerRef.current = setTimeout(() => {
      setState((current) => ({ ...current, transientError: false, transientSummary: "" }));
      transientTimerRef.current = null;
    }, GLOBAL_SYNC_SUMMARY_DURATION_MS);
    if (anySuccess) onSynced?.();
  }

  async function runActivityService(
    input: {
      accessToken: string;
      connectedAccountId: string | null;
      includeCalendar: boolean;
      includeMail: boolean;
      userEmail: string;
    },
    scope: "global" | "contact",
    service: ActivitySyncService
  ): Promise<ActivitySyncServiceOutcome> {
    const serviceInput = {
      ...input,
      includeCalendar: service === "calendar",
      includeMail: service === "mail"
    };
    setState((current) => ({ ...current, applying: false, loading: true, message: "Actualizando…" }));
    const reviewed = await runSync({ ...serviceInput, dryRun: true });
    if (!reviewed.result || !reviewed.result.ok) {
      return failedServiceOutcome(service, reviewed);
    }

    if (service === "mail") {
      const snapshot = scope === "global"
        ? reviewed.result.gmailFocusedSnapshot
        : reviewed.result.gmailContactSnapshot;
      if (!snapshot?.complete) {
        return {
          created: 0,
          error: scope === "global"
            ? "Gmail no pudo completar la lectura. Intenta nuevamente."
            : "Gmail no pudo completar la lectura de los últimos 14 días. Intenta nuevamente.",
          reauthorizationRequired: false,
          service,
          success: false,
          syncedAt: null
        };
      }
    }

    const externalIds = externalIdsFromInteractionPreview(actionableInteractionPreviewChanges(reviewed.result));
    setState((current) => ({ ...current, applying: true, loading: false, message: "Actualizando…" }));
    const applied = await runSync({
      ...serviceInput,
      dryRun: false,
      externalIds,
      gmailContactSnapshot: scope === "contact" ? reviewed.result.gmailContactSnapshot : undefined,
      gmailFocusedSnapshot: scope === "global" ? reviewed.result.gmailFocusedSnapshot : undefined,
      calendarRollingSnapshot: reviewed.result.calendarRollingSnapshot
    });
    if (!applied.result || !applied.result.ok) {
      return failedServiceOutcome(service, applied);
    }

    const serviceResult = service === "mail" ? applied.result.mail : applied.result.calendar;
    return {
      created: serviceResult?.counts.created ?? 0,
      error: "",
      reauthorizationRequired: false,
      service,
      success: true,
      syncedAt: new Date().toISOString()
    };
  }

  function clearTransientSummary() {
    if (transientTimerRef.current) {
      clearTimeout(transientTimerRef.current);
      transientTimerRef.current = null;
    }
  }

  async function runSync(input: {
    accessToken: string;
    connectedAccountId: string | null;
    dryRun: boolean;
    externalIds?: string[];
    gmailContactSnapshot?: SyncGoogleInteractionsResult["gmailContactSnapshot"];
    gmailFocusedSnapshot?: SyncGoogleInteractionsResult["gmailFocusedSnapshot"];
    calendarRollingSnapshot?: SyncGoogleInteractionsResult["calendarRollingSnapshot"];
    includeCalendar: boolean;
    includeMail: boolean;
    userEmail: string;
  }): Promise<ActivitySyncAttempt> {
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
      const calendarWindow = input.includeCalendar ? calendarRollingWindowIso() : null;
      const syncLimits = await loadActivitySyncLimitValues();
      logStep("Parametros", input.includeCalendar
        ? `Ventana Calendar: ${formatLogDate(calendarWindow?.since ?? null)} a ${formatLogDate(calendarWindow?.until ?? null)}.`
        : "Calendar no participa en esta unidad.", "info", {
        calendar_events_limit: syncLimits.calendarEvents,
        contact_id: contact?.id ?? null,
        mail_messages_limit: syncLimits.mailMessages,
        variant
      });
      const result = await syncGoogleInteractions({
        accessToken: input.accessToken,
        calendarQuery: null,
        calendarFutureTimeMax: calendarWindow?.until ?? null,
        calendarFutureTimeMin: null,
        calendarRollingWindowSync: input.includeCalendar ? (variant === "focus_incremental" ? "global" : "contact") : undefined,
        calendarRollingSnapshot: input.dryRun ? null : input.calendarRollingSnapshot,
        calendarTimeMin: calendarWindow?.since ?? null,
        connectedAccountId: input.connectedAccountId,
        contactIds: variant === "single_contact" && contact?.id ? [contact.id] : undefined,
        dryRun: input.dryRun,
        focusedOnly: variant === "focus_incremental" || input.includeCalendar,
        globalFocusedMailSync: variant === "focus_incremental",
        contactRecentMailSync: variant === "single_contact",
        gmailContactSnapshot: input.dryRun ? null : input.gmailContactSnapshot,
        gmailFocusedSnapshot: input.dryRun ? null : input.gmailFocusedSnapshot,
        gmailQuery: null,
        gmailSince: null,
        includeCalendar: input.includeCalendar,
        includeMail: input.includeMail && (
          input.dryRun
          || Boolean(input.gmailContactSnapshot)
          || Boolean(input.gmailFocusedSnapshot)
        ),
        maxCalendarEvents: syncLimits.calendarEvents || ACTIVITY_SYNC_MAX_CALENDAR_EVENTS,
        maxMailMessages: syncLimits.mailMessages || ACTIVITY_SYNC_MAX_MAIL_MESSAGES,
        maxPages: input.includeCalendar
          ? syncLimits.calendarPages || ACTIVITY_SYNC_MAX_CALENDAR_PAGES
          : syncLimits.mailPages || ACTIVITY_SYNC_MAX_MAIL_PAGES,
        ...(input.externalIds?.length ? { externalIds: input.externalIds } : {}),
        saveCursors: variant === "focus_incremental" || input.includeMail,
        saveReadDiagnostics: input.dryRun,
        userEmail: input.userEmail
      });
      const authFailure = hasGoogleInteractionAuthFailure(result);
      if (authFailure) {
        invalidateActiveGoogleDataAuthorization();
        logStep("Autorización Google requerida", "Permiso vencido o insuficiente.", "warning", {
          errors: result.errors
        });
        return {
          error: serviceSyncErrorMessage(result, requestedActivityService(input)),
          reauthorizationRequired: true,
          result
        };
      }
      logStep(input.dryRun ? "Preview listo" : "Aplicacion terminada", activityLogSummary(result), result.ok ? "success" : "warning", {
        errors: result.errors,
        warnings: result.warnings
      });
      return {
        error: result.ok ? "" : serviceSyncErrorMessage(result, requestedActivityService(input)),
        reauthorizationRequired: false,
        result
      };
    } catch (error) {
      logStep("Error", error instanceof Error ? error.message : "No pude actualizar la actividad.", "error");
      if (error instanceof GoogleInteractionClientError && error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") {
        invalidateActiveGoogleDataAuthorization();
        logStep("Autorización Google requerida", "Permiso vencido o insuficiente.", "warning");
        return {
          error: serviceThrownErrorMessage(requestedActivityService(input), error),
          reauthorizationRequired: true,
          result: null
        };
      }
      return {
        error: serviceThrownErrorMessage(requestedActivityService(input), error),
        reauthorizationRequired: false,
        result: null
      };
    }
  }

  return (
    <>
      <span className={`activity-sync-control ${variant === "focus_incremental" ? "global-activity-sync-control" : ""}`}>
        <Button
          aria-label={label}
          className={variant === "focus_incremental" ? "global-activity-sync" : ""}
          disabled={syncPreferences.loading || !state.connectionKnown || !selection.canSync || state.loading || state.applying}
          icon="sync"
          onClick={reviewSync}
          square={square}
          tone={square ? "secondary" : variant === "focus_incremental" ? "primary" : "secondary"}
        >
          {square ? null : state.loading ? "Revisando..." : state.applying ? "Aplicando..." : label}
        </Button>
        {variant === "focus_incremental" ? (
          <span
            className={`activity-sync-status ${state.error || state.transientError || state.reauthorizationRequired || selection.connectionRequired ? "error" : ""}`}
            role={state.error || state.transientError || state.reauthorizationRequired || selection.connectionRequired ? "alert" : "status"}
          >
            {globalActivityStatusText({
              ...state,
              connectionRequired: state.connectionKnown && selection.connectionRequired,
              pendingUpdate: state.pendingUpdate,
              syncDisabled: !syncPreferences.loading && selection.syncDisabled
            })}
          </span>
        ) : showMessage && notice ? (
          <span className={`activity-sync-message ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </span>
        ) : null}
        {state.reauthorizationRequired || (state.connectionKnown && selection.connectionRequired) ? (
          <button className="activity-sync-reauthorize" onClick={openSyncSettings} type="button">
            {state.reauthorizationRequired ? "Reautorizar" : "Configurar"}
          </button>
        ) : null}
      </span>
    </>
  );
}

function hasGoogleInteractionAuthFailure(result: SyncGoogleInteractionsResult) {
  return result.errors.some((error) => error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED");
}

function includedGoogleActivityServices(input: { includeCalendar: boolean; includeMail: boolean }) {
  const services: Array<"calendar" | "mail"> = [];
  if (input.includeMail) services.push("mail");
  if (input.includeCalendar) services.push("calendar");
  return services.sort();
}

function failedServiceOutcome(service: ActivitySyncService, attempt: ActivitySyncAttempt): ActivitySyncServiceOutcome {
  return {
    created: 0,
    error: attempt.error || `Error al actualizar ${activityServiceLabel(service)}`,
    reauthorizationRequired: attempt.reauthorizationRequired,
    service,
    success: false,
    syncedAt: null
  };
}

function requestedActivityService(input: { includeCalendar: boolean; includeMail: boolean }): ActivitySyncService {
  return input.includeMail ? "mail" : "calendar";
}

function serviceSyncErrorMessage(result: SyncGoogleInteractionsResult, service: ActivitySyncService) {
  const serviceResult = service === "mail" ? result.mail : result.calendar;
  const codes = new Set([
    ...result.errors.map((error) => error.code),
    ...(serviceResult?.errors ?? []).map((error) => error.code)
  ]);
  const label = activityServiceLabel(service);
  if (codes.has("GOOGLE_INTERACTIONS_AUTH_REQUIRED")) return `${label} requiere reconexión.`;
  if (codes.has("GOOGLE_INTERACTIONS_RATE_LIMITED")) {
    return `${label} alcanzó temporalmente su límite de uso. Intenta nuevamente más tarde.`;
  }
  if (codes.has("GOOGLE_INTERACTIONS_INVALID_RESPONSE")) {
    return `${label} devolvió una respuesta inesperada. Intenta nuevamente.`;
  }
  if ((serviceResult?.counts.failed ?? 0) > 0 || (serviceResult?.errors.length ?? 0) > 0) {
    return service === "mail"
      ? "No pude guardar algunos correos. Intenta nuevamente."
      : "No pude guardar algunas citas. Intenta nuevamente.";
  }
  return `Error al actualizar ${label}`;
}

function serviceThrownErrorMessage(service: ActivitySyncService, error: unknown) {
  const label = activityServiceLabel(service);
  if (error instanceof GoogleInteractionClientError) {
    if (error.code === "GOOGLE_INTERACTIONS_AUTH_REQUIRED") return `${label} requiere reconexión.`;
    if (error.code === "GOOGLE_INTERACTIONS_RATE_LIMITED") {
      return `${label} alcanzó temporalmente su límite de uso. Intenta nuevamente más tarde.`;
    }
    if (error.code === "GOOGLE_INTERACTIONS_INVALID_RESPONSE") {
      return `${label} devolvió una respuesta inesperada. Intenta nuevamente.`;
    }
  }
  return `Error al actualizar ${label}`;
}

function activityServiceLabel(service: ActivitySyncService) {
  return service === "mail" ? "Gmail" : "Calendar";
}

function activitySyncNotice(state: ActivitySyncState, input: {
  connectionRequired: boolean;
  preferencesError: string;
  preferencesLoading: boolean;
  syncDisabled: boolean;
  variant: ActivitySyncButtonProps["variant"];
}): ActivitySyncNotice | null {
  if (input.preferencesError) {
    return { text: input.preferencesError, tone: "error" };
  }
  if (input.preferencesLoading || !state.connectionKnown) return null;
  if (input.connectionRequired) {
    return { text: "Requiere conexión", tone: "error" };
  }
  if (input.syncDisabled) {
    return {
      text: input.variant === "focus_incremental" ? "Sincronización desactivada" : "Sin servicios habilitados para este contacto",
      tone: "info"
    };
  }
  if (state.error) {
    return { text: state.error, tone: "error" };
  }
  if (state.transientSummary) {
    return { text: state.transientSummary, tone: state.transientError ? "error" : "info" };
  }
  if (state.reauthorizationRequired) {
    return { text: "Requiere conexión", tone: "error" };
  }
  if (!state.message) {
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
