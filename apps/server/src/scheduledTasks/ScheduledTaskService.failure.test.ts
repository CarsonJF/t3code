import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  TotId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

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

const projectId = ProjectId.make("project:test");
const boundThread = ThreadId.make("thread:bound");
const glm: ModelSelection = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "opencode-go/glm-5.3",
};
const flash: ModelSelection = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "opencode-go/hy4-flash-free",
};
const fallbackMessageId = MessageId.make("usage-limit-fallback:retry");

type RunStatus = "completed" | "failed";

/**
 * A bound thread whose first run ends with `first`; a fallback retry, when the fake
 * fallback starts one, ends with `retry`.
 */
const harness = (input: {
  readonly first: RunStatus;
  readonly retry: RunStatus | null;
  readonly threadModel?: ModelSelection;
}) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make("");
    const retries = yield* Ref.make<Array<UsageLimitFallback.UsageLimitFallbackInput>>([]);
    const notices = yield* Ref.make<Array<ScheduledRunAlerts.ScheduledRunFailure>>([]);
    const settled = yield* Deferred.make<void>();
    const runs = (userMessageId: string) => [
      { id: "run:1", status: input.first, rootNodeId: "node:1", userMessageId },
      ...(input.retry === null
        ? []
        : [
            {
              id: "run:2",
              status: input.retry,
              rootNodeId: "node:2",
              userMessageId: fallbackMessageId,
            },
          ]),
    ];
    const limitError = (runId: string, nodeId: string) => ({
      id: `item:${runId}`,
      type: "error",
      status: "failed",
      runId,
      nodeId,
      ordinal: 1,
      updatedAt: DateTime.makeUnsafe("2026-11-01T07:01:00.000Z"),
      failure: { class: "usage_limit", message: "OpenCode Go weekly usage limit reached." },
    });
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            sendToThread: (send) => Ref.set(sent, send.messageId).pipe(Effect.as({} as never)),
            getThreadShell: () =>
              Effect.succeed({
                projectId,
                archivedAt: null,
                deletedAt: null,
                modelSelection: input.threadModel ?? glm,
              } as never),
            getProjectThreadRecords: (_thread, fields) =>
              Effect.map(Ref.get(sent), (userMessageId) =>
                (fields as ReadonlyArray<string>).includes("runs")
                  ? ({ runs: runs(userMessageId) } as never)
                  : ({
                      turnItems: [limitError("run:1", "node:1"), limitError("run:2", "node:2")],
                      messages: [
                        { id: userMessageId, runId: "run:1" },
                        { id: fallbackMessageId, runId: "run:2" },
                      ],
                    } as never),
              ),
            waitForThread: (wait) =>
              Effect.map(Ref.get(sent), (userMessageId) => ({
                threadId: wait.threadId,
                run: runs(userMessageId).find((run) => run.id === wait.runId),
                timedOut: false,
              })) as never,
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          Layer.succeed(UsageLimitFallback.UsageLimitFallback, {
            retry: (retry) =>
              Ref.update(retries, (all) => [...all, retry]).pipe(
                Effect.as(
                  input.retry === null ? null : { messageId: fallbackMessageId, model: flash },
                ),
              ),
            retryOnAccount: () => Effect.die("unused"),
          }),
          Layer.succeed(ScheduledRunAlerts.ScheduledRunAlerts, {
            notifyFailure: (failure) =>
              Ref.update(notices, (all) => [...all, failure]).pipe(
                Effect.andThen(Deferred.succeed(settled, undefined)),
              ),
            notifySweepAttention: () => Effect.void,
          }),
          NodeCrypto.layer,
          Scheduler.layer,
        ),
      ),
    );
    return { layer, retries, notices, settled };
  });

const onceTask = {
  id: ScheduledTaskId.make("task:reminder"),
  title: "Tot conversations design",
  prompt: "Remind me about the design",
  enabled: true,
  schedule: { type: "once" as const, runAt: "2026-11-01T07:01:00.000Z" },
  projectId,
  threadId: boundThread,
  workspaceStrategy: { type: "root" as const },
  modelSelection: glm,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  createdByTotId: TotId.make("yui"),
};

it.effect("a one-time task that hit a usage limit is retried once on the fallback", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const { layer, retries, notices } = yield* harness({ first: "failed", retry: "completed" });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(onceTask);
      const removed = yield* service.subscribeList().pipe(
        Stream.filter(({ tasks }) => tasks.length === 0),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* TestClock.adjust("2 minutes");
      yield* Fiber.join(removed);
      assert.deepEqual(yield* Ref.get(retries), [
        { threadId: boundThread, runId: "run:1" as never, totId: TotId.make("yui") },
      ]);
      assert.deepEqual(yield* Ref.get(notices), []);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a one-time task that stays failed is turned off, shown failed and reported", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const { layer, retries, notices, settled } = yield* harness({ first: "failed", retry: null });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(onceTask);
      yield* TestClock.adjust("2 minutes");
      yield* Deferred.await(settled);
      const [task] = (yield* service.list()).tasks;
      assert.equal(task?.lastRunStatus, "failed");
      assert.equal(task?.lastRunError, "OpenCode Go weekly usage limit reached.");
      assert.isFalse(task?.enabled);
      assert.isNull(task?.nextRunAt);
      assert.lengthOf(yield* Ref.get(retries), 1);
      const [notice] = yield* Ref.get(notices);
      assert.deepInclude(notice, {
        taskId: onceTask.id,
        title: onceTask.title,
        ownerTotId: TotId.make("yui"),
        errorClass: "usage_limit",
        threadId: boundThread,
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a failed fallback retry is reported once and never retried again", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const { layer, retries, notices, settled } = yield* harness({
      first: "failed",
      retry: "failed",
    });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(onceTask);
      yield* TestClock.adjust("2 minutes");
      yield* Deferred.await(settled);
      assert.lengthOf(yield* Ref.get(retries), 1);
      assert.lengthOf(yield* Ref.get(notices), 1);
      assert.isFalse((yield* service.list()).tasks[0]?.enabled);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a bound task stores and shows its thread's model, not the one it was saved with", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const { layer } = yield* harness({ first: "completed", retry: null, threadModel: flash });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert({
        ...onceTask,
        schedule: { type: "interval", everyMs: 60 * 60 * 1_000 },
      });
      assert.deepEqual(task.modelSelection, flash);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a run replaces a bound task's stale stored model with the one its thread used", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const sql = yield* SqlClient.SqlClient;
    const { layer } = yield* harness({ first: "completed", retry: null, threadModel: flash });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert({
        ...onceTask,
        schedule: { type: "interval", everyMs: 60 * 60 * 1_000 },
      });
      // A row saved before this fix still holds the model it was created with.
      yield* sql`UPDATE scheduled_tasks SET model_selection_json = ${'{"instanceId":"opencode","model":"opencode-go/glm-5.3"}'}`;
      const refreshed = yield* service.subscribeList().pipe(
        Stream.filter(({ tasks }) => tasks[0]?.modelSelection.model === flash.model),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* service.runNow({ id: task.id });
      yield* Fiber.join(refreshed);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a bound task that pins its model keeps that model across saves and runs", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-01T07:00:00.000Z"));
    const { layer, settled } = yield* harness({
      first: "failed",
      retry: null,
      threadModel: flash,
    });
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert({
        ...onceTask,
        schedule: { type: "interval", everyMs: 60 * 60 * 1_000 },
        modelPinned: true,
      });
      assert.deepEqual(task.modelSelection, glm);
      yield* service.runNow({ id: task.id });
      // The failure notice is sent after the bound-model refresh would have run.
      yield* Deferred.await(settled);
      const stored = (yield* service.list()).tasks.find((entry) => entry.id === task.id);
      assert.deepEqual(stored?.modelSelection, glm);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
