import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as ThreadHandlers from "./handlers.ts";
import { ThreadToolkit } from "./tools.ts";

const homeThread = ThreadId.make("tot:home:current");
const worker = ThreadId.make("thread:worker");
const approval = RuntimeRequestId.make("request:approval");

const harness = (callerThread: ThreadId) => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "thread:pending",
      thread: {
        threadId: callerThread,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(TotService.TotService)({
      totForThread: (threadId) =>
        Effect.succeed(
          threadId === homeThread
            ? Option.some({ ...DEFAULT_HOME_TOT, threadId: homeThread })
            : Option.none(),
        ),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(liveThreadShell(threadId, { activeRunId: RunId.make("run") })),
      getProjectThreadRecords: (input) =>
        Effect.succeed({
          thread: liveThreadShell(input.threadId),
          runtimeRequests: [{ id: approval, kind: "command", status: "pending" }],
          turnItems: [
            {
              type: "approval_request",
              requestId: approval,
              requestKind: "command",
              prompt: "rm -rf build",
            },
          ],
        } as never),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: 1 } as never;
        }),
    }),
    Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
    Layer.mock(ThreadSearch.ThreadSearch)({}),
    NodeCrypto.layer,
  );
  const call = (params: Record<string, unknown>) =>
    Effect.gen(function* () {
      const toolkit = yield* ThreadToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(ThreadHandlers.layer).pipe(Layer.provide(dependencies)),
        ),
      );
      const result = yield* toolkit
        .handle("t3_pending_request", params as never)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      return result.at(-1)?.result;
    });
  return { dispatched, call };
};

it.effect("a Tot sees approvals among a thread's pending requests", () =>
  Effect.gen(function* () {
    const { call } = harness(homeThread);
    const listed = yield* call({ action: "list", threadId: worker });
    expect(listed).toMatchObject({ approvals: [{ requestId: approval, kind: "command" }] });
    const read = yield* call({ action: "read", threadId: worker, requestId: approval });
    expect(read).toMatchObject({
      requestId: approval,
      approval: { kind: "command", prompt: "rm -rf build" },
    });
  }),
);

it.effect("a Tot approves a permission request for the user", () =>
  Effect.gen(function* () {
    const { call, dispatched } = harness(homeThread);
    yield* call({ action: "respond", threadId: worker, requestId: approval, decision: "accept" });
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: "runtime-request.respond",
        threadId: worker,
        requestId: approval,
        decision: "accept",
      }),
    );
  }),
);

it.effect("only a Tot can approve a permission request", () =>
  Effect.gen(function* () {
    const { call, dispatched } = harness(ThreadId.make("thread:ordinary"));
    const result = yield* call({
      action: "respond",
      threadId: worker,
      requestId: approval,
      decision: "accept",
    });
    expect(result).toMatchObject({
      code: "capability_denied",
      message: "Only a Tot can approve permission requests.",
    });
    expect(dispatched).toHaveLength(0);
    const listed = yield* call({ action: "list", threadId: worker });
    expect(listed).not.toHaveProperty("approvals");
  }),
);
