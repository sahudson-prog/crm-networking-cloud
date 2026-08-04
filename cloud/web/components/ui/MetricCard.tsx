import { Icon, type IconName } from "./Icon";

export function MetricCard({
  label,
  value,
  icon,
  hint
}: {
  label: string;
  value: number | string;
  icon: IconName;
  hint?: string;
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon">
          <Icon name={icon} />
        </span>
      </div>
      <span className="metric-value">{value}</span>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </article>
  );
}
