import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  OrchestratorMcpFailure,
  type OrchestratorMcpThreadWaitResult,
  EnvironmentId,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TotId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type Tot,
  type TotWatch,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

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
  pendingBackgroundTasks: OrchestrationV2ThreadShell["pendingBackgroundTasks"] = [],
): OrchestrationV2ThreadShell =>
  ({
    id,
    projectId: ProjectId.make("project:work"),
    title: `Thread ${id}`,
    status,
    latestRunId: RunId.make(runId),
    pendingRuntimeRequest: null,
    pendingBackgroundTasks,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
  }) as unknown as OrchestrationV2ThreadShell;

interface RemoteOptions {
  readonly waitForThread: PeerForwarding.PeerForwarding["Service"]["waitForThread"];
  readonly pause?: Effect.Effect<void>;
  readonly retry?: Schedule.Schedule<unknown>;
  readonly onRemove?: Effect.Effect<void>;
  readonly readThread?: PeerForwarding.PeerForwarding["Service"]["readThread"];
}

const sentinelThread = ThreadId.make("sentinel");

interface RunRecord {
  readonly id: RunId;
  readonly ordinal: number;
  readonly status: string;
  readonly restartContinuationOfRunId?: RunId;
  /** The notification outcome of a run that background work woke. */
  readonly wake?: "updated" | "completed";
  /** Cancelled while queued, so it never started. */
  readonly neverStarted?: boolean;
  /** The active run that Send now moved this run's message into. */
  readonly absorbedBy?: RunId;
  /** A person sent this run's prompt, rather than the Tot. */
  readonly byPerson?: boolean;
}

const asRun = (run: RunRecord) => ({
  ...run,
  userMessageId: `message-${String(run.id)}`,
  startedAt: run.neverStarted === true ? null : DateTime.makeUnsafe(0),
});

const asPrompt = (run: RunRecord) => ({
  id: `message-${String(run.id)}`,
  runId: run.absorbedBy ?? run.id,
  role: "user",
  createdBy: run.wake !== undefined ? "system" : run.byPerson === true ? "user" : "agent",
  text: "",
  ...(run.wake === undefined
    ? {}
    : { notification: { outcome: run.wake, source: { kind: "command" } } }),
});

/** The domain events the watcher streams, and the threads it looked up, in order. */
class EventFeed extends Context.Service<
  EventFeed,
  {
    readonly events: Queue.Queue<OrchestrationV2DomainEvent>;
    readonly lookups: Queue.Queue<ThreadId>;
  }
>()("t3/tots/TotWatchService.test/EventFeed") {}

const layerEventFeed = Layer.effect(
  EventFeed,
  Effect.all({
    events: Queue.unbounded<OrchestrationV2DomainEvent>(),
    lookups: Queue.unbounded<ThreadId>(),
  }),
);

const makeHarness = (initial: ReadonlyArray<Tot>, remote?: RemoteOptions) => {
  const state = { tots: [...initial] };
  const settings = { totReportBatchSeconds: 180 };
  const shells = new Map<ThreadId, OrchestrationV2ThreadShell>();
  const reports: Array<{
    totId: string;
    lines: ReadonlyArray<string>;
    sources?: ReadonlyArray<{ readonly environmentId: string; readonly threadId: string }>;
  }> = [];
  const removed: Array<string> = [];
  const ownStops = new Set<string>();
  const finalMessages = new Map<string, string>();
  const stopMessages = new Map<string, string>();
  const runRecords = new Map<ThreadId, ReadonlyArray<RunRecord>>();
  /** Records the run a shell presents, as the projection would hold it. */
  const noteShellRun = (threadId: ThreadId) => {
    const current = shells.get(threadId);
    if (current?.latestRunId == null) return;
    const runs = runRecords.get(threadId) ?? [];
    const known = runs.find((run) => run.id === current.latestRunId);
    const wake = current.latestRunBackgroundWake === true ? ("updated" as const) : known?.wake;
    const noted: RunRecord = {
      ...known,
      id: current.latestRunId,
      ordinal: known?.ordinal ?? runs.length + 1,
      status: current.status,
      ...(wake === undefined ? {} : { wake }),
    };
    runRecords.set(
      threadId,
      known === undefined
        ? [...runs, noted]
        : runs.map((run) => (run.id === noted.id ? noted : run)),
    );
  };
  /** Changes a run the shell no longer presents, such as one a queued run has passed. */
  const setRun = (threadId: ThreadId, runId: string, patch: Partial<RunRecord>) => {
    noteShellRun(threadId);
    const runs = runRecords.get(threadId) ?? [];
    runRecords.set(
      threadId,
      runs.some((run) => run.id === runId)
        ? runs.map((run) => (run.id === runId ? { ...run, ...patch } : run))
        : [
            ...runs,
            {
              id: RunId.make(runId),
              ordinal: runs.length + 1,
              status: "running",
              ...patch,
            },
          ],
    );
  };
  const pendingContinuations = new Set<string>();
  const continuationGates = new Map<string, Effect.Effect<void>>();
  const layer = TotWatchService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(TotService.TotService)({
          list: Effect.sync(() => state.tots),
          report: (id, expectedThreadId, lines, sources) =>
            Effect.sync(() => {
              const tot = state.tots.find((candidate) => candidate.id === id);
              if (tot?.threadId === expectedThreadId) {
                reports.push({ totId: id, lines, ...(sources === undefined ? {} : { sources }) });
              }
            }),
          removeWatch: (id, env, threadId) =>
            Effect.sync(() => {
              removed.push(threadId);
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
            }).pipe(Effect.andThen(remote?.onRemove ?? Effect.void)),
          removeWatchEntry: (id, entry) =>
            Effect.sync(() => {
              removed.push(entry.threadId);
              state.tots = state.tots.map((tot) =>
                tot.id !== id
                  ? tot
                  : {
                      ...tot,
                      watches: tot.watches.filter(
                        (each) =>
                          !(
                            each.environmentId === entry.environmentId &&
                            each.threadId === entry.threadId &&
                            each.reason === entry.reason &&
                            each.runId === entry.runId
                          ),
                      ),
                    },
              );
            }).pipe(Effect.andThen(remote?.onRemove ?? Effect.void)),
          moveSentWatch: (id, env, threadId, fromRunId, toRunId) =>
            Effect.sync(() => {
              state.tots = state.tots.map((tot) =>
                tot.id !== id
                  ? tot
                  : {
                      ...tot,
                      watches: tot.watches
                        .map((each) =>
                          each.environmentId === env &&
                          each.threadId === threadId &&
                          each.runId === fromRunId
                            ? { ...each, runId: toRunId }
                            : each,
                        )
                        .filter(
                          (each, index, all) =>
                            each.reason !== "sent" ||
                            all.findIndex(
                              (other) =>
                                other.reason === "sent" &&
                                other.threadId === each.threadId &&
                                other.runId === each.runId,
                            ) === index,
                        ),
                    },
              );
            }),
          noteOwnStop: (id, env, threadId) =>
            Effect.sync(() => void ownStops.add(`${id}|${env}|${threadId}`)),
          takeOwnStop: (id, env, threadId) =>
            Effect.sync(() => ownStops.delete(`${id}|${env}|${threadId}`)),
        }),
        Layer.unwrap(
          Effect.gen(function* () {
            const feed = yield* EventFeed;
            return Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: (threadId) =>
                Queue.offer(feed.lookups, threadId).pipe(Effect.as(shells.get(threadId) ?? null)),
              streamDomainEvents: Stream.fromQueue(feed.events),
              getThreadRecords: ((
                threadId: ThreadId,
                _fields: unknown,
                filter?: {
                  readonly messageRoles?: ReadonlyArray<string>;
                  readonly messageRunIds?: ReadonlyArray<string>;
                  readonly turnItemRunIds?: ReadonlyArray<string>;
                },
              ) => {
                noteShellRun(threadId);
                const runs = runRecords.get(threadId) ?? [];
                const runId = filter?.messageRunIds?.[0];
                const itemRunId = filter?.turnItemRunIds?.[0];
                const text = runId === undefined ? undefined : finalMessages.get(runId);
                const stop = itemRunId === undefined ? undefined : stopMessages.get(itemRunId);
                const prompts = runs
                  .map(asPrompt)
                  .filter((prompt) => runId === undefined || prompt.runId === runId);
                return Effect.succeed({
                  messages: filter?.messageRoles?.includes("assistant")
                    ? text === undefined
                      ? []
                      : [{ text }]
                    : prompts,
                  turnItems:
                    stop === undefined ? [] : [{ type: "run_interrupt_request", message: stop }],
                  runs: runs.map(asRun),
                });
              }) as never,
              // The real rule, over this harness's runs and prompts.
              runContinuedBy: ({ threadId, runId }) =>
                Effect.suspend(() => {
                  noteShellRun(threadId);
                  const runs = runRecords.get(threadId) ?? [];
                  return ThreadManagement.resolveRunContinuation(
                    runs.map(asRun) as never,
                    runId,
                    (filter) =>
                      Effect.succeed(
                        runs
                          .map(asPrompt)
                          .filter(
                            (prompt) =>
                              filter.messageRunIds?.some((id) => id === prompt.runId) === true ||
                              filter.messageIds?.some((id) => id === prompt.id) === true,
                          ) as never,
                      ),
                  );
                }),
              restartContinuationPending: ({ runId }) =>
                Effect.sync(() => pendingContinuations.has(runId)),
              awaitRestartContinuation: ({ runId }) => continuationGates.get(runId) ?? Effect.void,
            });
          }),
        ),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(environmentId),
          getDescriptor: Effect.succeed({ label: "Asuna" } as never),
        }),
        Layer.mock(PeerForwarding.PeerForwarding)({
          waitForThread: remote?.waitForThread ?? (() => Effect.never),
          readThread:
            remote?.readThread ??
            (() =>
              Effect.fail(
                new OrchestratorMcpFailure({ code: "orchestration_error", message: "No read." }),
              )),
          links: () =>
            Effect.succeed({
              environmentId,
              links: [{ environmentId: promini, label: "ProMini" }],
              notListed: "",
            } as never),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          streamChanges: Stream.never,
          getSettings: Effect.sync(
            () => ({ totReportBatchSeconds: settings.totReportBatchSeconds }) as never,
          ),
        }),
        Layer.succeed(TotWatchService.TotFollowPause, remote?.pause ?? Effect.never),
        Layer.succeed(RemoteDelegation.FollowRetrySchedule, remote?.retry ?? Schedule.forever),
      ),
    ),
    Layer.provideMerge(layerEventFeed),
  );
  const step = (next: OrchestrationV2ThreadShell) =>
    Effect.gen(function* () {
      shells.set(next.id, next);
      yield* (yield* TotWatchService.TotWatchService).observe(next.id);
    });
  /** Publishes domain events to a started watcher and returns once it has handled them. */
  const emit = (...emitted: ReadonlyArray<OrchestrationV2DomainEvent>) =>
    Effect.gen(function* () {
      const { events, lookups } = yield* EventFeed;
      for (const event of emitted) yield* Queue.offer(events, event);
      // The watcher handles events in order, so its look at the sentinel follows the rest.
      yield* Queue.offer(events, {
        type: "thread.meta-updated",
        threadId: sentinelThread,
      } as unknown as OrchestrationV2DomainEvent);
      while ((yield* Queue.take(lookups)) !== sentinelThread) {
        // Earlier looks belong to the emitted events.
      }
    });
  const flush = TotWatchService.TotWatchService.pipe(Effect.flatMap((service) => service.flush));
  const flushDue = TotWatchService.TotWatchService.pipe(
    Effect.flatMap((service) => service.flushDue),
  );
  const syncFollowers = TotWatchService.TotWatchService.pipe(
    Effect.flatMap((service) => service.syncFollowers),
  );
  const recoverSentWatches = TotWatchService.TotWatchService.pipe(
    Effect.flatMap((service) => service.recoverSentWatches),
  );
  shells.set(homeThread, shell(homeThread, "running"));
  shells.set(ThreadId.make("tot:home:fresh"), shell(ThreadId.make("tot:home:fresh"), "running"));
  return {
    state,
    settings,
    reports,
    removed,
    shells,
    layer,
    step,
    emit,
    flush,
    flushDue,
    syncFollowers,
    recoverSentWatches,
    ownStops,
    finalMessages,
    stopMessages,
    setRun,
    pendingContinuations,
    continuationGates,
  };
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
    expect(reports[0]!.lines[0]).toContain("- Finished: ");
    expect(reports[0]!.lines[0]).toContain(launched);
    expect(reports[0]!.lines[0]).toContain(" on Asuna");
    yield* flush;
    expect(reports).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

it.effect("a run that ends while awaited background work remains reports nothing", () => {
  const launched = ThreadId.make("tot-launched:home:c5");
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed", "run-1", awaited));
    yield* flush;
    expect(reports).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});

it.effect("a run that waited on background work reports Completed once it settles", () => {
  const launched = ThreadId.make("tot-launched:home:c6");
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed", "run-1", awaited));
    yield* flush;
    expect(reports).toHaveLength(0);
    yield* step(shell(launched, "completed"));
    yield* flush;
    expect(reports).toHaveLength(0);
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
    ]);
    yield* flush;
    expect(reports).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

const liveCommand: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
  { taskId: "shell-1", kind: "command" },
];

const domainEvent = (
  type: OrchestrationV2DomainEvent["type"],
  threadId: ThreadId,
  payload: Record<string, unknown> = {},
) => ({ type, threadId, payload }) as unknown as OrchestrationV2DomainEvent;

const runUpdated = (threadId: ThreadId, runId: string, status: string, userMessageId = "m1") =>
  domainEvent("run.updated", threadId, { id: runId, status, userMessageId });

// regression: the watcher saw `waiting` and never looked again when the awaited work ended.
it.effect("reports Completed when awaited background work ends, from the domain events", () => {
  const launched = ThreadId.make("tot-launched:home:e2e");
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const { reports, shells, layer, emit, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* (yield* TotWatchService.TotWatchService).start;
    shells.set(launched, shell(launched, "running"));
    yield* emit(runUpdated(launched, "run-1", "running"));
    shells.set(launched, shell(launched, "completed", "run-1", awaited));
    yield* emit(runUpdated(launched, "run-1", "completed"));
    yield* flush;
    expect(reports).toHaveLength(0);

    shells.set(launched, shell(launched, "completed"));
    yield* emit(domainEvent("provider-thread.updated", launched, { pendingBackgroundTasks: [] }));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain(launched);
  }).pipe(Effect.provide(layer), Effect.scoped);
});

it.effect("each kind of work-ended event wakes the watcher", () => {
  const { reports, shells, layer, emit, flush, state } = makeHarness([home({})]);
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const cases = [
    ["provider-thread.updated", { pendingBackgroundTasks: [] }],
    ["turn-item.updated", { type: "command_execution", status: "completed" }],
    ["subagent.updated", { status: "completed" }],
    ["run.background-work-cancelled", {}],
  ] as const;
  const threadFor = (type: string) => ThreadId.make(`tot-launched:home:${type}`);
  state.tots = [home({ watches: cases.map(([type]) => watch(threadFor(type), "launched")) })];
  return Effect.gen(function* () {
    yield* (yield* TotWatchService.TotWatchService).start;
    for (const [type, payload] of cases) {
      const thread = threadFor(type);
      shells.set(thread, shell(thread, "completed", "run-1", awaited));
      yield* emit(runUpdated(thread, "run-1", "completed"));
      shells.set(thread, shell(thread, "completed"));
      yield* emit(domainEvent(type, thread, payload));
    }
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toHaveLength(cases.length);
    cases.forEach(([type], index) => {
      expect(lines[index]).toContain("- Finished: ");
      expect(lines[index]).toContain(threadFor(type));
    });
  }).pipe(Effect.provide(layer), Effect.scoped);
});

it.effect("an idle compaction run does not report, and the next real run still does", () => {
  const launched = ThreadId.make("tot-launched:home:compacted");
  const { reports, shells, layer, emit, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* (yield* TotWatchService.TotWatchService).start;
    shells.set(launched, shell(launched, "completed", "run-1"));
    yield* emit(runUpdated(launched, "run-1", "completed"));
    const compaction = `idle-compact:${launched}:run-1`;
    shells.set(launched, shell(launched, "running", "run-2"));
    yield* emit(runUpdated(launched, "run-2", "running", compaction));
    shells.set(launched, shell(launched, "completed", "run-2"));
    yield* emit(runUpdated(launched, "run-2", "completed", compaction));
    shells.set(launched, shell(launched, "completed", "run-3"));
    yield* emit(runUpdated(launched, "run-3", "completed"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
      expect.stringContaining("- Finished: "),
    ]);
  }).pipe(Effect.provide(layer), Effect.scoped);
});

it.effect("a sent run's wake is followed and its real end is reported, not its start", () => {
  const { reports, removed, state, layer, step, flush, finalMessages } = makeHarness([
    home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const wake = (status: OrchestrationV2ThreadShell["status"]) => ({
    ...shell(yuiThread, status, "run-2"),
    latestRunBackgroundWake: true,
  });
  finalMessages.set("run-2", "Checks passed.");
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1", awaited));
    yield* step(wake("running"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(removed).toEqual([]);
    expect(state.tots[0]!.watches[0]!.runId).toBe("run-2");
    yield* step(wake("completed"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain("`Checks passed.`");
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect("a sent run another message replaces reports still working and ends its watch", () => {
  const { reports, removed, layer, step, flush } = makeHarness([
    home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1", awaited));
    yield* step(shell(yuiThread, "running", "run-2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Still working (1 background task): "),
    ]);
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect("background work not marked awaited holds the report until it really ends", () => {
  const launched = ThreadId.make("tot-launched:home:unmarked");
  const { reports, layer, step, flush, finalMessages } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  finalMessages.set("run-1", "Tests pass.");
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed", "run-1", liveCommand));
    yield* TestClock.adjust("10 minutes");
    yield* flush;
    expect(reports).toHaveLength(0);
    yield* step(shell(launched, "completed"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain("untrusted thread text");
    expect(lines[0]).toContain("`Tests pass.`");
  }).pipe(Effect.provide(layer));
});

it.effect("work still live after 30 minutes sends exactly one check-in", () => {
  const launched = ThreadId.make("tot-launched:home:devserver");
  const { reports, layer, step, flush, finalMessages } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  finalMessages.set("run-1", "Dev server is up.");
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed", "run-1", liveCommand));
    yield* TestClock.adjust("29 minutes");
    yield* flush;
    expect(reports).toHaveLength(0);
    yield* TestClock.adjust("1 minute");
    yield* flush;
    yield* flush;
    yield* step(shell(launched, "completed", "run-1", liveCommand));
    yield* TestClock.adjust("3 hours");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Still working (1 background task): ")]);
    expect(lines[0]).toContain("`Dev server is up.`");
    yield* step(shell(launched, "completed"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Still working"),
      expect.stringContaining("- Finished: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("wake runs of one job share its single check-in", () => {
  const launched = ThreadId.make("tot-launched:home:monitor");
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  const wake = (
    runId: string,
    status: OrchestrationV2ThreadShell["status"],
    tasks = liveCommand,
  ) => ({
    ...shell(launched, status, runId, tasks),
    latestRunBackgroundWake: true,
  });
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed", "run-1", liveCommand));
    yield* TestClock.adjust("31 minutes");
    yield* flush;
    yield* step(wake("run-2", "running", []));
    yield* step(wake("run-2", "completed"));
    yield* TestClock.adjust("31 minutes");
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Still working"),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a run first seen past its check-in after a restart stays silent until it ends", () => {
  const launched = ThreadId.make("tot-launched:home:restarted");
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* TestClock.adjust("2 hours");
    yield* step({
      ...shell(launched, "completed", "run-1", liveCommand),
      latestRunCompletedAt: DateTime.makeUnsafe(0),
    });
    yield* TestClock.adjust("1 hour");
    yield* flush;
    expect(reports).toHaveLength(0);
  }).pipe(Effect.provide(layer));
});

it.effect("a pull request watch waiting on a person does not hold a report", () => {
  const launched = ThreadId.make("tot-launched:home:pr");
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(
      shell(launched, "completed", "run-1", [
        { taskId: "pull-request-watch:github.com/acme/app#1", kind: "monitor" },
      ]),
    );
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a stop by the user reports who stopped it, with the last message", () => {
  const launched = ThreadId.make("tot-launched:home:stop-user");
  const { reports, layer, step, flush, stopMessages, finalMessages } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  stopMessages.set("run-1", "Stopped by user");
  finalMessages.set("run-1", "Halfway through.");
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "interrupted"));
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Stopped by the user: ")]);
    expect(lines[0]).toContain("`Halfway through.`");
  }).pipe(Effect.provide(layer));
});

it.effect("a Tot's own stop does not wake it, while another Tot watching still hears", () => {
  const launched = ThreadId.make("tot-launched:home:stop-own");
  const { reports, layer, step, flush, ownStops, stopMessages } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
    { ...yui, watches: [watch(launched, "launched")] },
  ]);
  stopMessages.set("run-1", "Stopped by an agent: replaced");
  ownStops.add(`home|${environmentId}|${launched}`);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "interrupted"));
    yield* flush;
    expect(reports.map((report) => report.totId)).toEqual(["yui"]);
    expect(reports[0]!.lines[0]).toContain("- Stopped by an agent: ");
    expect(ownStops.size).toBe(0);
  }).pipe(Effect.provide(layer));
});

it.effect("a sent watch survives a stop until its restart continuation resolves", () => {
  const { reports, removed, state, layer, step, flush, setRun, pendingContinuations } = makeHarness(
    [home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }), yui],
  );
  setRun(yuiThread, "run-1", {});
  setRun(yuiThread, "run-2", { restartContinuationOfRunId: RunId.make("run-1") });
  pendingContinuations.add("run-1");
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "cancelled", "run-1"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(removed).toEqual([]);
    pendingContinuations.delete("run-1");
    yield* step(shell(yuiThread, "running", "run-2"));
    expect(state.tots[0]!.watches[0]!.runId).toBe("run-2");
    yield* step(shell(yuiThread, "completed", "run-2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
    ]);
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect("a declined restart continuation reports the stop and ends the sent watch", () => {
  const { reports, removed, layer, step, flush, pendingContinuations, continuationGates } =
    makeHarness([
      home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }),
      yui,
    ]);
  return Effect.gen(function* () {
    const decided = yield* Deferred.make<void>();
    continuationGates.set("run-1", Deferred.await(decided));
    pendingContinuations.add("run-1");
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "cancelled", "run-1"));
    expect(removed).toEqual([]);
    pendingContinuations.delete("run-1");
    yield* Deferred.succeed(decided, undefined);
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Stopped: "),
    ]);
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect("a question or an approval while background work holds still reports", () => {
  const launched = ThreadId.make("tot-launched:home:c7");
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step({
      ...shell(launched, "completed", "run-1", awaited),
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make("q1"),
        kind: "user_input",
        createdAt: DateTime.makeUnsafe(0),
      },
    });
    yield* step({
      ...shell(launched, "completed", "run-1", awaited),
      pendingRuntimeRequest: {
        id: RuntimeRequestId.make("q2"),
        kind: "permission",
        createdAt: DateTime.makeUnsafe(0),
      },
    });
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Asks a question: "),
      expect.stringContaining("- Needs approval: "),
    ]);
    yield* step(shell(launched, "completed"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Asks a question: "),
      expect.stringContaining("- Needs approval: "),
      expect.stringContaining("- Finished: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a failed run still reports while awaited background work remains", () => {
  const launched = ThreadId.make("tot-launched:home:c8");
  const awaited: NonNullable<OrchestrationV2ThreadShell["pendingBackgroundTasks"]> = [
    { taskId: "shell-1", kind: "command", awaited: true },
  ];
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "failed", "run-1", awaited));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Failed: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("watching everything leaves another Tot's threads to that Tot", () => {
  const yuis = ThreadId.make("tot-launched:yui:c1");
  const plain = ThreadId.make("thread:plain");
  const { reports, layer, step, flush } = makeHarness([
    home({ watchAll: true, watchReports: "explicit" }),
    yui,
  ]);
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
    home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }),
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

it.effect("by default a Tot hears its launches and its sends, not threads it only watches", () => {
  const launched = ThreadId.make("tot-launched:home:c1");
  const asked = ThreadId.make("thread:asked");
  const { reports, layer, step, flush } = makeHarness([
    home({
      watches: [
        watch(launched, "launched"),
        watch(asked, "requested"),
        watch(yuiThread, "sent", "run-1"),
      ],
    }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-launched"));
    yield* step(shell(launched, "completed", "run-launched"));
    yield* step(shell(asked, "running", "run-asked"));
    yield* step(shell(asked, "completed", "run-asked"));
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining(launched),
      expect.stringContaining(yuiThread),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("watching everything by default counts only the threads this Tot launched", () => {
  const launched = ThreadId.make("tot-launched:home:c2");
  const anotherTots = ThreadId.make("tot-launched:yui:c1");
  const plain = ThreadId.make("thread:plain");
  const { reports, layer, step, flush } = makeHarness([home({ watchAll: true }), yui]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-launched"));
    yield* step(shell(launched, "completed", "run-launched"));
    yield* step(shell(anotherTots, "running", "run-other"));
    yield* step(shell(anotherTots, "completed", "run-other"));
    yield* step(shell(plain, "running", "run-plain"));
    yield* step(shell(plain, "completed", "run-plain"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([expect.stringContaining(launched)]);
  }).pipe(Effect.provide(layer));
});

it.effect("explicit watch reports cover launched, requested and sent watches", () => {
  const launched = ThreadId.make("tot-launched:home:c3");
  const asked = ThreadId.make("thread:asked");
  const { reports, layer, step, flush } = makeHarness([
    home({
      watchReports: "explicit",
      watches: [
        watch(launched, "launched"),
        watch(asked, "requested"),
        watch(yuiThread, "sent", "run-1"),
      ],
    }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-launched"));
    yield* step(shell(launched, "completed", "run-launched"));
    yield* step(shell(asked, "running", "run-asked"));
    yield* step(shell(asked, "completed", "run-asked"));
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining(launched),
      expect.stringContaining(asked),
      expect.stringContaining(yuiThread),
    ]);
  }).pipe(Effect.provide(layer));
});

const remoteThread = ThreadId.make("tot-launched:home:remote1");

const remoteRead = (
  pendingBackgroundTasks: ReadonlyArray<{ taskId: string; kind: "command" }> | undefined,
  text = "Remote work done.",
) =>
  ({
    thread: {
      activeRunId: null,
      ...(pendingBackgroundTasks === undefined ? {} : { pendingBackgroundTasks }),
    },
    recentRuns: [],
    items: [{ type: "assistant_message", runId: RunId.make("run-1"), text }],
    nextPosition: null,
    hasMore: false,
  }) as never;

const remoteCompleted: OrchestratorMcpThreadWaitResult = {
  threadId: remoteThread,
  runId: RunId.make("run-1"),
  status: "completed",
  timedOut: false,
};

const remoteWatch = (reason: TotWatch["reason"], runId?: string): TotWatch => ({
  environmentId: promini,
  threadId: remoteThread,
  reason,
  ...(runId === undefined ? {} : { runId: RunId.make(runId) }),
});

// regression: Yui's question to Work bot was answered in 16s and Yui was never woken.
it.effect("by default a Tot hears the answer to its own send into another Tot", () => {
  const { reports, removed, layer, step, flush, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  finalMessages.set("run-1", "It is on port 3000. Which build do you want?");
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain("Which build do you want?");
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect.each(["launched", "explicit"] as const)(
  "a sent run reports back in %s mode, and later runs there do not",
  (watchReports) => {
    const { reports, layer, step, flush } = makeHarness([
      home({ watchReports, watches: [watch(yuiThread, "sent", "run-1")] }),
      yui,
    ]);
    return Effect.gen(function* () {
      yield* step(shell(yuiThread, "running", "run-1"));
      yield* step(shell(yuiThread, "completed", "run-1"));
      yield* step(shell(yuiThread, "running", "run-2"));
      yield* step(shell(yuiThread, "completed", "run-2"));
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Finished: "),
      ]);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("a long answer says it was truncated and links the thread", () => {
  const { reports, layer, step, flush, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  finalMessages.set("run-1", `${"context ".repeat(200)}Which build do you want?`);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    const line = reports[0]!.lines[0]!;
    expect(line).toContain("truncated, open the thread for the rest");
    expect(line).toContain("Which build do you want?");
    expect(line).toContain(`t3-thread://`);
  }).pipe(Effect.provide(layer));
});

it.effect("a sent watch ending leaves the launched watch on the same thread", () => {
  const launched = ThreadId.make("tot-launched:home:both");
  const { state, reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(launched, "launched"), watch(launched, "sent", "run-2")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-2"));
    yield* step(shell(launched, "completed", "run-2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
    ]);
    expect(state.tots[0]!.watches).toEqual([watch(launched, "launched")]);
    yield* step(shell(launched, "running", "run-3"));
    yield* step(shell(launched, "completed", "run-3"));
    yield* flush;
    expect(reports).toHaveLength(2);
  }).pipe(Effect.provide(layer));
});

it.effect("a second send's watch survives the first run ending", () => {
  const { state, reports, layer, step, flush, setRun } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "run-1"), watch(yuiThread, "sent", "run-2")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    setRun(yuiThread, "run-1", {});
    setRun(yuiThread, "run-2", { status: "queued" });
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    expect(state.tots[0]!.watches).toEqual([watch(yuiThread, "sent", "run-2")]);
    yield* step(shell(yuiThread, "running", "run-2"));
    yield* step(shell(yuiThread, "completed", "run-2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toHaveLength(2);
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

it.effect("a report is still sent while the sender's own turn is running", () => {
  const { reports, shells, layer, step, flush } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    expect(shells.get(homeThread)!.status).toBe("running");
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    expect(reports.map((report) => report.totId)).toEqual(["home"]);
  }).pipe(Effect.provide(layer));
});

it.effect("a remote send into another Tot reports its answer back", () =>
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<void>();
    const remoteTot = ThreadId.make("tot:workbot:current");
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [
        home({
          watches: [
            {
              environmentId: promini,
              threadId: remoteTot,
              reason: "sent",
              runId: RunId.make("run-1"),
            },
          ],
        }),
      ],
      {
        waitForThread: () =>
          Effect.succeed({
            threadId: remoteTot,
            runId: RunId.make("run-1"),
            status: "completed",
            timedOut: false,
          }),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [],
            items: [
              { type: "assistant_message", runId: RunId.make("run-1"), text: "Yes. Which branch?" },
            ],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(ended);
      yield* flush;
      const lines = reports.flatMap((report) => report.lines);
      expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
      expect(lines[0]).toContain("`Yes. Which branch?`");
      expect(lines[0]).toContain(" on ProMini");
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote launched and sent watch on one run report it once", () =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("launched"), remoteWatch("sent", "run-1")] })],
      {
        waitForThread: () => Effect.succeed({ ...remoteCompleted }),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
        pause: Effect.never,
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* Queue.take(removals);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Finished: "),
      ]);
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("events interleaved with a queued run still report the sent run's real end", () => {
  const target = ThreadId.make("tot:yui:interleaved");
  const { reports, state, removed, shells, layer, emit, flush, setRun, finalMessages } =
    makeHarness([
      home({ watches: [watch(target, "sent", "r1")] }),
      { ...yui, threadId: ThreadId.make("tot:yui:other") },
    ]);
  finalMessages.set("r1", "Answer to Home.");
  finalMessages.set("r2", "Answer to someone else.");
  return Effect.gen(function* () {
    yield* (yield* TotWatchService.TotWatchService).start;
    shells.set(target, shell(target, "running", "r1"));
    yield* emit(runUpdated(target, "r1", "running"));
    // Someone queues r2 while r1 is still working, so the shell now presents r2.
    shells.set(target, shell(target, "queued", "r2"));
    setRun(target, "r2", { status: "queued" });
    yield* emit(runUpdated(target, "r2", "queued"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(removed).toEqual([]);
    // r1 ends and r2 starts in the same burst of events.
    setRun(target, "r1", { status: "completed" });
    shells.set(target, shell(target, "running", "r2"));
    yield* emit(runUpdated(target, "r1", "completed"), runUpdated(target, "r2", "running"));
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain("`Answer to Home.`");
    expect(state.tots[0]!.watches).toEqual([]);
    shells.set(target, shell(target, "completed", "r2"));
    yield* emit(runUpdated(target, "r2", "completed"));
    yield* flush;
    expect(reports).toHaveLength(1);
  }).pipe(Effect.provide(layer), Effect.scoped);
});

it.effect("two queued sends each report their own run once", () => {
  const { reports, state, layer, step, flush, setRun, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1"), watch(yuiThread, "sent", "r2")] }),
    yui,
  ]);
  finalMessages.set("r1", "First answer.");
  finalMessages.set("r2", "Second answer.");
  return Effect.gen(function* () {
    setRun(yuiThread, "r1", {});
    setRun(yuiThread, "r2", { status: "queued" });
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "queued", "r2"));
    expect(state.tots[0]!.watches).toHaveLength(2);
    setRun(yuiThread, "r1", { status: "completed" });
    yield* step(shell(yuiThread, "running", "r2"));
    yield* step(shell(yuiThread, "completed", "r2"));
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([
      expect.stringContaining("`First answer.`"),
      expect.stringContaining("`Second answer.`"),
    ]);
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

it.effect("a wake saying the command finished keeps following the sent run", () => {
  const { reports, state, layer, step, flush, setRun, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  finalMessages.set("r2", "Build passed.");
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "completed", "r1", liveCommand));
    setRun(yuiThread, "r2", { status: "running", wake: "completed" });
    yield* step(shell(yuiThread, "running", "r2"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches[0]!.runId).toBe("r2");
    yield* step(shell(yuiThread, "completed", "r2"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("`Build passed.`")]);
  }).pipe(Effect.provide(layer));
});

// regression (review #3): a restart loses the previous state, not the unreported watch.
it.effect("a sent run first seen stopped after a restart reports Stopped", () => {
  const { reports, state, layer, step, flush } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "interrupted", "r1"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Stopped"),
    ]);
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

// regression (review #6)
it.effect("a later run during the wake grace reports Finished, not Still working", () => {
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "completed", "r1", liveCommand));
    yield* step(shell(yuiThread, "completed", "r1"));
    yield* step(shell(yuiThread, "running", "r2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Finished: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a report names the threads it came from", () => {
  const { reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "completed", "r1"));
    yield* flush;
    expect(reports[0]!.sources).toEqual([{ environmentId, threadId: yuiThread }]);
  }).pipe(Effect.provide(layer));
});

// regression (review #2): a requested watch took the thread's one follower.
it.effect("a remote thread already watched still reports the Tot's own send", () =>
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("requested"), remoteWatch("sent", "run-1")] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () => Effect.succeed(remoteRead([], "The reply.")),
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
        pause: Queue.offer(ended, undefined).pipe(Effect.andThen(Effect.never)),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(ended);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("`The reply.`"),
      ]);
      expect(state.tots[0]!.watches).toEqual([remoteWatch("requested")]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a queued remote run with no message yet is not mistaken for a wake", () =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "run-1")] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [{ runId: RunId.make("run-2"), status: "queued" }],
            items: [{ type: "assistant_message", runId: RunId.make("run-1"), text: "Mine." }],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("`Mine.`"),
      ]);
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

// regression (re-review B1, S1): a later run with no visible prompt is not evidence of a wake.
it.effect.each([
  { name: "a run cancelled by send-now", status: "cancelled" },
  { name: "a person's run whose prompt left the page", status: "completed" },
])("a remote sent run keeps its own result past $name", ({ status }) =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "run-1")] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [{ runId: RunId.make("run-2"), status }],
            items: [{ type: "assistant_message", runId: RunId.make("run-1"), text: "Mine." }],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* flush;
      const lines = reports.flatMap((report) => report.lines);
      expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
      expect(lines[0]).toContain("`Mine.`");
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote sent watch moves only when the peer names the wake run", () =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const asked: Array<string | undefined> = [];
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "run-1")] })],
      {
        waitForThread: (_scope, _environment, input) =>
          Effect.sync(() => {
            asked.push(input.runId);
            return input.runId === "run-1"
              ? { ...remoteCompleted, continuedByRunId: RunId.make("run-2") }
              : { ...remoteCompleted, runId: RunId.make("run-2") };
          }),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [],
            items: [{ type: "assistant_message", runId: RunId.make("run-2"), text: "Woken end." }],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
        pause: Effect.void,
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* flush;
      expect(asked.slice(0, 2)).toEqual(["run-1", "run-2"]);
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("`Woken end.`"),
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

// regression (re-review S2): the event stream starts at the latest sequence.
it.effect("the startup pass reports a sent run that ended while the server was down, once", () => {
  const launched = ThreadId.make("tot-launched:home:old");
  const { state, reports, shells, layer, flush, recoverSentWatches } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1"), watch(launched, "launched")] }),
    yui,
  ]);
  shells.set(yuiThread, shell(yuiThread, "interrupted", "r1"));
  shells.set(launched, shell(launched, "completed", "old"));
  return Effect.gen(function* () {
    yield* recoverSentWatches;
    yield* recoverSentWatches;
    yield* flush;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.lines).toEqual([expect.stringContaining("- Stopped")]);
    expect(state.tots[0]!.watches).toEqual([watch(launched, "launched")]);
  }).pipe(Effect.provide(layer));
});

it.effect("the startup pass batches several Tot reports into one wake", () => {
  const second = ThreadId.make("tot:other:current");
  const { reports, shells, layer, flush, recoverSentWatches } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1"), watch(second, "sent", "r2")] }),
    yui,
  ]);
  shells.set(yuiThread, shell(yuiThread, "completed", "r1"));
  shells.set(second, shell(second, "failed", "r2"));
  return Effect.gen(function* () {
    yield* recoverSentWatches;
    yield* flush;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.lines).toHaveLength(2);
  }).pipe(Effect.provide(layer));
});

it.effect("the startup pass leaves a run a restart may still continue", () => {
  const { state, reports, shells, layer, flush, recoverSentWatches, pendingContinuations } =
    makeHarness([home({ watches: [watch(yuiThread, "sent", "r1")] }), yui]);
  shells.set(yuiThread, shell(yuiThread, "cancelled", "r1"));
  pendingContinuations.add("r1");
  return Effect.gen(function* () {
    yield* recoverSentWatches;
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

// regression (re-review N1)
it.effect("a watch moved onto a run that already has one reports that run once", () => {
  const { state, reports, layer, step, flush, setRun } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1"), watch(yuiThread, "sent", "r2")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    setRun(yuiThread, "r1", { status: "completed" });
    setRun(yuiThread, "r2", { status: "completed", wake: "completed" });
    yield* step(shell(yuiThread, "completed", "r2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toHaveLength(1);
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

// regression (final check 1): Send now cancels the queued run and moves its message.
it.effect("a sent run absorbed by Send now reports the absorbing run's end", () => {
  const { state, reports, layer, step, flush, setRun, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r2")] }),
    yui,
  ]);
  finalMessages.set("r1", "Handled both messages.");
  return Effect.gen(function* () {
    setRun(yuiThread, "r1", {});
    setRun(yuiThread, "r2", { status: "queued" });
    yield* step(shell(yuiThread, "running", "r1"));
    setRun(yuiThread, "r2", {
      status: "cancelled",
      neverStarted: true,
      absorbedBy: RunId.make("r1"),
    });
    yield* step(shell(yuiThread, "running", "r1"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches[0]!.runId).toBe("r1");
    yield* step(shell(yuiThread, "completed", "r1"));
    yield* flush;
    const lines = reports.flatMap((report) => report.lines);
    expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
    expect(lines[0]).toContain("`Handled both messages.`");
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

it.effect("a queued sent run cancelled with no absorbing run reports it ended unseen", () => {
  const { state, reports, layer, step, flush, setRun } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r2")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    setRun(yuiThread, "r1", {});
    setRun(yuiThread, "r2", { status: "cancelled", neverStarted: true });
    yield* step(shell(yuiThread, "running", "r1"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Ended unseen: "),
    ]);
    expect(state.tots[0]!.watches).toEqual([]);
  }).pipe(Effect.provide(layer));
});

// regression (final check 2): a cancelled queued run sat between the run and its wake.
it.effect("a wake after a run cancelled before it started is still followed", () => {
  const { state, reports, layer, step, flush, setRun, finalMessages } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  finalMessages.set("r3", "Checks passed.");
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "completed", "r1", liveCommand));
    setRun(yuiThread, "r2", { status: "cancelled", neverStarted: true });
    setRun(yuiThread, "r3", { status: "running", wake: "completed" });
    yield* step(shell(yuiThread, "running", "r3"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches[0]!.runId).toBe("r3");
    yield* step(shell(yuiThread, "completed", "r3"));
    yield* TestClock.adjust("10 seconds");
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("`Checks passed.`"),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a remote sent run absorbed by Send now follows the run the peer names", () =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "r2")] })],
      {
        waitForThread: (_scope, _environment, input) =>
          Effect.succeed(
            input.runId === "r2"
              ? {
                  ...remoteCompleted,
                  runId: RunId.make("r2"),
                  status: "cancelled" as const,
                  continuedByRunId: RunId.make("r1"),
                }
              : { ...remoteCompleted, runId: RunId.make("r1") },
          ),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [],
            items: [{ type: "assistant_message", runId: RunId.make("r1"), text: "Both done." }],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
        pause: Effect.void,
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("`Both done.`"),
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect.each([
  { name: "never started", startedAt: null, line: "- Ended unseen: " },
  { name: "had started", startedAt: "2026-11-23T00:00:00.000Z", line: "- Stopped" },
])("an older peer's cancelled sent run that $name reports honestly", ({ startedAt, line }) =>
  Effect.gen(function* () {
    const removals = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "r2")] })],
      {
        waitForThread: () =>
          Effect.succeed({
            ...remoteCompleted,
            runId: RunId.make("r2"),
            status: "cancelled" as const,
          }),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [{ runId: RunId.make("r2"), status: "cancelled", startedAt }],
            items: [],
            nextPosition: null,
            hasMore: false,
          } as never),
        onRemove: Queue.offer(removals, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(removals);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([expect.stringContaining(line)]);
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

// regression (review #4): the link dropped while r1 and then r2 finished.
it.effect("a remote sent run that ended out of sight still reports its own outcome", () =>
  Effect.gen(function* () {
    const settled = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "r1")] })],
      {
        waitForThread: (_scope, _environment, input) =>
          Effect.succeed({
            ...remoteCompleted,
            runId: RunId.make(input.runId ?? "r2"),
            status: input.runId === undefined ? "completed" : "failed",
          }),
        readThread: () => Effect.succeed(remoteRead([])),
        onRemove: Queue.offer(settled, undefined).pipe(Effect.asVoid),
        pause: Queue.offer(settled, undefined).pipe(Effect.andThen(Effect.never)),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(settled);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Failed: "),
      ]);
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote sent run the peer no longer knows reports that it ended unseen", () =>
  Effect.gen(function* () {
    const settled = yield* Queue.unbounded<void>();
    const { state, reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [remoteWatch("sent", "r1")] })],
      {
        waitForThread: (_scope, _environment, input) =>
          input.runId === undefined
            ? Effect.succeed({ ...remoteCompleted, runId: RunId.make("r2") })
            : Effect.fail(new OrchestratorMcpFailure({ code: "run_not_found", message: "Gone." })),
        onRemove: Queue.offer(settled, undefined).pipe(Effect.asVoid),
        pause: Queue.offer(settled, undefined).pipe(Effect.andThen(Effect.never)),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(settled);
      yield* flush;
      const lines = reports.flatMap((report) => report.lines);
      expect(lines).toEqual([expect.stringContaining("- Ended unseen: ")]);
      expect(lines[0]).toContain("t3-thread://");
      expect(state.tots[0]!.watches).toEqual([]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("watch reports off delivers nothing and keeps the watches", () => {
  const launched = ThreadId.make("tot-launched:home:c4");
  const asked = ThreadId.make("thread:asked");
  const { state, reports, layer, step, flush } = makeHarness([
    home({
      watchReports: "off",
      watchAll: true,
      watches: [
        watch(launched, "launched"),
        watch(asked, "requested"),
        watch(yuiThread, "sent", "run-1"),
      ],
    }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-launched"));
    yield* step(shell(launched, "completed", "run-launched"));
    yield* step(shell(asked, "running", "run-asked"));
    yield* step(shell(asked, "completed", "run-asked"));
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "completed", "run-1"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches).toHaveLength(3);
  }).pipe(Effect.provide(layer));
});

it.effect("switching watch reports on resumes a stored watch", () => {
  const asked = ThreadId.make("thread:asked");
  const { state, reports, layer, step, flush } = makeHarness([
    home({ watches: [watch(asked, "requested")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(asked, "running", "run-1"));
    yield* step(shell(asked, "completed", "run-1"));
    yield* flush;
    expect(reports).toHaveLength(0);
    expect(state.tots[0]!.watches).toHaveLength(1);
    state.tots = [home({ watchReports: "explicit", watches: [watch(asked, "requested")] }), yui];
    yield* step(shell(asked, "running", "run-2"));
    yield* step(shell(asked, "completed", "run-2"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([expect.stringContaining(asked)]);
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

it.effect("a second approval in the same remote run is reported too", () =>
  Effect.gen(function* () {
    const paused = yield* Queue.unbounded<void>();
    const resume = yield* Queue.unbounded<void>();
    const answers: Array<OrchestratorMcpThreadWaitResult> = ["q1", "q2"].map((requestId) => ({
      threadId: remoteThread,
      runId: RunId.make("run-1"),
      status: "waiting" as const,
      timedOut: false,
      attention: "approval" as const,
      attentionRequestId: RuntimeRequestId.make(requestId),
    }));
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () => {
          const next = answers.shift();
          return next === undefined ? Effect.never : Effect.succeed(next);
        },
        pause: Queue.offer(paused, undefined).pipe(Effect.andThen(Queue.take(resume))),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(paused);
      yield* Queue.offer(resume, undefined);
      yield* Queue.take(paused);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Needs approval: "),
        expect.stringContaining("- Needs approval: "),
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote launch's watch ends once its run is over", () =>
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<void>();
    const { state, reports, removed, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () =>
          Effect.succeed({
            threadId: remoteThread,
            runId: RunId.make("run-1"),
            status: "completed",
            timedOut: false,
          }),
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(ended);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Finished: "),
      ]);
      expect(removed).toEqual([remoteThread]);
      expect(state.tots[0]!.watches).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a fresh start moves remote followers to the new Tot thread", () =>
  Effect.gen(function* () {
    const callers = yield* Queue.unbounded<string>();
    const { state, layer, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: (scope) =>
          Queue.offer(callers, scope.thread?.threadId ?? "none").pipe(Effect.andThen(Effect.never)),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      expect(yield* Queue.take(callers)).toBe("tot:home:current");
      state.tots = [
        home({
          threadId: ThreadId.make("tot:home:fresh"),
          watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }],
        }),
      ];
      yield* syncFollowers;
      expect(yield* Queue.take(callers)).toBe("tot:home:fresh");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a run a Tot started that is stopped reports it and ends the watch", () => {
  const { reports, removed, layer, step, flush } = makeHarness([
    home({ watchReports: "explicit", watches: [watch(yuiThread, "sent", "run-1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "run-1"));
    yield* step(shell(yuiThread, "interrupted", "run-1"));
    yield* flush;
    expect(reports.flatMap((report) => report.lines)).toEqual([
      expect.stringContaining("- Stopped: "),
    ]);
    expect(removed).toEqual([yuiThread]);
  }).pipe(Effect.provide(layer));
});

it.effect("a remote run with live background work holds until the work ends", () =>
  Effect.gen(function* () {
    const paused = yield* Queue.unbounded<void>();
    const resume = yield* Queue.unbounded<void>();
    const reads = [
      remoteRead([{ taskId: "shell-1", kind: "command" }]),
      remoteRead([]),
      remoteRead([]),
      remoteRead([]),
    ];
    const ended = yield* Queue.unbounded<void>();
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () => Effect.succeed(reads.length > 1 ? reads.shift()! : reads[0]!),
        pause: Queue.offer(paused, undefined).pipe(Effect.andThen(Queue.take(resume))),
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(paused);
      yield* flush;
      expect(reports).toHaveLength(0);
      yield* Queue.offer(resume, undefined);
      yield* Queue.take(paused);
      yield* flush;
      expect(reports).toHaveLength(0);
      yield* Queue.offer(resume, undefined);
      yield* Queue.take(ended);
      yield* flush;
      const lines = reports.flatMap((report) => report.lines);
      expect(lines).toEqual([expect.stringContaining("- Finished: ")]);
      expect(lines[0]).toContain("`Remote work done.`");
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote run still working after 30 minutes checks in once", () =>
  Effect.gen(function* () {
    const paused = yield* Queue.unbounded<void>();
    const resume = yield* Queue.unbounded<void>();
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () => Effect.succeed(remoteRead([{ taskId: "shell-1", kind: "command" }])),
        pause: Queue.offer(paused, undefined).pipe(Effect.andThen(Queue.take(resume))),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(paused);
      yield* TestClock.adjust("31 minutes");
      for (let look = 0; look < 3; look += 1) {
        yield* Queue.offer(resume, undefined);
        yield* Queue.take(paused);
      }
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Still working (1 background task): "),
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("an older remote without a task list still reports its run", () =>
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<void>();
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [home({ watches: [{ environmentId: promini, threadId: remoteThread, reason: "launched" }] })],
      {
        waitForThread: () => Effect.succeed(remoteCompleted),
        readThread: () => Effect.succeed(remoteRead(undefined)),
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(ended);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Finished: "),
      ]);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("a remote sent watch follows the run that continues it to its real end", () =>
  Effect.gen(function* () {
    const ended = yield* Queue.unbounded<void>();
    const waits: Array<OrchestratorMcpThreadWaitResult> = [
      { ...remoteCompleted, status: "cancelled", timedOut: true },
      { ...remoteCompleted, runId: RunId.make("run-2") },
    ];
    const { state, reports, removed, layer, flush, syncFollowers } = makeHarness(
      [
        home({
          watchReports: "explicit",
          watches: [
            {
              environmentId: promini,
              threadId: remoteThread,
              reason: "sent",
              runId: RunId.make("run-1"),
            },
          ],
        }),
      ],
      {
        waitForThread: () => Effect.succeed(waits.length > 1 ? waits.shift()! : waits[0]!),
        readThread: () => Effect.succeed(remoteRead([])),
        pause: Effect.void,
        onRemove: Queue.offer(ended, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      yield* Queue.take(ended);
      yield* flush;
      expect(reports.flatMap((report) => report.lines)).toEqual([
        expect.stringContaining("- Finished: "),
      ]);
      expect(removed).toEqual([remoteThread]);
      expect(state.tots[0]!.watches).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  }),
);

const lines = (reports: ReadonlyArray<{ readonly lines: ReadonlyArray<string> }>) =>
  reports.flatMap((report) => report.lines);

it.effect("routine Finished reports wait out the batch window and arrive as one wake", () => {
  const first = ThreadId.make("tot-launched:home:batch1");
  const second = ThreadId.make("tot-launched:home:batch2");
  const { reports, layer, step, flushDue } = makeHarness([
    home({ watches: [watch(first, "launched"), watch(second, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(first, "running"));
    yield* step(shell(second, "running"));
    yield* step(shell(first, "completed"));
    yield* flushDue;
    expect(reports).toHaveLength(0);
    yield* TestClock.adjust("2 minutes");
    yield* step(shell(second, "completed"));
    yield* flushDue;
    expect(reports).toHaveLength(0);
    yield* TestClock.adjust("1 minute");
    yield* flushDue;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.lines).toEqual([
      expect.stringContaining(`- Finished: [`),
      expect.stringContaining(`- Finished: [`),
    ]);
    expect(reports[0]!.sources).toEqual([
      { environmentId, threadId: first },
      { environmentId, threadId: second },
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("urgent news is sent at once and carries the waiting Finished reports with it", () => {
  const done = ThreadId.make("tot-launched:home:done");
  const broken = ThreadId.make("tot-launched:home:broken");
  const { reports, layer, step, flushDue } = makeHarness([
    home({ watches: [watch(done, "launched"), watch(broken, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(done, "running"));
    yield* step(shell(broken, "running"));
    yield* step(shell(done, "completed"));
    yield* flushDue;
    expect(reports).toHaveLength(0);
    yield* step(shell(broken, "failed"));
    yield* flushDue;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.lines).toEqual([
      expect.stringContaining("- Finished: "),
      expect.stringContaining("- Failed: "),
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a zero batch window sends Finished reports at the next look", () => {
  const launched = ThreadId.make("tot-launched:home:nowait");
  const { reports, settings, layer, step, flushDue } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  settings.totReportBatchSeconds = 0;
  return Effect.gen(function* () {
    yield* step(shell(launched, "running"));
    yield* step(shell(launched, "completed"));
    yield* flushDue;
    expect(lines(reports)).toEqual([expect.stringContaining("- Finished: ")]);
  }).pipe(Effect.provide(layer));
});

it.effect("a Tot's batched report on another Tot still names its source for the loop guard", () => {
  const { reports, layer, step, flushDue } = makeHarness([
    home({ watches: [watch(yuiThread, "sent", "r1")] }),
    yui,
  ]);
  return Effect.gen(function* () {
    yield* step(shell(yuiThread, "running", "r1"));
    yield* step(shell(yuiThread, "completed", "r1"));
    yield* TestClock.adjust("3 minutes");
    yield* flushDue;
    expect(reports).toHaveLength(1);
    expect(reports[0]!.sources).toEqual([{ environmentId, threadId: yuiThread }]);
  }).pipe(Effect.provide(layer));
});

const personMessage = (threadId: ThreadId, id: string, text: string, createdBy = "user") =>
  domainEvent("message.updated", threadId, { id, role: "user", createdBy, text });

it.effect(
  "the user's message in a launched thread rides with the next report, with no wake",
  () => {
    const launched = ThreadId.make("tot-launched:home:steered");
    const { reports, shells, layer, emit, flush } = makeHarness([
      home({ watches: [watch(launched, "launched")] }),
    ]);
    return Effect.gen(function* () {
      yield* (yield* TotWatchService.TotWatchService).start;
      shells.set(launched, shell(launched, "running"));
      yield* emit(runUpdated(launched, "run-1", "running"));
      yield* emit(
        personMessage(launched, "m-person", "Use the staging database instead"),
        personMessage(launched, "m-person", "Use the staging database instead"),
        personMessage(launched, "m-tot", "Not a person", "agent"),
      );
      yield* flush;
      expect(reports).toHaveLength(0);
      shells.set(launched, shell(launched, "completed"));
      yield* emit(runUpdated(launched, "run-1", "completed"));
      yield* flush;
      expect(lines(reports)).toEqual([
        expect.stringContaining("- Finished: "),
        "  - The user wrote here (untrusted thread text): `Use the staging database instead`",
      ]);
    }).pipe(Effect.provide(layer), Effect.scoped);
  },
);

it.effect("a run the user started in a launched thread is noted, not reported as the Tot's", () => {
  const launched = ThreadId.make("tot-launched:home:userrun");
  const { reports, layer, step, flush, setRun } = makeHarness([
    home({ watches: [watch(launched, "launched")] }),
  ]);
  return Effect.gen(function* () {
    yield* step(shell(launched, "running", "run-1"));
    yield* step(shell(launched, "completed", "run-1"));
    yield* flush;
    expect(lines(reports)).toEqual([expect.stringContaining("- Finished: ")]);
    setRun(launched, "run-2", { byPerson: true });
    yield* step(shell(launched, "running", "run-2"));
    yield* step(shell(launched, "completed", "run-2"));
    yield* flush;
    // The user's own run wakes no one; it waits for the Tot's next report on this thread.
    expect(reports).toHaveLength(1);
    setRun(launched, "run-3", {});
    yield* step(shell(launched, "running", "run-3"));
    yield* step(shell(launched, "failed", "run-3"));
    yield* flush;
    expect(lines(reports).slice(1)).toEqual([
      expect.stringContaining("- Failed: "),
      "  - The user started runs here themselves, not you: Finished.",
    ]);
  }).pipe(Effect.provide(layer));
});

it.effect("a remote launched thread notes the user's messages and runs the same way", () =>
  Effect.gen(function* () {
    const looked = yield* Queue.unbounded<void>();
    let wait = 0;
    const userItem = (runId: string, messageId: string, createdBy: string, text: string) => ({
      type: "user_message",
      runId: RunId.make(runId),
      messageId,
      createdBy,
      text,
      updatedAt: "1970-01-01T00:00:01.000Z",
    });
    const { reports, layer, flush, syncFollowers } = makeHarness(
      [
        home({
          watches: [remoteWatch("launched"), remoteWatch("requested")],
          watchReports: "explicit",
        }),
      ],
      {
        waitForThread: () =>
          Effect.sync(() => {
            wait++;
            return { ...remoteCompleted, runId: RunId.make(wait === 1 ? "run-1" : "run-2") };
          }),
        readThread: () =>
          Effect.succeed({
            thread: { activeRunId: null, pendingBackgroundTasks: [] },
            recentRuns: [],
            items: [
              userItem("run-1", "m1", "user", "Try the other port"),
              { type: "assistant_message", runId: RunId.make("run-1"), text: "On it." },
              userItem("run-2", "m2", "agent", "Tot's follow-up"),
              { type: "assistant_message", runId: RunId.make("run-2"), text: "Done." },
            ],
            nextPosition: null,
            hasMore: false,
          } as never),
        pause: Queue.offer(looked, undefined).pipe(Effect.asVoid),
      },
    );
    yield* Effect.gen(function* () {
      yield* syncFollowers;
      // The user's own run-1 is not reported; the Tot's run-2 carries the note.
      yield* Queue.take(looked);
      yield* flush;
      expect(lines(reports)).toEqual([
        expect.stringContaining("`Done.`"),
        "  - The user wrote here (untrusted thread text): `Try the other port`",
        "  - The user started runs here themselves, not you: Finished.",
      ]);
    }).pipe(Effect.provide(layer));
  }),
);
