"use client";

import { useMemo } from "react";

import {
  icsReviewDescription,
  type IcsImportReviewSnapshot
} from "../lib/icsImportReview";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { SyncPreviewDialog, type SyncPreviewTabDefinition } from "./SyncPreviewDialog";

const ICS_PREVIEW_TABS: readonly SyncPreviewTabDefinition[] = [
  { key: "new", label: "Nuevas", matches: category("new") },
  { key: "modified", label: "Modificadas", matches: category("modified") },
  {
    key: "possible_duplicate",
    label: "Duplicados",
    description: "Coinciden en fecha, título y participantes con otra cita. No se seleccionan automáticamente.",
    matches: category("possible_duplicate")
  },
  { key: "unchanged", label: "Sin cambios", matches: category("unchanged") }
];

export function IcsImportPreviewDialog({
  applying,
  feedbackMessage,
  onClose,
  onConfirmSelection,
  open,
  snapshot
}: {
  applying?: boolean;
  feedbackMessage?: string;
  onClose: () => void;
  onConfirmSelection: (changeIds: string[]) => void;
  open: boolean;
  snapshot: IcsImportReviewSnapshot | null;
}) {
  const tabs = useMemo(
    () => ICS_PREVIEW_TABS.filter((tab) => snapshot?.changes.some(tab.matches)),
    [snapshot]
  );
  if (!snapshot) return null;

  return (
    <SyncPreviewDialog
      applyLabel="Importar selección"
      applying={applying}
      applyingLabel="Importando..."
      changes={snapshot.changes}
      description={icsReviewDescription(snapshot)}
      feedbackMessage={feedbackMessage}
      feedbackTone="error"
      onApply={(selectedChanges) => onConfirmSelection(selectedChanges.map((change) => change.id))}
      onClose={onClose}
      open={open}
      sortChanges={newestIcsChangeFirst}
      tabs={tabs}
      title="Revisar citas de iCalendar"
    />
  );
}

function category(value: string) {
  return (change: SyncPreviewChange) => change.metadata?.icsCategory === value;
}

function newestIcsChangeFirst(left: SyncPreviewChange, right: SyncPreviewChange) {
  const leftTime = metadataTime(left.metadata?.icsStartInstant);
  const rightTime = metadataTime(right.metadata?.icsStartInstant);
  if (leftTime === rightTime) return 0;
  return rightTime - leftTime;
}

function metadataTime(value: unknown) {
  if (typeof value !== "string") return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}
