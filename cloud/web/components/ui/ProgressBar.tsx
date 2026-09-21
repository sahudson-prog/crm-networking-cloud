import type { ReactNode } from "react";

export type ProgressTone = "neutral" | "primary" | "success" | "warning" | "danger";

export type ProgressBarProps = {
  compact?: boolean;
  detail?: ReactNode;
  indeterminate?: boolean;
  label?: ReactNode;
  max?: number;
  tone?: ProgressTone;
  value?: number;
};

function clampPercent(value?: number, max?: number) {
  if (!max || max <= 0 || value == null) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function ProgressBar({
  compact = false,
  detail,
  indeterminate = false,
  label,
  max,
  tone = "primary",
  value
}: ProgressBarProps) {
  const percent = clampPercent(value, max);
  const ariaValueNow = indeterminate || !max ? undefined : Math.round(percent);
  const ariaLabel = typeof label === "string" ? label : "Progreso";

  return (
    <div className={`progress-stack tone-${tone} ${compact ? "compact" : ""} ${indeterminate ? "indeterminate" : ""}`}>
      {(label || detail) ? (
        <div className="progress-header">
          {label ? <span className="progress-title">{label}</span> : <span />}
          {detail ? <span className="progress-detail">{detail}</span> : null}
        </div>
      ) : null}
      <div
        aria-label={ariaLabel}
        aria-valuemax={indeterminate || !max ? undefined : 100}
        aria-valuemin={indeterminate || !max ? undefined : 0}
        aria-valuenow={ariaValueNow}
        className="progress-track"
        role="progressbar"
      >
        <div className="progress-fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}
