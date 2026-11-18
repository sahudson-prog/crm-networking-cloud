"use client";
import { useSyncExternalStore } from "react";
import { boardMoves } from "./boardMoves";

export function useBoardMoves(prefix: "contact:" | "opportunity:") {
  const snapshot = useSyncExternalStore(boardMoves.subscribe, boardMoves.getSnapshot, boardMoves.getServerSnapshot);
  const moves = snapshot.filter(move => move.key.startsWith(prefix));
  const optimistic: Record<string, string> = {};
  const pending = new Set<string>();
  for (const move of moves) {
    const id = move.key.slice(prefix.length);
    if (move.phase === "saving") pending.add(id);
    if (move.phase === "saving" && !move.reconciling) optimistic[id] = move.target;
    else if (move.actual !== undefined) optimistic[id] = move.actual;
  }
  return { moves, optimistic, pending, failed: moves.some(move => move.phase === "error") };
}
