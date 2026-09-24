export type DiagnosticTableLike = {
  table: string;
};

export function filterDiagnosticTablesByAccess<T extends DiagnosticTableLike>(
  tables: readonly T[],
  canViewDiagnostics: boolean
) {
  return tables.filter((table) => table.table !== "sync_run_logs" || canViewDiagnostics);
}
