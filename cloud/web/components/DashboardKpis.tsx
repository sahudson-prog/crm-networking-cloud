"use client";

import { useEffect, useRef, useState } from "react";
import type { KpiTrend } from "../lib/readModel";
import { HelpTooltip } from "./ui/HelpTooltip";

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

type StackedPeriod = { realized: number; estimated: number; future: number; detail: string; axisLabel: string; visible: boolean };

export function KpiLineChart({ trend, stacked, stackedMode }: { trend: Pick<KpiTrend, "title" | "points">; stacked?: StackedPeriod[]; stackedMode?: "weekly" | "monthly" }) {
  const frame = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(344);
  useEffect(() => {
    if (!stacked || !frame.current) return;
    const element = frame.current;
    const resize = () => setAvailableWidth(Math.max(1, Math.round(element.clientWidth)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(stacked)]);
  if (stacked && stacked.length !== trend.points.length) throw new Error("Inconsistent KPI periods");
  if (stacked?.some((point, index) => point.realized + point.estimated + point.future !== trend.points[index].total))
    throw new Error("Inconsistent KPI totals");
  const width = stacked ? availableWidth : 320;
  const height = stacked ? (width < 360 ? 180 : width < 480 ? 200 : 220) : 118;
  const top = stacked ? 26 : 16;
  const bottom = stacked ? (stackedMode === "monthly" ? width < 480 ? 58 : 54 : 64) : 28;
  const usableHeight = height - top - bottom;
  const max = Math.max(1, ...trend.points.map((point) => Math.max(point.total, point.firstTime ?? 0)));
  const inset = stacked ? (width < 360 ? 18 : 24) : 18;
  const barWidth = stacked ? Math.max(2, (width - 2 * inset) / (2 * trend.points.length)) : 0;
  const weeklyAngle = width < 360 ? 65 : width < 480 ? 55 : 45;
  const xFor = (index: number) => {
    if (trend.points.length <= 1) return width / 2;
    if (stacked) return inset + (index + 0.5) * 2 * barWidth;
    return 18 + (index * (width - 36)) / (trend.points.length - 1);
  };
  const yFor = (value: number) => top + usableHeight - (value / max) * usableHeight;
  const linePoints = !stacked ? trend.points.map((point, index) => `${xFor(index)},${yFor(point.total)}`).join(" ") : "";

  const chart = (
    <svg className="kpi-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={trend.title}>
      <line className="kpi-base-line" x1="0" x2={width} y1={height - bottom} y2={height - bottom} />
      {trend.points.map((point, index) => {
        if (stacked) {
          const values = stacked[index];
          return <g className="kpi-time-slot" data-index={index} data-visible={values.visible} key={`${index}-stack`}>
            {values.visible ? <>
              <rect className="kpi-realized-bar" x={xFor(index) - barWidth / 2} y={yFor(values.realized)} width={barWidth} height={usableHeight * values.realized / max} rx="1" />
              <rect className="kpi-estimated-bar" x={xFor(index) - barWidth / 2} y={yFor(values.realized + values.estimated)} width={barWidth} height={usableHeight * values.estimated / max} rx="1" />
              <rect className="kpi-future-bar" x={xFor(index) - barWidth / 2} y={yFor(point.total)} width={barWidth} height={usableHeight * values.future / max} rx="1" />
            </> : null}
          </g>;
        }
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
      {!stacked ? <polyline className="kpi-total-line" points={linePoints} /> : null}
      {trend.points.map((point, index) => !stacked || stacked[index].visible ? (
        <g key={`${point.label}-total`}>
          <text className="kpi-total-label" x={xFor(index)} y={Math.max(12, yFor(point.total) - 7)}>
            {point.total}
          </text>
          {!stacked ? <circle className="kpi-total-dot" cx={xFor(index)} cy={yFor(point.total)} r="2.7">
            <title>
              {point.label}: total {point.total}
              {typeof point.firstTime === "number" ? `, primer contacto ${point.firstTime}` : ""}
            </title>
          </circle> : null}
        </g>
      ) : null)}
      {trend.points.map((point, index) => !stacked || stacked[index].visible ? (
        <text className={`kpi-axis-label ${stackedMode === "weekly" ? `weekly ${width < 360 ? "dense" : width < 480 ? "compact" : ""}` : "monthly"} ${stacked && index === 9 ? "current" : ""}`} key={`${point.label}-axis`}
          x={xFor(index)} y={stacked ? height - bottom + 17 : height - 7}
          textLength={stacked && stackedMode === "weekly" && width < 360 ? Math.min(32, 2 * barWidth * 1.25) : undefined}
          lengthAdjust={stacked && stackedMode === "weekly" && width < 360 ? "spacingAndGlyphs" : undefined}
          transform={stacked && stackedMode === "weekly" ? `rotate(-${weeklyAngle} ${xFor(index)} ${height - bottom + 17})` : undefined}>
          {stacked ? stacked[index].axisLabel : point.label}
        </text>
      ) : null)}
    </svg>
  );
  if (!stacked) return chart;
  return <div ref={frame} className="tracking-chart" role="region" aria-label="Gráfico Total cafés">
      {chart}
      {stacked.map((point, index) => point.visible ? <HelpTooltip floating key={index} className="kpi-chart-hit"
        style={{ left: `${100 * xFor(index) / width}%`, width: `${100 / stacked.length}%` }}
        text={`${point.detail}: ${point.realized} con cita pasada, ${point.estimated} con fecha estimada, ${point.future} proyectados. Total ${point.realized + point.estimated + point.future}.`}
        label={point.detail}><span className="sr-only">{point.detail}</span></HelpTooltip> : null)}
  </div>;
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
