import { statusClass } from "../lib/format";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${statusClass(status)}`}>{status || "sin estado"}</span>;
}
