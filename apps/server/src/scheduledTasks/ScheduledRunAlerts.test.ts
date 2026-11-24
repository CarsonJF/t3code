import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TotId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ScheduledRunAlerts from "./ScheduledRunAlerts.ts";

const homeThread = ThreadId.make("tot:home:1");
const runThread = ThreadId.make("thread:nightly");
const failure: ScheduledRunAlerts.ScheduledRunFailure = {
  taskId: ScheduledTaskId.make("task:nightly"),
  title: "Nightly monitor",
  ownerTotId: null,
  startedAtIso: "2026-11-20T11:40:00.000Z",
  errorClass: "usage_limit",
  failedAtIso: "2026-11-20T11:40:02.000Z",
  threadId: runThread,
};

const notify = (input: ScheduledRunAlerts.ScheduledRunFailure) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<Array<ThreadManagementService.ThreadManagementSendInput>>([]);
    const layer = ScheduledRunAlerts.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ tots: [{ ...DEFAULT_HOME_TOT, threadId: homeThread }] }),
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("env-asuna")),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () =>
              Effect.succeed({
                projectId: ProjectId.make("project:home"),
                archivedAt: null,
                deletedAt: null,
              } as never),
            sendToThread: (send) =>
              Ref.update(sent, (all) => [...all, send]).pipe(Effect.as({} as never)),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const alerts = yield* ScheduledRunAlerts.ScheduledRunAlerts;
      yield* alerts.notifyFailure(input);
    }).pipe(Effect.provide(layer));
    return yield* Ref.get(sent);
  });

describe("ScheduledRunAlerts", () => {
  it.effect("tells Home the task, error class, time and run when no Tot owns the task", () =>
    Effect.gen(function* () {
      const [message, ...rest] = yield* notify(failure);
      assert.lengthOf(rest, 0);
      assert.equal(message?.threadId, homeThread);
      assert.equal(
        message?.messageId,
        "scheduled-task-failed:task:nightly:2026-11-20T11:40:00.000Z",
      );
      assert.equal(
        message?.text,
        [
          'Scheduled task failed: "Nightly monitor"',
          "Error: usage_limit",
          "Time: 2026-11-20T11:40:02.000Z",
          "Run: [Nightly monitor](t3-thread://v2/env-asuna/thread:nightly)",
        ].join("\n"),
      );
    }),
  );

  it.effect("stays quiet when the run failed in the thread it would report to", () =>
    Effect.gen(function* () {
      assert.lengthOf(yield* notify({ ...failure, threadId: homeThread }), 0);
    }),
  );

  it.effect("goes to Home when the owning Tot is off", () =>
    Effect.gen(function* () {
      const [message] = yield* notify({ ...failure, ownerTotId: TotId.make("yui") });
      assert.equal(message?.threadId, homeThread);
    }),
  );
});
