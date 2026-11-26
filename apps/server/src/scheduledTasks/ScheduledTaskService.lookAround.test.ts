import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  LOOK_AROUND_OUTPUT_SCHEMA,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  TotId,
  lookAroundThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as UsageLimitFallback from "../orchestration-v2/UsageLimitFallback.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledRunAlerts from "./ScheduledRunAlerts.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const projectId = ProjectId.make("project:tot-ci");
const taskId = ScheduledTaskId.make("task:look-around");
const sweepThread = lookAroundThreadId(taskId);
const codex: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };

const sweep = {
  id: taskId,
  title: "Look around",
  prompt: "Check CI on the fork and stale PRs.",
  enabled: true,
  schedule: { type: "interval" as const, everyMs: 4 * 60 * 60 * 1000 },
  projectId,
  readOnly: true,
  workspaceStrategy: { type: "root" as const },
  modelSelection: codex,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  createdByTotId: TotId.make("ci-sitter"),
};

/** A sweep thread whose run completes having submitted `output`, or nothing when undefined. */
const harness = (output: unknown) =>
  Effect.gen(function* () {
    const launched = yield* Ref.make<Array<ThreadLaunch.ThreadLaunchInput>>([]);
    const attention = yield* Ref.make<Array<ScheduledRunAlerts.LookAroundAttention>>([]);
    const failures = yield* Ref.make<Array<ScheduledRunAlerts.ScheduledRunFailure>>([]);
    const reported = yield* Deferred.make<void>();
    const runs = Effect.map(Ref.get(launched), (all) =>
      all.map((launch, index) => ({
        id: `run:${index + 1}`,
        status: "completed",
        rootNodeId: `node:${index + 1}`,
        userMessageId: launch.initialMessage?.messageId,
        ...(output === undefined
          ? {}
          : { output: { value: output, submittedAt: "2026-11-25T13:00:00.000Z" } }),
      })),
    );
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: (launch) =>
              Ref.update(launched, (all) => [...all, launch]).pipe(
                Effect.as({ threadId: launch.threadId ?? ThreadId.make("thread:other") } as never),
              ),
            isNonGitProject: () => Effect.succeed(false),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () =>
              Effect.succeed({
                projectId,
                archivedAt: null,
                deletedAt: null,
                modelSelection: codex,
              } as never),
            getProjectThreadRecords: () => Effect.map(runs, (all) => ({ runs: all }) as never),
            waitForThread: (wait) =>
              Effect.map(runs, (all) => ({
                threadId: wait.threadId,
                run: all.find((run) => run.id === wait.runId),
                timedOut: false,
              })) as never,
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          Layer.succeed(UsageLimitFallback.UsageLimitFallback, {
            retry: () => Effect.succeed(null),
            retryOnAccount: () => Effect.die("unused"),
          }),
          Layer.succeed(ScheduledRunAlerts.ScheduledRunAlerts, {
            notifyFailure: (failure) => Ref.update(failures, (all) => [...all, failure]),
            notifySweepAttention: (found) =>
              Ref.update(attention, (all) => [...all, found]).pipe(
                Effect.andThen(Deferred.succeed(reported, undefined)),
              ),
          }),
          NodeCrypto.layer,
          Scheduler.layer,
        ),
      ),
    );
    return { layer, launched, attention, failures, reported };
  });

const recordedSweep = Effect.gen(function* () {
  const service = yield* ScheduledTaskService.ScheduledTaskService;
  const recorded = yield* service.subscribeList().pipe(
    Stream.map(({ tasks }) => tasks.find((task) => task.id === taskId)),
    Stream.filter((task) => task?.lastSweep !== undefined),
    Stream.runHead,
  );
  if (recorded._tag === "None" || recorded.value === undefined) {
    return yield* Effect.die("The sweep was never recorded.");
  }
  return recorded.value;
});

it.effect("a sweep runs read-only in its own thread and asks for a structured result", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-25T13:00:00.000Z"));
    const { layer, launched } = yield* harness({ status: "ok", findings: [] });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(sweep);
      assert.isTrue(task.readOnly);
      assert.equal(task.threadMode, "fresh_session");
      yield* service.runNow({ id: taskId });
      yield* recordedSweep;
      const [launch] = yield* Ref.get(launched);
      assert.equal(launch?.threadId, sweepThread);
      assert.equal(launch?.runtimeMode, "approval-required");
      assert.deepEqual(launch?.initialMessage?.outputSchema, LOOK_AROUND_OUTPUT_SCHEMA);
      assert.include(launch?.initialMessage?.text, sweep.prompt);
      assert.include(launch?.initialMessage?.text, "read-only");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("an ok sweep records the time and posts nothing", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-25T13:00:00.000Z"));
    const { layer, attention, failures } = yield* harness({ status: "ok", findings: [] });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(sweep);
      yield* service.runNow({ id: taskId });
      const task = yield* recordedSweep;
      assert.deepEqual(task.lastSweep, {
        at: "2026-11-25T13:00:00.000Z",
        status: "ok",
        findings: [],
      });
      assert.equal(task.threadId, sweepThread);
      assert.deepEqual(yield* Ref.get(attention), []);
      assert.deepEqual(yield* Ref.get(failures), []);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a sweep that needs attention tells its Tot what it found", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-25T13:00:00.000Z"));
    const findings = ["custom-nightly failed on the macOS job", "PR #101 has waited 6 days"];
    const { layer, attention, reported } = yield* harness({ status: "attention", findings });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(sweep);
      yield* service.runNow({ id: taskId });
      yield* Deferred.await(reported);
      const [found] = yield* Ref.get(attention);
      assert.deepInclude(found, {
        taskId,
        title: sweep.title,
        ownerTotId: TotId.make("ci-sitter"),
        findings,
        threadId: sweepThread,
      });
      const task = (yield* service.list()).tasks[0];
      assert.equal(task?.lastSweep?.status, "attention");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a sweep that hands back no result asks for attention rather than staying quiet", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-25T13:00:00.000Z"));
    const { layer, attention, reported } = yield* harness(undefined);
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(sweep);
      yield* service.runNow({ id: taskId });
      yield* Deferred.await(reported);
      assert.deepEqual(
        (yield* Ref.get(attention)).map((found) => found.findings),
        [["The sweep finished without a result."]],
      );
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a sweep cannot be bound to another thread", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-25T13:00:00.000Z"));
    const { layer } = yield* harness(undefined);
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const refused = yield* service
        .upsert({ ...sweep, threadId: ThreadId.make("tot:ci-sitter:1") })
        .pipe(Effect.flip);
      assert.include(refused.message, "its own read-only thread");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
