import type { ContactMergeResult, ContactMergeSource } from "./contactMerge.ts";
import type { ContactDeepMergeInput } from "./contactMergeActions.ts";

export type ContactDuplicateMergeLock = {
  current: Promise<void> | null;
};

type ContactDuplicateMergeDependencies = {
  merge: (input: ContactDeepMergeInput) => Promise<unknown>;
  refresh: () => Promise<void>;
};

export function startContactDuplicateMerge(
  result: ContactMergeResult,
  mergeSources: ContactMergeSource[],
  dependencies: ContactDuplicateMergeDependencies,
  lock: ContactDuplicateMergeLock
) {
  if (lock.current) return { operation: lock.current, started: false };

  const [target, ...sources] = mergeSources;
  if (!target || !sources.length) {
    throw new Error("Elige 2 o 3 contactos para fusionar.");
  }

  const operation = (async () => {
    await dependencies.merge({
      result,
      source: "duplicate_review",
      sourceContactIds: sources.map((source) => source.id),
      targetContactId: target.id
    });
    await dependencies.refresh();
  })();
  const trackedOperation = operation.finally(() => {
    if (lock.current === trackedOperation) lock.current = null;
  });
  lock.current = trackedOperation;
  return { operation: trackedOperation, started: true };
}
