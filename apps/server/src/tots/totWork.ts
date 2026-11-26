import type { TotObjectiveAttemptStatus, TotObjectiveStatus } from "@t3tools/contracts";

import type { WatchedThreadState } from "./totWatchTransitions.ts";

export const attemptIsOver = (status: TotObjectiveAttemptStatus) =>
  status === "done" || status === "failed" || status === "stopped";

/** What a look at a thread means for an attempt there, or null when it says nothing yet. */
export function attemptStatusOf(state: WatchedThreadState): TotObjectiveAttemptStatus | null {
  if (state.ended) return "stopped";
  if (state.pending !== null) return "needs_you";
  switch (state.status) {
    case "running":
      return state.waitingOn === undefined ? "working" : "waiting";
    case "waiting":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "stopped":
      return state.restartPending ? "working" : "stopped";
    case "idle":
      return null;
  }
}

/**
 * Whether a look speaks for this attempt: its own run, or any later run once its own was seen,
 * which is how a restart continuation or a background wake carries the work on. Before that, a
 * different run is an earlier one still finishing.
 */
export const lookIsForAttempt = (
  attempt: { readonly runId: string | null; readonly lastRunId: string | null },
  state: WatchedThreadState,
) =>
  state.ended ||
  attempt.runId === null ||
  state.runId === attempt.runId ||
  (attempt.lastRunId !== null && state.runId !== null);

interface ObjectiveFacts {
  readonly closedAs: "done" | "cancelled" | null;
  readonly resetAt: string | null;
  /** Oldest first. */
  readonly attempts: ReadonlyArray<{
    readonly status: TotObjectiveAttemptStatus;
    readonly startedAt: string;
  }>;
}

/** Failed or stopped attempts since the last reset; what the retry cap counts. */
export const failedAttemptsOf = (objective: ObjectiveFacts) =>
  objective.attempts.filter(
    (attempt) =>
      (attempt.status === "failed" || attempt.status === "stopped") &&
      (objective.resetAt === null || attempt.startedAt > objective.resetAt),
  ).length;

/** Past the cap, nothing more starts for it until a person resets it. 0 turns the cap off. */
const objectiveIsCapped = (objective: ObjectiveFacts, cap: number) =>
  cap > 0 && failedAttemptsOf(objective) >= cap;

export function objectiveStatusOf(objective: ObjectiveFacts, cap: number): TotObjectiveStatus {
  if (objective.closedAs !== null) return objective.closedAs;
  const open = objective.attempts.filter((attempt) => !attemptIsOver(attempt.status));
  if (open.some((attempt) => attempt.status === "needs_you")) return "needs_you";
  if (open.some((attempt) => attempt.status === "working")) return "working";
  if (open.length > 0) return "waiting";
  if (objectiveIsCapped(objective, cap)) return "needs_you";
  const latest = objective.attempts.at(-1);
  if (latest === undefined) return "planned";
  return latest.status === "done" ? "done" : "failed";
}

const ORDER: Record<TotObjectiveStatus, number> = {
  needs_you: 0,
  working: 1,
  waiting: 2,
  planned: 3,
  failed: 4,
  done: 5,
  cancelled: 6,
};

/** Open work first, then by most recent change. */
export const workListOrder = <
  T extends { readonly status: TotObjectiveStatus; readonly updatedAt: string },
>(
  objectives: ReadonlyArray<T>,
) =>
  objectives.toSorted(
    (a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt),
  );
