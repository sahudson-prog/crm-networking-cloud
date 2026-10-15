"use client";

import { useRef, useState, type ChangeEvent } from "react";

import { MAX_ICS_FILE_BYTES, parseIcsCalendar } from "../lib/icsImport";
import { applyIcsImportSelection, type IcsApplyResult } from "../lib/icsImportApply";
import { buildIcsImportReviewFromPersistedData } from "../lib/icsImportData";
import type { IcsImportReviewSnapshot } from "../lib/icsImportReview";
import { requireNetworkingStartIso } from "../lib/syncDate";
import { IcsImportPreviewDialog } from "./IcsImportPreviewDialog";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function IcsImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; tone: "error" | "info" }>({
    message: "",
    tone: "info"
  });
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<IcsImportReviewSnapshot | null>(null);

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setFeedback({ message: "", tone: "info" });
    setPreviewError("");
    if (!file.name.toLowerCase().endsWith(".ics")) {
      setFeedback({ message: "Selecciona un archivo con extensión .ics.", tone: "error" });
      return;
    }
    if (file.size > MAX_ICS_FILE_BYTES) {
      setFeedback({ message: "El archivo iCalendar supera el límite de 5 MB.", tone: "error" });
      return;
    }

    setLoading(true);
    try {
      const minimumStartIso = await requireNetworkingStartIso();
      const parsed = parseIcsCalendar(await file.text());
      const nextSnapshot = await buildIcsImportReviewFromPersistedData({ minimumStartIso, parsed });
      setSnapshot(nextSnapshot);
      setOpen(true);
    } catch (error) {
      setFeedback({
        message: reviewErrorMessage(error),
        tone: "error"
      });
    } finally {
      setLoading(false);
    }
  }

  async function applySelection(changeIds: string[]) {
    if (!snapshot) return;
    setApplying(true);
    setPreviewError("");
    try {
      const result = await applyIcsImportSelection({ snapshot, selectedChangeIds: changeIds });
      setFeedback({ message: resultMessage(result), tone: "info" });
      setOpen(false);
      setSnapshot(null);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "No pudimos completar la importación.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <div className="account-source-row">
        <div className="account-source-main">
          <span className="connected-service-logo active"><Icon name="file" /></span>
          <div>
            <strong>iCalendar (.ics)</strong>
            <span>Importación histórica puntual; no crea una sincronización continua.</span>
          </div>
        </div>
        <div className="account-source-actions">
          <input
            accept=".ics,text/calendar"
            aria-label="Seleccionar archivo iCalendar"
            className="sr-only"
            onChange={(event) => void handleFileSelection(event)}
            ref={inputRef}
            type="file"
          />
          <Button
            aria-label={loading ? "Leyendo archivo iCalendar" : "Importar archivo iCalendar"}
            disabled={loading || applying}
            icon="plus"
            onClick={() => inputRef.current?.click()}
            square
            tone="secondary"
          />
        </div>
      </div>

      <p className="account-import-limits">
        Hasta 500 citas, 5 MB de datos normalizados y 5.000 participantes por importación.
      </p>
      {feedback.message ? (
        <p className={feedback.tone === "error" ? "form-error" : "form-success"} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </p>
      ) : null}

      <IcsImportPreviewDialog
        applying={applying}
        feedbackMessage={previewError}
        onClose={() => {
          if (!applying) setOpen(false);
        }}
        onConfirmSelection={(changeIds) => void applySelection(changeIds)}
        open={open}
        snapshot={snapshot}
      />
    </>
  );
}

function resultMessage(result: IcsApplyResult) {
  return [
    `${result.createdCount} ${result.createdCount === 1 ? "cita creada" : "citas creadas"}`,
    `${result.updatedCount} ${result.updatedCount === 1 ? "actualizada" : "actualizadas"}`,
    `${result.unchangedCount} sin cambios`
  ].join(", ") + ".";
}

function reviewErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    if (code === "42501") return "No tienes permisos para revisar las citas existentes.";
    if (code === "PGRST301") return "Tu sesión ya no está disponible. Vuelve a ingresar.";
  }
  return "No pudimos revisar el archivo iCalendar. Inténtalo nuevamente.";
}
