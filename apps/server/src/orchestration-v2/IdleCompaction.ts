import {
  isListedThreadLineage,
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { COMPACTION_SUGGESTION_MIN_TOKENS } from "@t3tools/shared/claudeCompaction";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";

// Claude Code's idleCompaction defaults to 200K and won't go below 100K. Below
// that a cold re-read is cheap, so compacting mostly loses context for little
// saving.
const MIN_CONTEXT_TOKENS = COMPACTION_SUGGESTION_MIN_TOKENS;
// Start this long before the cache expires: enough for the session to resume
// and send the compaction while the cache is still warm.
const LEAD_MS = 2 * 60_000;

/**
 * Prompt-cache lifetimes for providers that do not report one per request.
 * Claude reports its own TTL (1h on subscriptions, 5m on API keys), so it is
 * absent here. OpenCode's measured hit rate holds for roughly 15-30 minutes,
 * falls to about half by 30-60 minutes, and almost always misses past 2 hours.
 */
export const PROVIDER_PROMPT_CACHE_TTL_MS: ReadonlyMap<ProviderDriverKind, number> = new Map([
  [ProviderDriverKind.make("opencode"), 30 * 60_000],
]);

const IDLE_COMPACTION_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "opencode"]);

/** Drivers whose sessions can receive T3 Code's `/compact` and keep their prompt cache. */
export const isIdleCompactionDriver = (driver: string | undefined): boolean =>
  driver !== undefined && IDLE_COMPACTION_DRIVERS.has(driver);

export type IdleCompactionRecords = Pick<
  OrchestrationV2ThreadProjection,
  | "thread"
  | "runs"
  | "messages"
  | "providerThreads"
  | "providerTurns"
  | "runtimeRequests"
  | "turnItems"
  | "contextTransfers"
>;

/**
 * When an idle Claude or OpenCode thread should compact, or null when it should
 * not. The window ends when the last request's prompt cache expires, so
 * compacting after that pays a full uncached read.
 */
export function idleCompactionWindow(
  {
    thread,
    runs,
    messages,
    providerThreads,
    providerTurns,
    runtimeRequests,
    turnItems,
    contextTransfers,
  }: IdleCompactionRecords,
  nowMs: number,
): {
  readonly runId: (typeof runs)[number]["id"];
  readonly startMs: number;
  readonly endMs: number;
} | null {
  if (thread.deletedAt !== null || thread.archivedAt !== null) return null;
  if (thread.settledAt !== null || thread.settledOverride === "settled") return null;
  if (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
    return null;
  if (!isListedThreadLineage(thread.lineage)) return null;
  // A removed or steered queued message leaves a cancelled run that never started.
  const latestRun = runs
    .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
    .reduce<(typeof runs)[number] | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );
  if (latestRun?.status !== "completed" || latestRun.completedAt === null) return null;
  const message = messages.find((candidate) => candidate.id === latestRun.userMessageId);
  // Never compact a compaction, so one idle spell compacts at most once.
  if (message === undefined || message.text.trim().toLowerCase() === "/compact") return null;
  if (
    runtimeRequests.some((request) => request.status === "pending") ||
    // A pending merge-back belongs to the user's next message.
    contextTransfers.some(
      (transfer) =>
        transfer.type === "merge_back" &&
        transfer.targetThreadId === thread.id &&
        transfer.status === "pending",
    ) ||
    // Background work reports into the next turn; compaction would swallow it. A delegated
    // child's result arrives later as its own message, so it does not count.
    derivePendingBackgroundWork({
      latestRun,
      runs,
      providerThreads,
      turnItems: turnItems.filter(
        (item) => item.type !== "subagent" || item.origin !== "app_owned",
      ),
      activeProviderThreadId: thread.activeProviderThreadId,
    }).length > 0
  )
    return null;
  const providerThread = providerThreads.find(
    (candidate) => candidate.id === thread.activeProviderThreadId,
  );
  // The thread's current selection receives the /compact, so it must still be this session.
  if (
    !isIdleCompactionDriver(providerThread?.driver) ||
    providerThread === undefined ||
    providerThread.id !== latestRun.providerThreadId ||
    providerThread.providerInstanceId !== thread.providerInstanceId ||
    latestRun.providerInstanceId !== thread.providerInstanceId
  )
    return null;
  const usages = providerTurns
    .filter((turn) => turn.providerThreadId === providerThread.id && turn.tokenUsage !== undefined)
    .map((turn) => turn.tokenUsage!)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  if ((usages[0]?.usedTokens ?? 0) < MIN_CONTEXT_TOKENS) return null;
  // A request served fully from cache creates no cache entry and reports no
  // TTL, but it still refreshes the cache. Claude reports one; other providers
  // use the measured lifetime counted from the last recorded request.
  const expiresAt = usages[0]?.promptCacheExpiresAt;
  const measuredTtlMs = PROVIDER_PROMPT_CACHE_TTL_MS.get(providerThread.driver);
  const endMs =
    expiresAt === undefined
      ? measuredTtlMs === undefined
        ? Number.NaN
        : Date.parse(usages[0]!.updatedAt) + measuredTtlMs
      : Date.parse(expiresAt);
  if (!Number.isFinite(endMs) || nowMs >= endMs) return null;
  return { runId: latestRun.id, startMs: endMs - LEAD_MS, endMs };
}

/** The message ids IdleCompactionService gives its own turns: housekeeping, not work. */
export const IDLE_COMPACTION_MESSAGE_ID_PREFIX = "idle-compact:";
/** Its turn that asks a Tot to save its working state, the step before a Tot's `/compact`. */
export const IDLE_COMPACTION_SAVE_MESSAGE_ID_PREFIX = `${IDLE_COMPACTION_MESSAGE_ID_PREFIX}save:`;

export const TOT_PRE_COMPACTION_NOTE =
  "[T3 Code: this thread compacts in a moment, before its prompt cache expires. Save what you would need to carry on to your `MEMORY.md` now: work in flight, threads you are waiting on, what you promised the user and your next steps. Start no new work. Reply with one short line.]";

/**
 * What to do for a thread whose compaction window is open: wait for it, ask a Tot to save its
 * working state first, or compact. The save turn refreshes the cache, so its end compacts at once.
 */
export function idleCompactionStep(input: {
  readonly totThread: boolean;
  readonly latestUserMessageId: string;
  readonly window: { readonly startMs: number };
  readonly nowMs: number;
}): "wait" | "save" | "compact" {
  if (
    input.totThread &&
    input.latestUserMessageId.startsWith(IDLE_COMPACTION_SAVE_MESSAGE_ID_PREFIX)
  ) {
    return "compact";
  }
  if (input.nowMs < input.window.startMs) return "wait";
  return input.totThread ? "save" : "compact";
}
