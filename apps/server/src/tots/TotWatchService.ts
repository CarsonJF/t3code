import {
  type EnvironmentId,
  type OrchestratorMcpThreadWaitResult,
  type TotWatch,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  type ThreadId,
  type Tot,
  type TotId,
} from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "./TotService.ts";
import {
  formatWatchLine,
  watchTransition,
  type WatchedThreadState,
} from "./totWatchTransitions.ts";

/** Reports wait this long so several changes reach a Tot as one message. */
const REPORT_BATCH_WINDOW = Duration.seconds(2);

const FOLLOW_WAIT_MS = 10 * 60 * 1_000;

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
}

export class TotWatchService extends Context.Service<
  TotWatchService,
  {
    /** Watches this environment's threads for every Tot until the scope closes. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** Looks at one thread again and queues what its Tots should hear. */
    readonly observe: (threadId: ThreadId) => Effect.Effect<void>;
    /** Sends what is queued now instead of at the end of the batch window. */
    readonly flush: Effect.Effect<void>;
    /** Starts a follower for each watched thread on a linked environment, and stops the rest. */
    readonly syncFollowers: Effect.Effect<void>;
  }
>()("t3/tots/TotWatchService") {}

const watchedStateFromShell = (shell: OrchestrationV2ThreadShell | null): WatchedThreadState => {
  if (
    shell === null ||
    shell.deletedAt !== null ||
    shell.archivedAt !== null ||
    shell.settledOverride === "settled"
  ) {
    return { status: "idle", pending: null, runId: null, ended: true };
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
  const status: WatchedThreadState["status"] =
    shell.status === "waiting"
      ? "waiting"
      : shell.status === "completed"
        ? "completed"
        : shell.status === "failed"
          ? "failed"
          : shell.status === "idle" ||
              shell.status === "interrupted" ||
              shell.status === "cancelled" ||
              shell.status === "rolled_back"
            ? "idle"
            : "running";
  return { status, pending, runId: shell.latestRunId, ended: false };
};

const watchedStateFromWait = (waited: OrchestratorMcpThreadWaitResult): WatchedThreadState => ({
  status:
    waited.status === "waiting"
      ? "waiting"
      : waited.status === "completed"
        ? "completed"
        : waited.status === "failed"
          ? "failed"
          : waited.status === "idle" ||
              waited.status === "interrupted" ||
              waited.status === "cancelled" ||
              waited.status === "rolled_back"
            ? "idle"
            : "running",
  pending: waited.attention ?? null,
  runId: waited.runId,
  ended: false,
});

const followerKey = (totId: TotId, watch: Pick<TotWatch, "environmentId" | "threadId">) =>
  [totId, watch.environmentId, watch.threadId].join(" ");

const touchesWatches = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" ||
  event.type === "runtime-request.updated" ||
  (event.type.startsWith("thread.") && !event.type.startsWith("thread.pull-request"));

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
  const outbox: Array<Outgoing> = [];

  // Untraced: runs for every thread event, under the stream's own span.
  const observe = Effect.fnUntraced(function* (threadId: ThreadId) {
    // A Tot never wakes for itself or another Tot's own thread.
    if (parseTotThreadId(threadId) !== null && !(yield* anySentWatch(threadId))) return;
    const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
    const next = watchedStateFromShell(shell);
    const previous = seen.get(threadId);
    seen.set(threadId, next);
    const owner = parseTotLaunchedThreadId(threadId);
    for (const tot of yield* tots.list) {
      if (tot.threadId === null || tot.threadId === threadId) continue;
      const explicit = tot.watches.filter(
        (watch) => watch.environmentId === environmentId && watch.threadId === threadId,
      );
      const viaAll =
        tot.watchAll &&
        parseTotThreadId(threadId) === null &&
        (owner === null || owner === tot.id) &&
        shell !== null &&
        inScope(tot, environmentId, shell);
      if (explicit.length === 0 && !viaAll) continue;
      // A first look is only a baseline unless the Tot started this work itself.
      const comparesWithEmpty = explicit.some((watch) => watch.reason !== "requested");
      if (previous === undefined && !comparesWithEmpty) continue;
      const event = watchTransition(previous, next);
      if (event === null) continue;
      if (event === "ended") {
        if (explicit.length > 0) {
          yield* tots.removeWatch(tot.id, environmentId, threadId).pipe(Effect.ignore);
        }
        continue;
      }
      const sent = explicit.filter((watch) => watch.reason === "sent");
      if (sent.length > 0 && sent.length === explicit.length) {
        // Only the run this Tot started counts, and it ends the watch.
        if (!sent.some((watch) => watch.runId === next.runId)) continue;
        if (event === "completed" || event === "failed") {
          yield* tots.removeWatch(tot.id, environmentId, threadId).pipe(Effect.ignore);
        }
      }
      const link = formatThreadLink({ environmentId, threadId }, shell?.title);
      outbox.push({
        totId: tot.id,
        expectedThreadId: tot.threadId,
        line: formatWatchLine(event, link, environmentLabel),
      });
    }
  });

  const stillWatching = (totId: TotId, watch: TotWatch) =>
    tots.list.pipe(
      Effect.map((all) => {
        const tot = all.find((candidate) => candidate.id === totId);
        if (tot === undefined || tot.threadId === null) return undefined;
        const watched = tot.watches.some(
          (each) => each.environmentId === watch.environmentId && each.threadId === watch.threadId,
        );
        return watched ? { ...tot, threadId: tot.threadId } : undefined;
      }),
    );

  /** Follows one thread on a linked environment for one Tot until its watch ends. */
  const follow = Effect.fn("TotWatchService.follow")(function* (totId: TotId, watch: TotWatch) {
    const first = yield* stillWatching(totId, watch);
    if (first === undefined) return;
    const caller = yield* threads
      .getThreadShell(first.threadId)
      .pipe(Effect.orElseSucceed(() => null));
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
    // A first look is only a baseline for a thread the Tot asked to watch.
    let baseline = watch.reason === "requested";
    let previous: WatchedThreadState | undefined = undefined;
    while (true) {
      const tot = yield* stillWatching(totId, watch);
      if (tot === undefined) return;
      const waited = yield* forwarding
        .waitForThread(scope, watch.environmentId, {
          threadId: watch.threadId,
          until: "attention",
          timeoutMs: FOLLOW_WAIT_MS,
        })
        .pipe(
          Effect.map((result) => ({ result, gone: false as const })),
          Effect.catchIf(
            (error) => error.code === "thread_not_found",
            () => Effect.succeed({ result: undefined, gone: true as const }),
          ),
          Effect.retry(followRetry),
        );
      if (waited.gone) {
        yield* tots.removeWatch(totId, watch.environmentId, watch.threadId).pipe(Effect.ignore);
        return;
      }
      const next = watchedStateFromWait(waited.result);
      const event = baseline ? null : watchTransition(previous, next);
      baseline = false;
      previous = next;
      const forThisRun = watch.reason !== "sent" || watch.runId === next.runId;
      if (event !== null && event !== "ended" && forThisRun) {
        outbox.push({
          totId,
          expectedThreadId: tot.threadId,
          line: formatWatchLine(
            event,
            formatThreadLink({ environmentId: watch.environmentId, threadId: watch.threadId }),
            label,
          ),
        });
        if (watch.reason === "sent" && (event === "completed" || event === "failed")) {
          yield* tots.removeWatch(totId, watch.environmentId, watch.threadId).pipe(Effect.ignore);
          return;
        }
      }
      if (!waited.result.timedOut) yield* pause;
    }
  });

  const syncFollowers = Effect.gen(function* () {
    const wanted = new Map<string, { totId: TotId; watch: TotWatch }>();
    for (const tot of yield* tots.list) {
      if (tot.threadId === null) continue;
      for (const watch of tot.watches) {
        if (watch.environmentId !== environmentId) {
          wanted.set(followerKey(tot.id, watch), { totId: tot.id, watch });
        }
      }
    }
    for (const [key, fiber] of followers) {
      if (wanted.has(key)) continue;
      followers.delete(key);
      yield* Fiber.interrupt(fiber);
    }
    for (const [key, { totId, watch }] of wanted) {
      if (followers.has(key)) continue;
      const fiber = yield* follow(totId, watch).pipe(
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

  const flush = Effect.gen(function* () {
    const batch = outbox.splice(0, outbox.length);
    const groups = new Map<string, { totId: TotId; expected: ThreadId; lines: Array<string> }>();
    for (const item of batch) {
      const key = `${item.totId}\u0000${item.expectedThreadId}`;
      const group = groups.get(key) ?? {
        totId: item.totId,
        expected: item.expectedThreadId,
        lines: [],
      };
      group.lines.push(item.line);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      yield* tots.report(group.totId, group.expected, group.lines).pipe(Effect.ignore);
    }
  });

  const start = Effect.gen(function* () {
    // Followers track the Tot settings: a new remote watch starts one, a removed one stops it.
    yield* syncFollowers;
    yield* settings.streamChanges.pipe(
      Stream.runForEach(() => syncFollowers),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* threads.streamDomainEvents.pipe(
      Stream.filter(touchesWatches),
      Stream.runForEach((event) => observe(event.threadId)),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* Effect.sleep(REPORT_BATCH_WINDOW).pipe(
      Effect.andThen(flush),
      Effect.forever,
      Effect.forkScoped,
    );
  });

  return TotWatchService.of({ start, observe, flush, syncFollowers });
});

export const layer = Layer.effect(TotWatchService, make);
