"use client";

import { useEffect, useMemo, useState } from "react";
import type { TodoRow } from "../lib/readModel";
import type { InteractionRow } from "../lib/readModel";
import { dismissCoachTodos, executeCoachTodos } from "../lib/coachActions";
import { reviewNetworkingStatusSuggestions } from "../lib/coachRuleEngine";
import {
  buildCoachDetail,
  buildCoachSummary,
  buildInteractionsByEvidenceId,
  compactSummaryName,
  findEvidenceInteraction,
  formatCoachDate,
  parseCoachEvidence,
  parseCoachState,
  shortContactName
} from "../lib/coachText";
import { statusClass } from "../lib/format";
import { CoachActionLogDialog } from "./CoachActionLogDialog";
import { CoachConfigDialog } from "./CoachConfigDialog";
import { Button } from "./ui/Button";

type CoachModuleProps = {
  todos: TodoRow[];
  total: number;
  contactId?: string;
  variant?: "dashboard" | "contact";
  botSize?: "normal" | "mini";
  maxVisible?: number;
  interactions?: InteractionRow[];
  onExecuted?: () => void;
};

export function CoachPreview(props: CoachModuleProps) {
  return <CoachModule {...props} />;
}

export function CoachModule({
  todos,
  total,
  contactId,
  variant = "dashboard",
  botSize = "normal",
  maxVisible = 4,
  interactions = [],
  onExecuted
}: CoachModuleProps) {
  const visibleTodos = useMemo(
    () => (contactId ? todos.filter((todo) => todo.object_id === contactId) : todos),
    [contactId, todos]
  );
  const count = contactId ? visibleTodos.length : total;
  const interactionsByEvidenceId = buildInteractionsByEvidenceId(interactions);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const selectedTodos = useMemo(
    () => visibleTodos.filter((todo) => selectedIds.has(todo.id)),
    [selectedIds, visibleTodos]
  );

  useEffect(() => {
    setSelectedIds((previous) => {
      const visibleIds = new Set(visibleTodos.map((todo) => todo.id));
      return new Set(Array.from(previous).filter((id) => visibleIds.has(id)));
    });
  }, [visibleTodos]);

  function toggleTodo(todoId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });
  }

  async function executeSelected() {
    if (!selectedTodos.length) return;
    setIsExecuting(true);
    setFeedback("");
    try {
      const result = await executeCoachTodos(selectedTodos);
      const parts = [`Ejecutadas: ${result.executed}`];
      if (result.unsupported) parts.push(`omitidas: ${result.unsupported}`);
      if (result.errors.length) parts.push(`errores: ${result.errors.length}`);
      setFeedback(parts.join(" - "));
      setSelectedIds(new Set());
      onExecuted?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude ejecutar las sugerencias.");
    } finally {
      setIsExecuting(false);
    }
  }

  async function dismissSelected() {
    if (!selectedTodos.length) return;
    setIsExecuting(true);
    setFeedback("");
    try {
      const result = await dismissCoachTodos(selectedTodos);
      const parts = [`Descartadas: ${result.dismissed}`];
      if (result.errors.length) parts.push(`errores: ${result.errors.length}`);
      setFeedback(parts.join(" - "));
      setSelectedIds(new Set());
      onExecuted?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude descartar las sugerencias.");
    } finally {
      setIsExecuting(false);
    }
  }

  async function reviewSuggestions() {
    setIsExecuting(true);
    setFeedback("");
    try {
      const result = await reviewNetworkingStatusSuggestions();
      const parts = [
        `Nuevas: ${result.created}`,
        `vigentes: ${result.kept}`,
        `cerradas: ${result.closed}`
      ];
      if (result.autoExecuted) parts.push(`autoejecutadas: ${result.autoExecuted}`);
      if (result.skipped) parts.push(`omitidas: ${result.skipped}`);
      if (result.errors.length) parts.push(`errores: ${result.errors.length}`);
      setFeedback(parts.join(" - "));
      setSelectedIds(new Set());
      onExecuted?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pude buscar nuevas sugerencias.");
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <section className={`coach-module ${variant} bot-${botSize}`} data-coach-count={count}>
      <div className="coach-rail">
        <CoachMascot size={botSize} />
        <div className="toolbar coach-actions" aria-label="Acciones del Coach IA">
          <Button
            disabled={!selectedTodos.length || isExecuting}
            icon="check"
            onClick={executeSelected}
            square
            tone="primary"
            aria-label="Ejecutar sugerencias seleccionadas"
          />
          <Button
            disabled={!selectedTodos.length || isExecuting}
            icon="close"
            onClick={dismissSelected}
            square
            aria-label="Descartar sugerencias seleccionadas"
          />
          <Button
            disabled={isExecuting}
            icon="sparkles"
            onClick={reviewSuggestions}
            square
            tone="primary"
            aria-label="Buscar sugerencias"
          />
          <Button icon="settings" onClick={() => setConfigOpen(true)} square aria-label="Configurar automatizaciones" />
        </div>
      </div>

      <div className="coach-chat-scroll" style={{ ["--coach-visible" as string]: maxVisible }}>
        {visibleTodos.length ? (
          visibleTodos.map((todo) => (
            <CoachMessage
              checked={selectedIds.has(todo.id)}
              key={todo.id}
              onToggle={() => toggleTodo(todo.id)}
              todo={todo}
              interactionsByEvidenceId={interactionsByEvidenceId}
            />
          ))
        ) : (
          <details className="coach-message">
            <summary>
              <span className="coach-message-text">No tengo sugerencias abiertas</span>
              <span className="coach-message-date">Hoy</span>
            </summary>
            <div className="coach-message-detail">
              No tengo comentarios pendientes para este contexto.
            </div>
          </details>
        )}
      </div>
      {feedback ? <div className="coach-feedback">{feedback}</div> : null}
      <CoachConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onOpenHistory={() => {
          setConfigOpen(false);
          setLogOpen(true);
        }}
        onSaved={onExecuted}
      />
      <CoachActionLogDialog open={logOpen} contactId={contactId} onClose={() => setLogOpen(false)} />
    </section>
  );
}

function CoachMascot({ size }: { size: "normal" | "mini" }) {
  return (
    <div className={`coach-floating-bot coach-floating-bot-${size}`} aria-label="Asistente virtual del Coach IA">
      <div className="coach-bot">
        <div className="coach-bot-antenna" />
        <div className="coach-bot-head">
          <div className="coach-bot-eye" />
          <div className="coach-bot-eye" />
          <div className="coach-bot-mouth" />
        </div>
        <div className="coach-bot-neck" />
        <div className="coach-bot-body">
          <div className="coach-bot-panel" aria-hidden="true">
            <span>C</span>
            <span>o</span>
            <span>a</span>
            <span>c</span>
            <span>h</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachMessage({
  checked,
  onToggle,
  todo,
  interactionsByEvidenceId
}: {
  checked: boolean;
  onToggle: () => void;
  todo: TodoRow;
  interactionsByEvidenceId: Map<string, InteractionRow>;
}) {
  const current = parseCoachState(todo.current_state);
  const suggested = parseCoachState(todo.suggested_state);
  const evidence = parseCoachEvidence(todo.evidence);
  const currentStatus = current.Estado_CRM ?? current.networking_status ?? "";
  const suggestedStatus = suggested.Estado_CRM ?? suggested.networking_status ?? "";
  const hasStatusChange = Boolean(currentStatus || suggestedStatus);
  const evidenceInteraction = findEvidenceInteraction(evidence, interactionsByEvidenceId);
  const summary = buildCoachSummary(todo, currentStatus, suggestedStatus);
  const detail = buildCoachDetail(todo, evidence, evidenceInteraction);
  const contactName = shortContactName(todo.summary || "contacto");
  const summaryName = compactSummaryName(todo.summary || "este contacto");

  return (
    <div className="coach-message-row">
      <details className="coach-message">
        <summary>
          <span className="coach-message-text">
            {hasStatusChange ? (
              <>
                {summary.prefix} <strong className="coach-contact-name">{summaryName}</strong> de{" "}
                <CoachState value={currentStatus || "sin estado"} /> a{" "}
                <CoachState value={suggestedStatus || "sin estado"} />.
              </>
            ) : (
              summary.prefix
            )}
          </span>
          <span className="coach-message-date">{formatCoachDate(todo.created_at)}</span>
        </summary>
        <div className="coach-message-detail">
          <div>{detail}</div>
          <div className="coach-message-actions">
            {todo.object_id ? (
              <a className="coach-contact-link" href={`/contactos?contactId=${encodeURIComponent(todo.object_id)}`}>
                Ir a {contactName}
              </a>
            ) : null}
          </div>
        </div>
      </details>
      <input
        aria-label={`Seleccionar sugerencia de ${contactName}`}
        checked={checked}
        className="coach-message-check"
        onChange={onToggle}
        type="checkbox"
      />
    </div>
  );
}

function CoachState({ value }: { value: string }) {
  return <span className={`coach-state ${statusClass(value)}`}>{value}</span>;
}
