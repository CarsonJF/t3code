import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
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
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "./TotService.ts";
import * as TotWatchService from "./TotWatchService.ts";

const environmentId = EnvironmentId.make("asuna-env");
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

const makeHarness = (initial: ReadonlyArray<Tot>) => {
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
      ),
    ),
  );
  const step = (next: OrchestrationV2ThreadShell) =>
    Effect.gen(function* () {
      shells.set(next.id, next);
      yield* (yield* TotWatchService.TotWatchService).observe(next.id);
    });
  const flush = TotWatchService.TotWatchService.pipe(Effect.flatMap((service) => service.flush));
  return { state, reports, layer, step, flush };
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
