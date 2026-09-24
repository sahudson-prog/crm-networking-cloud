"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";
import { MetricCard } from "./ui/MetricCard";
import { ProgressBar } from "./ui/ProgressBar";
import { ProviderButton, ProviderIcon } from "./ui/ProviderIcon";
import { StatusBadge } from "./StatusBadge";
import { SyncPreviewDialog } from "./SyncPreviewDialog";
import type { SyncPreviewChange } from "../lib/syncOrchestrator";
import { ContactSyncPreviewSandbox } from "./ContactSyncPreviewSandbox";
import { ContactMergePreview } from "./ContactMergePreview";

const palette = [
  ["Fondo app", "--crm-bg"],
  ["Panel blanco", "--crm-surface"],
  ["Borde", "--crm-border"],
  ["Texto", "--crm-text"],
  ["Secundario", "--crm-muted"],
  ["Dato vacio", "--crm-empty-value"],
  ["Primario", "--crm-primary"],
  ["Acento", "--crm-accent"],
  ["Positivo", "--crm-positive"],
  ["Peligro", "--crm-danger"]
];

const icons = [
  "search",
  "arrowRight",
  "check",
  "close",
  "plus",
  "sync",
  "settings",
  "sparkles",
  "mail",
  "phone",
  "chat",
  "calendar",
  "target",
  "users",
  "trash",
  "link"
] as const;

const states = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

type CoverBoardCard = {
  company: string;
  id: string;
  kind: "contact" | "headhunter";
  name: string;
};

type CoverBoardColumn = {
  cards: CoverBoardCard[];
  id: string;
  title: string;
};

const initialCoverBoardColumns: CoverBoardColumn[] = [
  {
    id: "pendiente",
    title: "Pendiente",
    cards: [
      { company: "Empresa Aurora", id: "demo-uno", kind: "contact", name: "Contacto Demo Uno" },
      { company: "Empresa Boreal", id: "demo-dos", kind: "contact", name: "Contacto Demo Dos" },
      { company: "Search Demo Norte", id: "headhunter-uno", kind: "headhunter", name: "Headhunter Demo Uno" },
      { company: "Search Demo Sur", id: "headhunter-dos", kind: "headhunter", name: "Headhunter Demo Dos" },
      { company: "Empresa Prisma", id: "demo-tres", kind: "contact", name: "Contacto Demo Tres" },
      { company: "Empresa Horizonte", id: "demo-cuatro", kind: "contact", name: "Contacto Demo Cuatro" },
      { company: "Search Demo Centro", id: "headhunter-tres", kind: "headhunter", name: "Headhunter Demo Tres" }
    ]
  },
  {
    id: "contactado",
    title: "Contactado",
    cards: [
      { company: "Empresa Delta", id: "demo-cinco", kind: "contact", name: "Contacto Demo Cinco" },
      { company: "Search Demo Este", id: "headhunter-cuatro", kind: "headhunter", name: "Headhunter Demo Cuatro" },
      { company: "Empresa Vector", id: "demo-seis", kind: "contact", name: "Contacto Demo Seis" },
      { company: "Search Demo Oeste", id: "headhunter-cinco", kind: "headhunter", name: "Headhunter Demo Cinco" },
      { company: "Search Demo Andes", id: "headhunter-seis", kind: "headhunter", name: "Headhunter Demo Seis" }
    ]
  }
];

const syncPreviewChanges: SyncPreviewChange[] = [
  {
    defaultSelected: true,
    fields: [
      { after: "Contacto Demo Nuevo", changed: true, label: "Nombre" },
      { after: "Empresa Demo", changed: true, label: "Empresa" },
      { after: "nuevo@example.invalid", changed: true, label: "Correo" },
      { after: "000000001", changed: true, label: "Telefono" }
    ],
    id: "design-new-ana",
    title: "Contacto Demo Nuevo",
    type: "new"
  },
  {
    defaultSelected: true,
    fields: [
      { after: "Contacto Demo Editado", apply: false, before: "Contacto Demo", changed: true, label: "Nombre", operation: "replace" },
      { after: "Empresa Demo", before: "", changed: true, label: "Empresa" },
      { after: "editado@example.invalid", changed: true, label: "Correo", operation: "add" },
      { apply: false, before: "anterior@example.invalid", changed: true, label: "Correo", operation: "remove" }
    ],
    id: "design-mod-josefina",
    title: "Contacto Demo",
    type: "modified"
  },
  {
    defaultSelected: true,
    fields: [
      { after: "duplicado@example.invalid", before: "duplicado@example.invalid", changed: true, label: "Correo", operation: "match" },
      { after: "Empresa Demo", before: "", changed: true, label: "Empresa" },
      { after: "000000002", changed: true, label: "Telefono", operation: "add" }
    ],
    id: "design-cons-ricardo",
    metadata: {
      mergeSources: [
        {
          company: "Empresa Demo",
          emails: ["duplicado@example.invalid"],
          focus: true,
          headhunter: false,
          id: "contact-demo",
          kind: "Guardado",
          name: "Contacto Demo Duplicado",
          networkingStatus: "Contactado",
          phones: ["000000002"],
          role: "Gerente"
        },
        {
          company: "",
          emails: ["duplicado@example.invalid"],
          focus: false,
          headhunter: false,
          id: "people/demo-a",
          kind: "Fuente conectada",
          name: "Contacto Demo Duplicado",
          networkingStatus: "Pendiente",
          phones: ["000000002"],
          role: ""
        },
        {
          company: "",
          emails: [],
          focus: false,
          headhunter: false,
          id: "people/demo-b",
          kind: "Fuente conectada",
          name: "Contacto Demo D.",
          networkingStatus: "Pendiente",
          phones: ["000000003"],
          role: ""
        }
      ]
    },
    title: "Contacto Demo Duplicado",
    type: "consolidation"
  },
  {
    defaultSelected: false,
    fields: [
      { after: "Contacto Demo A", changed: true, label: "Nombre" },
      { after: "000000004", changed: true, label: "Telefono" }
    ],
    id: "design-dup-complex-alberto",
    metadata: {
      duplicateGroupId: "design-dup-group-alberto",
      duplicateGroupConnectedCount: 3,
      duplicateGroupLabel: "Contacto Demo Grupo",
      duplicateGroupSavedCount: 2,
      duplicateGroupTotalCount: 5,
      mergeSources: [
        {
          company: "",
          emails: [],
          focus: false,
          headhunter: false,
          id: "people/demo-complex-a",
          kind: "Fuente conectada",
          name: "Contacto Demo A",
          networkingStatus: "Pendiente",
          phones: ["000000004"],
          role: ""
        }
      ]
    },
    title: "Contacto Demo A",
    type: "duplicate_complex"
  },
  {
    defaultSelected: false,
    fields: [
      { after: "Contacto Demo Completo", changed: true, label: "Nombre" },
      { after: "completo@example.invalid", changed: true, label: "Correo" },
      { after: "000000004", changed: true, label: "Telefono" }
    ],
    id: "design-dup-complex-alberto-g",
    metadata: {
      duplicateGroupId: "design-dup-group-alberto",
      duplicateGroupConnectedCount: 3,
      duplicateGroupLabel: "Contacto Demo Grupo",
      duplicateGroupSavedCount: 2,
      duplicateGroupTotalCount: 5,
      mergeSources: [
        {
          company: "",
          emails: ["completo@example.invalid"],
          focus: false,
          headhunter: false,
          id: "people/demo-complex-b",
          kind: "Fuente conectada",
          name: "Contacto Demo Completo",
          networkingStatus: "Pendiente",
          phones: ["000000004"],
          role: ""
        }
      ]
    },
    title: "Contacto Demo Completo",
    type: "duplicate_complex"
  },
  {
    defaultSelected: false,
    fields: [
      { before: "Contacto Demo Eliminado", changed: true, label: "Nombre" },
      { before: "Empresa Demo", changed: true, label: "Empresa" },
      { before: "eliminado@example.invalid", changed: true, label: "Correo" }
    ],
    id: "design-deleted-manuel",
    title: "Contacto Demo Eliminado",
    type: "deleted"
  }
];

export function DesignSystemPreview() {
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);
  const [boardColumns, setBoardColumns] = useState<CoverBoardColumn[]>(initialCoverBoardColumns);
  const [draggingCardId, setDraggingCardId] = useState("");
  const [dropIndicator, setDropIndicator] = useState<{ columnId: string; index: number } | null>(null);

  function moveBoardCard(cardId: string, targetColumnId: string, targetIndex: number) {
    setBoardColumns((current) => {
      let movedCard: CoverBoardCard | null = null;
      let sourceColumnId = "";
      let sourceIndex = -1;
      const withoutMoved = current.map((column) => {
        const nextCards = column.cards.filter((card, index) => {
          if (card.id !== cardId) return true;
          movedCard = card;
          sourceColumnId = column.id;
          sourceIndex = index;
          return false;
        });
        return { ...column, cards: nextCards };
      });

      if (!movedCard) return current;
      const normalizedTargetIndex = sourceColumnId === targetColumnId && sourceIndex >= 0 && sourceIndex < targetIndex
        ? targetIndex - 1
        : targetIndex;

      return withoutMoved.map((column) => {
        if (column.id !== targetColumnId) return column;
        const insertAt = Math.max(0, Math.min(normalizedTargetIndex, column.cards.length));
        return {
          ...column,
          cards: [
            ...column.cards.slice(0, insertAt),
            movedCard as CoverBoardCard,
            ...column.cards.slice(insertAt)
          ]
        };
      });
    });
    setDropIndicator(null);
  }

  return (
    <div className="grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Guia visual cloud</h2>
            <span className="panel-caption">Referencia oculta para construir vistas nuevas sin improvisar estilos.</span>
          </div>
          <Button icon="sync" square aria-label="Actualizar referencia" />
        </div>

        <div className="metric-grid">
          <MetricCard label="Contactos" value={1357} icon="users" hint="Tarjeta KPI" />
          <MetricCard label="En foco" value={147} icon="target" hint="Dato principal" />
          <MetricCard label="Coach" value="RULE" icon="sparkles" hint="Modo lectura" />
          <MetricCard label="Sistema" value="OK" icon="settings" hint="Estado simple" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Botones</h2>
          <span className="panel-caption">Maximo 36px alto; iconos centrados.</span>
        </div>
        <div className="toolbar">
          <Button icon="check" tone="primary">Guardar</Button>
          <Button icon="close">Cancelar</Button>
          <Button icon="plus" square aria-label="Agregar" />
          <Button icon="settings" square aria-label="Configurar" />
          <Button icon="sparkles" tone="primary" square aria-label="Coach IA" />
          <Button icon="trash" tone="danger" square aria-label="Desactivar" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Iconos</h2>
          <span className="panel-caption">Acciones y canales estandar.</span>
        </div>
        <div className="icon-grid">
          {icons.map((name) => (
            <div className="icon-sample" key={name}>
              <span className="metric-icon">
                <Icon name={name} />
              </span>
              <span>{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Indicadores informativos</h2>
          <span className="panel-caption">No son botones; explican contexto sin ejecutar acciones.</span>
        </div>
        <div className="toolbar">
          <span
            className="shared-interaction-indicator"
            title={"Interaccion compartida con otros contactos.\nParticipantes:\nDe: Persona Demo A <demo-a@example.invalid>\nPara: Persona Demo B <demo-b@example.invalid>\nCC: Persona Demo C <demo-c@example.invalid>"}
          >
            <Icon name="users" />
          </span>
          <span className="meta">Interaccion compartida</span>
          <a className="external-source-indicator" href="#" title="Origen externo: Gmail. Abrir origen.">
            <ProviderIcon name="google" />
          </a>
          <span className="external-source-indicator disabled" title="Origen externo: Google Calendar. Link directo aun no disponible.">
            <ProviderIcon name="google" />
          </span>
          <span className="meta">Origen externo</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Barras de progreso</h2>
            <span className="panel-caption">Procesos largos con avance visible, reutilizables en sync e importaciones.</span>
          </div>
        </div>
        <div className="progress-reference">
          <ProgressBar
            detail="42 aplicados / 0 fallidos"
            label="Aplicando contactos"
            max={120}
            value={42}
          />
          <ProgressBar
            detail="18 aplicados / 2 fallidos"
            label="Aplicando con advertencias"
            max={80}
            tone="warning"
            value={20}
          />
          <ProgressBar
            detail="Esperando respuesta del proveedor"
            indeterminate
            label="Preparando revision"
            tone="neutral"
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Servicios conectados</h2>
          <span className="panel-caption">Botones globales por proveedor, con version activa y deshabilitada.</span>
        </div>
        <div className="toolbar">
          <ProviderButton name="google" label="Google conectado" />
          <ProviderButton name="apple" label="Apple conectado" />
          <ProviderButton name="microsoft" label="Microsoft conectado" />
          <ProviderButton name="google" label="Google no disponible" disabled />
          <ProviderButton name="apple" label="Apple no disponible" disabled />
          <ProviderButton name="microsoft" label="Microsoft no disponible" disabled />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Preview de sincronizacion</h2>
            <span className="panel-caption">Modal global con pestanas por tipo de cambio y footer global.</span>
          </div>
          <Button icon="sync" tone="primary" onClick={() => setSyncPreviewOpen(true)}>Abrir preview</Button>
        </div>
        <div className="sync-preview-reference">
          <div className="sync-preview-tabs sample" aria-hidden="true">
            <button className="active" type="button"><span>Nuevos</span><strong>1</strong></button>
            <button type="button"><span>Modificaciones</span><strong>1</strong></button>
            <button type="button"><span>Duplicados fusionables</span><strong>1</strong></button>
            <button type="button"><span>Duplicados complejos</span><strong>1</strong></button>
            <button type="button"><span>Eliminaciones</span><strong>1</strong></button>
          </div>
          <span className="panel-caption">El preview muestra solo cambios revisables. Los elementos sin cambios quedan fuera del modal para no confundir la seleccion.</span>
        </div>
        <ContactSyncPreviewSandbox />
        <SyncPreviewDialog
          changes={syncPreviewChanges}
          description="Ejemplo visual: los datos seleccionados se aplicarian desde el footer global."
          onApply={() => setSyncPreviewOpen(false)}
          onClose={() => setSyncPreviewOpen(false)}
          open={syncPreviewOpen}
          title="Preview de sincronizacion"
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Estados</h2>
        </div>
        <div className="toolbar">
          {states.map((state) => (
            <StatusBadge key={state} status={state} />
          ))}
        </div>
      </section>

      <section className="panel">
        <ContactMergePreview />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Tablero Cover Flow</h2>
            <span className="panel-caption">Maqueta funcional: arrastra una tarjeta a la otra columna. Cinco tarjetas visibles por scroll.</span>
          </div>
        </div>
        <div className="state-cover-board" aria-label="Maqueta tablero Cover Flow por estados">
          {boardColumns.map((column) => (
            <CoverFlowColumn
              column={column}
              draggingCardId={draggingCardId}
              dropIndex={dropIndicator?.columnId === column.id ? dropIndicator.index : null}
              key={column.id}
              onDragEnd={() => {
                setDraggingCardId("");
                setDropIndicator(null);
              }}
              onDragStart={(cardId) => {
                setDraggingCardId(cardId);
                setDropIndicator(null);
              }}
              onDropIndexChange={(index) => setDropIndicator({ columnId: column.id, index })}
              onDropCard={moveBoardCard}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Dato vacio</h2>
            <span className="panel-caption">Formato unico para ausencias de dato, placeholders y previews tenues.</span>
          </div>
        </div>
        <div className="empty-value-reference">
          <EmptyValue>Sin empresa</EmptyValue>
          <EmptyValue>Sin cargo</EmptyValue>
          <EmptyValue>sin telefonos</EmptyValue>
          <input aria-label="Placeholder ejemplo" placeholder="correo@empresa.cl" />
          <span className="contact-timeline-preview">Preview de interaccion colapsada...</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Paleta</h2>
        </div>
        <div className="palette-grid">
          {palette.map(([label, token]) => (
            <div className="palette-card" key={token}>
              <span className="palette-swatch" style={{ background: `var(${token})` }} />
              <strong>{label}</strong>
              <span className="meta">{token}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CoverFlowColumn({
  column,
  draggingCardId,
  dropIndex,
  onDragEnd,
  onDragStart,
  onDropIndexChange,
  onDropCard
}: {
  column: CoverBoardColumn;
  draggingCardId: string;
  dropIndex: number | null;
  onDragEnd: () => void;
  onDragStart: (cardId: string) => void;
  onDropIndexChange: (index: number) => void;
  onDropCard: (cardId: string, targetColumnId: string, targetIndex: number) => void;
}) {
  return (
    <div
      className={`state-cover-column ${draggingCardId ? "drop-ready" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const cardId = event.dataTransfer.getData("text/plain") || draggingCardId;
        if (cardId) onDropCard(cardId, column.id, dropIndex ?? column.cards.length);
        onDragEnd();
      }}
    >
      <div className="state-cover-column-head">
        <StatusBadge status={column.title} />
        <strong>{column.cards.length}</strong>
      </div>
      <div className="state-cover-scroll">
        {column.cards.map((card, index) => (
          <div key={card.id}>
            {dropIndex === index ? <div className="state-cover-drop-line" /> : null}
            <div
              className={`state-cover-card ${card.kind} ${draggingCardId === card.id ? "dragging" : ""}`}
              data-board-card
              draggable
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onDropIndexChange(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
              }}
              onDragStart={(event) => {
                const dragImage = event.currentTarget.cloneNode(true) as HTMLElement;
                dragImage.classList.add("state-cover-drag-image");
                document.body.appendChild(dragImage);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", card.id);
                event.dataTransfer.setDragImage(dragImage, 24, 24);
                window.setTimeout(() => dragImage.remove(), 0);
                onDragStart(card.id);
              }}
            >
              <span className="state-cover-card-icon">
                <Icon name={card.kind === "headhunter" ? "search" : "user"} />
              </span>
              <div>
                <strong>{card.name}</strong>
                <span>{card.company}</span>
              </div>
            </div>
          </div>
        ))}
        {dropIndex === column.cards.length && column.cards.length ? <div className="state-cover-drop-line" /> : null}
        {!column.cards.length ? <div className="state-cover-empty">Suelta una tarjeta aca</div> : null}
      </div>
    </div>
  );
}
