"use client";

import type { DragEvent, ReactNode } from "react";

export type BoardDropTarget = { index: number; status: string };
type CardEvents = {
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (id: string) => void;
};

// Extracted from ContactTable: both boards use the same drop geometry and DOM.
export function StatusBoard<T extends { id: string }>({
  label, statuses, cardsByStatus, draggingId, dropTarget, onDragEnd, onDragStart,
  onDropCard, onDropTargetChange, columnClass, renderHeader, renderCard,
  className = "", emptyText = "Suelta un contacto aca"
}: {
  label: string;
  statuses: readonly string[];
  cardsByStatus: Map<string, T[]>;
  draggingId: string;
  dropTarget: BoardDropTarget | null;
  onDragEnd: () => void;
  onDragStart: (id: string) => void;
  onDropCard: (id: string, status: string) => void;
  onDropTargetChange: (target: BoardDropTarget | null) => void;
  columnClass: (status: string) => string;
  renderHeader: (status: string, count: number) => ReactNode;
  renderCard: (card: T, events: CardEvents) => ReactNode;
  className?: string;
  emptyText?: string;
}) {
  return <div className={`contacts-status-board ${className}`} aria-label={label}>
    {statuses.map((status) => {
      const cards = cardsByStatus.get(status) ?? [];
      const targetIndex = dropTarget?.status === status ? dropTarget.index : null;
      return <div key={status} data-board-status={status}
        className={`contacts-status-column ${columnClass(status)} ${draggingId ? "drop-ready" : ""}`}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropTargetChange(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!cards.length) onDropTargetChange({ status, index: 0 });
        }}
        onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain") || draggingId;
          if (id) onDropCard(id, status);
          onDragEnd();
        }}>
        <div className="contacts-status-column-head">{renderHeader(status, cards.length)}</div>
        <div className="contacts-status-scroll">
          {cards.map((card, index) => <div key={card.id}>
            {targetIndex === index ? <div className="contacts-status-drop-line" /> : null}
            {renderCard(card, {
              onDragEnd, onDragStart,
              onDragOver: (event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onDropTargetChange({ status, index: event.clientY < rect.top + rect.height / 2 ? index : index + 1 });
              }
            })}
          </div>)}
          {targetIndex === cards.length && cards.length ? <div className="contacts-status-drop-line" /> : null}
          {!cards.length ? <div className="contacts-status-empty">{emptyText}</div> : null}
        </div>
      </div>;
    })}
  </div>;
}

export function StatusBoardCard({ id, children, className = "", dragging, pending, saving, disabled = false,
  onDragEnd, onDragOver, onDragStart }: CardEvents & {
  id: string; children: ReactNode; className?: string;
  dragging: boolean; pending: boolean; saving: boolean; disabled?: boolean;
}) {
  return <div data-board-card={id}
    className={`contacts-status-card ${className} ${dragging ? "dragging" : ""} ${pending ? "pending" : ""} ${saving ? "saving" : ""}`}
    draggable={!disabled} onDragEnd={onDragEnd} onDragOver={onDragOver}
    onDragStart={(event) => {
      if (disabled) { event.preventDefault(); return; }
      const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
      dragImage.classList.add("contacts-status-drag-image");
      document.body.appendChild(dragImage);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.setDragImage(dragImage, 24, 24);
      window.setTimeout(() => dragImage.remove(), 0);
      onDragStart(id);
    }}>{children}</div>;
}
