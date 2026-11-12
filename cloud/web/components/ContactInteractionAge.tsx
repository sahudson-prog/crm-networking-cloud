import { EmptyValue } from "./ui/EmptyValue";

export function formatLastInteractionAge(days: number | null, lastInteractionAt: string | null) {
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
