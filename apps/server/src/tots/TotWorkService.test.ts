import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, RunId, ThreadId, TotId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TotWorkService from "./TotWorkService.ts";
import type { WatchedThreadState } from "./totWatchTransitions.ts";

const totId = TotId.make("yui");
const environmentId = EnvironmentId.make("env-here");

const look = (
  runId: string,
  status: WatchedThreadState["status"],
  extra: Partial<WatchedThreadState> = {},
): WatchedThreadState => ({
  status,
  pending: null,
  runId,
  requestId: null,
  ended: false,
  backgroundTasks: 0,
  restartPending: false,
  ...extra,
});

const serviceAt = (dbPath: string, retryCap = 3) =>
  TotWorkService.layer.pipe(
    Layer.provide(SqlitePersistence.layerFromPath(dbPath)),
    Layer.provide(ServerSettings.layerTest({ totObjectiveRetryCap: retryCap })),
    Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
  );

const withService = <A, E>(
  dbPath: string,
  use: (work: TotWorkService.TotWorkService["Service"]) => Effect.Effect<A, E>,
  retryCap = 3,
) =>
  Effect.gen(function* () {
    const work = yield* TotWorkService.TotWorkService;
    return yield* use(work);
  }).pipe(Effect.provide(serviceAt(dbPath, retryCap)), Effect.scoped);

const tempDb = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-tot-work-" });
  return path.join(dir, "state.sqlite");
});

/** Starts one attempt at `goal` in its own thread, then ends it with `status`. */
const attemptThat = (
  work: TotWorkService.TotWorkService["Service"],
  goal: string,
  index: number,
  status: WatchedThreadState["status"],
) =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(`tot-launched:yui:fix-${index}`);
    const runId = RunId.make(`run-${index}`);
    const target = yield* work.check(totId, goal);
    const objective = yield* work.attach(target, {
      kind: "launch",
      environmentId,
      threadId,
      runId,
    });
    yield* work.observe(environmentId, threadId, look(runId, status), Effect.succeed("It broke."));
    return objective.id;
  });

describe("TotWorkService", () => {
  it.effect("derives each status from the runs it sees, with the worker's outcome", () =>
    Effect.gen(function* () {
      const dbPath = yield* tempDb;
      yield* withService(dbPath, (work) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make("tot-launched:yui:a");
          const runId = RunId.make("run-a");
          const target = yield* work.check(totId, "Fix the login page");
          assert.strictEqual(target.objectiveId, null);
          const created = yield* work.attach(target, {
            kind: "launch",
            environmentId,
            threadId,
            runId,
          });
          assert.strictEqual(created.status, "working");
          const status = () =>
            work.list(totId).pipe(Effect.map(({ objectives }) => objectives[0]?.status));

          // An earlier run still finishing on the thread says nothing about this attempt.
          yield* work.observe(
            environmentId,
            threadId,
            look("run-old", "completed"),
            Effect.succeed(null),
          );
          assert.strictEqual(yield* status(), "working");

          yield* work.observe(
            environmentId,
            threadId,
            look(runId, "running", { pending: "question", requestId: "q1" }),
            Effect.succeed(null),
          );
          assert.strictEqual(yield* status(), "needs_you");
          yield* work.observe(
            environmentId,
            threadId,
            look(runId, "waiting", { backgroundTasks: 1, waitingOn: "checks" }),
            Effect.succeed(null),
          );
          assert.strictEqual(yield* status(), "waiting");
          // A background wake carries the same work on in a later run.
          yield* work.observe(
            environmentId,
            threadId,
            look("run-wake", "completed"),
            Effect.succeed("Merged the fix."),
          );
          const { objectives } = yield* work.list(totId);
          assert.strictEqual(objectives[0]?.status, "done");
          assert.strictEqual(objectives[0]?.attempts[0]?.outcome, "Merged the fix.");
          assert.isFalse(work.tracks(environmentId, threadId));

          // A relaunch under the same goal joins that objective instead of forking it.
          const again = yield* work.check(totId, "fix the login page");
          assert.strictEqual(again.objectiveId, created.id);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("needs a person after the retry cap, and a reset lets work start again", () =>
    Effect.gen(function* () {
      const dbPath = yield* tempDb;
      yield* withService(dbPath, (work) =>
        Effect.gen(function* () {
          const id = yield* attemptThat(work, "Repair CI", 1, "failed");
          yield* attemptThat(work, "Repair CI", 2, "stopped");
          yield* attemptThat(work, id, 3, "failed");
          const { objectives } = yield* work.list(totId);
          assert.strictEqual(objectives.length, 1);
          assert.strictEqual(objectives[0]?.status, "needs_you");
          assert.strictEqual(objectives[0]?.failedAttempts, 3);

          const byGoal = yield* work.check(totId, "Repair CI").pipe(Effect.flip);
          assert.include(byGoal.message, "needs a person");
          const byId = yield* work.check(totId, id).pipe(Effect.flip);
          assert.include(byId.message, "3 failed or stopped attempts");

          const reset = yield* work.update({ id: totId, objectiveId: id, action: "reset" });
          assert.strictEqual(reset.failedAttempts, 0);
          assert.strictEqual(reset.status, "failed");
          assert.strictEqual((yield* work.check(totId, id)).objectiveId, id);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("keeps a closed objective closed, and a cap of 0 never refuses", () =>
    Effect.gen(function* () {
      const dbPath = yield* tempDb;
      yield* withService(
        dbPath,
        (work) =>
          Effect.gen(function* () {
            const id = yield* attemptThat(work, "Tidy logs", 1, "failed");
            yield* attemptThat(work, id, 2, "failed");
            assert.strictEqual((yield* work.check(totId, id)).objectiveId, id);
            const cancelled = yield* work.update({
              id: totId,
              objectiveId: id,
              action: "cancelled",
            });
            assert.strictEqual(cancelled.status, "cancelled");
            // A cancelled goal is not reused by name; a new launch starts a new objective.
            assert.strictEqual((yield* work.check(totId, "Tidy logs")).objectiveId, null);
            const missing = yield* work
              .update({ id: TotId.make("other"), objectiveId: id, action: "done" })
              .pipe(Effect.flip);
            assert.include(missing.message, "no objective");
          }),
        0,
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("keeps objectives and open attempts across a restart", () =>
    Effect.gen(function* () {
      const dbPath = yield* tempDb;
      const threadId = ThreadId.make("tot-launched:yui:b");
      const runId = RunId.make("run-b");
      const id = yield* withService(dbPath, (work) =>
        Effect.gen(function* () {
          const target = yield* work.check(totId, "Ship the release");
          const objective = yield* work.attach(target, {
            kind: "delegate",
            environmentId,
            threadId,
            runId,
            taskId: "task-1",
          });
          return objective.id;
        }),
      );
      // A new service on the same database: what it learns about the thread still lands.
      yield* withService(dbPath, (work) =>
        Effect.gen(function* () {
          assert.isTrue(work.tracks(environmentId, threadId));
          yield* work.observe(environmentId, threadId, look(runId, "failed"), Effect.succeed(null));
          const { objectives } = yield* work.list(totId);
          assert.strictEqual(objectives[0]?.id, id);
          assert.strictEqual(objectives[0]?.status, "failed");
          assert.strictEqual(objectives[0]?.attempts[0]?.taskId, "task-1");
          assert.strictEqual(objectives[0]?.attempts[0]?.kind, "delegate");
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
