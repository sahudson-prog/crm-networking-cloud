"use client";

import { useEffect, useMemo, useState } from "react";
import { applyContactSyncPreview, type ApplyContactSyncPreviewResult, type ApplyContactSyncProgress } from "../lib/contactSyncApply";
import { buildContactSyncPreview } from "../lib/contactSyncPreview";
import { requireCurrentUserCapability } from "../lib/accessControl";
import { readCurrentGoogleConnectionState } from "../lib/connectedAccounts";
import { reconnectGoogle } from "../lib/googleAuthSession";
import { GOOGLE_CONTACTS_READONLY_SCOPE, GoogleContactsClientError, readGoogleContact } from "../lib/googleContactsClient";
import type { ContactRow } from "../lib/readModel";
import { supabase } from "../lib/supabaseClient";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { createSyncRunId, writeSyncRunLogStep } from "../lib/syncRunLog";
import { SyncPreviewDialog } from "./SyncPreviewDialog";
import { Button } from "./ui/Button";

type ContactDataSyncButtonProps = {
  contact: ContactRow;
  onNoticeChange?: (notice: ContactDataSyncNotice | null) => void;
  onSynced?: () => void;
};

export type ContactDataSyncNotice = {
  busy?: boolean;
  text: string;
  tone: "error" | "info";
};

type ContactDataSyncState = {
  accessToken: string;
  applying: boolean;
  error: string;
  loading: boolean;
  message: string;
  preview: SyncPreviewChange[];
  previewOpen: boolean;
  progress: ApplyContactSyncProgress | null;
};

const initialState: ContactDataSyncState = {
  accessToken: "",
  applying: false,
  error: "",
  loading: false,
  message: "",
  preview: [],
  previewOpen: false,
  progress: null
};

const CONTACT_DATA_SYNC_TABS = ["modified", "deleted"] as const;

export function ContactDataSyncButton({ contact, onNoticeChange, onSynced }: ContactDataSyncButtonProps) {
  const [state, setState] = useState<ContactDataSyncState>(initialState);
  const notice = useMemo(() => contactDataSyncNotice(state), [state.applying, state.error, state.loading, state.message, state.previewOpen]);

  useEffect(() => {
    let active = true;
    readCurrentGoogleConnectionState({ registerRememberedScopes: true }).then((googleConnection) => {
      if (!active) return;
      setState((current) => ({
        ...current,
        accessToken: googleConnection.accessToken
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

  async function connectGoogle() {
    await reconnectGoogle(GOOGLE_CONTACTS_READONLY_SCOPE);
  }

  async function reviewContactData() {
    try {
      await requireCurrentUserCapability("contacts.import_google", "actualizar datos de contacto desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        message: "",
        previewOpen: true,
        progress: null
      }));
      return;
    }

    setState((current) => ({
      ...current,
      applying: false,
      error: "",
      loading: true,
      message: "Conectando con Google...",
      progress: null
    }));
    const googleConnection = await readCurrentGoogleConnectionState({ registerRememberedScopes: true });
    setState((current) => ({ ...current, accessToken: googleConnection.accessToken }));
    if (!googleConnection.connected || !googleConnection.accessToken) {
      setState((current) => ({ ...current, accessToken: "", error: "", loading: true, message: "Reconectando Google..." }));
      await connectGoogle();
      return;
    }

    setState((current) => ({
      ...current,
      applying: false,
      error: "",
      loading: true,
      message: "Revisando datos del contacto...",
      preview: [],
      progress: null
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
        resourceType: "contacts",
        runId,
        scopeLabel: `contacto:${contact.display_name || contact.id}`,
        status,
        step,
        stepOrder
      });
    };
    logStep("Inicio", "Revision de datos del contacto solicitada.", "running", { contact_id: contact.id });

    try {
      const externalId = await readLinkedGoogleContactId(contact.id);
      if (!externalId) {
        throw new Error("Este contacto aun no esta vinculado a Google Contacts. Usa Importar contactos desde Cuenta.");
      }

      logStep("Vinculo Google", externalId);
      const [externalContact, knownValues] = await Promise.all([
        readGoogleContact({
          accessToken: googleConnection.accessToken,
          resourceName: externalId
        }),
        readKnownValues(externalId)
      ]);
      const preview = buildContactSyncPreview({
        appContacts: [contact],
        externalContacts: [externalContact],
        externalIdToContactId: { [externalId]: contact.id },
        knownExternalValuesByContactId: { [contact.id]: knownValues },
        mode: "incremental",
        provider: "google"
      });
      setState((current) => ({
        ...current,
        error: "",
        loading: false,
        message: contactPreviewMessage(preview),
        preview,
        previewOpen: true
      }));
      logStep("Preview listo", contactPreviewMessage(preview), "success");
    } catch (error) {
      logStep("Error", error instanceof Error ? error.message : "No pude revisar datos del contacto.", "error");
      if (error instanceof GoogleContactsClientError && error.code === "GOOGLE_CONTACTS_AUTH_REQUIRED") {
        setState((current) => ({
          ...current,
          applying: false,
          accessToken: "",
          error: "",
          loading: true,
          message: "Reconectando Google...",
          previewOpen: false
        }));
        logStep("Reconectando Google", "Permiso vencido o invalido.", "warning");
        await connectGoogle();
        return;
      }
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No pude revisar datos del contacto.",
        loading: false,
        previewOpen: true
      }));
    }
  }

  async function applyContactData(selectedChanges: SyncPreviewChange[]) {
    try {
      await requireCurrentUserCapability("contacts.import_google", "actualizar datos de contacto desde Google");
    } catch (error) {
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude validar permisos.",
        loading: false,
        previewOpen: true,
        progress: null
      }));
      return;
    }

    if (!selectedChanges.length) {
      setState((current) => ({ ...current, error: "No hay cambios seleccionados para aplicar." }));
      return;
    }

    setState((current) => ({
      ...current,
      applying: true,
      error: "",
      message: "Aplicando cambios...",
      progress: {
        appliedCount: 0,
        failedCount: 0,
        processedCount: 0,
        totalCount: selectedChanges.length
      }
    }));

    const runId = createSyncRunId();
    void writeSyncRunLogStep({
      detail: `${selectedChanges.length} cambio(s) seleccionados.`,
      operation: "apply",
      provider: "google",
      resourceType: "contacts",
      runId,
      scopeLabel: `contacto:${contact.display_name || contact.id}`,
      status: "running",
      step: "Aplicacion iniciada",
      stepOrder: 1
    });

    try {
      const result = await applyContactSyncPreview({
        changes: selectedChanges,
        cursorLabel: `contact:${contact.id}`,
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
        source: "contact_profile_contact_data_sync",
        totalPreviewChanges: actionableChangeCount(state.preview)
      });
      setState((current) => ({
        ...current,
        applying: false,
        error: result.errors.map((item) => item.message).join(" ") || "",
        message: applyMessage(result),
        preview: remainingPreviewChanges(current.preview, result.appliedChangeIds),
        previewOpen: !result.ok || hasActionableChanges(remainingPreviewChanges(current.preview, result.appliedChangeIds)),
        progress: null
      }));
      void writeSyncRunLogStep({
        detail: applyMessage(result),
        metadata: {
          applied_change_ids: result.appliedChangeIds,
          failed_change_ids: result.failedChangeIds
        },
        operation: "apply",
        provider: "google",
        resourceType: "contacts",
        runId,
        scopeLabel: `contacto:${contact.display_name || contact.id}`,
        status: result.ok ? "success" : "warning",
        step: "Aplicacion terminada",
        stepOrder: 2
      });
      if (result.ok) onSynced?.();
    } catch (error) {
      void writeSyncRunLogStep({
        detail: error instanceof Error ? error.message : "No pude aplicar los cambios del contacto.",
        operation: "apply",
        provider: "google",
        resourceType: "contacts",
        runId,
        scopeLabel: `contacto:${contact.display_name || contact.id}`,
        status: "error",
        step: "Error aplicando",
        stepOrder: 2
      });
      setState((current) => ({
        ...current,
        applying: false,
        error: error instanceof Error ? error.message : "No pude aplicar los cambios del contacto.",
        progress: null,
        previewOpen: true
      }));
    }
  }

  return (
    <>
      <Button
        aria-label="Actualizar datos del contacto"
        disabled={state.loading || state.applying}
        icon="sync"
        onClick={reviewContactData}
        square
      />
      <SyncPreviewDialog
        applying={state.applying}
        changes={state.preview}
        description={`Revisa datos de Google Contacts para ${contact.display_name || "este contacto"}. Nada se guarda hasta aplicar la seleccion.`}
        feedbackMessage={state.error || state.message}
        feedbackTone={state.error ? "error" : "info"}
        onApply={applyContactData}
        onClose={() => setState((current) => ({ ...current, previewOpen: false }))}
        open={state.previewOpen}
        progress={state.applying && state.progress ? {
          detail: `${state.progress.appliedCount} aplicados / ${state.progress.failedCount} fallidos`,
          label: "Aplicando contacto",
          max: state.progress.totalCount,
          tone: state.progress.failedCount ? "warning" : "primary",
          value: state.progress.processedCount
        } : undefined}
        tabKeys={CONTACT_DATA_SYNC_TABS}
        title="Datos del contacto"
      />
    </>
  );
}

async function readLinkedGoogleContactId(contactId: string) {
  if (!supabase) throw new Error("Supabase no esta configurado.");
  const { data, error } = await supabase
    .from("external_contact_ids")
    .select("external_id")
    .eq("provider", "google")
    .eq("contact_id", contactId)
    .eq("is_active", true)
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.external_id as string | undefined;
}

async function readKnownValues(externalId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("external_contact_snapshots")
    .select("emails,phones")
    .eq("provider", "google")
    .eq("external_id", externalId)
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { emails?: unknown; phones?: unknown } | undefined;
  return [
    ...toStringArray(row?.emails).map((value) => ({ kind: "email" as const, value })),
    ...toStringArray(row?.phones).map((value) => ({ kind: "phone" as const, value }))
  ];
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function contactPreviewMessage(changes: SyncPreviewChange[]) {
  const modified = changes.filter((change) => change.type === "modified").length;
  const deleted = changes.filter((change) => change.type === "deleted" || change.type === "deactivated").length;
  const unchanged = changes.filter((change) => change.type === "unchanged").length;
  return `${modified} modificaciones, ${deleted} eliminaciones, ${unchanged} sin cambios.`;
}

function applyMessage(result: ApplyContactSyncPreviewResult) {
  const prefix = result.ok ? "Cambios guardados" : "Cambios guardados parcialmente";
  return `${prefix}: ${result.appliedCount} aplicados, ${result.failedCount} fallidos, ${result.pendingCount} pendientes.`;
}

function contactDataSyncNotice(state: ContactDataSyncState): ContactDataSyncNotice | null {
  if (state.error) return { text: state.error, tone: "error" };
  if (state.previewOpen || !state.message) return null;
  return { busy: state.loading || state.applying, text: state.message, tone: "info" };
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
