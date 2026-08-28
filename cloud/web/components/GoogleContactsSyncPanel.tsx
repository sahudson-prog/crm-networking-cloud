"use client";

import { useEffect, useMemo, useState } from "react";
import { applyContactSyncPreview, type ApplyContactSyncPreviewResult, type ApplyContactSyncProgress } from "../lib/contactSyncApply";
import { mergeContactsDeep } from "../lib/contactMergeActions";
import type { ContactMergeResult, ContactMergeSource } from "../lib/contactMerge";
import { GOOGLE_CONTACTS_READONLY_SCOPE, GoogleContactsClientError } from "../lib/googleContactsClient";
import { prepareGoogleContactSyncPreview, type GoogleContactSyncCheckpoint, type PrepareGoogleContactSyncResult } from "../lib/googleContactSyncFlow";
import { readAllActiveContacts } from "../lib/cloudData";
import { requireCurrentUserCapability } from "../lib/accessControl";
import { readCurrentGoogleConnectionState } from "../lib/connectedAccounts";
import { reconnectGoogle } from "../lib/googleAuthSession";
import { ACTIVITY_SYNC_MAX_CONTACT_PAGES } from "../lib/interactionSyncLimits";
import type { ContactRow } from "../lib/readModel";
import { supabase } from "../lib/supabaseClient";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { createSyncRunId, writeSyncRunLogStep } from "../lib/syncRunLog";
import { loadActivitySyncLimitValues } from "../lib/usageLimitSettings";
import { Button } from "./ui/Button";
import { ContactMergeDialog } from "./ContactMergeDialog";
import { ProgressBar } from "./ui/ProgressBar";
import { ProviderButton } from "./ui/ProviderIcon";
import { SyncPreviewDialog } from "./SyncPreviewDialog";

type GoogleSyncState = {
  accessToken: string;
  applying: boolean;
  contactsInScope: number;
  diagnostics: GoogleContactSyncCheckpoint[];
  loading: boolean;
  error: string;
  linkedContacts: number;
  message: string;
  progress: ApplyContactSyncProgress | null;
  preview: PrepareGoogleContactSyncResult | null;
  lastApply: ApplyContactSyncPreviewResult | null;
};

const initialState: GoogleSyncState = {
  accessToken: "",
  applying: false,
  contactsInScope: 0,
  diagnostics: [],
  error: "",
  lastApply: null,
  linkedContacts: 0,
  loading: false,
  message: "",
  progress: null,
  preview: null
};

const GOOGLE_CONTACT_SYNC_TABS = ["new", "modified", "deleted"] as const;

type GoogleContactsSyncPanelProps = {
  compact?: boolean;
  googleConnected?: boolean;
};

export function GoogleContactsSyncPanel({ compact = false, googleConnected = true }: GoogleContactsSyncPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<GoogleSyncState>(initialState);
  const [mergeContacts, setMergeContacts] = useState<ContactRow[]>([]);
  const [savedDuplicateMergeSources, setSavedDuplicateMergeSources] = useState<ContactMergeSource[] | null>(null);
  const [savedDuplicateMerging, setSavedDuplicateMerging] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([readCurrentGoogleConnectionState({ registerRememberedScopes: true }), loadGoogleContactStats()]).then(([googleConnection, stats]) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken,
        contactsInScope: stats.contactsInScope,
        linkedContacts: stats.linkedContacts
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const changes = state.preview?.preview ?? [];
    return {
      deleted: changes.filter((change) => change.type === "deleted" || change.type === "deactivated").length,
      modified: changes.filter((change) => change.type === "modified").length,
      new: changes.filter((change) => change.type === "new").length,
      unchanged: changes.filter((change) => change.type === "unchanged").length,
      total: changes.length
    };
  }, [state.preview]);

  async function connectGoogle() {
    try {
      await reconnectGoogle(GOOGLE_CONTACTS_READONLY_SCOPE, `${window.location.origin}/cuenta`);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude conectar Google."
      }));
    }
  }

  async function preparePreview(forceFullSync = false) {
    try {
      await requireCurrentUserCapability("contacts.import_google", "importar contactos desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        progress: null
      }));
      setOpen(true);
      return;
    }

    const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    setState((current) => ({ ...current, accessToken: googleConnection.accessToken }));
    if (!googleConnection.connected || !googleConnection.accessToken) {
      setState((current) => ({
        ...current,
        error: "",
        loading: true,
        message: "Reconectando Google..."
      }));
      await connectGoogle();
      return;
    }

    setState((current) => ({
      ...current,
      error: "",
      lastApply: null,
      loading: true,
      message: "",
      progress: null,
      preview: null,
      diagnostics: []
    }));

    const runId = createSyncRunId();
    let stepOrder = 0;
    const logStep = (step: string, detail?: string | null, status: "info" | "running" | "success" | "warning" | "error" = "info", metadata?: Record<string, unknown>) => {
      stepOrder += 1;
      void writeSyncRunLogStep({
        detail,
        metadata,
        operation: forceFullSync ? "import_full" : "review",
        provider: "google",
        resourceType: "contacts",
        runId,
        scopeLabel: "cuenta",
        status,
        step,
        stepOrder
      });
    };
    logStep("Inicio", forceFullSync ? "Importacion completa solicitada." : "Revision solicitada.", "running");

    try {
      const syncLimits = await loadActivitySyncLimitValues();
      const preview = await prepareGoogleContactSyncPreview({
        accessToken: googleConnection.accessToken,
        forceFullSync,
        maxPages: syncLimits.contactPages || ACTIVITY_SYNC_MAX_CONTACT_PAGES,
        onCheckpoint: (checkpoint) => {
          logStep(checkpoint.step, checkpoint.detail);
          setState((current) => ({
            ...current,
            diagnostics: [...current.diagnostics, checkpoint]
          }));
        }
      });

      setState((current) => ({
        ...current,
        loading: false,
        message: previewMessage(preview),
        progress: null,
        preview
      }));
      logStep("Preview listo", previewLogSummary(preview.preview ?? []), "success", {
        pages_read: preview.googleRead.pagesRead,
        read_mode: preview.googleRead.mode,
        total_google: preview.googleRead.totalItems
      });
      setOpen(true);
    } catch (error) {
      logStep("Error", error instanceof Error ? error.message : "No pude preparar la sincronizacion de contactos.", "error");
      if (error instanceof GoogleContactsClientError && error.code === "GOOGLE_CONTACTS_AUTH_REQUIRED") {
        setState((current) => ({
          ...current,
          accessToken: "",
          error: "El permiso de Google vencio o no es valido. Vuelve a conectar Google y luego revisa cambios.",
          loading: false,
          progress: null
        }));
        setOpen(true);
        return;
      }

      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude preparar la sincronizacion de contactos.",
        loading: false,
        progress: null
      }));
      setOpen(true);
    }
  }

  async function applyPreview(selectedChanges: SyncPreviewChange[]) {
    try {
      await requireCurrentUserCapability("contacts.import_google", "importar contactos desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        progress: null
      }));
      setOpen(true);
      return;
    }

    const previewBeforeApply = state.preview;
    if (!previewBeforeApply) return;

    setState((current) => ({
      ...current,
      applying: true,
      error: "",
      message: "",
      progress: {
        appliedCount: 0,
        failedCount: 0,
        processedCount: 0,
        totalCount: selectedChanges.filter((change) => change.type !== "unchanged").length
      }
    }));

    const runId = createSyncRunId();
    void writeSyncRunLogStep({
      detail: `${selectedChanges.length} cambio(s) seleccionados.`,
      operation: "apply",
      provider: "google",
      resourceType: "contacts",
      runId,
      scopeLabel: "cuenta",
      status: "running",
      step: "Aplicacion iniciada",
      stepOrder: 1
    });

    try {
      const result = await applyContactSyncPreview({
        changes: selectedChanges,
        cursorAfter: previewBeforeApply.cursorAfter,
        cursorLabel: "",
        onProgress: (progress) => {
          setState((current) => ({
            ...current,
            message: progress.totalCount
              ? `Aplicando ${progress.processedCount} de ${progress.totalCount}: ${progress.appliedCount} aplicados, ${progress.failedCount} fallidos.`
              : "Preparando aplicacion...",
            progress
          }));
        },
        provider: "google",
        source: "google_contacts_sync_panel",
        totalPreviewChanges: actionableChangeCount(previewBeforeApply.preview ?? selectedChanges)
      });

      const remainingChanges = remainingPreviewChanges(previewBeforeApply.preview ?? [], result.appliedChangeIds);
      setState((current) => ({
        ...current,
        applying: false,
        lastApply: result,
        message: applyMessage(result),
        progress: null,
        preview: remainingChanges.length
          ? { ...previewBeforeApply, preview: remainingChanges }
          : null
      }));
      if (result.ok) {
        const stats = await loadGoogleContactStats();
        setState((current) => ({
          ...current,
          contactsInScope: stats.contactsInScope,
          linkedContacts: stats.linkedContacts
        }));
      }
      void writeSyncRunLogStep({
        detail: `${result.appliedCount} aplicados, ${result.failedCount} fallidos, ${result.pendingCount} pendientes.`,
        metadata: {
          applied_change_ids: result.appliedChangeIds,
          cursor_saved: result.cursorSaved,
          failed_change_ids: result.failedChangeIds
        },
        operation: "apply",
        provider: "google",
        resourceType: "contacts",
        runId,
        scopeLabel: "cuenta",
        status: result.ok ? "success" : "warning",
        step: "Aplicacion terminada",
        stepOrder: 2
      });
      setOpen(hasActionableChanges(remainingChanges));
    } catch (error) {
      void writeSyncRunLogStep({
        detail: error instanceof Error ? error.message : "No pude aplicar la seleccion.",
        operation: "apply",
        provider: "google",
        resourceType: "contacts",
        runId,
        scopeLabel: "cuenta",
        status: "error",
        step: "Error aplicando",
        stepOrder: 2
      });
      setState((current) => ({
        ...current,
        applying: false,
        progress: null,
        error: error instanceof Error ? error.message : "No pude aplicar la seleccion."
      }));
    }
  }

  async function openSavedDuplicateMerge(sources: ContactMergeSource[]) {
    setState((current) => ({ ...current, error: "", message: "" }));
    try {
      const rows = await readAllActiveContacts();
      setMergeContacts(rows);
      setSavedDuplicateMergeSources(sources);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude cargar contactos guardados para fusionar."
      }));
    }
  }

  async function mergeSavedDuplicates(result: ContactMergeResult, sources: ContactMergeSource[]) {
    const [target, ...sourceContacts] = sources;
    if (!target || !sourceContacts.length) {
      setState((current) => ({ ...current, error: "Elige 2 o 3 contactos guardados para fusionar." }));
      return;
    }

    setSavedDuplicateMerging(true);
    setState((current) => ({ ...current, error: "", message: "" }));
    try {
      await mergeContactsDeep({
        result,
        source: "google_contacts_duplicate_complex",
        sourceContactIds: sourceContacts.map((source) => source.id),
        targetContactId: target.id
      });
      setSavedDuplicateMergeSources(null);
      setState((current) => ({
        ...current,
        message: "Contactos guardados fusionados. Vuelve a revisar cambios para actualizar esta propuesta."
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude fusionar estos contactos guardados."
      }));
    } finally {
      setSavedDuplicateMerging(false);
    }
  }

  function handlePrimarySyncClick() {
    if (!googleConnected) {
      setState((current) => ({
        ...current,
        error: "Primero conecta Google para autorizar lectura de contactos."
      }));
      return;
    }
    void preparePreview(false);
  }

  const syncFeedback = (
    <>
      {state.loading ? (
        <ProgressBar
          compact
          detail="Leyendo fuente conectada"
          indeterminate
          label="Revisando contactos"
          tone="neutral"
        />
      ) : null}
      {state.applying && state.progress ? (
        <ProgressBar
          compact
          detail={`${state.progress.appliedCount} aplicados / ${state.progress.failedCount} fallidos`}
          label="Aplicando contactos"
          max={state.progress.totalCount}
          tone={state.progress.failedCount ? "warning" : "primary"}
          value={state.progress.processedCount}
        />
      ) : null}

      <SyncPreviewDialog
        applying={state.applying}
        changes={state.preview?.preview ?? []}
        description="Revisa los cambios detectados. Los cambios que no selecciones quedan pendientes para la proxima sincronizacion."
        feedbackMessage={state.error || state.message || state.lastApply?.warnings.join(" ") || ""}
        feedbackTone={state.error || state.lastApply?.failedCount ? "error" : "info"}
        onApply={applyPreview}
        onClose={() => setOpen(false)}
        onOpenSavedDuplicateMerge={openSavedDuplicateMerge}
        open={open}
        progress={state.applying && state.progress ? {
          detail: `${state.progress.appliedCount} aplicados / ${state.progress.failedCount} fallidos`,
          label: "Aplicando contactos",
          max: state.progress.totalCount,
          tone: state.progress.failedCount ? "warning" : "primary",
          value: state.progress.processedCount
        } : undefined}
        tabKeys={GOOGLE_CONTACT_SYNC_TABS}
        title="Cambios desde Google Contacts"
      />

      <ContactMergeDialog
        availableContacts={mergeContacts}
        description="Fusiona contactos que ya estan guardados en la app. Despues vuelve a revisar cambios para recalcular la importacion."
        note="Al fusionar, las interacciones, referidos, ToDos e IDs externos quedaran asociados al contacto resultante."
        onClose={() => setSavedDuplicateMergeSources(null)}
        onSave={mergeSavedDuplicates}
        open={Boolean(savedDuplicateMergeSources)}
        saveLabel={savedDuplicateMerging ? "Fusionando..." : "Fusionar"}
        saving={savedDuplicateMerging}
        sources={savedDuplicateMergeSources ?? []}
        title="Fusionar duplicados guardados"
      />
    </>
  );

  if (compact) {
    return (
      <div className="connected-service-action">
        <div className="connected-service-action-main">
          <strong>Contactos</strong>
          <span>{state.linkedContacts} vinculados · {state.contactsInScope} en foco</span>
        </div>
        <div className="toolbar">
          <Button disabled={state.loading || !googleConnected || !state.accessToken} icon="users" onClick={handlePrimarySyncClick} tone="primary">
            {state.loading ? "Revisando..." : "Importar"}
          </Button>
          <Button icon="trash" onClick={() => confirmImportedDataDelete("contactos")} tone="danger">
            Borrar importados
          </Button>
        </div>
        <div className="connected-service-feedback">{syncFeedback}</div>
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Importar contactos</h2>
          <span className="panel-caption">Lee Google Contacts y confirma antes de guardar cambios en la app.</span>
        </div>
        <div className="toolbar">
          <ProviderButton label={state.accessToken ? "Reconectar Google" : "Conectar Google"} name="google" onClick={connectGoogle} />
          <Button disabled={state.loading} icon="users" onClick={handlePrimarySyncClick} tone="primary">
            {state.loading ? "Revisando..." : state.accessToken ? "Importar" : "Conectar Google"}
          </Button>
        </div>
      </div>

      {syncFeedback}
    </section>
  );
}

async function loadGoogleContactStats() {
  if (!supabase) return { contactsInScope: 0, linkedContacts: 0 };
  const [linkedContacts, contactsInScope] = await Promise.all([
    countRows("external_contact_ids", { is_active: true, provider: "google" }),
    countRows("contacts", { is_active: true, networking_focus: true })
  ]);
  return { contactsInScope, linkedContacts };
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

function confirmImportedDataDelete(kind: string) {
  window.alert(
    `Pendiente: borrar ${kind} importados requiere definir si se conservan o eliminan notas, minutas y datos asociados. No se borro nada.`
  );
}

function previewMessage(preview: PrepareGoogleContactSyncResult) {
  const mode = preview.googleRead.mode === "incremental" ? "incremental" : "completa";
  const changes = preview.preview ?? [];
  const actionables = actionableChangeCount(changes);
  const unchanged = changes.filter((change) => change.type === "unchanged").length;
  const warnings = preview.warnings.length ? ` ${preview.warnings.join(" ")}` : "";
  return `Revision ${mode}: ${actionables} cambios detectados y ${unchanged} contactos sin cambios en ${preview.googleRead.pagesRead} pagina(s).${warnings}`;
}

function previewLogSummary(changes: SyncPreviewChange[]) {
  const newCount = changes.filter((change) => change.type === "new").length;
  const modifiedCount = changes.filter((change) => change.type === "modified").length;
  const deletedCount = changes.filter((change) => change.type === "deleted" || change.type === "deactivated").length;
  const unchangedCount = changes.filter((change) => change.type === "unchanged").length;
  return `${changes.length} revisados: ${newCount} nuevos, ${modifiedCount} modificaciones, ${deletedCount} eliminaciones, ${unchangedCount} sin cambios.`;
}

function applyMessage(result: ApplyContactSyncPreviewResult) {
  const cursor = result.cursorSaved ? "cursor actualizado" : "cursor sin actualizar";
  const prefix = result.ok ? "Aplicacion terminada" : "Aplicacion parcial";
  return `${prefix}: ${result.appliedCount} aplicados, ${result.failedCount} fallidos, ${result.pendingCount} pendientes; ${cursor}.`;
}

function actionableChangeCount(changes: SyncPreviewChange[]) {
  return changes.filter((change) => change.type !== "unchanged").length;
}

function remainingPreviewChanges(changes: SyncPreviewChange[], appliedChangeIds: string[]) {
  const appliedIds = new Set(appliedChangeIds);
  return changes.filter((change) => change.type === "unchanged" || !appliedIds.has(change.id));
}

function hasActionableChanges(changes: SyncPreviewChange[]) {
  return changes.some((change) => change.type !== "unchanged");
}
