import type { ContactRow, InteractionRow } from "../lib/readModel";
import { formatContactCompanyRole, interactionLabel, shortDate } from "../lib/format";
import { StatusBadge } from "./StatusBadge";
import { Icon } from "./ui/Icon";

export function RecentContactCards({ contacts }: { contacts: ContactRow[] }) {
  return (
    <div className="card-list">
      {contacts.map((contact) => (
        <article className="soft-card" key={contact.id}>
          <div>
            <strong>{contact.display_name || "sin nombre"}</strong>
            <span className="meta">{formatContactCompanyRole(contact.company, contact.role)}</span>
          </div>
          <StatusBadge status={contact.networking_status} />
        </article>
      ))}
    </div>
  );
}

export function RecentInteractionCards({ interactions }: { interactions: InteractionRow[] }) {
  if (!interactions.length) return <span className="empty">Sin interacciones para los filtros actuales.</span>;

  return (
    <div className="card-list">
      {interactions.map((interaction) => (
        <article className="interaction-card" key={interaction.id}>
          <span className={`interaction-icon ${interaction.interaction_type}`}>
            <Icon name={interactionIcon(interaction.interaction_type)} />
          </span>
          <strong>{shortDate(interaction.occurred_at)}</strong>
          <div>
            <span>{interaction.subject || "sin asunto"}</span>
            <span className="meta">{interactionLabel(interaction.interaction_type, interaction.direction)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function interactionIcon(type: InteractionRow["interaction_type"]) {
  if (type === "calendar") return "calendar";
  if (type === "call") return "phone";
  if (type === "message") return "chat";
  return "mail";
}
