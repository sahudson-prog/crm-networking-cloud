"use client";

import Link from "next/link";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NETWORKING_STATUSES, updateContactFlags, updateContactNetworkingStatus } from "../lib/contactActions";
import { DEFAULT_CONTACT_FILTERS, filterContacts, headhunterDomainsForContact, objectiveOptionsForContacts, type ContactFilters } from "../lib/contactFilters";
import { triggerCoachRuleReviewForContacts } from "../lib/coachRuleTriggers";
import { cleanContactCompany, cleanContactRole, joinCompact, statusClass } from "../lib/format";
import { readHeadhunterCompanyMaster } from "../lib/headhunterCompanyActions";
import { addObjectiveAssignmentsToContacts, objectiveTypeLabel, readObjectives } from "../lib/objectiveActions";
import {
  resolveHeadhunterCompany,
  type HeadhunterCompanyMasterRow,
  type HeadhunterCompanyResolution
} from "../lib/headhunterCompanyMaster";
import type { ContactListRow, ObjectiveRow } from "../lib/readModel";
import { ContactFilterControls } from "./ContactFilterControls";
import { StatusBadge } from "./StatusBadge";
import { Button } from "./ui/Button";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon, type IconName } from "./ui/Icon";

type ContactTableProps = {
  contacts: ContactListRow[];
  onReload?: () => Promise<void> | void;
};

type SortKey = "name" | "companyRole" | "status" | "daysSince";
type SortDirection = "asc" | "desc";

type SortState = {
  key: SortKey;
  direction: SortDirection;
};

type BoardDropTarget = {
  index: number;
  status: string;
};

type ContactBoardCard = {
  id: string;
  contactIds: string[];
  contacts: ContactListRow[];
  primaryContact: ContactListRow;
  title: string;
  subtitle: string;
  status: string;
  isHeadhunterGroup: boolean;
  extraCount: number;
};

export function ContactTable({ contacts, onReload }: ContactTableProps) {
  const [quickQuery, setQuickQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_CONTACT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("Pendiente");
  const [bulkObjectiveIds, setBulkObjectiveIds] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });
  const [feedback, setFeedback] = useState("");
  const [applying, setApplying] = useState(false);
  const [savingBoardIds, setSavingBoardIds] = useState<Set<string>>(new Set());
  const [optimisticBoardStatuses, setOptimisticBoardStatuses] = useState<Record<string, string>>({});
  const [pendingBoardStatuses, setPendingBoardStatuses] = useState<Record<string, string>>({});
  const [draggingContactId, setDraggingContactId] = useState("");
  const [boardDropTarget, setBoardDropTarget] = useState<BoardDropTarget | null>(null);
  const [headhuntersGrouped, setHeadhuntersGrouped] = useState(false);
  const [showGroupConfirm, setShowGroupConfirm] = useState(false);
  const [headhunterMaster, setHeadhunterMaster] = useState<HeadhunterCompanyMasterRow[] | null>(null);
  const [allObjectives, setAllObjectives] = useState<ObjectiveRow[]>([]);

  const visibleContacts = useMemo(
    () => contacts.map((contact) => {
      const optimisticStatus = optimisticBoardStatuses[contact.id];
      if (!optimisticStatus || optimisticStatus === contact.networking_status) return contact;
      return { ...contact, networking_status: optimisticStatus };
    }),
    [contacts, optimisticBoardStatuses]
  );
  const filtered = useMemo(() => filterContacts(visibleContacts, quickQuery, filters), [filters, quickQuery, visibleContacts]);
  const objectiveOptions = useMemo(
    () => allObjectives.length ? allObjectives : objectiveOptionsForContacts(visibleContacts),
    [allObjectives, visibleContacts]
  );
  const sortedContacts = useMemo(() => sortContacts(filtered, sort), [filtered, sort]);
  const boardCards = useMemo(() => buildContactBoardCards(sortedContacts, headhuntersGrouped), [headhuntersGrouped, sortedContacts]);
  const boardCardsByStatus = useMemo(() => groupBoardCardsByStatus(boardCards), [boardCards]);
  const boardCardsById = useMemo(() => new Map(boardCards.map((card) => [card.id, card])), [boardCards]);
  const pendingBoardIds = useMemo(() => new Set(Object.keys(pendingBoardStatuses)), [pendingBoardStatuses]);
  const headhunterResolutionByContact = useMemo(
    () => buildHeadhunterResolutionMap(sortedContacts, headhunterMaster),
    [headhunterMaster, sortedContacts]
  );
  const selectedCount = selectedIds.size;

  useEffect(() => {
    let active = true;
    readHeadhunterCompanyMaster()
      .then((rows) => {
        if (active) setHeadhunterMaster(rows);
      })
      .catch(() => {
        if (active) setHeadhunterMaster(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    readObjectives({ activeOnly: true })
      .then((rows) => {
        if (active) setAllObjectives(rows);
      })
      .catch(() => {
        if (active) setAllObjectives([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const pendingEntries = Object.entries(pendingBoardStatuses);
    if (!pendingEntries.length || savingBoardIds.size) return;

    const timeoutId = window.setTimeout(() => {
      void flushBoardStatuses(pendingEntries);
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [pendingBoardStatuses, savingBoardIds.size]);

  function toggleSelected(contactId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(contactId);
      else next.delete(contactId);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds(new Set(sortedContacts.map((contact) => contact.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function applyBulkFlags(flags: { networkingFocus?: boolean; isHeadhunter?: boolean }) {
    if (!selectedCount) return;
    setApplying(true);
    setFeedback("");
    try {
      const affectedIds = Array.from(selectedIds);
      for (const contactId of affectedIds) {
        await updateContactFlags(contactId, { ...flags, source: "contacts_bulk", reviewCoach: false });
      }
      await triggerCoachRuleReviewForContacts(affectedIds, "contacts_bulk_flags");
      setFeedback("Cambios guardados.");
      clearSelection();
      await onReload?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude guardar los cambios.");
    } finally {
      setApplying(false);
    }
  }

  async function applyBulkStatus() {
    if (!selectedCount || !bulkStatus) return;
    setApplying(true);
    setFeedback("");
    try {
      const affectedIds = Array.from(selectedIds);
      for (const contactId of affectedIds) {
        await updateContactNetworkingStatus(contactId, bulkStatus, "contacts_bulk", { reviewCoach: false });
      }
      await triggerCoachRuleReviewForContacts(affectedIds, "contacts_bulk_status");
      setFeedback("Estado guardado.");
      clearSelection();
      await onReload?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude guardar el estado.");
    } finally {
      setApplying(false);
    }
  }

  async function applyBulkObjectives() {
    if (!selectedCount || !bulkObjectiveIds.length) return;
    setApplying(true);
    setFeedback("");
    try {
      const affectedIds = Array.from(selectedIds);
      const result = await addObjectiveAssignmentsToContacts({
        contactIds: affectedIds,
        objectiveIds: bulkObjectiveIds,
        source: "user"
      });
      setFeedback(result.insertedAssignments ? "Objetivos guardados." : "Los objetivos ya estaban asignados.");
      setBulkObjectiveIds([]);
      clearSelection();
      await onReload?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude guardar los objetivos.");
    } finally {
      setApplying(false);
    }
  }

  function applyBoardStatus(cardId: string, nextStatus: string) {
    const card = boardCardsById.get(cardId);
    setDraggingContactId("");
    setBoardDropTarget(null);
    if (!card) return;

    const currentStatus = card.status;
    if (currentStatus === nextStatus) return;

    const originalContacts = card.contactIds
      .map((contactId) => contacts.find((item) => item.id === contactId))
      .filter((contact): contact is ContactListRow => Boolean(contact));

    if (originalContacts.every((contact) => contact.networking_status === nextStatus)) {
      setOptimisticBoardStatuses((current) => omitKeys(current, card.contactIds));
      setPendingBoardStatuses((current) => omitKeys(current, card.contactIds));
      return;
    }

    setOptimisticBoardStatuses((current) => applyStatusToIds(current, card.contactIds, nextStatus));
    setPendingBoardStatuses((current) => {
      const next = { ...current };
      for (const contact of originalContacts) {
        if (contact.networking_status === nextStatus) delete next[contact.id];
        else next[contact.id] = nextStatus;
      }
      return next;
    });
    setFeedback("Cambio pendiente de guardado.");
  }

  async function flushBoardStatuses(entries: Array<[string, string]>) {
    const ids = entries.map(([contactId]) => contactId);
    setSavingBoardIds(new Set(ids));
    setFeedback("");

    const savedIds: string[] = [];
    const failedIds: string[] = [];
    try {
      for (const [contactId, nextStatus] of entries) {
        try {
          await updateContactNetworkingStatus(contactId, nextStatus, "contacts_status_board", { reviewCoach: false });
          savedIds.push(contactId);
        } catch {
          failedIds.push(contactId);
        }
      }

      await triggerCoachRuleReviewForContacts(savedIds, "contacts_status_board");
      await onReload?.();
      setFeedback(failedIds.length ? "Algunos estados no se pudieron guardar." : "Estados guardados.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude guardar los estados.");
    } finally {
      setPendingBoardStatuses((current) => removeUnchangedPending(current, entries));
      setOptimisticBoardStatuses((current) => removeSettledOptimistic(current, [...savedIds, ...failedIds], entries));
      setSavingBoardIds(new Set());
    }
  }

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key !== key) return { key, direction: key === "daysSince" ? "desc" : "asc" };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <>
      <ContactFilterControls
        filters={filters}
        filtersOpen={filtersOpen}
        objectiveOptions={objectiveOptions}
        quickQuery={quickQuery}
        summary={`Mostrando ${filtered.length} de ${contacts.length} contactos`}
        onFiltersChange={setFilters}
        onFiltersOpenChange={setFiltersOpen}
        onQuickQueryChange={setQuickQuery}
      />
      <section className="panel contacts-workspace">
        <div className="panel-header contacts-header">
          <div>
            <h2 className="panel-title">Contactos</h2>
          </div>
        </div>

      <div className="contacts-status-toolbar">
        <Button
          icon={headhuntersGrouped ? "users" : "circleDot"}
          onClick={() => {
            if (headhuntersGrouped) {
              setHeadhuntersGrouped(false);
              return;
            }
            setShowGroupConfirm(true);
          }}
        >
          {headhuntersGrouped ? "Desagrupar Headhunters" : "Agrupar Headhunters"}
        </Button>
        <p className={`contacts-status-feedback ${feedback.includes("No pude") ? "form-error" : "form-success"}`}>
          {feedback}
        </p>
      </div>

      <ContactStatusBoard
        cardsByStatus={boardCardsByStatus}
        draggingContactId={draggingContactId}
        dropTarget={boardDropTarget}
        pendingContactIds={pendingBoardIds}
        savingContactIds={savingBoardIds}
        onDragEnd={() => {
          setDraggingContactId("");
          setBoardDropTarget(null);
        }}
        onDragStart={(contactId) => {
          setDraggingContactId(contactId);
          setBoardDropTarget(null);
        }}
        onDropContact={applyBoardStatus}
        onDropTargetChange={setBoardDropTarget}
      />

      <div className="contacts-bulk-bar">
        <div className="contacts-selection-summary">
          <strong>{sortedContacts.length}</strong> contactos en tabla · <strong>{selectedCount}</strong> seleccionados
        </div>
        <div className="contacts-bulk-toolbox" aria-label="Acciones masivas">
          <BulkToolGroup label="Seleccionar">
            <IconToolButton
              disabled={!sortedContacts.length || applying}
              icon="checkbox"
              label="Seleccionar todos los contactos visibles"
              onClick={selectVisible}
            />
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="close"
              label="Limpiar seleccion"
              onClick={clearSelection}
            />
          </BulkToolGroup>
          <BulkToolGroup label="Foco">
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="userPlus"
              label="Marcar seleccion como foco"
              onClick={() => applyBulkFlags({ networkingFocus: true })}
            />
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="userMinus"
              label="Quitar foco a la seleccion"
              onClick={() => applyBulkFlags({ networkingFocus: false })}
            />
          </BulkToolGroup>
          <BulkToolGroup label="Headhunter">
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="circleDot"
              label="Marcar seleccion como headhunter"
              onClick={() => applyBulkFlags({ isHeadhunter: true })}
            />
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="users"
              label="Quitar marca headhunter a la seleccion"
              onClick={() => applyBulkFlags({ isHeadhunter: false })}
            />
          </BulkToolGroup>
          <BulkToolGroup label="Estado">
            <select
              aria-label="Estado networking para aplicar"
              className="compact-select contacts-bulk-status-select"
              disabled={!selectedCount || applying}
              value={bulkStatus}
              onChange={(event) => setBulkStatus(event.target.value)}
            >
              {NETWORKING_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <IconToolButton
              disabled={!selectedCount || applying}
              icon="check"
              label="Aplicar estado a la seleccion"
              onClick={applyBulkStatus}
              primary
            />
          </BulkToolGroup>
          <BulkToolGroup label="Objetivos">
            <BulkObjectiveSelect
              disabled={!selectedCount || applying}
              objectiveIds={bulkObjectiveIds}
              objectives={allObjectives}
              onChange={setBulkObjectiveIds}
            />
            <IconToolButton
              disabled={!selectedCount || applying || !bulkObjectiveIds.length}
              icon="check"
              label="Aplicar objetivos a la seleccion"
              onClick={applyBulkObjectives}
              primary
            />
          </BulkToolGroup>
        </div>
      </div>

      <div className="table-wrap contacts-table-wrap">
        <table className="table contacts-table">
          <thead>
            <tr>
              <th aria-label="Seleccionar" />
              <SortHeader label="Nombre" sortKey="name" current={sort} onSort={toggleSort} />
              <SortHeader label="Empresa / cargo" sortKey="companyRole" current={sort} onSort={toggleSort} />
              <SortHeader label="Estado" sortKey="status" current={sort} onSort={toggleSort} />
              <SortHeader label="Ultima interaccion" sortKey="daysSince" current={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedContacts.map((contact) => {
              return (
                <tr key={contact.id}>
                  <td>
                    <input
                      aria-label={`Seleccionar ${contact.display_name || "contacto"}`}
                      checked={selectedIds.has(contact.id)}
                      onChange={(event) => toggleSelected(contact.id, event.target.checked)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <Link className="table-link contacts-name-link" href={`/contactos?contactId=${encodeURIComponent(contact.id)}`}>
                      {contact.display_name || <EmptyValue>sin nombre</EmptyValue>}
                    </Link>
                  </td>
                  <td>{renderCompanyRole(contact, headhunterResolutionByContact.get(contact.id))}</td>
                  <td><StatusBadge status={contact.networking_status} /></td>
                  <td>{formatLastInteractionAge(contact.days_since_last_interaction, contact.last_interaction_at)}</td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={5}>
                  <div className="contacts-empty-state">No hay contactos para los filtros actuales.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showGroupConfirm ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card contacts-group-dialog" role="dialog" aria-modal="true" aria-labelledby="contacts-group-title">
            <header className="modal-head">
              <div>
                <h2 id="contacts-group-title">Agrupar Headhunters</h2>
                <p>
                  Al agrupar tarjetas de contactos de una misma empresa headhunter en una sola tarjeta de empresa, mostraremos y actualizaremos el estado del contacto con estado más avanzado dentro del grupo.
                </p>
              </div>
              <Button icon="close" square aria-label="Cerrar" onClick={() => setShowGroupConfirm(false)} />
            </header>
            <footer className="modal-actions">
              <Button onClick={() => setShowGroupConfirm(false)}>Cancelar</Button>
              <Button
                icon="check"
                tone="primary"
                onClick={() => {
                  setHeadhuntersGrouped(true);
                  setShowGroupConfirm(false);
                }}
              >
                Agrupar
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
      </section>
    </>
  );
}

function BulkToolGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="contacts-bulk-group">
      <span>{label}</span>
      <div className="contacts-bulk-group-actions">{children}</div>
    </div>
  );
}

function IconToolButton({
  disabled,
  icon,
  label,
  onClick,
  primary = false
}: {
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={`contacts-tool-button ${primary ? "primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}

function BulkObjectiveSelect({
  disabled,
  objectiveIds,
  objectives,
  onChange
}: {
  disabled?: boolean;
  objectiveIds: string[];
  objectives: ObjectiveRow[];
  onChange: (objectiveIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(objectiveIds);
  const sortedObjectives = useMemo(
    () => [...objectives].sort((left, right) => compareBulkObjectives(left, right, selected)),
    [objectives, objectiveIds]
  );

  function toggleObjective(objectiveId: string) {
    const next = new Set(objectiveIds);
    if (next.has(objectiveId)) next.delete(objectiveId);
    else next.add(objectiveId);
    onChange(Array.from(next));
  }

  return (
    <div className="contacts-bulk-objective-select">
      <button
        aria-expanded={open}
        className="compact-select contacts-bulk-objective-trigger"
        disabled={disabled || !objectives.length}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{objectiveIds.length ? `${objectiveIds.length} objetivo${objectiveIds.length === 1 ? "" : "s"}` : "Elegir objetivos"}</span>
      </button>
      {open && !disabled ? (
        <div className="contacts-bulk-objective-menu">
          {sortedObjectives.length ? sortedObjectives.map((objective) => {
            const active = selected.has(objective.id);
            return (
              <button
                className={active ? "active" : ""}
                key={objective.id}
                onClick={() => toggleObjective(objective.id)}
                type="button"
              >
                <span className="contacts-bulk-objective-name">
                  {active ? <Icon name="check" /> : null}
                  {objective.objective_name}
                </span>
                <span>{objectiveTypeLabel(objective.objective_type)}</span>
              </button>
            );
          }) : <p className="empty-value">sin objetivos</p>}
        </div>
      ) : null}
    </div>
  );
}

function ContactStatusBoard({
  cardsByStatus,
  draggingContactId,
  dropTarget,
  onDragEnd,
  onDragStart,
  onDropContact,
  onDropTargetChange,
  pendingContactIds,
  savingContactIds
}: {
  cardsByStatus: Map<string, ContactBoardCard[]>;
  draggingContactId: string;
  dropTarget: BoardDropTarget | null;
  onDragEnd: () => void;
  onDragStart: (contactId: string) => void;
  onDropContact: (contactId: string, status: string) => void;
  onDropTargetChange: (target: BoardDropTarget | null) => void;
  pendingContactIds: Set<string>;
  savingContactIds: Set<string>;
}) {
  return (
    <div className="contacts-status-board" aria-label="Tablero de estados networking">
      {NETWORKING_STATUSES.map((status) => {
        const statusCards = cardsByStatus.get(status) ?? [];
        const targetIndex = dropTarget?.status === status ? dropTarget.index : null;
        return (
          <div
            className={`contacts-status-column ${statusClass(status)} ${draggingContactId ? "drop-ready" : ""}`}
            key={status}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropTargetChange(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!statusCards.length) onDropTargetChange({ status, index: 0 });
            }}
            onDrop={(event) => {
              event.preventDefault();
              const cardId = event.dataTransfer.getData("text/plain") || draggingContactId;
              if (cardId) onDropContact(cardId, status);
              onDragEnd();
            }}
          >
            <div className="contacts-status-column-head">
              <StatusBadge status={status} />
              <strong>{statusCards.length}</strong>
            </div>
            <div className="contacts-status-scroll">
              {statusCards.map((card, index) => (
                <div key={card.id}>
                  {targetIndex === index ? <div className="contacts-status-drop-line" /> : null}
                  <ContactStatusCard
                    card={card}
                    dragging={draggingContactId === card.id}
                    pending={card.contactIds.some((contactId) => pendingContactIds.has(contactId))}
                    saving={card.contactIds.some((contactId) => savingContactIds.has(contactId))}
                    onDragEnd={onDragEnd}
                    onDragOver={(event) => {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onDropTargetChange({
                        status,
                        index: event.clientY < rect.top + rect.height / 2 ? index : index + 1
                      });
                    }}
                    onDragStart={onDragStart}
                  />
                </div>
              ))}
              {targetIndex === statusCards.length && statusCards.length ? <div className="contacts-status-drop-line" /> : null}
              {!statusCards.length ? <div className="contacts-status-empty">Suelta un contacto aca</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContactStatusCard({
  card,
  dragging,
  onDragEnd,
  onDragOver,
  onDragStart,
  pending,
  saving
}: {
  card: ContactBoardCard;
  dragging: boolean;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (contactId: string) => void;
  pending: boolean;
  saving: boolean;
}) {
  return (
    <div
      className={`contacts-status-card ${card.isHeadhunterGroup || card.primaryContact.is_headhunter ? "headhunter" : ""} ${card.isHeadhunterGroup ? "group" : ""} ${dragging ? "dragging" : ""} ${pending ? "pending" : ""} ${saving ? "saving" : ""}`}
      draggable
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={(event) => {
        const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
        dragImage.classList.add("contacts-status-drag-image");
        document.body.appendChild(dragImage);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.id);
        event.dataTransfer.setDragImage(dragImage, 24, 24);
        window.setTimeout(() => dragImage.remove(), 0);
        onDragStart(card.id);
      }}
    >
      <span className="contacts-status-card-icon" title={card.isHeadhunterGroup ? "Empresa headhunter" : card.primaryContact.is_headhunter ? "Headhunter" : "Contacto"}>
        <Icon name={card.isHeadhunterGroup || card.primaryContact.is_headhunter ? "circleDot" : "users"} />
      </span>
      <div className="contacts-status-card-main">
        <Link draggable={false} href={`/contactos?contactId=${encodeURIComponent(card.primaryContact.id)}`}>
          {card.title || "sin nombre"}
        </Link>
        <span className={card.subtitle ? "" : "empty-value"}>{card.subtitle || "Sin empresa · Sin cargo"}</span>
      </div>
      <span className="contacts-status-card-tags" title={card.extraCount ? `${card.extraCount} contacto${card.extraCount === 1 ? "" : "s"} adicional${card.extraCount === 1 ? "" : "es"}` : "Hashtags pendientes"}>
        {card.extraCount ? `+${card.extraCount}` : "#"}
      </span>
    </div>
  );
}

function SortHeader({
  current,
  label,
  onSort,
  sortKey
}: {
  current: SortState;
  label: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
}) {
  const active = current.key === sortKey;
  return (
    <th>
      <button
        className={`contacts-sort-header ${active ? "active" : ""}`}
        onClick={() => onSort(sortKey)}
        title={`Ordenar por ${label}`}
        type="button"
      >
        <span>{label}</span>
        {active ? <Icon name={current.direction === "asc" ? "sortAsc" : "sortDesc"} /> : null}
      </button>
    </th>
  );
}

function sortContacts(contacts: ContactListRow[], sort: SortState) {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...contacts].sort((left, right) => {
    const comparison = compareSortValue(sortValue(left, sort.key), sortValue(right, sort.key), sort.key);
    return comparison * factor;
  });
}

function compareBulkObjectives(left: ObjectiveRow, right: ObjectiveRow, selected: Set<string>) {
  const selectedComparison = Number(selected.has(right.id)) - Number(selected.has(left.id));
  if (selectedComparison) return selectedComparison;
  const typeComparison = objectiveTypeLabel(left.objective_type).localeCompare(objectiveTypeLabel(right.objective_type), "es", { sensitivity: "base" });
  if (typeComparison) return typeComparison;
  return left.objective_name.localeCompare(right.objective_name, "es", { sensitivity: "base" });
}

function buildContactBoardCards(contacts: ContactListRow[], groupHeadhunters: boolean) {
  if (!groupHeadhunters) return contacts.map(contactToBoardCard);

  const grouped = new Map<string, ContactListRow[]>();
  const directCards: ContactBoardCard[] = [];

  for (const contact of contacts) {
    const groupKey = contact.is_headhunter ? headhunterGroupKey(contact) : "";
    if (!groupKey) {
      directCards.push(contactToBoardCard(contact));
      continue;
    }
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)?.push(contact);
  }

  const groupedCards = Array.from(grouped.values()).flatMap((group) => {
    if (group.length < 2) return group.map(contactToBoardCard);
    const primaryContact = mostAdvancedContact(group);
    const company = cleanContactCompany(primaryContact.company);
    const domain = headhunterDomainsForContact(primaryContact)[0] ?? "";
    return [{
      id: `hh:${headhunterGroupKey(primaryContact)}`,
      contactIds: group.map((contact) => contact.id),
      contacts: group,
      primaryContact,
      title: `${primaryContact.display_name || company || domain || "Empresa headhunter"} +${group.length - 1}`,
      subtitle: company || domain || "Empresa headhunter",
      status: statusOrDefault(primaryContact.networking_status),
      isHeadhunterGroup: true,
      extraCount: group.length - 1
    }];
  });

  return [...directCards, ...groupedCards].sort((left, right) => {
    const statusComparison = compareSortValue(sortValue(left.primaryContact, "status"), sortValue(right.primaryContact, "status"), "status");
    if (statusComparison !== 0) return statusComparison;
    return left.title.localeCompare(right.title, "es", { sensitivity: "base" });
  });
}

function contactToBoardCard(contact: ContactListRow): ContactBoardCard {
  const company = cleanContactCompany(contact.company);
  const role = cleanContactRole(contact.role);
  return {
    id: contact.id,
    contactIds: [contact.id],
    contacts: [contact],
    primaryContact: contact,
    title: contact.display_name || "sin nombre",
    subtitle: joinCompact([company, role], ""),
    status: statusOrDefault(contact.networking_status),
    isHeadhunterGroup: false,
    extraCount: 0
  };
}

function groupBoardCardsByStatus(cards: ContactBoardCard[]) {
  return cards.reduce<Map<string, ContactBoardCard[]>>((acc, card) => {
    const status = statusOrDefault(card.status);
    if (!acc.has(status)) acc.set(status, []);
    acc.get(status)?.push(card);
    return acc;
  }, new Map());
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const { [key]: _omitted, ...rest } = record;
  return rest;
}

function omitKeys<T>(record: Record<string, T>, keys: string[]) {
  return keys.reduce((next, key) => omitKey(next, key), record);
}

function applyStatusToIds(record: Record<string, string>, contactIds: string[], status: string) {
  return contactIds.reduce((next, contactId) => ({ ...next, [contactId]: status }), record);
}

function headhunterGroupKey(contact: ContactListRow) {
  const company = cleanContactCompany(contact.company).toLowerCase();
  if (company) return `company:${company}`;
  const domain = headhunterDomainsForContact(contact)[0];
  return domain ? `domain:${domain.toLowerCase()}` : "";
}

function mostAdvancedContact(contacts: ContactListRow[]) {
  return [...contacts].sort((left, right) => statusRank(right.networking_status) - statusRank(left.networking_status))[0] ?? contacts[0];
}

function statusOrDefault(status: string) {
  return NETWORKING_STATUSES.includes(status as typeof NETWORKING_STATUSES[number]) ? status : "Pendiente";
}

function statusRank(status: string) {
  const index = NETWORKING_STATUSES.indexOf(status as typeof NETWORKING_STATUSES[number]);
  return index >= 0 ? index : 0;
}

function removeUnchangedPending(current: Record<string, string>, entries: Array<[string, string]>) {
  return entries.reduce((next, [contactId, status]) => {
    if (next[contactId] !== status) return next;
    return omitKey(next, contactId);
  }, current);
}

function removeSettledOptimistic(current: Record<string, string>, contactIds: string[], entries: Array<[string, string]>) {
  const settled = new Map(entries);
  return contactIds.reduce((next, contactId) => {
    const status = settled.get(contactId);
    if (!status || next[contactId] !== status) return next;
    return omitKey(next, contactId);
  }, current);
}

function sortValue(contact: ContactListRow, key: SortKey) {
  if (key === "name") return contact.display_name || "";
  if (key === "companyRole") return [cleanContactCompany(contact.company), cleanContactRole(contact.role)].join(" ");
  if (key === "status") return NETWORKING_STATUSES.indexOf(contact.networking_status as typeof NETWORKING_STATUSES[number]);
  return contact.days_since_last_interaction ?? Number.POSITIVE_INFINITY;
}

function compareSortValue(left: string | number, right: string | number, key: SortKey) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (key === "daysSince") return 0;
  return String(left).localeCompare(String(right), "es", { sensitivity: "base" });
}

function renderCompanyRole(contact: ContactListRow, resolution: HeadhunterCompanyResolution | "master_unavailable" | undefined) {
  const company = cleanContactCompany(contact.company);
  const role = cleanContactRole(contact.role);
  const marker = renderHeadhunterMarker(contact, resolution);
  if (!company && !role) {
    return (
      <span className="contacts-company-role-with-marker">
        {marker}
        <span>
          <EmptyValue>Sin empresa</EmptyValue>
          <span className="contacts-company-role-separator"> · </span>
          <EmptyValue>Sin cargo</EmptyValue>
        </span>
      </span>
    );
  }
  return (
    <span className="contacts-company-role-with-marker">
      {marker}
      <span>{joinCompact([company, role])}</span>
    </span>
  );
}

function renderHeadhunterMarker(contact: ContactListRow, resolution: HeadhunterCompanyResolution | "master_unavailable" | undefined) {
  if (!contact.is_headhunter) return null;
  const state = headhunterMarkerState(contact, resolution);
  return (
    <span
      className={`contacts-headhunter-marker ${state.tone}`}
      title={state.title}
      aria-label={state.title}
    >
      <Icon name="circleDot" />
      {state.tone !== "ok" ? <i aria-hidden="true">!</i> : null}
    </span>
  );
}

function headhunterMarkerState(
  contact: ContactListRow,
  resolution: HeadhunterCompanyResolution | "master_unavailable" | undefined
) {
  if (resolution === "master_unavailable") {
    return {
      title: "Headhunter: maestro no disponible o sin empresas cargadas.",
      tone: "attention"
    };
  }
  if (!resolution) {
    return {
      title: "Headhunter: falta revisar empresa en el maestro.",
      tone: "attention"
    };
  }
  if (resolution.status === "matched_company") {
    return {
      title: `Headhunter: empresa reconocida como ${resolution.company.displayName}.`,
      tone: "ok"
    };
  }
  if (resolution.status === "matched_domain") {
    return {
      title: `Headhunter: dominio reconocido; falta completar empresa como ${resolution.company.displayName}.`,
      tone: "attention"
    };
  }
  if (resolution.status === "company_mismatch") {
    return {
      title: "Headhunter: la empresa escrita no coincide con el maestro.",
      tone: "attention"
    };
  }
  if (resolution.status === "ambiguous") {
    return {
      title: "Headhunter: hay mas de una empresa posible para sus dominios.",
      tone: "attention"
    };
  }
  return {
    title: "Headhunter: seleccionar o crear empresa headhunter.",
    tone: "attention"
  };
}

function buildHeadhunterResolutionMap(contacts: ContactListRow[], master: HeadhunterCompanyMasterRow[] | null) {
  const result = new Map<string, HeadhunterCompanyResolution | "master_unavailable">();
  for (const contact of contacts) {
    if (!contact.is_headhunter) continue;
    if (!master?.length) {
      result.set(contact.id, "master_unavailable");
      continue;
    }
    result.set(contact.id, resolveHeadhunterCompany(contact, master));
  }
  return result;
}

function formatLastInteractionAge(days: number | null, lastInteractionAt: string | null) {
  if (days === null) return <EmptyValue>sin interacciones</EmptyValue>;
  const title = lastInteractionAt ? new Date(lastInteractionAt).toLocaleDateString("es-CL") : undefined;
  if (days === 0) return <span title={title}>Hoy</span>;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  const parts = [
    months ? `${months}m` : "",
    remainingDays ? `${remainingDays}d` : ""
  ].filter(Boolean);
  return <span title={title}>{parts.join(" ")}</span>;
}
