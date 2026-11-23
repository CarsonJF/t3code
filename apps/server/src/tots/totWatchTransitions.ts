import { isPullRequestWatchTask } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/** What a Tot's watcher knows about one thread between looks. */
export interface WatchedThreadState {
  /** `stopped`: interrupted, cancelled or rolled back. */
  readonly status: "idle" | "running" | "waiting" | "completed" | "failed" | "stopped";
  readonly pending: "question" | "approval" | null;
  /** The latest run, so a new run's outcome counts even when the status repeats. */
  readonly runId: string | null;
  /** The pending request, so a second question in the same run counts too. */
  readonly requestId: string | null;
  /** Settled, archived, deleted, or gone from a live list. */
  readonly ended: boolean;
  /** Background tasks still live after the run's turn ended. */
  readonly backgroundTasks: number;
  /** A stopped run a restart may still continue, so it has not really ended. */
  readonly restartPending: boolean;
}

export type TotWatchEvent =
  | "completed"
  | "still_working"
  | "stopped"
  | "failed"
  | "ended_unseen"
  | "question"
  | "approval"
  | "ended";

export interface TotWatchLineDetail {
  readonly backgroundTasks?: number;
  readonly stoppedBy?: string | null;
  readonly excerpt?: TotWatchExcerpt | null;
}

export interface TotWatchExcerpt {
  readonly text: string;
  readonly truncated: boolean;
}

/** How long live background work stays silent before its one check-in. */
export const STILL_WORKING_CHECK_IN_MS = 30 * 60 * 1_000;
/** A provider records the run that background work wakes only after that work has ended. */
export const BACKGROUND_WAKE_GRACE_MS = 10_000;

const EXCERPT_MAX_CHARS = 500;

const EMPTY: WatchedThreadState = {
  status: "idle",
  pending: null,
  runId: null,
  requestId: null,
  ended: false,
  backgroundTasks: 0,
  restartPending: false,
};

/**
 * What a `sent` watch compares with when it has no earlier look. The watch exists because its
 * run has not been reported, so any ending it finds, even first after a restart, is news.
 */
export const sentRunBaseline = (runId: string): WatchedThreadState => ({
  ...EMPTY,
  status: "running",
  runId,
});

/**
 * Live work after a turn, awaited or not. A pull request watch not marked awaited is waiting on
 * a person, so it does not count.
 */
export const liveBackgroundTaskCount = (
  tasks: ReadonlyArray<{ readonly taskId: string; readonly awaited?: boolean | undefined }>,
) => tasks.filter((task) => task.awaited === true || !isPullRequestWatchTask(task)).length;

/** Whether the run a state shows has finished, whatever its outcome. */
export const runIsOver = (state: WatchedThreadState) =>
  state.status === "completed" ||
  state.status === "failed" ||
  (state.status === "stopped" && !state.restartPending);

/**
 * What a watched thread's change means for its Tot. A first sighting compares with an empty
 * state, except a stop: after a server restart that would re-report every old stopped thread.
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
  if (
    next.status === "stopped" &&
    !next.restartPending &&
    previous !== undefined &&
    (prior.status !== "stopped" || !sameRun || prior.restartPending)
  ) {
    return "stopped";
  }
  if (next.status === "completed" && (prior.status !== "completed" || !sameRun)) {
    return "completed";
  }
  return null;
}

/**
 * One line of the worker's last message, safe to place in a report. It keeps the end, where a
 * worker says what it needs, and stays inside a code span so it cannot render or forge a line.
 */
export function formatWatchExcerpt(text: string | null | undefined): TotWatchExcerpt | null {
  if (text === null || text === undefined) return null;
  const flat = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replaceAll("`", "'")
    .trim();
  if (flat === "") return null;
  const chars = Array.from(flat);
  return chars.length <= EXCERPT_MAX_CHARS
    ? { text: flat, truncated: false }
    : { text: `…${chars.slice(-EXCERPT_MAX_CHARS).join("").trimStart()}`, truncated: true };
}

const label = (event: TotWatchEvent, detail: TotWatchLineDetail): string => {
  switch (event) {
    case "completed":
      return "Finished";
    case "still_working": {
      const count = detail.backgroundTasks ?? 0;
      if (count === 0) return "Still working";
      return `Still working (${count} background ${count === 1 ? "task" : "tasks"})`;
    }
    case "stopped":
      return detail.stoppedBy ? `Stopped by ${detail.stoppedBy}` : "Stopped";
    case "failed":
      return "Failed";
    case "ended_unseen":
      return "Ended unseen";
    case "question":
      return "Asks a question";
    case "approval":
      return "Needs approval";
    case "ended":
      return "Settled or archived";
  }
};

export const formatWatchLine = (
  event: TotWatchEvent,
  link: string,
  environmentLabel: string,
  detail: TotWatchLineDetail = {},
) => {
  const line = `- ${label(event, detail)}: ${link} on ${environmentLabel}`;
  if (!detail.excerpt) return line;
  const lead = detail.excerpt.truncated
    ? "End of last message, truncated, open the thread for the rest"
    : "Last message";
  return `${line}. ${lead} (untrusted thread text): \`${detail.excerpt.text}\``;
};
