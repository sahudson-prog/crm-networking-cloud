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
  showIndividualSuggestions?: boolean;
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
  showIndividualSuggestions: controlledShowIndividualSuggestions,
  onExecuted
}: CoachModuleProps) {
  const visibleTodos = useMemo(
    () => sortTodosByDate(contactId ? todos.filter((todo) => todo.object_id === contactId) : todos),
    [contactId, todos]
  );
  const count = contactId ? visibleTodos.length : total;
  const interactionsByEvidenceId = buildInteractionsByEvidenceId(interactions);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uncontrolledShowIndividualSuggestions, setUncontrolledShowIndividualSuggestions] = useState(Boolean(contactId));
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const showIndividualSuggestions = controlledShowIndividualSuggestions ?? uncontrolledShowIndividualSuggestions;
  const selectedTodos = useMemo(
    () => visibleTodos.filter((todo) => selectedIds.has(todo.id)),
    [selectedIds, visibleTodos]
  );
  const groupedTodos = useMemo(() => groupCoachTodos(visibleTodos), [visibleTodos]);
  const shouldGroupSuggestions = !contactId && !showIndividualSuggestions && groupedTodos.length > 0;

  useEffect(() => {
    setSelectedIds((previous) => {
      const visibleIds = new Set(visibleTodos.map((todo) => todo.id));
      return new Set(Array.from(previous).filter((id) => visibleIds.has(id)));
    });
  }, [visibleTodos]);

  useEffect(() => {
    if (controlledShowIndividualSuggestions === undefined) {
      setUncontrolledShowIndividualSuggestions(Boolean(contactId));
    }
  }, [contactId, controlledShowIndividualSuggestions]);

  useEffect(() => {
    setExpandedGroupIds((previous) => {
      const groupIds = new Set(groupedTodos.map((group) => group.id));
      return new Set(Array.from(previous).filter((id) => groupIds.has(id)));
    });
  }, [groupedTodos]);

  function toggleTodo(todoId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });
  }

  function toggleTodos(todoIds: string[]) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      const allSelected = todoIds.every((todoId) => next.has(todoId));
      for (const todoId of todoIds) {
        if (allSelected) next.delete(todoId);
        else next.add(todoId);
      }
      return next;
    });
  }

  function toggleGroup(groupId: string) {
    setExpandedGroupIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
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
          shouldGroupSuggestions ? (
            groupedTodos.map((group) => (
              <CoachGroupSection
                checked={group.todos.every((todo) => selectedIds.has(todo.id))}
                expanded={expandedGroupIds.has(group.id)}
                key={group.id}
                group={group}
                interactionsByEvidenceId={interactionsByEvidenceId}
                onGroupToggle={() => toggleGroup(group.id)}
                onToggle={() => toggleTodos(group.todos.map((todo) => todo.id))}
                selectedIds={selectedIds}
                onTodoToggle={toggleTodo}
              />
            ))
          ) : (
            visibleTodos.map((todo) => (
              <CoachMessage
                checked={selectedIds.has(todo.id)}
                key={todo.id}
                onToggle={() => toggleTodo(todo.id)}
                todo={todo}
                interactionsByEvidenceId={interactionsByEvidenceId}
              />
            ))
          )
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

type CoachTodoGroup = {
  id: string;
  todos: TodoRow[];
  todoType: string;
  currentStatus: string;
  suggestedStatus: string;
  suggestedCompany: string;
};

function groupCoachTodos(todos: TodoRow[]): CoachTodoGroup[] {
  const groups = new Map<string, CoachTodoGroup>();
  for (const todo of todos) {
    const current = parseCoachState(todo.current_state);
    const suggested = parseCoachState(todo.suggested_state);
    const currentStatus = current.Estado_CRM ?? current.networking_status ?? "";
    const suggestedStatus = suggested.Estado_CRM ?? suggested.networking_status ?? "";
    const suggestedCompany = suggested.Empresa ?? suggested.company ?? "";
    const id = groupIdForTodo(todo.todo_type, suggestedStatus);
    const existing = groups.get(id);
    if (existing) {
      existing.todos.push(todo);
    } else {
      groups.set(id, {
        id,
        todos: [todo],
        todoType: todo.todo_type,
        currentStatus,
        suggestedStatus,
        suggestedCompany
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    const byDate = todoTime(b.todos[0]) - todoTime(a.todos[0]);
    if (byDate) return byDate;
    return a.todoType.localeCompare(b.todoType, "es");
  });
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
  const suggestedCompany = suggested.Empresa ?? suggested.company ?? "";
  const hasStatusChange = Boolean(currentStatus || suggestedStatus);
  const isHeadhunterCompanyTodo = todo.todo_type === "HEADHUNTER_COMPANY_DETECTED" && suggestedCompany;
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
            ) : isHeadhunterCompanyTodo ? (
              <>
                Registra a <strong className="coach-contact-name">{summaryName}</strong> como headhunter, en{" "}
                <strong className="coach-contact-name">{suggestedCompany}</strong>.
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

function CoachGroupSection({
  checked,
  expanded,
  group,
  interactionsByEvidenceId,
  onGroupToggle,
  onTodoToggle,
  selectedIds,
  onToggle
}: {
  checked: boolean;
  expanded: boolean;
  group: CoachTodoGroup;
  interactionsByEvidenceId: Map<string, InteractionRow>;
  onGroupToggle: () => void;
  onTodoToggle: (todoId: string) => void;
  selectedIds: Set<string>;
  onToggle: () => void;
}) {
  const count = group.todos.length;
  const noun = count === 1 ? "contacto" : "contactos";

  return (
    <div className="coach-group-section">
      <div className={`coach-group-title-row ${expanded ? "expanded" : ""}`}>
        <button className="coach-group-title" type="button" onClick={onGroupToggle}>
          <span className="coach-message-text">
            {group.currentStatus || group.suggestedStatus ? (
              <>
                Cambia el estado de <strong className="coach-contact-name">{count} {noun}</strong> a{" "}
                <CoachState value={group.suggestedStatus || "sin estado"} />.
              </>
            ) : group.todoType === "HEADHUNTER_COMPANY_DETECTED" ? (
              <>
                Registra <strong className="coach-contact-name">{count} {noun}</strong> como headhunters.
              </>
            ) : (
              <>
                Revisa <strong className="coach-contact-name">{count} {noun}</strong> con sugerencias vigentes.
              </>
            )}
          </span>
        </button>
        {!expanded ? (
          <input
            aria-label={`Seleccionar ${count} sugerencias agrupadas`}
            checked={checked}
            className="coach-message-check"
            onChange={onToggle}
            type="checkbox"
          />
        ) : null}
      </div>
      {expanded ? (
        <div className="coach-group-messages">
          {group.todos.map((todo) => (
            <CoachMessage
              checked={selectedIds.has(todo.id)}
              key={todo.id}
              onToggle={() => onTodoToggle(todo.id)}
              todo={todo}
              interactionsByEvidenceId={interactionsByEvidenceId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CoachState({ value }: { value: string }) {
  return <span className={`coach-state ${statusClass(value)}`}>{value}</span>;
}

function groupIdForTodo(todoType: string, suggestedStatus: string) {
  if (todoType === "NETWORKING_STATUS_CHANGE") return `${todoType}|${suggestedStatus}`;
  if (todoType === "HEADHUNTER_COMPANY_DETECTED") return todoType;
  return todoType;
}

function sortTodosByDate(todos: TodoRow[]) {
  return [...todos].sort((a, b) => todoTime(b) - todoTime(a));
}

function todoTime(todo: Pick<TodoRow, "created_at">) {
  const time = new Date(todo.created_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}
