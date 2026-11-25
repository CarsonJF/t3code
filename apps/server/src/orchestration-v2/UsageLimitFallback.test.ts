import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_HOME_TOT,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TotId,
  type ModelSelection,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as UsageLimitFallback from "./UsageLimitFallback.ts";

const opencode = ProviderInstanceId.make("opencode");
const model = (id: string): ModelSelection => ({ instanceId: opencode, model: id });
const glm = model("opencode-go/glm-5.3");
const glmFlash = model("opencode-go/glm-5.3-flash");
const deepseek = model("opencode-go/deepseek-v4.1-flash");
const hy4 = model("opencode-go/hy4-flash-free");

describe("chooseUsageLimitFallback", () => {
  it("never picks full GLM 5.3, even when the deny list is cleared, but allows its Flash", () => {
    assert.deepEqual(
      UsageLimitFallback.chooseUsageLimitFallback({
        candidates: [glm, model("OPENCODE-GO/GLM-5.3"), glmFlash],
        denied: [],
        failed: deepseek,
      }),
      glmFlash,
    );
  });

  it("skips denied models and the model that just hit its limit, in list order", () => {
    assert.deepEqual(
      UsageLimitFallback.chooseUsageLimitFallback({
        candidates: [deepseek, glmFlash, hy4],
        denied: ["opencode-go/glm-5.3-flash"],
        failed: deepseek,
      }),
      hy4,
    );
    assert.isNull(
      UsageLimitFallback.chooseUsageLimitFallback({
        candidates: [deepseek],
        denied: [],
        failed: deepseek,
      }),
    );
  });

  it("uses a Tot's own list over the environment's, even an empty one", () => {
    const settings = {
      usageLimitFallbackModels: [hy4],
      tots: [
        { ...DEFAULT_HOME_TOT, id: TotId.make("yui"), usageLimitFallbackModels: [glmFlash] },
        { ...DEFAULT_HOME_TOT, id: TotId.make("off"), usageLimitFallbackModels: [] },
        { ...DEFAULT_HOME_TOT, id: TotId.make("plain") },
      ],
    };
    assert.deepEqual(UsageLimitFallback.fallbackCandidates(settings, TotId.make("yui")), [
      glmFlash,
    ]);
    assert.deepEqual(UsageLimitFallback.fallbackCandidates(settings, TotId.make("off")), []);
    assert.deepEqual(UsageLimitFallback.fallbackCandidates(settings, TotId.make("plain")), [hy4]);
    assert.deepEqual(UsageLimitFallback.fallbackCandidates(settings, null), [hy4]);
  });
});

describe("failureNoticeTotThread", () => {
  const home = { ...DEFAULT_HOME_TOT, threadId: ThreadId.make("tot:home:1") };
  const yui = { ...DEFAULT_HOME_TOT, id: TotId.make("yui"), threadId: ThreadId.make("tot:yui:1") };
  const off = { ...DEFAULT_HOME_TOT, id: TotId.make("off"), threadId: null };

  it("prefers the owning Tot and falls back to Home", () => {
    const tots = [home, yui, off];
    assert.equal(
      UsageLimitFallback.failureNoticeTotThread({ tots }, TotId.make("yui")),
      yui.threadId,
    );
    assert.equal(
      UsageLimitFallback.failureNoticeTotThread({ tots }, TotId.make("off")),
      home.threadId,
    );
    assert.equal(UsageLimitFallback.failureNoticeTotThread({ tots }, null), home.threadId);
    assert.isNull(UsageLimitFallback.failureNoticeTotThread({ tots: [DEFAULT_HOME_TOT] }, null));
  });
});

const threadId = ThreadId.make("tot-launched:yui:launch-1");
const failedRun = (overrides: Record<string, unknown> = {}) => ({
  id: RunId.make("run:1"),
  status: "failed",
  rootNodeId: "node:1",
  userMessageId: "message:1",
  modelSelection: deepseek,
  ...overrides,
});
const errorItem = (failureClass: string) => ({
  id: "item:1",
  type: "error",
  status: "failed",
  runId: "run:1",
  nodeId: "node:1",
  ordinal: 1,
  updatedAt: DateTime.makeUnsafe("2026-11-20T00:00:00.000Z"),
  failure: { class: failureClass, message: "OpenCode Go weekly usage limit reached." },
});

const retryWith = (input: {
  readonly run: ReturnType<typeof failedRun>;
  readonly failureClass: string;
  readonly fallbacks: ReadonlyArray<ModelSelection>;
}) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<Array<OrchestrationV2ServerCommand>>([]);
    const layer = UsageLimitFallback.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ usageLimitFallbackModels: [...input.fallbacks] }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: () => Effect.succeed({ archivedAt: null, deletedAt: null } as never),
            getThreadRecords: () =>
              Effect.succeed({
                runs: [input.run],
                turnItems: [errorItem(input.failureClass)],
              } as never),
            dispatch: (command) =>
              Ref.update(dispatched, (all) => [...all, command]).pipe(Effect.as({} as never)),
          }),
        ),
      ),
    );
    const result = yield* Effect.gen(function* () {
      const fallback = yield* UsageLimitFallback.UsageLimitFallback;
      return yield* fallback.retry({ threadId, runId: input.run.id, totId: TotId.make("yui") });
    }).pipe(Effect.provide(layer));
    return { result, dispatched: yield* Ref.get(dispatched) };
  });

describe("UsageLimitFallback.retry", () => {
  it.effect("continues the limited run once on the fallback and says so in the thread", () =>
    Effect.gen(function* () {
      const { result, dispatched } = yield* retryWith({
        run: failedRun(),
        failureClass: "usage_limit",
        fallbacks: [glm, hy4],
      });
      assert.isNotNull(result);
      assert.deepEqual(result.model, hy4);
      const [retry, notice] = dispatched;
      assert.deepInclude(retry, {
        type: "message.dispatch",
        commandId: CommandId.make(`usage-limit-fallback:${threadId}:run:1`),
        messageId: result.messageId,
        manualContinuationOfRunId: RunId.make("run:1"),
        modelSelection: hy4,
      });
      assert.deepInclude(notice, {
        type: "message.dispatch",
        systemNotice: true,
        text: "opencode-go/deepseek-v4.1-flash hit a usage limit, so this run was retried once on opencode-go/hy4-flash-free.",
      });
    }),
  );

  it.effect("never retries a run that was itself a fallback retry", () =>
    Effect.gen(function* () {
      const { result, dispatched } = yield* retryWith({
        run: failedRun({ userMessageId: `usage-limit-fallback:${threadId}:run:0` }),
        failureClass: "usage_limit",
        fallbacks: [hy4],
      });
      assert.isNull(result);
      assert.lengthOf(dispatched, 0);
    }),
  );

  it.effect("leaves other failures and runs with no usable fallback alone", () =>
    Effect.gen(function* () {
      for (const attempt of [
        { run: failedRun(), failureClass: "provider_error", fallbacks: [hy4] },
        { run: failedRun(), failureClass: "usage_limit", fallbacks: [glm, deepseek] },
        { run: failedRun(), failureClass: "usage_limit", fallbacks: [] },
      ]) {
        const { result, dispatched } = yield* retryWith(attempt);
        assert.isNull(result);
        assert.lengthOf(dispatched, 0);
      }
    }),
  );
});

describe("UsageLimitFallback.workerLayer", () => {
  it.effect("retries failed runs only in threads a Tot launched", () =>
    Effect.gen(function* () {
      const retried = yield* Ref.make<Array<UsageLimitFallback.UsageLimitFallbackInput>>([]);
      const runEvent = (thread: string, status: string) => ({
        type: "run.updated",
        threadId: ThreadId.make(thread),
        payload: { id: RunId.make(`run:${thread}`), status },
      });
      const layer = UsageLimitFallback.workerLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Orchestrator.OrchestratorV2)({
              streamDomainEvents: Stream.make(
                runEvent("tot-launched:yui:a", "failed"),
                runEvent("tot-launched:yui:b", "completed"),
                runEvent("thread:plain", "failed"),
              ) as never,
            }),
            Layer.succeed(UsageLimitFallback.UsageLimitFallback, {
              retry: (input) => Ref.update(retried, (all) => [...all, input]).pipe(Effect.as(null)),
            }),
          ),
        ),
      );
      yield* Effect.scoped(Layer.build(layer).pipe(Effect.andThen(Effect.yieldNow)));
      assert.deepEqual(yield* Ref.get(retried), [
        {
          threadId: ThreadId.make("tot-launched:yui:a"),
          runId: RunId.make("run:tot-launched:yui:a"),
          totId: TotId.make("yui"),
        },
      ]);
    }),
  );
});
