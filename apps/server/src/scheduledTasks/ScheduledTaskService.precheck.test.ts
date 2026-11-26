import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import { ScheduledTaskPrecheckRunner } from "./precheck.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const baseInput = (title: string, extra: Record<string, unknown> = {}) =>
  decodeInput({
    title,
    prompt: "Check the build.",
    enabled: true,
    schedule: { type: "interval", everyMs: 3_600_000 },
    projectId: "project-precheck",
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...extra,
  });

/** Launches fail, but each one counts and the named title wakes the test. */
const makeHarness = Effect.gen(function* () {
  const launched = yield* Ref.make<ReadonlyArray<string>>([]);
  const prechecks = yield* Ref.make<ReadonlyArray<string>>([]);
  const lastLaunch = yield* Deferred.make<void>();
  const layer = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        Scheduler.layer,
        ManagedPolicy.layerTest(),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          isNonGitProject: () => Effect.succeed(false),
          launch: (input) =>
            Ref.update(launched, (titles) => [...titles, input.title]).pipe(
              Effect.andThen(
                input.title === "last" ? Deferred.succeed(lastLaunch, undefined) : Effect.void,
              ),
              Effect.andThen(Effect.die("synthetic launch failure")),
            ),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
      ),
    ),
    Layer.provide(
      Layer.succeed(ScheduledTaskPrecheckRunner, (input) =>
        Ref.update(prechecks, (commands) => [...commands, input.command]).pipe(
          Effect.as({ pass: input.command === "true", detail: "Exited 1: nothing new" }),
        ),
      ),
    ),
  );
  return { launched, prechecks, lastLaunch, layer };
});

const setNextRun = (sql: SqlClient.SqlClient, id: string, at: number) =>
  sql`UPDATE scheduled_tasks SET next_run_at = ${iso(at)} WHERE task_id = ${id}`;

it.effect("a failing precheck skips the scheduled run without starting a turn", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const sql = yield* SqlClient.SqlClient;
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const gated = yield* service.upsert(yield* baseInput("gated", { precheck: "false" }));
      const passing = yield* service.upsert(yield* baseInput("passing", { precheck: "true" }));
      const last = yield* service.upsert(yield* baseInput("last"));
      yield* setNextRun(sql, gated.task.id, NOW - 30_000);
      yield* setNextRun(sql, passing.task.id, NOW - 20_000);
      yield* setNextRun(sql, last.task.id, NOW - 10_000);

      yield* TestClock.adjust("6 seconds");
      yield* Deferred.await(harness.lastLaunch);

      expect(yield* Ref.get(harness.launched)).toEqual(["passing", "last"]);
      expect(yield* Ref.get(harness.prechecks)).toEqual(["false", "true"]);
      const skipped = (yield* service.list()).tasks.find((task) => task.id === gated.task.id);
      expect(skipped?.lastRunStatus).toBe("never");
      expect(skipped?.runCount).toBe(0);
      expect(skipped?.lastSkip?.reason).toBe("precheck");
      expect(skipped?.lastSkip?.detail).toBe("Exited 1: nothing new");
      // The poll may run this batch at startup or on its first tick; either way, one interval on.
      const skippedAt = Date.parse(skipped?.lastSkip?.at ?? "");
      expect(skipped?.nextRunAt).toBe(iso(skippedAt + 3_600_000));

      // Run now is the user asking, so it starts a turn without the gate.
      yield* service.runNow({ id: gated.task.id });
      expect(yield* Ref.get(harness.launched)).toEqual(["passing", "last", "gated"]);
      expect(yield* Ref.get(harness.prechecks)).toEqual(["false", "true"]);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("after downtime a run inside the grace catches up once and an older one is skipped", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const sql = yield* SqlClient.SqlClient;
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const stale = yield* service.upsert(yield* baseInput("stale", { missedRunGraceMinutes: 30 }));
      const last = yield* service.upsert(yield* baseInput("last", { missedRunGraceMinutes: 30 }));
      yield* setNextRun(sql, stale.task.id, NOW - 2 * 3_600_000);
      yield* setNextRun(sql, last.task.id, NOW - 10 * 60_000);

      yield* TestClock.adjust("6 seconds");
      yield* Deferred.await(harness.lastLaunch);

      expect(yield* Ref.get(harness.launched)).toEqual(["last"]);
      const skipped = (yield* service.list()).tasks.find((task) => task.id === stale.task.id);
      expect(skipped?.lastSkip?.reason).toBe("missed");
      expect(skipped?.runCount).toBe(0);
      const skippedAt = Date.parse(skipped?.lastSkip?.at ?? "");
      expect(skipped?.nextRunAt).toBe(iso(skippedAt + 3_600_000));
      const caughtUp = (yield* service.list()).tasks.find((task) => task.id === last.task.id);
      expect(caughtUp?.runCount).toBe(1);
      expect(caughtUp?.lastSkip).toBeUndefined();
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("only a full-access task keeps a precheck, and omitted fields keep their values", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const harness = yield* makeHarness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const refused = yield* service
        .upsert(yield* baseInput("ask", { precheck: "true", runtimeMode: "approval-required" }))
        .pipe(Effect.flip);
      expect(refused.message).toContain("only a full-access task");

      const created = yield* service.upsert(
        yield* baseInput("gated", { precheck: "test -f flag", missedRunGraceMinutes: 15 }),
      );
      expect(created.task.precheck).toBe("test -f flag");
      expect(created.task.missedRunGraceMinutes).toBe(15);

      const renamed = yield* service.upsert(
        yield* baseInput("renamed", { id: created.task.id, requireExisting: true }),
      );
      expect(renamed.task.precheck).toBe("test -f flag");
      expect(renamed.task.missedRunGraceMinutes).toBe(15);

      const lowered = yield* service
        .upsert(
          yield* baseInput("renamed", { id: created.task.id, runtimeMode: "approval-required" }),
        )
        .pipe(Effect.flip);
      expect(lowered.message).toContain("only a full-access task");

      const cleared = yield* service.upsert(
        yield* baseInput("renamed", {
          id: created.task.id,
          runtimeMode: "approval-required",
          precheck: null,
          missedRunGraceMinutes: null,
        }),
      );
      expect(cleared.task.precheck).toBeUndefined();
      expect(cleared.task.missedRunGraceMinutes).toBeUndefined();
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
