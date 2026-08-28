"use client";

import Link from "next/link";
import type {
  ContactRow,
  ExternalInteractionSourceRow,
  InteractionParticipantRow,
  InteractionRow
} from "../lib/readModel";
import { interactionLabel, shortDate } from "../lib/format";
import { Button } from "./ui/Button";
import { Icon, type IconName } from "./ui/Icon";
import { ProviderIcon } from "./ui/ProviderIcon";

type InteractionTimelineListProps = {
  contactsById?: Map<string, ContactRow>;
  emptyMessage?: string;
  expandedIds?: Set<string>;
  interactions: InteractionRow[];
  participantsByInteraction: Map<string, InteractionParticipantRow[]>;
  sourcesByInteraction: Map<string, ExternalInteractionSourceRow[]>;
  showContactContext?: boolean;
  onEdit?: (interaction: InteractionRow) => void;
  onOpenChange?: (interactionId: string, open: boolean) => void;
};

export function InteractionTimelineList({
  contactsById,
  emptyMessage = "Sin interacciones registradas.",
  expandedIds,
  interactions,
  participantsByInteraction,
  sourcesByInteraction,
  showContactContext = false,
  onEdit,
  onOpenChange
}: InteractionTimelineListProps) {
  if (!interactions.length) return <div className="empty">{emptyMessage}</div>;

  return (
    <div className={`contact-interaction-list ${showContactContext ? "dashboard-interaction-list" : ""}`}>
      {interactions.map((interaction) => (
        <InteractionTimelineItem
          contactsById={contactsById}
          interaction={interaction}
          isOpen={expandedIds?.has(interaction.id)}
          key={interaction.id}
          onEdit={onEdit}
          onOpenChange={onOpenChange}
          participants={participantsByInteraction.get(interaction.id) ?? []}
          showContactContext={showContactContext}
          sources={sourcesByInteraction.get(interaction.id) ?? []}
        />
      ))}
    </div>
  );
}

export function groupParticipantsByInteraction(participants: InteractionParticipantRow[]) {
  return participants.reduce<Map<string, InteractionParticipantRow[]>>((acc, participant) => {
    if (!acc.has(participant.interaction_id)) acc.set(participant.interaction_id, []);
    acc.get(participant.interaction_id)?.push(participant);
    return acc;
  }, new Map());
}

export function groupSourcesByInteraction(sources: ExternalInteractionSourceRow[]) {
  return sources.reduce<Map<string, ExternalInteractionSourceRow[]>>((acc, source) => {
    if (!acc.has(source.interaction_id)) acc.set(source.interaction_id, []);
    acc.get(source.interaction_id)?.push(source);
    return acc;
  }, new Map());
}

function InteractionTimelineItem({
  contactsById,
  interaction,
  isOpen,
  onEdit,
  onOpenChange,
  participants,
  showContactContext,
  sources
}: {
  contactsById?: Map<string, ContactRow>;
  interaction: InteractionRow;
  isOpen?: boolean;
  onEdit?: (interaction: InteractionRow) => void;
  onOpenChange?: (interactionId: string, open: boolean) => void;
  participants: InteractionParticipantRow[];
  showContactContext: boolean;
  sources: ExternalInteractionSourceRow[];
}) {
  const icon = interactionIcon(interaction.interaction_type);
  const title = interaction.subject || interactionLabelShort(interaction);
  const detail = interaction.user_notes_raw?.trim() || "";
  const preview = detail.replace(/\s+/g, " ").slice(0, 110);
  const sharedTooltip = sharedInteractionTooltip(participants);
  const contacts = contactsForParticipants(participants, contactsById);

  return (
    <details
      className={`contact-timeline-item ${interaction.interaction_type} ${showContactContext ? "dashboard-timeline-item" : ""}`}
      onToggle={(event) => onOpenChange?.(interaction.id, event.currentTarget.open)}
      open={isOpen}
    >
      <summary>
        {showContactContext ? <DashboardInteractionContacts contacts={contacts} /> : null}
        <span className="contact-timeline-date">{shortDate(interaction.occurred_at)}</span>
        <span className={`interaction-icon ${interaction.interaction_type}`}>
          <Icon name={icon} />
        </span>
        <span className="shared-interaction-slot">
          {sharedTooltip ? (
            <span className="shared-interaction-indicator" title={sharedTooltip}>
              <Icon name="users" />
            </span>
          ) : null}
        </span>
        <span className="contact-timeline-main">
          <strong>{title}</strong>
          <span className="contact-timeline-preview">{preview}</span>
        </span>
        <ExternalSourceIndicator sources={sources} />
        {onEdit ? (
          <Button
            aria-label="Editar minuta"
            icon="edit"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEdit(interaction);
            }}
            square
          />
        ) : (
          <span className="timeline-action-slot" />
        )}
      </summary>
      <div className="contact-timeline-detail">
        <p>{detail || "Sin minuta editable."}</p>
      </div>
    </details>
  );
}

function DashboardInteractionContacts({ contacts }: { contacts: ContactRow[] }) {
  if (!contacts.length) return <span className="dashboard-timeline-contacts empty-value">sin contacto</span>;

  return (
    <span className="dashboard-timeline-contacts">
      {contacts.map((contact, index) => (
        <span key={contact.id}>
          {index ? <span className="dashboard-timeline-contact-separator">·</span> : null}
          <Link href={`/contactos?contactId=${encodeURIComponent(contact.id)}`}>{contact.display_name || "sin nombre"}</Link>
        </span>
      ))}
    </span>
  );
}

function ExternalSourceIndicator({ sources }: { sources: ExternalInteractionSourceRow[] }) {
  const source = preferredExternalSource(sources);
  if (!source) return <span className="external-source-slot" />;

  const label = externalSourceLabel(source);
  const href = externalSourceHref(source);
  const content = (
    <>
      <ProviderIcon name="google" />
      <span className="sr-only">{label}</span>
    </>
  );

  if (href) {
    return (
      <a className="external-source-indicator" href={href} rel="noreferrer" target="_blank" title={`${label}. Abrir origen.`}>
        {content}
      </a>
    );
  }

  return (
    <span className="external-source-indicator disabled" title={`${label}. Link directo aun no disponible.`}>
      {content}
    </span>
  );
}

function contactsForParticipants(participants: InteractionParticipantRow[], contactsById?: Map<string, ContactRow>) {
  const contacts: ContactRow[] = [];
  const seen = new Set<string>();
  for (const participant of participants) {
    if (!participant.contact_id || seen.has(participant.contact_id)) continue;
    const contact = contactsById?.get(participant.contact_id);
    if (!contact) continue;
    seen.add(contact.id);
    contacts.push(contact);
  }
  return contacts;
}

function interactionIcon(type: InteractionRow["interaction_type"]): IconName {
  if (type === "calendar") return "calendar";
  if (type === "call") return "phone";
  if (type === "message") return "chat";
  if (type === "manual") return "plus";
  return "mail";
}

function interactionLabelShort(interaction: InteractionRow) {
  if (interaction.interaction_type === "calendar") return "Cita";
  if (interaction.interaction_type === "call") return "Llamada";
  if (interaction.interaction_type === "message") return "Mensaje";
  if (interaction.interaction_type === "manual") return "Interaccion manual";
  return interaction.direction === "outbound" ? "Correo enviado" : "Correo";
}

function preferredExternalSource(sources: ExternalInteractionSourceRow[]) {
  return sources.find((source) => source.external_url) ?? sources[0] ?? null;
}

function externalSourceLabel(source: ExternalInteractionSourceRow) {
  const service = source.source_service === "calendar" ? "Google Calendar" : source.source_service === "gmail" ? "Gmail" : "Google";
  const status = source.prevent_reimport ? " reimportacion bloqueada" : ` estado ${source.sync_status || "vinculado"}`;
  return `Origen externo: ${service};${status}`;
}

function externalSourceHref(source: ExternalInteractionSourceRow) {
  if (source.external_url) return source.external_url;
  if (source.source_service === "gmail") {
    const gmailId = stripProviderPrefix(source.external_id, "GMAIL_");
    return gmailId ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(gmailId)}` : "";
  }
  return "";
}

function stripProviderPrefix(value: string | null | undefined, prefix: string) {
  if (!value) return "";
  return value.toUpperCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function sharedInteractionTooltip(participants: InteractionParticipantRow[]) {
  const visibleParticipants = dedupeParticipants(participants);
  if (visibleParticipants.length <= 1) return "";
  const uniqueContacts = new Set(
    visibleParticipants.map((participant) => participant.contact_id || participant.email_identity || participant.contact_name).filter(Boolean)
  );
  const intro = uniqueContacts.size > 1
    ? "Interaccion compartida con otros contactos."
    : "Interaccion con multiples direcciones.";
  return [
    intro,
    "Participantes:",
    ...visibleParticipants.map((participant) => `${roleLabel(participant.role)}: ${participantLabel(participant)}`)
  ].join("\n");
}

function dedupeParticipants(participants: InteractionParticipantRow[]) {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = [
      participant.role || "",
      participant.contact_id || "",
      (participant.email_identity || "").toLowerCase(),
      (participant.contact_name || "").toLowerCase()
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function participantLabel(participant: InteractionParticipantRow) {
  const name = participant.contact_name?.trim();
  const email = participant.email_identity?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || "Participante sin dato";
}

function roleLabel(role: string | null | undefined) {
  const cleanRole = (role || "").toUpperCase();
  if (cleanRole === "FROM") return "De";
  if (cleanRole === "TO") return "Para";
  if (cleanRole === "CC") return "CC";
  if (cleanRole === "BCC") return "CCO";
  return cleanRole || "Rol";
}
