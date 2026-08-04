import type { KpiTrend } from "../lib/readModel";

export function DashboardKpis({ trends }: { trends: KpiTrend[] }) {
  return (
    <div className="kpi-trend-grid">
      {trends.map((trend) => (
        <article className="kpi-trend" key={trend.title} title={trend.description}>
          <div className="kpi-trend-head">
            <div>
              <span className="metric-label">{trend.title}</span>
              <strong>Acum: {trend.accumulated}</strong>
            </div>
          </div>
          <KpiLineChart trend={trend} />
          <KpiLegend hasBars={trend.points.some((point) => typeof point.firstTime === "number")} />
          <span className="kpi-change">{formatChange(trend)}</span>
        </article>
      ))}
    </div>
  );
}

function KpiLineChart({ trend }: { trend: KpiTrend }) {
  const width = 320;
  const height = 118;
  const top = 16;
  const bottom = 28;
  const usableHeight = height - top - bottom;
  const max = Math.max(1, ...trend.points.map((point) => Math.max(point.total, point.firstTime ?? 0)));
  const xFor = (index: number) => {
    if (trend.points.length <= 1) return width / 2;
    return 18 + (index * (width - 36)) / (trend.points.length - 1);
  };
  const yFor = (value: number) => top + usableHeight - (value / max) * usableHeight;
  const linePoints = trend.points.map((point, index) => `${xFor(index)},${yFor(point.total)}`).join(" ");

  return (
    <svg className="kpi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={trend.title}>
      <line className="kpi-base-line" x1="0" x2={width} y1={height - bottom} y2={height - bottom} />
      {trend.points.map((point, index) => {
        const barValue = point.firstTime ?? null;
        if (barValue === null) return null;
        const barHeight = Math.max(3, height - bottom - yFor(barValue));
        const labelInside = barHeight >= 14;
        return (
          <g key={`${point.label}-first`}>
            <rect
              className="kpi-first-bar"
              x={xFor(index) + 6}
              y={height - bottom - barHeight}
              width="10"
              height={barHeight}
              rx="1"
            />
            <text
              className={`kpi-first-label ${labelInside ? "inside" : ""}`}
              x={xFor(index) + 11}
              y={labelInside ? height - bottom - barHeight + 11 : height - bottom - barHeight - 4}
            >
              {barValue}
            </text>
          </g>
        );
      })}
      <polyline className="kpi-total-line" points={linePoints} />
      {trend.points.map((point, index) => (
        <g key={`${point.label}-total`}>
          <text className="kpi-total-label" x={xFor(index)} y={Math.max(8, yFor(point.total) - 7)}>
            {point.total}
          </text>
          <circle className="kpi-total-dot" cx={xFor(index)} cy={yFor(point.total)} r="2.7">
            <title>
              {point.label}: total {point.total}
              {typeof point.firstTime === "number" ? `, primer contacto ${point.firstTime}` : ""}
            </title>
          </circle>
        </g>
      ))}
      {trend.points.map((point, index) => (
        <text className="kpi-axis-label" key={`${point.label}-axis`} x={xFor(index)} y={height - 7}>
          {point.label}
        </text>
      ))}
    </svg>
  );
}

function KpiLegend({ hasBars }: { hasBars: boolean }) {
  if (!hasBars) return <span className="kpi-legend-spacer" />;
  return (
    <div className="chart-legend">
      <span>
        <i className="legend-line" />
        Linea: totales
      </span>
      <span>
        <i className="legend-bar" />
        Barras: primer contacto
      </span>
    </div>
  );
}

function formatChange(trend: KpiTrend) {
  const value = trend.previousChange.value;
  const percent = trend.previousChange.percent;
  const valueText = value > 0 ? `+${value}` : `${value}`;
  const percentText = percent === null ? "" : ` (${percent > 0 ? "+" : ""}${percent}%)`;
  return `${trend.previousChange.label}: ${valueText}${percentText}`;
}
