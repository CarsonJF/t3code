import { IsoDateTime, ThreadGroupsState } from "@t3tools/contracts";
import { threadGroupRestoreOp } from "@t3tools/shared/threadGroups";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const THREAD_GROUP_HISTORY_LIMIT = 20;

const ThreadGroupHistoryEntry = Schema.Struct({
  savedAt: IsoDateTime,
  threadGroups: ThreadGroupsState,
});
export type ThreadGroupHistoryEntry = typeof ThreadGroupHistoryEntry.Type;

/**
 * The thread groups before each change, oldest first. States from before a group was removed
 * are also kept apart, so a burst of later thread moves cannot rotate the last copy out.
 */
export const ThreadGroupHistory = Schema.Struct({
  recent: Schema.Array(ThreadGroupHistoryEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  beforeRemoval: Schema.Array(ThreadGroupHistoryEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type ThreadGroupHistory = typeof ThreadGroupHistory.Type;

export const EMPTY_THREAD_GROUP_HISTORY: ThreadGroupHistory = { recent: [], beforeRemoval: [] };

export const removedThreadGroups = (previous: ThreadGroupsState, next: ThreadGroupsState) =>
  previous.groups.filter((group) => !next.groups.some((kept) => kept.id === group.id));

export function appendThreadGroupHistory(
  history: ThreadGroupHistory,
  previous: ThreadGroupsState,
  next: ThreadGroupsState,
  savedAt: string,
): ThreadGroupHistory {
  if (JSON.stringify(previous) === JSON.stringify(next)) return history;
  const entry = { savedAt, threadGroups: previous };
  return {
    recent: [...history.recent, entry].slice(-THREAD_GROUP_HISTORY_LIMIT),
    beforeRemoval:
      removedThreadGroups(previous, next).length > 0
        ? [...history.beforeRemoval, entry].slice(-THREAD_GROUP_HISTORY_LIMIT)
        : history.beforeRemoval,
  };
}

// Both lists are oldest first; reversing before the stable sort keeps later saves first on ties.
const newestFirst = (history: ThreadGroupHistory) =>
  [...history.beforeRemoval, ...history.recent]
    .toReversed()
    .toSorted((left, right) => right.savedAt.localeCompare(left.savedAt));

/** The op restoring `groupId` as the newest saved state that still held it had it. */
export function restoreOpFromHistory(history: ThreadGroupHistory, groupId: string) {
  for (const entry of newestFirst(history)) {
    const op = threadGroupRestoreOp(entry.threadGroups, groupId);
    if (op !== null) return op;
  }
  return null;
}

/** Saved groups missing from `current`, newest copy of each, for agents choosing what to restore. */
export function deletedThreadGroups(history: ThreadGroupHistory, current: ThreadGroupsState) {
  const seen = new Set(current.groups.map((group) => group.id));
  const deleted: Array<{ readonly id: string; readonly name: string }> = [];
  for (const entry of newestFirst(history)) {
    for (const group of entry.threadGroups.groups) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      deleted.push({ id: group.id, name: group.name });
    }
  }
  return deleted;
}
