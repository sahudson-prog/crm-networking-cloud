"use client";
import { useEffect, useState } from "react";
import { historyImportCopy, readHistoryWindow, HistoryCycleRequiredError } from "../lib/historyPolicy";
import { Button } from "./ui/Button";

export type HistoryAvailability = "loading" | "ready" | "unconfigured" | "error";
export function useHistoryImportAvailability() {
  const [status, setStatus] = useState<HistoryAvailability>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    readHistoryWindow().then(() => { if (active) setStatus("ready"); })
      .catch(error => { if (active) setStatus(error instanceof HistoryCycleRequiredError ? "unconfigured" : "error"); });
    return () => { active = false; };
  }, [attempt]);
  return { status, retry: () => { setStatus("loading"); setAttempt(value => value + 1); } };
}
export function HistoryImportAvailabilityFeedback({ status, retry }: { status: HistoryAvailability; retry: () => void }) {
  if (status === "ready") return null;
  return <div className="toolbar">
    <p className={status === "error" ? "form-error" : "meta"} role={status === "error" ? "alert" : "status"}>
      {status === "loading" ? "Comprobando la ventana de importación..." : status === "unconfigured"
        ? "Configura el inicio de tu proceso en Objetivos antes de importar correos o citas."
        : "No pudimos comprobar la ventana de importación. Reintenta; no necesitas cambiar tu proceso."}
    </p>
    {status === "error" ? <Button onClick={retry}>Reintentar lectura</Button> : null}
  </div>;
}
export function HistoryImportNotice({ months }: { months?: number | null }) {
  const [message, setMessage] = useState("Consultando la ventana de importación...");
  useEffect(() => {
    let active = true;
    readHistoryWindow().then(value => { if (active) setMessage(historyImportCopy(value.max_months)); })
      .catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  return <p className="meta">{months ? historyImportCopy(months) : message}</p>;
}
