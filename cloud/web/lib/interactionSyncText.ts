import type { SyncGoogleInteractionsResult } from "./googleInteractionSyncFlow";
import type { SyncRunResult } from "./syncOrchestrator";

export type InteractionSyncServiceSummary = {
  label: "Gmail" | "Calendar";
  read: number;
  pages: number;
  candidates: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  participantsInserted: number;
};

export type InteractionSyncSummary = {
  applied: boolean;
  calendar: InteractionSyncServiceSummary;
  mail: InteractionSyncServiceSummary;
  ok: boolean;
  totals: {
    read: number;
    candidates: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    participantsInserted: number;
  };
};

export function summarizeGoogleInteractionSync(result: SyncGoogleInteractionsResult): InteractionSyncSummary {
  const mail = serviceSummary("Gmail", result.mail, result.googleRead.mailMessages, result.googleRead.mailPages);
  const calendar = serviceSummary("Calendar", result.calendar, result.googleRead.calendarEvents, result.googleRead.calendarPages);
  return {
    applied: !(result.mail?.dryRun ?? result.calendar?.dryRun ?? false),
    calendar,
    mail,
    ok: result.ok,
    totals: {
      read: mail.read + calendar.read,
      candidates: mail.candidates + calendar.candidates,
      created: mail.created + calendar.created,
      updated: mail.updated + calendar.updated,
      skipped: mail.skipped + calendar.skipped,
      failed: mail.failed + calendar.failed,
      participantsInserted: mail.participantsInserted + calendar.participantsInserted
    }
  };
}

export function formatGoogleInteractionSyncMessage(result: SyncGoogleInteractionsResult) {
  const summary = summarizeGoogleInteractionSync(result);
  if (!summary.ok) return `Actualizacion incompleta: ${formatAppliedCounts(summary)}.`;
  if (!summary.applied) return `Revision lista sin guardar: ${summary.totals.candidates} posibles interacciones.`;
  return `Actualizacion lista: ${formatAppliedCounts(summary)}.`;
}

export function formatGoogleInteractionHistoricalMessage(result: SyncGoogleInteractionsResult) {
  const summary = summarizeGoogleInteractionSync(result);
  const prefix = summary.applied ? "Reconstruccion aplicada" : "Revision lista sin guardar";
  if (!summary.ok) return `${prefix}, con errores por revisar.`;
  if (!summary.applied) return `${prefix}: ${summary.totals.candidates} posibles interacciones.`;
  return `${prefix}: ${formatAppliedCounts(summary)}.`;
}

export function explainInteractionSyncSkipped(applied: boolean) {
  if (!applied) {
    return "En revision sin guardar, los posibles solo se cuentan; no se escriben cambios.";
  }
  return "Omitidos son objetos revisados que no se guardaron, por ejemplo porque estaban bloqueados para reimportacion o fallaron una validacion.";
}

function serviceSummary(
  label: InteractionSyncServiceSummary["label"],
  result: SyncRunResult | null,
  read: number,
  pages: number
): InteractionSyncServiceSummary {
  return {
    label,
    read,
    pages,
    candidates: result?.counts.scanned ?? 0,
    created: result?.counts.created ?? 0,
    updated: result?.counts.updated ?? 0,
    skipped: result?.dryRun ? 0 : result?.counts.skipped ?? 0,
    failed: result?.counts.failed ?? 0,
    participantsInserted: result?.counts.participantsInserted ?? 0
  };
}

function formatAppliedCounts(summary: InteractionSyncSummary) {
  return `${summary.totals.created} nuevos, ${summary.totals.updated} modificados, ${summary.totals.skipped} omitidos`;
}

