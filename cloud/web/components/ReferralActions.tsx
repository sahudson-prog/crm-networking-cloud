import type { ReferralActionRow } from "../lib/readModel";
import { StatusBadge } from "./StatusBadge";

export function ReferralActions({ rows }: { rows: ReferralActionRow[] }) {
  if (!rows.length) return <span className="empty">Sin referidos sugeridos por accionar.</span>;

  return (
    <div className="card-list">
      {rows.map((row) => (
        <article className="soft-card referral-card" key={row.id}>
          <div>
            <strong>{row.referredName}</strong>
            <span className="meta">Referido por {row.referrerName}</span>
            {row.notes ? <span className="meta">{row.notes}</span> : null}
          </div>
          <StatusBadge status={row.status} />
        </article>
      ))}
    </div>
  );
}
