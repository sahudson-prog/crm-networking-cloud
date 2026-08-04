import type { MirrorSummary } from "../lib/readModel";
import { MetricCard } from "./ui/MetricCard";

export function Metrics({ summary }: { summary: MirrorSummary }) {
  const items = [
    { label: "Contactos", value: summary.contacts, icon: "users" },
    { label: "En foco", value: summary.focusContacts, icon: "target" },
    { label: "Headhunters", value: summary.headhunters, icon: "search" },
    { label: "Interacciones", value: summary.interactions, icon: "chat" }
  ] as const;

  return (
    <section className="metric-grid">
      {items.map((item) => (
        <MetricCard key={item.label} label={item.label} value={item.value} icon={item.icon} />
      ))}
    </section>
  );
}
