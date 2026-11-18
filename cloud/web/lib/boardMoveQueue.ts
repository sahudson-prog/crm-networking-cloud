export type BoardMoveResult = { previous: string; actual: string };
export type BoardMoveCommand = {
  key: string;
  target: string;
  tutorial?: boolean;
  write: () => Promise<BoardMoveResult>;
  read: () => Promise<string>;
};
export type BoardMoveState = {
  key: string;
  target: string;
  actual?: string;
  phase: "saving" | "saved" | "error";
  unresolved: boolean;
  reconciling?: boolean;
  confirmation?: BoardMoveResult;
};
const EMPTY: readonly BoardMoveState[] = [];

/** Only card moves. Promises belong to the tab, never to a mounted board. */
export class BoardMoveQueue {
  private owner: string | null = null;
  private generation = 0;
  private active = 0;
  private states = new Map<string, BoardMoveState>();
  private tails = new Map<string, Promise<void>>();
  private readers = new Map<string, () => Promise<string>>();
  private blocked = new Set<string>();
  private reconciling = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: readonly BoardMoveState[] = EMPTY;
  private readonly invalidate: () => void;
  constructor(invalidate: () => void) { this.invalidate = invalidate; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => EMPTY;
  isActive = () => this.active > 0;
  scope(owner: string | null) {
    if (owner === this.owner) return;
    this.owner = owner; this.generation++;
    this.states.clear(); this.tails.clear(); this.readers.clear(); this.blocked.clear(); this.reconciling.clear(); this.publish();
  }
  private publish() { this.snapshot = [...this.states.values()]; this.listeners.forEach(listener => listener()); }
  enqueue(command: BoardMoveCommand): Promise<void> {
    if (!this.owner) return Promise.reject(Error("board_access_changed"));
    const { key, target } = command;
    if (this.states.get(key)?.unresolved || this.reconciling.has(key) || (this.tails.has(key) && this.blocked.has(key))) return Promise.reject(Error("board_reconciliation_required"));
    const generation = this.generation;
    const previous = this.tails.get(key);
    if (!previous) this.blocked.delete(key);
    this.readers.set(key, command.read);
    this.states.set(key, { ...this.states.get(key), key, target, phase: "saving", unresolved: false });
    this.active++; this.publish();
    const execute = async () => {
      if (generation !== this.generation || this.blocked.has(key)) return;
      let confirmed: BoardMoveResult | undefined;
      let failed = false;
      try { confirmed = await command.write(); } catch { failed = true; }
      if (generation !== this.generation) return;
      // Confirmed writers supply persisted evidence; only uncertainty needs reconciliation.
      let actual = confirmed?.actual;
      if (failed || actual !== target) {
        try { actual = await command.read(); } catch { actual = undefined; failed = true; }
      }
      if (generation !== this.generation) return;
      if (actual !== target) failed = true;
      const current = this.states.get(key)!;
      const confirmation = command.tutorial && confirmed?.previous === "Pendiente" && confirmed.actual === "Contactado"
        ? confirmed : current.confirmation;
      if (failed) this.blocked.add(key);
      this.states.set(key, { ...current, actual, confirmation, unresolved: actual === undefined,
        phase: failed ? "error" : this.tails.get(key) !== tail ? "saving" : "saved" });
      this.publish();
    };
    // The first writer starts in this call, not in an effect or a debounce timer.
    const running = previous ? previous.then(execute) : execute();
    const tail = running.finally(() => {
      this.active--;
      if (this.tails.get(key) === tail) this.tails.delete(key);
      if (generation === this.generation && this.tails.has(key) && !this.blocked.has(key)) {
        const current = this.states.get(key);
        if (current) this.states.set(key, { ...current, phase: "saving" });
      }
      this.publish();
      if (generation === this.generation && !this.tails.has(key)) this.invalidate();
    });
    this.tails.set(key, tail);
    return tail;
  }
  async reconcile(key: string) {
    if (this.tails.has(key) || this.reconciling.has(key)) return;
    const read = this.readers.get(key), previous = this.states.get(key);
    if (!read || !previous) return;
    const generation = this.generation;
    this.reconciling.add(key);
    this.active++; this.states.set(key, { ...previous, phase: "saving", reconciling: true }); this.publish();
    try {
      const actual = await read();
      if (generation !== this.generation) return;
      // Explicit reconciliation confirms the current state, not the original write.
      this.blocked.delete(key);
      this.states.set(key, { ...previous, actual, target: actual, phase: "saved", unresolved: false, reconciling: false });
    } catch {
      if (generation === this.generation) this.states.set(key, { ...previous, phase: "error", unresolved: true });
    } finally {
      this.active--;
      if (generation === this.generation) this.reconciling.delete(key);
      this.publish();
      if (generation === this.generation) this.invalidate();
    }
  }
  acknowledgeRead(prefix: string, actuals: ReadonlyMap<string, string>) {
    let changed = false;
    for (const [key, state] of this.states) {
      if (!key.startsWith(prefix) || this.tails.has(key) || this.reconciling.has(key) || state.unresolved
        || state.actual === undefined || actuals.get(key.slice(prefix.length)) !== state.actual) continue;
      if (state.phase === "saved" && !state.confirmation) {
        this.states.delete(key); this.readers.delete(key); changed = true;
      } else if (state.actual !== undefined) { this.states.set(key, { ...state, actual: undefined }); changed = true; }
    }
    if (changed) this.publish();
  }
  acknowledgeConfirmation(key: string, confirmation: BoardMoveResult) {
    const state = this.states.get(key);
    if (state?.confirmation !== confirmation) return;
    if (state.phase === "saved" && state.actual === undefined) {
      this.states.delete(key); this.readers.delete(key);
    } else this.states.set(key, { ...state, confirmation: undefined });
    this.publish();
  }
}

export function attachBoardUnloadWarning(queue: BoardMoveQueue, target: Pick<Window, "addEventListener" | "removeEventListener">) {
  const warn = (event: BeforeUnloadEvent) => { if (queue.isActive()) { event.preventDefault(); event.returnValue = ""; } };
  let attached = false;
  const update = () => {
    const active = queue.isActive();
    if (active === attached) return;
    attached = active;
    if (active) target.addEventListener("beforeunload", warn);
    else target.removeEventListener("beforeunload", warn);
  };
  const unsubscribe = queue.subscribe(update); update();
  return () => { unsubscribe(); target.removeEventListener("beforeunload", warn); };
}
