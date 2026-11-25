import {
  DEFAULT_TOT_REPORT_BATCH_SECONDS,
  type EnvironmentId,
  isOrchestrationV2WorkActive,
  type OrchestratorMcpThreadWaitResult,
  type TotWatch,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  RunId,
  type ThreadId,
  type Tot,
  type TotId,
  totWatchReportsOf,
} from "@t3tools/contracts";
import {
  backgroundWorkHoldsCompletion,
  turnItemUpdateCanEndBackgroundWork,
} from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Fiber from "effect/Fiber";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { IDLE_COMPACTION_MESSAGE_ID_PREFIX } from "../orchestration-v2/IdleCompaction.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "./TotService.ts";
import { USER_STOP_REASON } from "../orchestration-v2/RunExecutionService.ts";
import {
  BACKGROUND_WAKE_GRACE_MS,
  EMPTY_STEERING_NOTE,
  formatSteeringNote,
  formatWatchExcerpt,
  formatWatchLine,
  isRoutineWatchEvent,
  liveBackgroundTaskCount,
  noteSteeringMessage,
  noteSteeringRun,
  runIsOver,
  sentRunBaseline,
  type SteeringNote,
  STILL_WORKING_CHECK_IN_MS,
  type TotWatchEvent,
  type TotWatchLineDetail,
  watchTransition,
  type WatchedThreadState,
} from "./totWatchTransitions.ts";
import { deliversWatchReport } from "./totWatchReports.ts";

/** How often queued reports are looked at; urgent ones wait no longer than this. */
const REPORT_BATCH_WINDOW = Duration.seconds(2);

const FOLLOW_WAIT_MS = 10 * 60 * 1_000;
const MAX_REMEMBERED_RUNS = 1_000;

/**
 * Between looks at a remote thread whose run ended or stopped to ask: the
 * wait there returns at once until a new run starts, so the follower rests.
 */
export const TotFollowPause = Context.Reference<Effect.Effect<void>>(
  "t3/tots/TotWatchService/TotFollowPause",
  { defaultValue: () => Effect.sleep(Duration.seconds(30)) },
);

interface Outgoing {
  readonly totId: TotId;
  /** The Tot thread when the change happened; a fresh start or turning off drops it. */
  readonly expectedThreadId: ThreadId;
  readonly line: string;
  /** The watched thread this line is about. */
  readonly source: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
  /** Set on a stop report, which the Tot that issued the stop does not need. */
  readonly stopped?: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
  /** Sent at the next look; routine news waits for the batch window or urgent news. */
  readonly urgent: boolean;
  readonly queuedAt: number;
}

/** A run whose turn ended with background work live: silent until it ends or the check-in. */
interface BackgroundHold {
  readonly runId: string;
  readonly dueAt: number;
  readonly checkedIn: boolean;
  /** Set once the work ended, while a wake run may still be about to start. */
  readonly graceUntil: number | null;
}

export class TotWatchService extends Context.Service<
  TotWatchService,
  {
    /** Watches this environment's threads for every Tot until the scope closes. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** Looks at one thread again and queues what its Tots should hear. */
    readonly observe: (threadId: ThreadId) => Effect.Effect<void>;
    /** Sends everything queued now, routine reports included. */
    readonly flush: Effect.Effect<void>;
    /** Sends what is due: every Tot with urgent news, or routine news older than the window. */
    readonly flushDue: Effect.Effect<void>;
    /** Starts a follower for each watched thread on a linked environment, and stops the rest. */
    readonly syncFollowers: Effect.Effect<void>;
    /** Once after recovery: looks at stored sent watches whose runs ended while the server was down. */
    readonly recoverSentWatches: Effect.Effect<void>;
  }
>()("t3/tots/TotWatchService") {}

const statusOf = (
  status: OrchestrationV2ThreadShell["status"] | OrchestratorMcpThreadWaitResult["status"],
): WatchedThreadState["status"] => {
  switch (status) {
    case "waiting":
    case "completed":
    case "failed":
    case "idle":
      return status;
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return "stopped";
    default:
      return "running";
  }
};

const ENDED_STATE: WatchedThreadState = {
  status: "idle",
  pending: null,
  runId: null,
  requestId: null,
  ended: true,
  backgroundTasks: 0,
  restartPending: false,
};

const watchedStateFromShell = (shell: OrchestrationV2ThreadShell | null): WatchedThreadState => {
  if (
    shell === null ||
    shell.deletedAt !== null ||
    shell.archivedAt !== null ||
    shell.settledOverride === "settled"
  ) {
    return ENDED_STATE;
  }
  const request = shell.pendingRuntimeRequest;
  const pending =
    request === null || request.userOnly === true
      ? null
      : request.kind === "user_input"
        ? "question"
        : request.kind === "dynamic_tool_call" || request.kind === "auth_refresh"
          ? null
          : "approval";
  const backgroundTasks =
    shell.status === "completed" ? liveBackgroundTaskCount(shell.pendingBackgroundTasks ?? []) : 0;
  return {
    status: backgroundTasks > 0 ? "waiting" : statusOf(shell.status),
    pending,
    runId: shell.latestRunId,
    requestId: pending === null || request === null ? null : request.id,
    ended: false,
    backgroundTasks,
    restartPending: false,
  };
};

/** A wait that timed out on a stopped run is still following its restart continuation. */
const watchedStateFromWait = (
  waited: OrchestratorMcpThreadWaitResult,
  backgroundTasks: number,
): WatchedThreadState => {
  const status = statusOf(waited.status);
  const holding = status === "completed" && backgroundTasks > 0;
  return {
    status: holding ? "waiting" : status,
    pending: waited.attention ?? null,
    runId: waited.runId,
    requestId: waited.attentionRequestId ?? null,
    ended: false,
    backgroundTasks: holding ? backgroundTasks : 0,
    restartPending: status === "stopped" && waited.timedOut,
  };
};

const stoppedByFrom = (message: string | undefined) =>
  message === undefined
    ? null
    : message === USER_STOP_REASON
      ? "the user"
      : message.startsWith("Stopped by an agent")
        ? "an agent"
        : null;

const carriesExcerpt = (event: TotWatchEvent) =>
  event === "completed" || event === "failed" || event === "stopped" || event === "still_working";

/** Keyed by the Tot's current thread too, so a fresh start restarts its followers. */
const followerKey = (
  totId: TotId,
  totThreadId: ThreadId,
  watch: Pick<TotWatch, "environmentId" | "threadId">,
) => [totId, totThreadId, watch.environmentId, watch.threadId].join(" ");

/** The events after which a watched thread can read differently, including awaited work ending. */
const touchesWatches = (event: OrchestrationV2DomainEvent): boolean => {
  switch (event.type) {
    case "run.updated":
    case "runtime-request.updated":
    case "run.background-work-cancelled":
      return true;
    // The same "work can have ended" moments ThreadSettlementService sweeps on.
    case "subagent.updated":
      return !isOrchestrationV2WorkActive(event.payload.status);
    case "provider-thread.updated":
      return !backgroundWorkHoldsCompletion(event.payload.pendingBackgroundTasks ?? []);
    case "turn-item.updated":
      return turnItemUpdateCanEndBackgroundWork(event.payload);
    default:
      return event.type.startsWith("thread.") && !event.type.startsWith("thread.pull-request");
  }
};

// IdleCompactionService's message ids: its compaction runs are housekeeping, not work to report.
const isIdleCompactionRun = (
  event: OrchestrationV2DomainEvent,
): event is Extract<OrchestrationV2DomainEvent, { readonly type: "run.updated" }> =>
  event.type === "run.updated" &&
  event.payload.userMessageId.startsWith(IDLE_COMPACTION_MESSAGE_ID_PREFIX);

/** A message a person wrote in a thread a Tot launched: the steering its next report mentions. */
const isPersonMessageInLaunchedThread = (
  event: OrchestrationV2DomainEvent,
): event is Extract<OrchestrationV2DomainEvent, { readonly type: "message.updated" }> =>
  event.type === "message.updated" &&
  event.payload.role === "user" &&
  event.payload.createdBy === "user" &&
  parseTotLaunchedThreadId(event.threadId) !== null;

const inScope = (tot: Tot, environmentId: EnvironmentId, shell: OrchestrationV2ThreadShell) =>
  tot.scope === "all" ||
  tot.scope.projects.some(
    (project) => project.environmentId === environmentId && project.projectId === shell.projectId,
  );

const make = Effect.gen(function* () {
  const tots = yield* TotService.TotService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const environmentLabel = (yield* environment.getDescriptor).label;
  const forwarding = yield* PeerForwarding.PeerForwarding;
  const settings = yield* ServerSettings.ServerSettingsService;
  const followRetry = yield* RemoteDelegation.FollowRetrySchedule;
  const pause = yield* TotFollowPause;
  const layerScope = yield* Scope.Scope;
  const followers = new Map<string, Fiber.Fiber<void>>();
  const seen = new Map<ThreadId, WatchedThreadState>();
  /** Each thread's latest idle-compaction run. */
  const compactionRuns = new Map<ThreadId, string>();
  const outbox: Array<Outgoing> = [];
  /** What the user did in threads a Tot launched, kept for that Tot's next report on each. */
  const steering = new Map<string, SteeringNote>();
  /** Whether a person started each run seen in a launched thread, so it is read once. */
  const personRuns = new Map<string, boolean>();
  const holds = new Map<ThreadId, BackgroundHold>();
  /** The last look at each run a Tot sent, which the thread's latest run may have passed. */
  const sentSeen = new Map<string, WatchedThreadState>();
  /** Stopped runs with a follower already waiting on their restart decision. */
  const continuationWaits = new Set<string>();

  const enqueue = Effect.fnUntraced(function* (
    event: TotWatchEvent,
    item: Omit<Outgoing, "urgent" | "queuedAt">,
  ) {
    outbox.push({
      ...item,
      urgent: !isRoutineWatchEvent(event),
      queuedAt: yield* Clock.currentTimeMillis,
    });
  });

  const steeringKey = (source: Outgoing["source"]) =>
    `${source.environmentId}\u0000${source.threadId}`;
  const noteSteering = (source: Outgoing["source"], change: (note: SteeringNote) => SteeringNote) =>
    steering.set(
      steeringKey(source),
      change(steering.get(steeringKey(source)) ?? EMPTY_STEERING_NOTE),
    );

  /** Each message once, though its record updates as it queues, starts and ends. */
  const notedLocalMessages = new Set<string>();
  const noteLocalSteering = (threadId: ThreadId, messageId: string, text: string) => {
    if (notedLocalMessages.has(messageId) || text.trim() === "") return;
    if (notedLocalMessages.size >= MAX_REMEMBERED_RUNS) notedLocalMessages.clear();
    notedLocalMessages.add(messageId);
    noteSteering({ environmentId, threadId }, (note) => noteSteeringMessage(note, text));
  };

  /** Whether a person, rather than the Tot that launched the thread, started this run. */
  const startedByPerson = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const key = `${threadId}\u0000${runId}`;
    const known = personRuns.get(key);
    if (known !== undefined) return known;
    const records = yield* threads
      .getThreadRecords(threadId, ["runs", "messages"], {
        messageRoles: ["user"],
        messageRunIds: [runId],
      })
      .pipe(Effect.option);
    if (Option.isNone(records)) return false;
    const startedBy = records.value.runs.find((run) => run.id === runId)?.userMessageId;
    const person =
      records.value.messages.find((message) => message.id === startedBy)?.createdBy === "user";
    if (personRuns.size >= MAX_REMEMBERED_RUNS) personRuns.clear();
    personRuns.set(key, person);
    return person;
  });

  /** Keeps a run's report back while its background work is live and just after it ends. */
  const throughHold = (
    threadId: ThreadId,
    next: WatchedThreadState,
    shell: OrchestrationV2ThreadShell | null,
    firstLook: boolean,
    now: number,
    wokenByWork: boolean,
  ): WatchedThreadState => {
    const hold = holds.get(threadId);
    const chained = hold !== undefined && (hold.runId === next.runId || wokenByWork);
    if (next.status === "waiting" && next.backgroundTasks > 0 && next.runId !== null) {
      if (chained) {
        holds.set(threadId, { ...hold, runId: next.runId, graceUntil: null });
      } else {
        const endedAt = shell?.latestRunCompletedAt;
        const dueAt =
          (endedAt == null ? now : DateTime.toEpochMillis(endedAt)) + STILL_WORKING_CHECK_IN_MS;
        // Past due at a first look means a restart lost whether the check-in already went out.
        holds.set(threadId, {
          runId: next.runId,
          dueAt,
          checkedIn: firstLook && dueAt <= now,
          graceUntil: null,
        });
      }
      return next;
    }
    if (chained && hold.runId === next.runId && next.status === "completed") {
      const graceUntil = hold.graceUntil ?? now + BACKGROUND_WAKE_GRACE_MS;
      if (now < graceUntil) {
        holds.set(threadId, { ...hold, graceUntil });
        return { ...next, status: "waiting" };
      }
      holds.delete(threadId);
      return next;
    }
    if (chained && next.status === "running" && next.runId !== null) {
      holds.set(threadId, { ...hold, runId: next.runId, graceUntil: null });
    } else {
      holds.delete(threadId);
    }
    return next;
  };

  const localDetail = Effect.fnUntraced(function* (
    threadId: ThreadId,
    event: TotWatchEvent,
    next: WatchedThreadState,
  ) {
    const runId = next.runId === null ? null : RunId.make(next.runId);
    if (runId === null || !carriesExcerpt(event)) return {} satisfies TotWatchLineDetail;
    const { messages } = yield* threads
      .getThreadRecords(threadId, ["messages"], {
        messageRoles: ["assistant"],
        messageRunIds: [runId],
      })
      .pipe(Effect.orElseSucceed(() => ({ messages: [] })));
    const excerpt = formatWatchExcerpt(
      messages.findLast((message) => message.text.trim() !== "")?.text,
    );
    const stoppedBy =
      event === "stopped"
        ? stoppedByFrom(
            (yield* threads
              .getThreadRecords(threadId, ["turnItems"], {
                turnItemRunIds: [runId],
                turnItemTypes: ["run_interrupt_request"],
              })
              .pipe(Effect.orElseSucceed(() => ({ turnItems: [] })))).turnItems.flatMap((item) =>
              item.type === "run_interrupt_request" ? [item.message] : [],
            )[0],
          )
        : null;
    return {
      excerpt,
      stoppedBy,
      backgroundTasks: next.backgroundTasks,
    } satisfies TotWatchLineDetail;
  });

  /** Looks again once a restart has decided whether this stopped run continues. */
  const lookAfterContinuation = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const key = `${threadId}\u0000${runId}`;
    if (continuationWaits.has(key)) return;
    continuationWaits.add(key);
    yield* threads
      .awaitRestartContinuation({ threadId, runId })
      .pipe(
        Effect.ensuring(Effect.sync(() => continuationWaits.delete(key))),
        Effect.andThen(Effect.suspend(() => look(threadId))),
        Effect.ignore,
        Effect.forkIn(layerScope),
      );
  });

  // Untraced: runs for every thread event, under the stream's own span.
  const lookNow = Effect.fnUntraced(function* (
    threadId: ThreadId,
    checkIn: boolean,
    sentOnly: boolean,
  ) {
    // A Tot never wakes for itself or another Tot's own thread.
    if (parseTotThreadId(threadId) !== null && !(yield* anySentWatch(threadId))) return;
    const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
    const shellState = watchedStateFromShell(shell);
    // A compaction run neither reports nor moves the baseline the next real run compares with.
    if (
      !shellState.ended &&
      shellState.runId !== null &&
      compactionRuns.get(threadId) === shellState.runId
    ) {
      return;
    }
    const stoppedRun =
      shellState.status === "stopped" && shellState.runId !== null
        ? RunId.make(shellState.runId)
        : null;
    const restartPending =
      stoppedRun !== null &&
      (yield* threads.restartContinuationPending({ threadId, runId: stoppedRun }));
    const allTots = yield* tots.list;
    const watched = allTots.some(
      (tot) =>
        tot.watchAll ||
        tot.watches.some(
          (watch) => watch.environmentId === environmentId && watch.threadId === threadId,
        ),
    );
    const heldRun = holds.get(threadId)?.runId;
    const wokenByWork =
      shell?.latestRunBackgroundWake === true ||
      (heldRun !== undefined &&
        shellState.runId !== null &&
        heldRun !== shellState.runId &&
        (yield* threads.runContinuedBy({ threadId, runId: RunId.make(heldRun) })) ===
          shellState.runId);
    const now = yield* Clock.currentTimeMillis;
    const previous = seen.get(threadId);
    if (!watched) holds.delete(threadId);
    const current = { ...shellState, restartPending };
    const next = watched
      ? throughHold(threadId, current, shell, previous === undefined, now, wokenByWork)
      : current;
    // The startup pass must not become the baseline a launched watch's next look compares with.
    if (!sentOnly) seen.set(threadId, next);
    if (restartPending && stoppedRun !== null) {
      yield* lookAfterContinuation(threadId, stoppedRun);
    }
    const isCheckIn =
      checkIn && next.status === "waiting" && next.backgroundTasks > 0 && next.pending === null;
    const owner = parseTotLaunchedThreadId(threadId);
    const link = formatThreadLink({ environmentId, threadId }, shell?.title);
    const source = { environmentId, threadId };
    const anySent = allTots.some((tot) =>
      tot.watches.some(
        (watch) =>
          watch.reason === "sent" &&
          watch.environmentId === environmentId &&
          watch.threadId === threadId,
      ),
    );
    // A failed read leaves sent watches for the next look rather than calling their runs gone.
    const sentRuns =
      anySent && !next.ended
        ? Option.getOrUndefined(
            yield* threads.getThreadRecords(threadId, ["runs"]).pipe(Effect.option),
          )?.runs
        : undefined;
    for (const tot of allTots) {
      if (tot.threadId === null || tot.threadId === threadId) continue;
      const mode = totWatchReportsOf(tot);
      // Off keeps its watches: switching reports back on resumes them.
      if (mode === "off") continue;
      const explicit = tot.watches.filter(
        (watch) => watch.environmentId === environmentId && watch.threadId === threadId,
      );
      const viaAll =
        tot.watchAll &&
        parseTotThreadId(threadId) === null &&
        // `launched` counts a watch-everything match only where this Tot launched the thread.
        (mode === "explicit" ? owner === null || owner === tot.id : owner === tot.id) &&
        shell !== null &&
        inScope(tot, environmentId, shell);
      if (explicit.length === 0 && !viaAll) continue;
      if (next.ended) {
        steering.delete(steeringKey(source));
        // A first look is only a baseline unless the Tot started this work itself.
        const counts = previous !== undefined || explicit.some((w) => w.reason !== "requested");
        if (counts && explicit.length > 0 && watchTransition(previous, next) === "ended") {
          yield* tots.removeWatch(tot.id, environmentId, threadId).pipe(Effect.ignore);
          for (const key of sentSeen.keys()) {
            if (key.startsWith(`${tot.id}\u0000${threadId}\u0000`)) sentSeen.delete(key);
          }
        }
        continue;
      }
      // Each sent watch follows its own run, whichever run the thread presents now.
      const sentRunsHere = new Set<string>();
      for (const entry of explicit) {
        if (entry.reason !== "sent" || entry.runId === undefined || sentRuns === undefined) {
          continue;
        }
        const run = yield* followSentRun(threadId, sentRuns, entry.runId);
        if (run !== undefined && sentRunsHere.has(run.id)) {
          if (run.id !== entry.runId) {
            yield* tots
              .moveSentWatch(tot.id, environmentId, threadId, entry.runId, run.id)
              .pipe(Effect.ignore);
          }
          continue;
        }
        if (run === undefined) {
          yield* tots.removeWatchEntry(tot.id, entry).pipe(Effect.ignore);
          sentSeen.delete(sentKey(tot.id, threadId, entry.runId));
          if (deliversWatchReport({ mode, reasons: ["sent"], viaAll: false })) {
            yield* enqueue("ended_unseen", {
              totId: tot.id,
              expectedThreadId: tot.threadId,
              line: formatWatchLine("ended_unseen", link, environmentLabel),
              source,
            });
          }
          continue;
        }
        if (run.id !== entry.runId) {
          yield* tots
            .moveSentWatch(tot.id, environmentId, threadId, entry.runId, run.id)
            .pipe(Effect.ignore);
          const moved = sentSeen.get(sentKey(tot.id, threadId, entry.runId));
          sentSeen.delete(sentKey(tot.id, threadId, entry.runId));
          if (moved !== undefined) sentSeen.set(sentKey(tot.id, threadId, run.id), moved);
        }
        sentRunsHere.add(run.id);
        const key = sentKey(tot.id, threadId, run.id);
        const prior = sentSeen.get(key) ?? sentRunBaseline(run.id);
        const own = run.id === next.runId ? next : yield* passedRunState(threadId, run, next);
        // A later run took over from a turn whose background work was still live.
        const overtaken =
          own.status === "completed" && run.id !== next.runId && prior.backgroundTasks > 0;
        const event: TotWatchEvent | null =
          overtaken || (isCheckIn && run.id === next.runId)
            ? "still_working"
            : watchTransition(prior.runId === run.id ? prior : sentRunBaseline(run.id), own);
        sentSeen.set(key, own);
        if (runIsOver(own)) {
          yield* tots.removeWatchEntry(tot.id, { ...entry, runId: run.id }).pipe(Effect.ignore);
          sentSeen.delete(key);
        }
        if (
          event !== null &&
          event !== "ended" &&
          deliversWatchReport({ mode, reasons: ["sent"], viaAll: false })
        ) {
          yield* enqueue(event, {
            totId: tot.id,
            expectedThreadId: tot.threadId,
            line: formatWatchLine(
              event,
              link,
              environmentLabel,
              yield* localDetail(
                threadId,
                event,
                overtaken ? { ...own, backgroundTasks: prior.backgroundTasks } : own,
              ),
            ),
            source,
            ...(event === "stopped" ? { stopped: source } : {}),
          });
        }
      }
      if (sentOnly) continue;
      const broad = explicit.filter((watch) => watch.reason !== "sent");
      if (broad.length === 0 && !viaAll) continue;
      // A first look is only a baseline unless the Tot started this work itself.
      if (previous === undefined && !broad.some((watch) => watch.reason === "launched")) continue;
      const event = isCheckIn ? "still_working" : watchTransition(previous, next);
      if (event === null || event === "ended") continue;
      if (next.runId !== null && sentRunsHere.has(next.runId)) continue;
      if (!deliversWatchReport({ mode, reasons: broad.map((watch) => watch.reason), viaAll })) {
        continue;
      }
      // The user's own run in a thread this Tot launched is news for its next report, not a wake.
      if (
        owner === tot.id &&
        next.runId !== null &&
        (yield* startedByPerson(threadId, RunId.make(next.runId)))
      ) {
        noteSteering(source, (note) =>
          noteSteeringRun(note, event, { backgroundTasks: next.backgroundTasks }),
        );
        continue;
      }
      yield* enqueue(event, {
        totId: tot.id,
        expectedThreadId: tot.threadId,
        line: formatWatchLine(
          event,
          link,
          environmentLabel,
          yield* localDetail(threadId, event, next),
        ),
        source,
        ...(event === "stopped" ? { stopped: source } : {}),
      });
    }
  });

  // One look at a time, so two looks cannot both report the same run before its watch is gone.
  const lookLock = yield* Semaphore.make(1);
  const look = (threadId: ThreadId, checkIn = false, sentOnly = false): Effect.Effect<void> =>
    lookLock.withPermits(1)(lookNow(threadId, checkIn, sentOnly));

  const observe = (threadId: ThreadId) => look(threadId);

  const recoverSentWatches = Effect.gen(function* () {
    const threadIds = new Set(
      (yield* tots.list).flatMap((tot) =>
        tot.threadId === null
          ? []
          : tot.watches.flatMap((watch) =>
              watch.reason === "sent" && watch.environmentId === environmentId
                ? [watch.threadId]
                : [],
            ),
      ),
    );
    // Reports go through the outbox, so each Tot gets one batched wake.
    for (const threadId of threadIds) yield* look(threadId, false, true);
  });

  const sentKey = (totId: TotId, threadId: ThreadId, runId: string) =>
    `${totId}\u0000${threadId}\u0000${runId}`;

  /** The run that carries a sent run's work now, through restarts and background wakes. */
  const followSentRun = Effect.fnUntraced(function* (
    threadId: ThreadId,
    runs: ReadonlyArray<OrchestrationV2Run>,
    runId: RunId,
  ) {
    const ordered = runs.toSorted((left, right) => left.ordinal - right.ordinal);
    let current = ordered.find((run) => run.id === runId);
    while (current !== undefined) {
      const { id, status } = current;
      const continuation = ordered.findLast((run) => run.restartContinuationOfRunId === id);
      if (continuation !== undefined) {
        current = continuation;
        continue;
      }
      const neverStarted = ThreadManagementService.runNeverStarted(current);
      if (status !== "completed" && !neverStarted) return current;
      const continuedBy = yield* threads.runContinuedBy({ threadId, runId: id });
      // A run that never started has no outcome: undefined reports it as ended unseen.
      if (continuedBy === undefined) return neverStarted ? undefined : current;
      current = ordered.find((run) => run.id === continuedBy);
    }
    return undefined;
  });

  /** A sent run the thread's latest run has passed, read from its own record. */
  const passedRunState = Effect.fnUntraced(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
    latest: WatchedThreadState,
  ) {
    const status = statusOf(run.status);
    const restartPending =
      status === "stopped" &&
      (yield* threads.restartContinuationPending({ threadId, runId: run.id }));
    if (restartPending) yield* lookAfterContinuation(threadId, run.id);
    const ended = status === "completed" || status === "failed" || status === "stopped";
    return {
      status,
      // A request open while this run is still active is this run's, not the queued one's.
      pending: ended ? null : latest.pending,
      runId: run.id,
      requestId: ended ? null : latest.requestId,
      ended: false,
      backgroundTasks: 0,
      restartPending,
    } satisfies WatchedThreadState;
  });

  const stillWatching = (totId: TotId, totThreadId: ThreadId, watch: TotWatch) =>
    tots.list.pipe(
      Effect.map((all) => {
        const tot = all.find((candidate) => candidate.id === totId);
        if (tot === undefined || tot.threadId !== totThreadId) return undefined;
        const watched = tot.watches.some(
          (each) => each.environmentId === watch.environmentId && each.threadId === watch.threadId,
        );
        return watched ? { ...tot, threadId: tot.threadId } : undefined;
      }),
    );

  /** Follows one thread on a linked environment for one Tot until its watch ends. */
  const follow = Effect.fn("TotWatchService.follow")(function* (
    totId: TotId,
    totThreadId: ThreadId,
    watch: TotWatch,
  ) {
    const first = yield* stillWatching(totId, totThreadId, watch);
    if (first === undefined) return;
    const callerShell = threads
      .getThreadShell(first.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const caller = yield* callerShell;
    if (caller === null) return;
    const scope = {
      environmentId,
      requestNamespace: `tot:${totId}`,
      thread: {
        threadId: first.threadId,
        providerSessionId: `tot-watch:${watch.threadId}`,
        providerInstanceId: caller.providerInstanceId,
      },
      client: undefined,
      capabilities: new Set(["orchestration" as const]),
      issuedAt: 0,
    };
    const label = yield* forwarding.links(scope).pipe(
      Effect.map(
        (result) =>
          result.links.find((link) => link.environmentId === watch.environmentId)?.label ??
          watch.environmentId,
      ),
      Effect.orElseSucceed(() => watch.environmentId),
    );
    let firstLook = true;
    let previous: WatchedThreadState | undefined = undefined;
    let hold: { readonly dueAt: number; readonly checkedIn: boolean } | null = null;
    let wakeGraceUsed = false;
    const link = formatThreadLink({ environmentId: watch.environmentId, threadId: watch.threadId });
    const source = { environmentId: watch.environmentId, threadId: watch.threadId };
    // The user's messages there since this follower started, for the next report's note.
    const launchedByThisTot = parseTotLaunchedThreadId(watch.threadId) === totId;
    const followStartedAt = yield* Clock.currentTimeMillis;
    const notedMessages = new Set<string>();
    const remoteRead = (limit: number, maxCharsPerItem: number, runLimit = 1) =>
      forwarding
        .readThread(scope, watch.environmentId, {
          threadId: watch.threadId,
          view: "messages",
          limit,
          runLimit,
          maxCharsPerItem,
          beforePosition: Number.MAX_SAFE_INTEGER,
        })
        .pipe(Effect.option);
    while (true) {
      const tot = yield* stillWatching(totId, totThreadId, watch);
      if (tot === undefined) return;
      // Read fresh each look: every watch on this thread shares this one follower.
      const entries = tot.watches.filter(
        (each) => each.environmentId === watch.environmentId && each.threadId === watch.threadId,
      );
      // The oldest unreported send first, by its own run, so a later run cannot hide its end.
      let target = entries.find(
        (each) => each.reason === "sent" && each.runId !== undefined,
      )?.runId;
      const asked = target;
      const waited = yield* forwarding
        .waitForThread(scope, watch.environmentId, {
          threadId: watch.threadId,
          ...(asked === undefined ? {} : { runId: asked }),
          until: "attention",
          timeoutMs: FOLLOW_WAIT_MS,
        })
        .pipe(
          Effect.map((result) => ({ result, lost: null })),
          Effect.catchIf(
            (error) =>
              error.code === "thread_not_found" ||
              (error.code === "run_not_found" && asked !== undefined),
            (error) =>
              Effect.succeed({
                result: undefined,
                lost: error.code === "thread_not_found" ? ("thread" as const) : ("run" as const),
              }),
          ),
          Effect.retry(followRetry),
        );
      if (waited.lost === "thread") {
        // Only the watched thread being gone ends the watch; a missing caller just stops here.
        if ((yield* callerShell) !== null) {
          yield* tots.removeWatch(totId, watch.environmentId, watch.threadId).pipe(Effect.ignore);
        }
        return;
      }
      const mode = totWatchReportsOf(tot);
      const endedUnseen = Effect.fnUntraced(function* (runId: RunId) {
        yield* tots
          .removeWatchEntry(totId, { ...source, reason: "sent", runId })
          .pipe(Effect.ignore);
        if (deliversWatchReport({ mode, reasons: ["sent"], viaAll: false })) {
          yield* enqueue("ended_unseen", {
            totId,
            expectedThreadId: tot.threadId,
            line: formatWatchLine("ended_unseen", link, label),
            source,
          });
        }
      });
      if (waited.lost === "run" || waited.result === undefined) {
        // The peer no longer has this run, so its outcome cannot be known from here.
        if (asked !== undefined) yield* endedUnseen(asked);
        continue;
      }
      const result = waited.result;
      // A peer without the task list reads as none, which is what it reported before.
      const read =
        result.status === "completed" ? Option.getOrUndefined(yield* remoteRead(10, 1)) : undefined;
      const detail = read?.thread;
      let next = watchedStateFromWait(
        result,
        liveBackgroundTaskCount(detail?.pendingBackgroundTasks ?? []),
      );
      const moveTo = (runId: RunId) =>
        asked === undefined
          ? Effect.void
          : tots
              .moveSentWatch(totId, watch.environmentId, watch.threadId, asked, runId)
              .pipe(Effect.ignore);
      // The wait follows a restart to its continuation and answers with that run.
      if (target !== undefined && result.runId !== null && result.runId !== target) {
        yield* moveTo(result.runId);
        target = result.runId;
      }
      // Only the peer's own word moves a watch; without it this run's outcome stands.
      if (target !== undefined && result.continuedByRunId !== undefined) {
        yield* moveTo(result.continuedByRunId);
        continue;
      }
      // An older peer names no absorbing run, so a run that never started has no known outcome.
      if (target !== undefined && result.status === "cancelled" && !result.timedOut) {
        const ownRun = Option.getOrUndefined(yield* remoteRead(1, 1, 50))?.recentRuns.find(
          (run) => run.runId === target,
        );
        if (ownRun === undefined || ownRun.startedAt === null) {
          yield* endedUnseen(target);
          continue;
        }
      }
      const now = yield* Clock.currentTimeMillis;
      const heldNow = next.status === "waiting" && next.backgroundTasks > 0;
      if (heldNow) {
        hold ??= { dueAt: now + STILL_WORKING_CHECK_IN_MS, checkedIn: false };
        wakeGraceUsed = false;
      } else if (
        previous !== undefined &&
        previous.backgroundTasks > 0 &&
        previous.runId === next.runId &&
        next.status === "completed" &&
        !wakeGraceUsed
      ) {
        // One more look, in case the ended work is about to wake a new run.
        wakeGraceUsed = true;
        next = { ...next, status: "waiting" };
      } else if (next.status !== "running") {
        hold = null;
      }
      const checkIn =
        heldNow && hold !== null && !hold.checkedIn && now >= hold.dueAt && next.pending === null;
      if (checkIn && hold !== null) hold = { ...hold, checkedIn: true };
      // A first look is only a baseline for a thread the Tot only asked to watch.
      const baseline =
        firstLook && target === undefined && !entries.some((each) => each.reason === "launched");
      firstLook = false;
      const prior =
        target !== undefined && previous?.runId !== next.runId
          ? sentRunBaseline(next.runId ?? target)
          : previous;
      const event: TotWatchEvent | null = baseline
        ? null
        : checkIn
          ? "still_working"
          : watchTransition(prior, next);
      previous = next;
      const delivers = deliversWatchReport({
        mode,
        reasons: [
          ...entries.filter((each) => each.reason !== "sent").map((each) => each.reason),
          ...(target === undefined ? [] : (["sent"] as const)),
        ],
        viaAll: false,
      });
      if (event !== null && event !== "ended" && delivers) {
        let personRun = false;
        const lastItems =
          carriesExcerpt(event) || launchedByThisTot
            ? Option.getOrUndefined(yield* remoteRead(20, 20_000))?.items
            : undefined;
        if (launchedByThisTot && lastItems !== undefined) {
          for (const item of lastItems) {
            if (
              item.type !== "user_message" ||
              item.createdBy !== "user" ||
              item.text === null ||
              item.messageId === null ||
              notedMessages.has(item.messageId) ||
              Date.parse(item.updatedAt) < followStartedAt
            ) {
              continue;
            }
            notedMessages.add(item.messageId);
            noteSteering(source, (note) => noteSteeringMessage(note, item.text!));
          }
          const startedBy = lastItems.find(
            (item) => item.type === "user_message" && item.runId === next.runId,
          );
          personRun = target === undefined && startedBy?.createdBy === "user";
          if (personRun) {
            noteSteering(source, (note) =>
              noteSteeringRun(note, event, { backgroundTasks: next.backgroundTasks }),
            );
          }
        }
        // Only this run's words: a later run may be the newest thing in the thread.
        const excerpt = formatWatchExcerpt(
          lastItems?.findLast(
            (item) =>
              item.type === "assistant_message" && item.text !== null && item.runId === next.runId,
          )?.text,
        );
        if (!personRun) {
          yield* enqueue(event, {
            totId,
            expectedThreadId: tot.threadId,
            line: formatWatchLine(event, link, label, {
              excerpt,
              backgroundTasks: next.backgroundTasks,
            }),
            source,
            ...(event === "stopped" ? { stopped: source } : {}),
          });
        }
      }
      if (runIsOver(next)) {
        // Work the Tot started ends with its run there; looking on would poll forever.
        if (target !== undefined) {
          yield* tots
            .removeWatchEntry(totId, { ...source, reason: "sent", runId: target })
            .pipe(Effect.ignore);
          continue;
        }
        const launched = entries.filter((each) => each.reason === "launched");
        if (launched.length > 0) {
          for (const entry of launched) {
            yield* tots.removeWatchEntry(totId, entry).pipe(Effect.ignore);
          }
          continue;
        }
      }
      if (!result.timedOut) yield* pause;
    }
  });

  const syncFollowers: Effect.Effect<void> = Effect.gen(function* () {
    const wanted = new Map<string, { totId: TotId; totThreadId: ThreadId; watch: TotWatch }>();
    for (const tot of yield* tots.list) {
      if (tot.threadId === null) continue;
      for (const watch of tot.watches) {
        if (watch.environmentId !== environmentId) {
          // One follower per thread; it reads every watch on that thread each look.
          wanted.set(followerKey(tot.id, tot.threadId, watch), {
            totId: tot.id,
            totThreadId: tot.threadId,
            watch,
          });
        }
      }
    }
    for (const [key, fiber] of followers) {
      if (wanted.has(key)) continue;
      followers.delete(key);
      yield* Fiber.interrupt(fiber);
    }
    for (const [key, { totId, totThreadId, watch }] of wanted) {
      if (followers.has(key)) continue;
      const fiber = yield* follow(totId, totThreadId, watch).pipe(
        Effect.ensuring(Effect.sync(() => followers.delete(key))),
        Effect.ignore,
        Effect.forkIn(layerScope),
      );
      followers.set(key, fiber);
    }
  });

  const anySentWatch = (threadId: ThreadId) =>
    tots.list.pipe(
      Effect.map((all) =>
        all.some((tot) =>
          tot.watches.some(
            (watch) =>
              watch.reason === "sent" &&
              watch.environmentId === environmentId &&
              watch.threadId === threadId,
          ),
        ),
      ),
    );

  /** Sends each due check-in and the reports whose wake grace has passed. */
  const sweepHolds = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [threadId, hold] of holds) {
      if (hold.graceUntil !== null) {
        if (now >= hold.graceUntil) yield* look(threadId);
      } else if (!hold.checkedIn && now >= hold.dueAt) {
        holds.set(threadId, { ...hold, checkedIn: true });
        yield* look(threadId, true);
      }
    }
  });

  const batchWindowMs = settings.getSettings.pipe(
    Effect.map((current) => current.totReportBatchSeconds * 1_000),
    Effect.orElseSucceed(() => DEFAULT_TOT_REPORT_BATCH_SECONDS * 1_000),
  );

  /** Takes every queued report of each Tot that is due, so one wake carries all of its news. */
  const takeDue = Effect.fnUntraced(function* (all: boolean) {
    if (all) return outbox.splice(0, outbox.length);
    const now = yield* Clock.currentTimeMillis;
    const windowMs = yield* batchWindowMs;
    const due = new Set(
      outbox
        .filter((item) => item.urgent || now - item.queuedAt >= windowMs)
        .map((item) => item.totId),
    );
    const batch = outbox.filter((item) => due.has(item.totId));
    const kept = outbox.filter((item) => !due.has(item.totId));
    outbox.splice(0, outbox.length, ...kept);
    return batch;
  });

  const send = Effect.fnUntraced(function* (all: boolean) {
    yield* sweepHolds;
    const batch = yield* takeDue(all);
    const groups = new Map<
      string,
      {
        totId: TotId;
        expected: ThreadId;
        lines: Array<string>;
        sources: Array<Outgoing["source"]>;
      }
    >();
    for (const item of batch) {
      if (
        item.stopped !== undefined &&
        (yield* tots.takeOwnStop(item.totId, item.stopped.environmentId, item.stopped.threadId))
      ) {
        continue;
      }
      const key = `${item.totId}\u0000${item.expectedThreadId}`;
      const group = groups.get(key) ?? {
        totId: item.totId,
        expected: item.expectedThreadId,
        lines: [],
        sources: [],
      };
      group.lines.push(item.line);
      // The user's own words and runs ride with the launching Tot's next line about that thread.
      const note = steering.get(steeringKey(item.source));
      if (note !== undefined && parseTotLaunchedThreadId(item.source.threadId) === item.totId) {
        steering.delete(steeringKey(item.source));
        group.lines.push(...formatSteeringNote(note));
      }
      if (
        !group.sources.some(
          (source) =>
            source.environmentId === item.source.environmentId &&
            source.threadId === item.source.threadId,
        )
      ) {
        group.sources.push(item.source);
      }
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      yield* tots
        .report(group.totId, group.expected, group.lines, group.sources)
        .pipe(Effect.ignore);
    }
  });
  const flush = send(true);
  const flushDue = send(false);

  const start = Effect.gen(function* () {
    // Followers track the Tot settings: a new remote watch starts one, a removed one stops it.
    yield* syncFollowers;
    yield* settings.streamChanges.pipe(
      Stream.runForEach(() => syncFollowers),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* threads.streamDomainEvents.pipe(
      // While a hold is open, any task list change can be the end of work it counts.
      Stream.filter(
        (event) =>
          touchesWatches(event) ||
          isPersonMessageInLaunchedThread(event) ||
          (event.type === "provider-thread.updated" && holds.has(event.threadId)),
      ),
      Stream.runForEach((event) =>
        Effect.suspend(() => {
          if (isPersonMessageInLaunchedThread(event)) {
            noteLocalSteering(event.threadId, event.payload.id, event.payload.text);
            return Effect.void;
          }
          if (isIdleCompactionRun(event)) compactionRuns.set(event.threadId, event.payload.id);
          return observe(event.threadId);
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* Effect.sleep(REPORT_BATCH_WINDOW).pipe(
      Effect.andThen(flushDue),
      Effect.forever,
      Effect.forkScoped,
    );
  });

  return TotWatchService.of({
    start,
    observe,
    flush,
    flushDue,
    syncFollowers,
    recoverSentWatches,
  });
});

export const layer = Layer.effect(TotWatchService, make);
