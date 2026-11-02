"use client";

import { useEffect, useRef } from "react";

// Contactos' existing quiet period; changing a card again restarts the delay.
export function useDeferredBoardSave(
  pending: Record<string, string>, savingCount: number,
  flush: (entries: Array<[string, string]>) => Promise<void>
) {
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => {
    const entries = Object.entries(pending);
    if (!entries.length || savingCount) return;
    const timeoutId = window.setTimeout(() => { void flushRef.current(entries); }, 1600);
    return () => window.clearTimeout(timeoutId);
  }, [pending, savingCount]);
}

export function omitKeys<T>(record: Record<string, T>, keys: string[]) {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

export function applyStatusToIds(record: Record<string, string>, ids: string[], status: string) {
  return ids.reduce((next, id) => ({ ...next, [id]: status }), record);
}

export function removeUnchangedPending(current: Record<string, string>, entries: Array<[string, string]>) {
  return entries.reduce((next, [id, status]) => next[id] === status ? omitKeys(next, [id]) : next, current);
}

export function removeSettledOptimistic(current: Record<string, string>, ids: string[], entries: Array<[string, string]>) {
  const settled = new Map(entries);
  return ids.reduce((next, id) => settled.get(id) && next[id] === settled.get(id) ? omitKeys(next, [id]) : next, current);
}
