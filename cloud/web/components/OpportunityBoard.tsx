"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribeGlobalActivitySync, getGlobalActivitySyncSnapshot, getGlobalActivitySyncServerSnapshot } from "../lib/activitySyncExecution";
import { BriefcaseBusiness, MessageSquare, Users } from "lucide-react";
import { readOpportunities, saveOpportunity } from "../lib/opportunityActions";
import { peekSharedView } from "../lib/indicatorReads";
import { readOpportunityBoard } from "../lib/readOpportunityBoard";
import { OperationStatus } from "./ui/OperationStatus";
import { subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision } from "../lib/networkingDataRevision";
import { OPPORTUNITY_STAGES, opportunityClosureValid, opportunityMoveIntent, opportunityResultLabel, type Opportunity, type OpportunityResult, type OpportunityStage } from "../lib/opportunityModel";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { ViewSkeleton } from "./ui/ViewSkeleton";
import { OpportunityEditor, type OpportunityEditorRequest } from "./OpportunityEditor";
import { OpportunityCardPopover, type OpportunityCardAction } from "./OpportunityCardPopover";
import { StatusBoard, StatusBoardCard, type BoardDropTarget } from "./ui/StatusBoard";
import { boardMoves, moveOpportunityCard } from "../lib/boardMoves";
import { useBoardMoves } from "../lib/useBoardMoves";

export function WingedBriefcase() {
  return <svg className="opportunity-winged-icon" aria-hidden="true" width="34" height="28" viewBox="0 0 34 28"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11C18 5 12 5 9 2C7 0 6 3 7 5C8 7 10 8 11 8C8 7 8 10 10 11C12 13 15 14 18 11Z" />
    <BriefcaseBusiness size={22} strokeWidth={1.8} x={11} y={6} />
    <path fill="var(--crm-surface)" d="M12 23C8 24 5 22 6 20C3 21 1 18 4 17C1 17 0 13 3 14C0 12 1 7 3 9C6 12 12 12 14 17C15 20 14 22 12 23Z" />
  </svg>;
}

export function OpportunityBoard({ revision = 0, enabled = true, onInitialLoadComplete }: {
  revision?: number; enabled?: boolean; onInitialLoadComplete?: () => void;
}) {
  const calendarSyncedAt = useSyncExternalStore(subscribeGlobalActivitySync, getGlobalActivitySyncSnapshot,
    getGlobalActivitySyncServerSnapshot).lastSuccess?.calendar;
  const previousCalendarSuccess = useRef(calendarSyncedAt);
  const dataRevision = useSyncExternalStore(subscribeNetworkingDataRevision, getNetworkingDataRevision, getServerNetworkingDataRevision);
  const previousDataRevision = useRef(dataRevision);
  const [cached] = useState(() => peekSharedView<Opportunity[]>("opportunity-board"));
  const [rows, setRows] = useState<Opportunity[]>(cached ?? []);
  const [filter, setFilter] = useState<"active" | "finalized" | "all">("active");
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [hasData, setHasData] = useState(Boolean(cached));
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const cardMoves = useBoardMoves("opportunity:");
  const pending = Object.fromEntries([...cardMoves.pending].map(id => [id, cardMoves.optimistic[id]]));
  const optimistic = cardMoves.optimistic;
  const [draggingId, setDraggingId] = useState("");
  const [dropTarget, setDropTarget] = useState<BoardDropTarget | null>(null);
  const [success, setSuccess] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<OpportunityEditorRequest | null>(null);
  const [cardAction, setCardAction] = useState<OpportunityCardAction | null>(null);
  const closeCardAction = useCallback(() => setCardAction(null), []);
  const loadVersion = useRef(0);
  const moving = useRef(false);
  const generation = useRef(0);
  const pendingCount = Object.keys(pending).length;
  const busy = loading || Boolean(error) || !enabled;
  const editorBlocked = busy || refreshing || savingIds.size > 0 || pendingCount > 0;
  const feedback = error || saveError || (cardMoves.failed ? "No pudimos confirmar todos los movimientos. Reintenta la lectura antes de volver a mover." : "");
  const visibleRows = rows.filter((row) => row.situation !== "voided" && (filter === "all" || row.situation === filter)).map((row) => optimistic[row.id]
    ? { ...row, stage: optimistic[row.id] as OpportunityStage, result: null, result_note: null } : row);
  const cardsByStatus = new Map(OPPORTUNITY_STAGES.map(([stage]) => [stage, visibleRows.filter((row) => row.stage === stage)]));

  useEffect(() => {
    generation.current += 1;
    setEditor(null); setCardAction(null); setSuccess(0); setSaveError("");
    void load();
    return () => { generation.current += 1; loadVersion.current += 1; };
  }, [revision]);
  useEffect(() => {
    if ((previousCalendarSuccess.current === calendarSyncedAt && previousDataRevision.current === dataRevision) || loading || refreshing || pendingCount || savingIds.size || editor || cardAction) return;
    previousCalendarSuccess.current = calendarSyncedAt;
    previousDataRevision.current = dataRevision;
    void load();
  }, [calendarSyncedAt, dataRevision, loading, refreshing, pendingCount, savingIds.size, editor, cardAction]);
  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      setEditor(null); setCardAction(null); setSuccess(0);
    }
  }, [enabled]);
  useEffect(() => { if (!loading) onInitialLoadComplete?.(); }, [loading, onInitialLoadComplete]);
  useEffect(() => { boardMoves.acknowledgeRead("opportunity:", new Map(rows.map(row => [row.id, row.stage]))); }, [rows]);
  async function load() {
    const version = ++loadVersion.current;
    setRefreshing(true);
    try {
      const next = await readOpportunityBoard();
      if (version !== loadVersion.current) return false;
      setRows(next); setHasData(true); setError("");
      return true;
    } catch {
      if (version === loadVersion.current) setError("No pudimos leer las oportunidades. Intenta nuevamente.");
      return false;
    } finally { if (version === loadVersion.current) { setLoading(false); setRefreshing(false); } }
  }
  async function retryRead() {
    await Promise.all(cardMoves.moves.filter(move => move.phase === "error").map(move => boardMoves.reconcile(move.key)));
    if (await load()) setSaveError("");
  }
  function endDrag() { setDraggingId(""); setDropTarget(null); }
  function move(row: Opportunity, stage: OpportunityStage) {
    endDrag();
    if (busy || editor || row.situation !== "active") return;
    const intent = opportunityMoveIntent(row.stage, stage);
    if (intent === "unchanged") return;
    setSuccess(0); setSaveError("");
    try { void moveOpportunityCard(row.id, stage).catch(() => setSaveError("No pudimos iniciar el movimiento. Actualiza antes de reintentar.")); }
    catch { setSaveError("No pudimos iniciar el movimiento. Actualiza antes de reintentar."); }
  }

  async function reopen(row: Opportunity) {
    if (editorBlocked || moving.current || row.situation !== "finalized") return;
    const epoch = generation.current;
    moving.current = true; setSavingIds(new Set([row.id])); setSuccess(0);
    try {
      await saveOpportunity({ id: row.id, expectedUpdatedAt: row.updated_at, title: row.title,
        company: row.company ?? "", applicationUrl: row.application_url ?? "", stage: row.stage,
        situation: "active", result: null, resultNote: "", contactIds: row.contact_ids,
        objectiveIds: row.objective_ids, interactionIds: row.interaction_ids });
      if (epoch === generation.current && await load()) { setSaveError(""); setSuccess((value) => value + 1); }
    } catch { if (epoch === generation.current) setSaveError("No pudimos confirmar la reapertura. Actualiza antes de reintentar."); }
    finally { moving.current = false; setSavingIds(new Set()); }
  }

  async function finalize(row: Opportunity, result: OpportunityResult, note: string) {
    if (editorBlocked || moving.current || row.situation !== "active"
      || !opportunityClosureValid(row.stage, "finalized", result)) return false;
    const epoch = generation.current;
    moving.current = true; setSavingIds(new Set([row.id])); setSuccess(0);
    try {
      await saveOpportunity({ id: row.id, expectedUpdatedAt: row.updated_at, title: row.title,
        company: row.company ?? "", applicationUrl: row.application_url ?? "", stage: row.stage,
        situation: "finalized", result, resultNote: note, contactIds: row.contact_ids,
        objectiveIds: row.objective_ids, interactionIds: row.interaction_ids });
      if (epoch !== generation.current) return false;
      if (await load()) { setSaveError(""); setSuccess((value) => value + 1); return true; }
      setSaveError("No pudimos confirmar el cierre. Actualiza el tablero antes de continuar.");
      return false;
    } catch { if (epoch === generation.current) setSaveError("No pudimos confirmar el cierre. Actualiza el tablero antes de continuar."); return false; }
    finally { moving.current = false; setSavingIds(new Set()); }
  }

  return <section className="panel opportunities-section" aria-labelledby="opportunities-title">
    <div className="panel-header"><h2 className="panel-title" id="opportunities-title"><WingedBriefcase /> Oportunidades
      <OperationStatus label="Oportunidades" resolved={hasData} busy={loading || refreshing || previousDataRevision.current !== dataRevision || pendingCount > 0 || savingIds.size > 0}
        confirming={pendingCount > 0 || savingIds.size > 0}
        error={feedback || (!enabled ? "Verifica la búsqueda activa antes de continuar." : "")} onRetry={() => void retryRead()} />
    </h2></div>
    <div className="opportunity-situation-filter" role="group" aria-label="Situación de oportunidades">
      {([["active", "Activas"], ["finalized", "Finalizadas"], ["all", "Todas"]] as const).map(([value, label]) =>
        <Button key={value} aria-pressed={filter === value} tone={filter === value ? "primary" : "ghost"}
          onClick={() => setFilter(value)}>{label}</Button>)}
    </div>
    {!hasData&&(loading||refreshing)?<ViewSkeleton kind="board" columns={4} label="Oportunidades"/>:null}
    {hasData ? <StatusBoard label="Oportunidades por etapa" className="opportunity-board" statuses={OPPORTUNITY_STAGES.map(([stage]) => stage)}
      cardsByStatus={cardsByStatus} draggingId={draggingId} dropTarget={dropTarget}
      onDragEnd={endDrag} onDragStart={(id) => { setDraggingId(id); setDropTarget(null); }} onDropTargetChange={setDropTarget}
      onDropCard={(id, stage) => { const row = visibleRows.find((item) => item.id === id); if (row) move(row, stage as OpportunityStage); }}
      columnClass={(stage) => `opportunity-column ${stage}`} emptyText="Suelta una tarjeta acá"
      renderHeader={(stage, count) => {
        const label = OPPORTUNITY_STAGES.find(([value]) => value === stage)?.[1];
        return <><h3 className="opportunity-column-title">{label}</h3><strong>{count}</strong>
            <Button icon="plus" square disabled={editorBlocked}
              aria-label={`Crear en ${label}`} onClick={() => setEditor({ stage: stage as OpportunityStage })} />
        </>;
      }}
      renderCard={(row, events) => <StatusBoardCard id={row.id} className="opportunity-card" {...events}
        dragging={draggingId === row.id} pending={Boolean(pending[row.id])} saving={savingIds.has(row.id) || cardMoves.pending.has(row.id)} disabled={busy || Boolean(editor) || row.situation !== "active"}>
              <button className="opportunity-card-main" disabled={busy} aria-disabled={editorBlocked}
                onClick={() => { if (!editorBlocked) setEditor({ opportunity: row }); }} type="button"
                aria-label={`Editar ${row.title}`}><strong>{row.title}</strong>{row.company ? <span>{row.company}</span> : null}</button>
              {row.situation === "finalized" ? <small className="opportunity-result">{opportunityResultLabel(row.result)}</small> : null}
              <div className="opportunity-card-footer">
                <div className="opportunity-counts" aria-label="Relaciones">
                  <span title="Contactos" aria-label={`${row.contact_ids.length} contactos`}><Users size={12} aria-hidden="true" />{row.contact_ids.length}</span>
                  <span title="Interacciones" aria-label={`${row.visible_interaction_count ?? row.interaction_ids.length} interacciones`}><MessageSquare size={12} aria-hidden="true" />{row.visible_interaction_count ?? row.interaction_ids.length}</span>
                  <span title="Prioridades" aria-label={`${row.objective_ids.length} prioridades`}><Icon name="tag" />{row.objective_ids.length}</span>
                </div>
                <div className="opportunity-card-actions">
                  {row.situation === "active" ? <Button icon="more" square disabled={busy || Boolean(editor)}
                    aria-haspopup="dialog" aria-expanded={cardAction?.kind === "stage" && cardAction.row.id === row.id}
                    aria-label={`Mover ${row.title} a otra etapa`}
                    onClick={(event) => setCardAction({ kind: "stage", row, anchor: event.currentTarget })} /> : null}
                  <button type="button" className="objective-chip opportunity-card-action" disabled={editorBlocked}
                    aria-haspopup={row.situation === "active" ? "dialog" : undefined}
                    aria-expanded={row.situation === "active" && cardAction?.kind === "finalize" && cardAction.row.id === row.id}
                    aria-label={`${row.situation === "finalized" ? "Restaurar" : "Finalizar"} ${row.title}`}
                    onClick={(event) => row.situation === "finalized" ? void reopen(row)
                      : setCardAction({ kind: "finalize", row, anchor: event.currentTarget })}>
                    {row.situation === "finalized" ? "Restaurar" : "Finalizar"}
                  </button>
                </div>
              </div>
      </StatusBoardCard>}
    /> : null}
    <OpportunityEditor request={editor} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); setSuccess(0); void load();
    }} />
    {cardAction ? <OpportunityCardPopover key={`${cardAction.kind}:${cardAction.row.id}`} action={cardAction}
      onClose={closeCardAction} onMove={move} onFinalize={finalize} /> : null}
  </section>;
}
