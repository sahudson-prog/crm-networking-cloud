export const NETWORKING_CYCLE_RESULTS = [
  { code: "new_job", label: "Conseguí un nuevo trabajo" },
  { code: "ended_without_job", label: "Terminé la búsqueda sin conseguir un nuevo trabajo" },
  { code: "stopped", label: "Dejé de buscar por ahora" },
  { code: "other", label: "Otro resultado" },
  { code: "prefer_not_to_say", label: "Prefiero no indicar" }
] as const;

export type NetworkingCycleResult = (typeof NETWORKING_CYCLE_RESULTS)[number]["code"];

export function networkingCycleResultLabel(value: string | null) {
  return NETWORKING_CYCLE_RESULTS.find((entry) => entry.code === value)?.label ?? "No informado";
}
