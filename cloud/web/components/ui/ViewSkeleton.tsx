/** Geometry only: no fake counts or empty results while a read is pending. */
export function ViewSkeleton({ kind = "table", label = "Contenido", rows = 5, columns = 5 }: {
  kind?: "table" | "board" | "list" | "inline" | "form" | "chips";
  label?: string;
  rows?: number;
  columns?: number;
}) {
  if (kind === "inline") return <span className="view-skeleton-inline" role="status" aria-label={label} aria-busy="true"><span aria-hidden="true" /></span>;
  return <div className={`view-skeleton view-skeleton-${kind}`} role="status" aria-label={label} aria-busy="true"
    style={kind === "board" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
    {Array.from({ length: kind === "board" ? columns : rows }, (_, index) => <div key={index} className="view-skeleton-row" aria-hidden="true">
      <span /><span /><span />
    </div>)}
  </div>;
}
