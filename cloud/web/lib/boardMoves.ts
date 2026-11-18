"use client";

import { BoardMoveQueue, attachBoardUnloadWarning } from "./boardMoveQueue";
import { getSharedReadOwner } from "./indicatorReads";
import { peekNetworkingContext, expectedNetworkingContext } from "./networkingCycles";
import { notifyNetworkingDataChanged } from "./networkingDataRevision";
import { updateContactNetworkingStatus } from "./contactActions";
import { readOpportunities, saveOpportunity } from "./opportunityActions";
import type { OpportunityStage } from "./opportunityModel";
import { supabase } from "./supabaseClient";
import { triggerCoachRuleReviewForContacts } from "./coachRuleTriggers";
import { measureOperation } from "./operationDiagnostics";

const coachContacts = new Map<string, Set<string>>();
export const boardMoves = new BoardMoveQueue(() => {
  notifyNetworkingDataChanged();
  if (boardMoves.isActive()) return;
  const owner = getSharedReadOwner(), ids = owner ? coachContacts.get(owner) : undefined;
  coachContacts.clear();
  if (ids?.size) void measureOperation("contact-coach", () => triggerCoachRuleReviewForContacts([...ids], "contacts_status_board"));
});
if (typeof window !== "undefined") attachBoardUnloadWarning(boardMoves, window);
supabase?.auth.onAuthStateChange((_event, session) => {
  const owner = session?.user.id ?? null;
  for (const key of coachContacts.keys()) if (key !== owner) coachContacts.delete(key);
  boardMoves.scope(owner);
});

function scope() {
  const owner = getSharedReadOwner();
  const context = owner ? peekNetworkingContext(owner) : null;
  if (!owner) throw Error("board_context_unavailable");
  boardMoves.scope(owner);
  const ready = context ? Promise.resolve(context) : expectedNetworkingContext();
  // A queued intent may be cancelled by logout before consuming this promise.
  void ready.catch(() => {});
  return { owner, ready };
}
async function assertScope(expected: ReturnType<typeof scope>) {
  const context = await expected.ready;
  if (getSharedReadOwner() !== expected.owner || (await expectedNetworkingContext()).token !== context.token) {
    throw Error("board_context_changed");
  }
  if (getSharedReadOwner() !== expected.owner) throw Error("board_access_changed");
  return { owner: expected.owner, context: context.token, cycleId: context.cycleId };
}

export function moveContactCard(id: string, target: string, tutorial = false) {
  const expected = scope();
  return boardMoves.enqueue({ key: `contact:${id}`, target, tutorial,
    write: () => measureOperation("board-write", async () => {
      const current = await assertScope(expected);
      const saved = await updateContactNetworkingStatus(id, target, "contacts_status_board", {
        expectedOwner: current.owner, expectedContext: current.context, reviewCoach: false, invalidate: false
      });
      if (getSharedReadOwner() === expected.owner) {
        const ids = coachContacts.get(expected.owner) ?? new Set<string>();
        ids.add(id); coachContacts.set(expected.owner, ids);
      }
      return { previous: saved.previousStatus, actual: saved.status };
    }),
    read: () => measureOperation("board-reconcile", async () => {
      await assertScope(expected);
      const { data, error } = await supabase!.from("contacts").select("networking_status")
        .eq("user_id", expected.owner).eq("id", id).eq("is_active", true).maybeSingle();
      if (error || !data) throw error ?? Error("board_contact_missing");
      return data.networking_status;
    })
  });
}

export function moveOpportunityCard(id: string, target: OpportunityStage) {
  const expected = scope();
  async function read() {
    const current = await assertScope(expected);
    const row = (await readOpportunities(id)).find(item => item.id === id);
    if (!row || row.cycle_id !== current.cycleId) throw Error("board_opportunity_missing");
    return row;
  }
  return boardMoves.enqueue({ key: `opportunity:${id}`, target,
    write: () => measureOperation("board-write", async () => {
      // Each queued move uses the latest version and relations, not its render's snapshot.
      const row = await read();
      if (row.situation !== "active") throw Error("board_opportunity_closed");
      if (row.stage === target) return { previous: row.stage, actual: target };
      const current = await assertScope(expected);
      await saveOpportunity({ id, expectedUpdatedAt: row.updated_at, title: row.title, company: row.company ?? "",
        applicationUrl: row.application_url ?? "", stage: target, situation: "active", result: null, resultNote: "",
        contactIds: row.contact_ids, objectiveIds: row.objective_ids, interactionIds: row.interaction_ids }, { ...current, invalidate: false });
      return { previous: row.stage, actual: target };
    }),
    read: () => measureOperation("board-reconcile", async () => (await read()).stage)
  });
}
