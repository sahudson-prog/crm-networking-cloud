import type { StatusCount } from "../lib/readModel";

const pipelineOrder = [
  "Pendiente",
  "Contactado",
  "Agendado",
  "Cita concretada",
  "Agradecimiento enviado"
];

export function DashboardPipeline({ counts }: { counts: StatusCount[] }) {
  const countByStatus = new Map(counts.map((item) => [item.status, item.count]));

  return (
    <div className="pipeline">
      {pipelineOrder.map((status) => (
        <div className={`pipeline-step ${statusClassName(status)}`} key={status}>
          <span>{status}</span>
          <strong>{countByStatus.get(status) ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function statusClassName(status: string) {
  if (status === "Pendiente") return "pendiente";
  if (status === "Contactado") return "contactado";
  if (status === "Agendado") return "agendado";
  if (status === "Cita concretada") return "cita";
  if (status === "Agradecimiento enviado") return "agradecimiento";
  return "";
}
