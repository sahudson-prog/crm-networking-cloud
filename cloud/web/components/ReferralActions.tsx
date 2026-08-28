import Link from "next/link";
import { cleanContactCompany, cleanContactRole, joinCompact } from "../lib/format";
import type { DashboardReferralRow } from "../lib/readModel";
import { StatusBadge } from "./StatusBadge";
import { EmptyValue } from "./ui/EmptyValue";

export function ReferralActions({ rows }: { rows: DashboardReferralRow[] }) {
  if (!rows.length) return <span className="empty">Sin referidos para los filtros actuales.</span>;

  return (
    <div className="dashboard-referral-list">
      {rows.map((row) => (
        <article className="contact-referral-card dashboard-referral-card" key={row.id}>
          <div className="dashboard-referral-referrer">
            <span className="dashboard-referral-label">Refiere</span>
            <Link href={`/contactos?contactId=${encodeURIComponent(row.referredByContactId)}`}>{row.referrerName}</Link>
            <StatusBadge status={row.referrerStatus || "Pendiente"} />
          </div>
          <div className="contact-referral-note dashboard-referral-referred">
            <strong>{row.referredName}</strong>
            <span>{joinCompact([row.notes, row.referredCompany, row.referredRole])}</span>
            <span>{joinCompact([row.referredEmail, row.referredPhone])}</span>
          </div>
          <div className="contact-referral-link-row dashboard-referral-linked">
            <div>
              <span className="dashboard-referral-label">Contacto vinculado</span>
              {row.linkedContactId ? (
                <>
                  <Link href={`/contactos?contactId=${encodeURIComponent(row.linkedContactId)}`}>
                    {row.linkedContactName || "Contacto vinculado"}
                  </Link>
                  <span className="meta">{joinCompact([cleanContactCompany(row.linkedContactCompany), cleanContactRole(row.linkedContactRole)])}</span>
                  <StatusBadge status={row.linkedContactStatus || "Pendiente"} />
                </>
              ) : (
                <EmptyValue>sin vinculo</EmptyValue>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
