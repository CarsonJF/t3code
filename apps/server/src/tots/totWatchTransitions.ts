/** What a Tot's watcher knows about one thread between looks. */
export interface WatchedThreadState {
  /** `stopped`: interrupted, cancelled or rolled back; it ends watches without a report. */
  readonly status: "idle" | "running" | "waiting" | "completed" | "failed" | "stopped";
  readonly pending: "question" | "approval" | null;
  /** The latest run, so a new run's outcome counts even when the status repeats. */
  readonly runId: string | null;
  /** The pending request, so a second question in the same run counts too. */
  readonly requestId: string | null;
  /** Settled, archived, deleted, or gone from a live list. */
  readonly ended: boolean;
}

export type TotWatchEvent = "completed" | "failed" | "question" | "approval" | "ended";

const EMPTY: WatchedThreadState = {
  status: "idle",
  pending: null,
  runId: null,
  requestId: null,
  ended: false,
};

/** Whether the run a state shows has finished, whatever its outcome. */
export const runIsOver = (state: WatchedThreadState) =>
  state.status === "completed" || state.status === "failed" || state.status === "stopped";

/**
 * What a watched thread's change means for its Tot, using the same moments as
 * desktop notifications. A first sighting compares with an empty state; the
 * watcher decides when a first look is only a baseline instead.
 */
export function watchTransition(
  previous: WatchedThreadState | undefined,
  next: WatchedThreadState,
): TotWatchEvent | null {
  const prior = previous ?? EMPTY;
  if (next.ended) return prior.ended ? null : "ended";
  const sameRun = prior.runId === next.runId;
  if (
    next.pending !== null &&
    (next.pending !== prior.pending || !sameRun || next.requestId !== prior.requestId)
  ) {
    return next.pending;
  }
  if (next.status === "failed" && (prior.status !== "failed" || !sameRun)) return "failed";
  if (next.status === "completed" && (prior.status !== "completed" || !sameRun)) {
    return "completed";
  }
  return null;
}

const LABELS: Record<TotWatchEvent, string> = {
  completed: "Completed",
  failed: "Failed",
  question: "Asks a question",
  approval: "Needs approval",
  ended: "Settled or archived",
};

export const formatWatchLine = (event: TotWatchEvent, link: string, environmentLabel: string) =>
  `- ${LABELS[event]}: ${link} on ${environmentLabel}`;
