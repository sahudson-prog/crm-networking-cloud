export type OperationState = {
  resolved: boolean;
  busy?: boolean;
  /** Explicit save/reconciliation, distinct from a background read. */
  confirming?: boolean;
  error?: string;
  onRetry?: () => void;
};

export function operationPhase(state: OperationState): "error" | "busy" | "ready" {
  if (state.error) return "error";
  if (!state.resolved || state.busy || state.confirming) return "busy";
  return "ready";
}
