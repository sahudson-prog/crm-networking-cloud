"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { withContactMergeDecision, type ContactMergeResult, type ContactMergeSource } from "../lib/contactMerge";
import type { SyncPreviewChange, SyncPreviewChangeType } from "../lib/syncOrchestrator";
import { ContactMergeDialog } from "./ContactMergeDialog";
import { Button } from "./ui/Button";

type SyncPreviewDialogProps = {
  open: boolean;
  title?: string;
  description?: string;
  changes: SyncPreviewChange[];
  applying?: boolean;
  onClose: () => void;
  onApply: (selectedChanges: SyncPreviewChange[]) => void;
  onOpenSavedDuplicateMerge?: (sources: ContactMergeSource[]) => void;
};

type SyncPreviewTabKey = "new" | "modified" | "consolidation" | "duplicate_complex" | "deleted" | "unchanged";

const PREVIEW_TABS: Array<{ key: SyncPreviewTabKey; label: string; types: SyncPreviewChangeType[]; description?: string }> = [
  { key: "new", label: "Nuevos", types: ["new"] },
  {
    description: "Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en \"Editar datos\".",
    key: "modified",
    label: "Modificaciones",
    types: ["modified"]
  },
  {
    description: "Estos casos tienen 2 o 3 contactos duplicados con 1 contacto existente. Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en \"Editar datos\".",
    key: "consolidation",
    label: "Duplicados fusionables",
    types: ["consolidation"]
  },
  {
    description: "Estos casos tienen 4 o mas contactos duplicados o multiples contactos existentes. Por defecto, no pisaremos ningun dato del contacto guardado; solo completaremos campos faltantes. Puede editar la propuesta en \"Editar datos\".",
    key: "duplicate_complex",
    label: "Duplicados complejos",
    types: ["duplicate_complex"]
  },
  { key: "deleted", label: "Eliminaciones", types: ["deactivated", "deleted"] },
  { key: "unchanged", label: "Sin cambios", types: ["unchanged"] }
];

export function SyncPreviewDialog({
  applying = false,
  changes,
  description = "Revisa los cambios detectados. Los cambios que no selecciones quedan pendientes para la proxima sincronizacion.",
  onApply,
  onClose,
  onOpenSavedDuplicateMerge,
  open,
  title = "Cambios detectados"
}: SyncPreviewDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<SyncPreviewTabKey>("new");
  const [mergeDialogChange, setMergeDialogChange] = useState<SyncPreviewChange | null>(null);
  const [mergeDecisions, setMergeDecisions] = useState<Record<string, ContactMergeResult>>({});
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const wasAlreadyOpen = wasOpenRef.current;
    const remainingIds = new Set(changes.map((change) => change.id));
    setSelectedIds((current) => (
      wasAlreadyOpen
        ? new Set(Array.from(current).filter((id) => remainingIds.has(id)))
        : new Set(changes.filter((change) => change.defaultSelected && !change.blocking).map((change) => change.id))
    ));
    setActiveTab(firstTabWithChanges(changes));
    setMergeDialogChange(null);
    setMergeDecisions((current) => {
      if (!wasAlreadyOpen) return {};
      return Object.fromEntries(Object.entries(current).filter(([changeId]) => remainingIds.has(changeId)));
    });
    wasOpenRef.current = true;
  }, [changes, open]);

  const tabs = useMemo(
    () => PREVIEW_TABS.map((tab) => ({
      ...tab,
      changes: sortChangesByTitle(changes.filter((change) => tab.types.includes(change.type)))
    })),
    [changes]
  );

  if (!open) return null;

  const activeTabData = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const activeChanges = activeTabData?.changes || [];
  const readOnlyTab = activeTab === "unchanged";
  const actionableChanges = changes.filter((change) => !change.blocking);
  const selectedChanges = actionableChanges
    .filter((change) => selectedIds.has(change.id))
    .map((change) => {
      const decision = mergeDecisions[change.id];
      return decision ? withContactMergeDecision(change, decision) : change;
    });
  const pendingCount = actionableChanges.length - selectedChanges.length;
  const footerSummary = selectionSummary(tabs, selectedIds, pendingCount);
  const mergeDialogSources = mergeDialogChange ? mergeSourcesFromChange(mergeDialogChange) : [];
  const mergeDialogMode = mergeDialogChange ? mergeDialogCopy(mergeDialogChange) : null;

  function toggle(change: SyncPreviewChange, selected: boolean) {
    if (change.blocking) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(change.id);
      else next.delete(change.id);
      return next;
    });
  }

  function selectAllInTab(select: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      activeChanges.forEach((change) => {
        if (change.blocking) return;
        if (select) next.add(change.id);
        else next.delete(change.id);
      });
      return next;
    });
  }

  function renderChangeCard(change: SyncPreviewChange) {
    return (
      <article className={`sync-preview-card ${change.type}`} key={change.id}>
        {change.type === "unchanged" ? (
          <span className="sync-preview-card-status" aria-label="Sin cambios">OK</span>
        ) : (
          <label className="sync-preview-card-select">
            <input
              checked={selectedIds.has(change.id)}
              disabled={change.blocking}
              onChange={(event) => toggle(change, event.target.checked)}
              type="checkbox"
            />
          </label>
        )}
        <div className="sync-preview-card-content">
          <div className="sync-preview-card-head">
            <strong>{change.title}</strong>
            {canEditData(change) ? (
              <Button
                className="sync-preview-edit-data"
                icon="edit"
                onClick={() => setMergeDialogChange(change)}
              >
                Editar datos
              </Button>
            ) : null}
            {duplicatePendingNotice(change)}
          </div>

          {visibleFields(change).length ? (
            <div className="sync-preview-fields">
              {visibleFields(change).map((field, index) => (
              <div className={`sync-preview-field ${field.changed ? "changed" : ""}`} key={fieldKey(field, index)}>
                <span className="sync-preview-field-label">{field.label}</span>
                {renderFieldValue(field, change.type)}
              </div>
              ))}
            </div>
          ) : null}

          {mergeDecisions[change.id] ? <span className="meta">Propuesta ajustada</span> : null}
        </div>
      </article>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card sync-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-preview-title">
        <header className="modal-head">
          <div>
            <h2 id="sync-preview-title">{title}</h2>
            <p>{description}</p>
          </div>
          <Button icon="close" square aria-label="Cerrar preview de sincronizacion" onClick={onClose} />
        </header>

        <div className="sync-preview-tabs" role="tablist" aria-label="Tipos de cambios detectados">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "active" : ""}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              role="tab"
              type="button"
            >
              <span>{tab.label}</span>
              <strong>{tab.changes.length}</strong>
            </button>
          ))}
        </div>

        <div className="sync-preview-toolbar">
          {readOnlyTab ? (
            <span>{activeChanges.length} contactos revisados sin cambios.</span>
          ) : (
            <div>
              <Button disabled={!activeChanges.some((change) => !change.blocking)} onClick={() => selectAllInTab(true)}>Seleccionar pestana</Button>
              <Button disabled={!activeChanges.some((change) => !change.blocking)} onClick={() => selectAllInTab(false)}>Limpiar pestana</Button>
            </div>
          )}
        </div>

        <div className="sync-preview-body">
          {!changes.length ? (
            <div className="sync-preview-empty">No se detectaron cambios.</div>
          ) : !activeChanges.length ? (
            <div className="sync-preview-empty">{emptyTabMessage(activeTabData.label)}</div>
          ) : (
            <section className="sync-preview-group" key={activeTabData.key}>
              <div className="sync-preview-group-title">
                <div>
                  <strong>{activeTabData.label}</strong>
                  {activeTabData.description ? <p>{activeTabData.description}</p> : null}
                </div>
                <span>{activeChanges.length}</span>
              </div>
              <div className="sync-preview-cards">
                {activeTab === "duplicate_complex"
                  ? duplicateComplexGroups(activeChanges).map((group) => (
                    <section className="sync-preview-duplicate-group" key={group.id}>
                      <div className="sync-preview-duplicate-group-head">
                        <strong>{group.label}</strong>
                        <span>({duplicateGroupSummary(group.changes[0], onOpenSavedDuplicateMerge)})</span>
                      </div>
                      <div className="sync-preview-duplicate-group-cards">
                        {group.changes.map(renderChangeCard)}
                      </div>
                    </section>
                  ))
                  : activeChanges.map(renderChangeCard)}
              </div>
            </section>
          )}
        </div>

        <footer className="sync-preview-footer">
          <div className="sync-preview-selection-summary">
            <span>{footerSummary}</span>
            <strong>{pendingCount} quedaran pendientes.</strong>
          </div>
          <div className="modal-actions">
            <Button onClick={onClose}>Cancelar</Button>
            <Button disabled={!selectedChanges.length || applying} onClick={() => onApply(selectedChanges)} tone="primary">
              {applying ? "Aplicando..." : "Aplicar seleccion"}
            </Button>
          </div>
        </footer>

        <ContactMergeDialog
          description={mergeDialogMode?.description}
          onClose={() => setMergeDialogChange(null)}
          onSave={(result) => {
            if (!mergeDialogChange) return;
            setMergeDecisions((current) => ({ ...current, [mergeDialogChange.id]: result }));
            setSelectedIds((current) => new Set(current).add(mergeDialogChange.id));
            setMergeDialogChange(null);
          }}
          open={Boolean(mergeDialogChange && mergeDialogSources.length >= 1)}
          sources={mergeDialogSources}
          title={mergeDialogMode?.title}
        />
      </section>
    </div>
  );
}

function duplicateComplexGroups(changes: SyncPreviewChange[]) {
  const groups = new Map<string, { id: string; label: string; changes: SyncPreviewChange[] }>();
  for (const change of changes) {
    const id = metadataText(change, "duplicateGroupId") || change.id;
    const label = metadataText(change, "duplicateGroupLabel") || change.title;
    const group = groups.get(id) ?? { changes: [], id, label };
    group.changes.push(change);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => (
    cleanSortTitle(a.label).localeCompare(cleanSortTitle(b.label), "es", { sensitivity: "base" })
    || a.id.localeCompare(b.id)
  ));
}

function duplicateGroupSummary(
  change: SyncPreviewChange,
  onOpenSavedDuplicateMerge?: (sources: ContactMergeSource[]) => void
): ReactNode {
  const total = metadataNumber(change, "duplicateGroupTotalCount");
  const saved = metadataNumber(change, "duplicateGroupSavedCount");
  const imported = metadataNumber(change, "duplicateGroupImportedCount");
  const savedSources = duplicateGroupSavedSources(change);
  const savedText = saved === 1 ? "1 guardado" : `${saved} guardados`;
  const importedText = imported === 1 ? "1 importado" : `${imported} importados`;
  const canOpenSavedMerge = savedSources.length >= 2 && savedSources.length <= 3 && onOpenSavedDuplicateMerge;

  return (
    <>
      {total} duplicados:{" "}
      {canOpenSavedMerge ? (
        <button
          className="sync-preview-inline-link"
          onClick={() => onOpenSavedDuplicateMerge(savedSources)}
          type="button"
        >
          {savedText}
        </button>
      ) : savedText}
      {" y "}
      {importedText}
    </>
  );
}

function canEditData(change: SyncPreviewChange) {
  return ["new", "modified", "consolidation", "duplicate_complex"].includes(change.type) && mergeSourcesFromChange(change).length >= 1;
}

function duplicatePendingNotice(change: SyncPreviewChange) {
  const savedCount = metadataNumber(change, "internalDuplicateSavedCount");
  const importedCount = metadataNumber(change, "importedDuplicateCount");
  if (savedCount > 1 && importedCount > 0) {
    const savedNoun = savedCount === 1 ? "duplicado ya guardado" : "duplicados ya guardados";
    const importedNoun = importedCount === 1 ? "adicional" : "adicionales";
    return (
      <span className="sync-preview-duplicate-warning">
        recomendacion: primero resolver {savedCount} {savedNoun}, antes de importar {importedCount} {importedNoun}
      </span>
    );
  }

  const count = metadataNumber(change, "duplicatePendingCount");
  if (!count) return null;
  const verb = count === 1 ? "quedara" : "quedaran";
  const noun = count === 1 ? "pendiente" : "pendientes";
  return (
    <span className="sync-preview-duplicate-warning">
      varios duplicados: {count} {verb} {noun} para la siguiente sincronizacion
    </span>
  );
}

function metadataNumber(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metadataText(change: SyncPreviewChange, key: string) {
  const value = change.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function mergeDialogCopy(change: SyncPreviewChange) {
  if (change.type === "new" || change.type === "duplicate_complex") {
    return {
      description: "Ajusta el contacto nuevo antes de aplicarlo. Nada se guarda hasta presionar Aplicar seleccion.",
      title: "Editar contacto nuevo"
    };
  }
  if (change.type === "modified") {
    return {
      description: "Ajusta que datos aceptar para este contacto antes de aplicar la sincronizacion.",
      title: "Editar datos"
    };
  }
  return {
    description: "Elige que datos guardar antes de aplicar este duplicado fusionable.",
    title: "Duplicado fusionable"
  };
}

function mergeSourcesFromChange(change: SyncPreviewChange): ContactMergeSource[] {
  const sources = change.metadata?.mergeSources;
  if (!Array.isArray(sources)) return [];
  return sources.filter(isContactMergeSource);
}

function duplicateGroupSavedSources(change: SyncPreviewChange): ContactMergeSource[] {
  const sources = change.metadata?.duplicateGroupSavedSources;
  if (!Array.isArray(sources)) return [];
  return sources.filter(isContactMergeSource);
}

function isContactMergeSource(value: unknown): value is ContactMergeSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.id === "string"
    && (source.kind === "Guardado" || source.kind === "Importado")
    && typeof source.name === "string"
    && Array.isArray(source.emails)
    && Array.isArray(source.phones)
    && typeof source.focus === "boolean"
    && typeof source.headhunter === "boolean"
    && typeof source.networkingStatus === "string";
}

function renderFieldValue(field: SyncPreviewChange["fields"][number], changeType: SyncPreviewChangeType) {
  if (changeType === "new" || changeType === "duplicate_complex") {
    return <span className="sync-preview-field-values">{formatFieldValue(field.after || field.before)}</span>;
  }

  if (changeType === "deleted") {
    return <span className="sync-preview-field-values">{formatFieldValue(field.before || field.after)}</span>;
  }

  const operation = field.operation || (field.changed ? "replace" : "info");

  if (operation === "add") {
    return <span className="sync-preview-field-values"><span className="sync-preview-operation">agregar</span> {formatFieldValue(field.after)}{notAppliedLabel(field)}</span>;
  }

  if (operation === "remove") {
    return <span className="sync-preview-field-values"><span className="sync-preview-operation danger">eliminar</span> {formatFieldValue(field.before)}{notAppliedLabel(field)}</span>;
  }

  if (operation === "match") {
    return <span className="sync-preview-field-values"><span className="sync-preview-operation match">coincide</span> <span className="sync-preview-arrow">--&gt;</span> {formatFieldValue(field.after || field.before)}</span>;
  }

  if (operation === "info") {
    return <span className="sync-preview-field-values">{formatFieldValue(field.after || field.before)}</span>;
  }

  return (
    <span className="sync-preview-field-values">
      {formatFieldValue(field.before)}
      <span className="sync-preview-arrow">--&gt;</span>
      {formatFieldValue(field.after)}
      {notAppliedLabel(field)}
    </span>
  );
}

function notAppliedLabel(field: SyncPreviewChange["fields"][number]) {
  return field.apply === false ? <em className="sync-preview-not-applied"> (no aplicado)</em> : null;
}

function fieldKey(field: SyncPreviewChange["fields"][number], index: number) {
  return [
    field.label,
    field.operation ?? "value",
    field.before ?? "",
    field.after ?? "",
    index
  ].join(":");
}

function formatFieldValue(value?: string | null) {
  const clean = value?.trim();
  if (!clean) return <em>sin datos</em>;
  return <span className="sync-preview-data">{clean}</span>;
}

function visibleFields(change: SyncPreviewChange) {
  if (change.type === "new" || change.type === "duplicate_complex" || change.type === "deleted" || change.type === "unchanged") {
    return change.fields.filter((field) => field.after?.trim() || field.before?.trim());
  }
  return change.fields.filter((field) => field.changed);
}

function sortChangesByTitle(changes: SyncPreviewChange[]) {
  return [...changes].sort((a, b) => (
    cleanSortTitle(a.title).localeCompare(cleanSortTitle(b.title), "es", { sensitivity: "base" })
    || a.id.localeCompare(b.id)
  ));
}

function cleanSortTitle(value: string) {
  return value.trim().toLowerCase();
}

function firstTabWithChanges(changes: SyncPreviewChange[]): SyncPreviewTabKey {
  return PREVIEW_TABS.find((tab) => changes.some((change) => tab.types.includes(change.type)))?.key || "new";
}

function emptyTabMessage(label: string) {
  return `No se detectaron cambios en ${label.toLowerCase()}.`;
}

function selectionSummary(
  tabs: Array<{ label: string; changes: SyncPreviewChange[] }>,
  selectedIds: Set<string>,
  pendingCount: number
) {
  const parts = tabs
    .filter((tab) => tab.changes.some((change) => !change.blocking))
    .map((tab) => {
      const selected = tab.changes.filter((change) => !change.blocking && selectedIds.has(change.id)).length;
      return `${tab.label}: ${selected}`;
    });

  return parts.length ? `Seleccionados - ${parts.join(" · ")}` : `Sin seleccion accionable - pendientes: ${pendingCount}`;
}
