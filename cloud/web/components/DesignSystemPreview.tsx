"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { EmptyValue } from "./ui/EmptyValue";
import { Icon } from "./ui/Icon";
import { MetricCard } from "./ui/MetricCard";
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

const syncPreviewChanges: SyncPreviewChange[] = [
  {
    defaultSelected: true,
    fields: [
      { after: "Ana Pereira", changed: true, label: "Nombre" },
      { after: "C-Group", changed: true, label: "Empresa" },
      { after: "ana@c-group.cl", changed: true, label: "Correo" },
      { after: "+56 9 4444 2222", changed: true, label: "Telefono" }
    ],
    id: "design-new-ana",
    title: "Ana Pereira",
    type: "new"
  },
  {
    defaultSelected: true,
    fields: [
      { after: "Josefina Camus Headhunter", apply: false, before: "Josefina Camus", changed: true, label: "Nombre", operation: "replace" },
      { after: "Seminarium", before: "", changed: true, label: "Empresa" },
      { after: "josefina@seminarium.cl", changed: true, label: "Correo", operation: "add" },
      { apply: false, before: "josefina.antiguo@empresa.cl", changed: true, label: "Correo", operation: "remove" }
    ],
    id: "design-mod-josefina",
    title: "Josefina Camus",
    type: "modified"
  },
  {
    defaultSelected: true,
    fields: [
      { after: "smith@gmail.com", before: "smith@gmail.com", changed: true, label: "Correo", operation: "match" },
      { after: "Patria", before: "", changed: true, label: "Empresa" },
      { after: "+56 9 8888 1111", changed: true, label: "Telefono", operation: "add" }
    ],
    id: "design-cons-ricardo",
    metadata: {
      mergeSources: [
        {
          company: "Patria",
          emails: ["smith@gmail.com"],
          focus: true,
          headhunter: false,
          id: "contact-ricardo",
          kind: "Guardado",
          name: "Ricardo Smith",
          networkingStatus: "Contactado",
          phones: ["+56 9 8888 1111"],
          role: "Gerente"
        },
        {
          company: "",
          emails: ["smith@gmail.com"],
          focus: false,
          headhunter: false,
          id: "people/ricardo-a",
          kind: "Importado",
          name: "Ricardo Smith",
          networkingStatus: "Pendiente",
          phones: ["+56 9 8888 1111"],
          role: ""
        },
        {
          company: "",
          emails: [],
          focus: false,
          headhunter: false,
          id: "people/ricardo-b",
          kind: "Importado",
          name: "Ricardo S.",
          networkingStatus: "Pendiente",
          phones: ["+56 9 7777 1111"],
          role: ""
        }
      ]
    },
    title: "Ricardo Smith",
    type: "consolidation"
  },
  {
    defaultSelected: false,
    fields: [
      { after: "Alberto V", changed: true, label: "Nombre" },
      { after: "56228371378", changed: true, label: "Telefono" }
    ],
    id: "design-dup-complex-alberto",
    metadata: {
      duplicateGroupId: "design-dup-group-alberto",
      duplicateGroupImportedCount: 3,
      duplicateGroupLabel: "Alberto Villate",
      duplicateGroupSavedCount: 2,
      duplicateGroupTotalCount: 5,
      mergeSources: [
        {
          company: "",
          emails: [],
          focus: false,
          headhunter: false,
          id: "people/alberto-v",
          kind: "Importado",
          name: "Alberto V",
          networkingStatus: "Pendiente",
          phones: ["56228371378"],
          role: ""
        }
      ]
    },
    title: "Alberto V",
    type: "duplicate_complex"
  },
  {
    defaultSelected: false,
    fields: [
      { after: "Alberto Villate Galarce", changed: true, label: "Nombre" },
      { after: "avillate@skberge.cl", changed: true, label: "Correo" },
      { after: "56228371378", changed: true, label: "Telefono" }
    ],
    id: "design-dup-complex-alberto-g",
    metadata: {
      duplicateGroupId: "design-dup-group-alberto",
      duplicateGroupImportedCount: 3,
      duplicateGroupLabel: "Alberto Villate",
      duplicateGroupSavedCount: 2,
      duplicateGroupTotalCount: 5,
      mergeSources: [
        {
          company: "",
          emails: ["avillate@skberge.cl"],
          focus: false,
          headhunter: false,
          id: "people/alberto-g",
          kind: "Importado",
          name: "Alberto Villate Galarce",
          networkingStatus: "Pendiente",
          phones: ["56228371378"],
          role: ""
        }
      ]
    },
    title: "Alberto Villate Galarce",
    type: "duplicate_complex"
  },
  {
    defaultSelected: false,
    fields: [
      { before: "Manuel Diaz", changed: true, label: "Nombre" },
      { before: "Outplacement", changed: true, label: "Empresa" },
      { before: "manuel@outplacement.cl", changed: true, label: "Correo" }
    ],
    id: "design-deleted-manuel",
    title: "Manuel Diaz",
    type: "deleted"
  }
];

export function DesignSystemPreview() {
  const [syncPreviewOpen, setSyncPreviewOpen] = useState(false);

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
            title={"Interaccion compartida con otros contactos.\nParticipantes:\nDe: Maria S. <maria@empresa.cl>\nPara: Sergio H. <sergio@correo.cl>\nCC: Jorge M. <jorge@empresa.cl>"}
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
            <button type="button"><span>Sin cambios</span><strong>4</strong></button>
          </div>
          <span className="panel-caption">Las eliminaciones quedan separadas para evitar aplicar cambios delicados por error.</span>
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
