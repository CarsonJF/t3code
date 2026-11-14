import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  OrchestratorMcpFailure,
  type OrchestratorMcpThreadWaitResult,
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  TotId,
  type OrchestrationV2ThreadShell,
  type Tot,
  type TotWatch,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TotService from "./TotService.ts";
import * as TotWatchService from "./TotWatchService.ts";

const environmentId = EnvironmentId.make("asuna-env");
const promini = EnvironmentId.make("promini-env");
const homeThread = ThreadId.make("tot:home:current");
const yuiThread = ThreadId.make("tot:yui:current");

const shell = (
  id: ThreadId,
  status: OrchestrationV2ThreadShell["status"],
  runId = "run-1",
): OrchestrationV2ThreadShell =>
  ({
    id,
    projectId: ProjectId.make("project:work"),
    title: `Thread ${id}`,
    status,
    latestRunId: RunId.make(runId),
    pendingRuntimeRequest: null,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
  }) as unknown as OrchestrationV2ThreadShell;

interface RemoteOptions {
  readonly waitForThread: PeerForwarding.PeerForwarding["Service"]["waitForThread"];
  readonly pause?: Effect.Effect<void>;
  readonly retry?: Schedule.Schedule<unknown>;
}

const makeHarness = (initial: ReadonlyArray<Tot>, remote?: RemoteOptions) => {
  const state = { tots: [...initial] };
  const shells = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const reports: Array<{ totId: string; lines: ReadonlyArray<string> }> = [];
  const layer = TotWatchService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(TotService.TotService)({
          list: Effect.sync(() => state.tots),
          report: (id, expectedThreadId, lines) =>
            Effect.sync(() => {
              const tot = state.tots.find((candidate) => candidate.id === id);
              if (tot?.threadId === expectedThreadId) reports.push({ totId: id, lines });
            }),
          removeWatch: (id, env, threadId) =>
            Effect.sync(() => {
              state.tots = state.tots.map((tot) =>
                tot.id !== id
                  ? tot
                  : {
                      ...tot,
                      watches: tot.watches.filter(
                        (watch) => !(watch.environmentId === env && watch.threadId === threadId),
                      ),
                    },
              );
            }),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (threadId) => Effect.sync(() => shells.get(threadId) ?? null),
          streamDomainEvents: Stream.never,
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.succeed({ label: "Asuna" } as never),
        }),
        Layer.mock(PeerForwarding.PeerForwarding)({
          waitForThread: remote?.waitForThread ?? (() => Effect.never),
          links: () =>
            Effect.succeed({
              environmentId,
              links: [{ environmentId: promini, label: "ProMini" }],
              notListed: "",
            } as never),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({ streamChanges: Stream.never }),
        Layer.succeed(TotWatchService.TotFollowPause, remote?.pause ?? Effect.never),
        Layer.succeed(RemoteDelegation.FollowRetrySchedule, remote?.retry ?? Schedule.forever),
      ),
    ),
  );
  const step = (next: OrchestrationV2ThreadShell) =>
    Effect.gen(function* () {
      shells.set(next.id, next);
      yield* (yield* TotWatchService.TotWatchService).observe(next.id);
    });
  const flush = TotWatchService.TotWatchService.pipe(Effect.flatMap((service) => service.flush));
  const syncFollowers = TotWatchService.TotWatchService.pipe(
    Effect.flatMap((service) => service.syncFollowers),
  );
  shells.set(homeThread, shell(homeThread, "running"));
  return { state, reports, layer, step, flush, syncFollowers };
};

const watch = (threadId: ThreadId, reason: TotWatch["reason"], runId?: string): TotWatch => ({
  environmentId,
  threadId,
  reason,
  ...(runId === undefined ? {} : { runId: RunId.make(runId) }),
});

const home = (overrides: Partial<Tot>): Tot => ({
  ...DEFAULT_HOME_TOT,
  threadId: homeThread,
  ...overrides,
});
const yui: Tot = {
  ...DEFAULT_HOME_TOT,
  id: TotId.make("yui"),
  name: "Yui",
  threadId: yuiThread,
};

it.effect("a thread a Tot launched reports once when it completes", () => {
  const launched = ThreadId.make("tot-launched:home:c1");
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed"));
    yield* flush;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.totId).toBe("home");
    expect(reports[0]!.lines).toHaveLength(1);
    expect(reports[0]!.lines[0]).toContain("- Completed: ");
    expect(reports[0]!.lines[0]).toContain(launched);
    expect(reports[0]!.lines[0]).toContain(" on Asuna");
    yield* flush;
    expect(reports).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

it.effect("watching everything leaves another Tot's threads to that Tot", () => {
  const yuis = ThreadId.make("tot-launched:yui:c1");
  const plain = ThreadId.make("thread:plain");
  const { reports, layer, step, flush } = makeHarness([home({ watchAll: true }), yui]);
  return Effect.gen(function* () {
    yield* step(shell(yuis, "running"));
    yield* step(shell(yuis, "completed"));
    // A thread seen first while watching everything is only a baseline.
    yield* step(shell(plain, "running"));
    yield* step(shell(plain, "completed"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([expect.stringContaining(plain)]);
  }).pipe(Effect.provide(layer));
});

it.effect("a Tot hears about the run it started in another Tot, not later runs there", () => {
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    expect(reports).toHaveLength(1);
    yield* step(shell(yuiThread, "running", "run-2"));
    yield* step(shell(yuiThread, "completed", "run-2"));
    yield* flush;
    expect(reports).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

it.effect("a Tot turned off before the batch goes out is not woken", () => {
  const launched = ThreadId.make("tot-launched:yui:c1");
  const { state, reports, layer, step, flush } = makeHarness([
    { ...yui, watches: [watch(launched, "launched")] },
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "failed"));
    state.tots = [{ ...yui, threadId: null }];
    yield* flush;
    expect(reports).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});

it.effect("a watched thread that is archived ends its watch without a report", () => {
  const launched = ThreadId.make("tot-launched:home:c1");
  const { state, reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step({ ...shell(launched, "running"), archivedAt: DateTime.makeUnsafe(0) } as never);
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});

const remoteThread = ThreadId.make("tot-launched:home:remote1");

it.effect("a watched thread on another machine that asks a question reports once", () =>
  Effect.gen(function* () {
    const paused = yield* Queue.unbounded<void>();
    const answers: Array<OrchestratorMcpThreadWaitResult> = [
      {
        threadId: remoteThread,
        runId: RunId.make("run-1"),
        status: "waiting",
        timedOut: false,
        attention: "question",
      },
    ];
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () => {
          const next = answers.shift();
          return next === undefined ? Effect.never : Effect.succeed(next);
        },
        pause: Queue.offer(paused, undefined).pipe(Effect.andThen(Effect.never)),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(paused);
      yield* flush;
      expect(reports).toHaveLength(1);
      expect(reports[0]!.lines[0]).toContain("- Asks a question: ");
      expect(reports[0]!.lines[0]).toContain(" on ProMini");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect(
  "an unreachable machine is retried on the backoff, and its follower stops when unwatched",
  () =>
    Effect.gen(function* () {
      const failed = yield* Queue.unbounded<void>();
      const retry = yield* Queue.unbounded<void>();
      let attempts = 0;
      const { state, reports, layer, flush, syncFollowers } = makeHarness(
        [
          home({
            watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }],
          }),
        ],
        {
          waitForThread: () =>
            Effect.suspend(() => {
              attempts += 1;
              return Effect.fail(
                new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "ProMini does not answer.",
                }),
              );
            }),
          retry: Schedule.forever.pipe(
            Schedule.tap(() =>
              Queue.offer(failed, undefined).pipe(Effect.andThen(Queue.take(retry))),
            ),
          ),
        },
      );
      yield* Effect.gen(function* () {
        yield* syncFollowers;
        yield* Queue.take(failed);
        yield* Queue.offer(retry, undefined);
        yield* Queue.take(failed);
        expect(attempts).toBe(2);
        state.tots = [home({ watches: [] })];
        yield* syncFollowers;
        yield* Queue.offer(retry, undefined);
        yield* flush;
        expect(attempts).toBe(2);
        expect(reports).toHaveLength(0);
      }).pipe(Effect.provide(layer));
    }),
);
