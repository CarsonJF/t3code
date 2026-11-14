import {
  type EnvironmentId,
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "./TotService.ts";
import {
  formatWatchLine,
  watchTransition,
  type WatchedThreadState,
} from "./totWatchTransitions.ts";

/** Reports wait this long so several changes reach a Tot as one message. */
const REPORT_BATCH_WINDOW = Duration.seconds(2);

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

  return TotWatchService.of({ start, observe, flush });
});

export const layer = Layer.effect(TotWatchService, make);
