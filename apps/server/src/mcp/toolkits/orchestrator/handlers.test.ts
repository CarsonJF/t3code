import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  EnvironmentId,
  MessageId,
  OrchestratorMcpFailure,
  type OrchestratorMcpThreadInterruptResult,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type TotWatch,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinkRequests from "../../../peer/PeerLinkRequests.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as RemoteDelegation from "../../../peer/RemoteDelegation.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../../ThreadMetadataMcpService.ts";
import * as OrchestratorHandlers from "./handlers.ts";
import { OrchestratorToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:here");
const linked = EnvironmentId.make("environment:linked");
const homeThread = ThreadId.make("tot:home:current");
const worker = ThreadId.make("tot-launched:home:worker");

const interrupted: OrchestratorMcpThreadInterruptResult = {
  threadId: worker,
  runId: RunId.make("run-1"),
  status: "interrupt_requested",
};
const nothingRunning: OrchestratorMcpThreadInterruptResult = {
  threadId: worker,
  runId: null,
  status: "no_active_run",
};

const harness = (
  callerThread: ThreadId,
  outcome: Effect.Effect<OrchestratorMcpThreadInterruptResult, OrchestratorMcpFailure>,
) => {
  const marks: Array<string> = [];
  const home = { ...DEFAULT_HOME_TOT, threadId: homeThread };
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "thread:interrupt",
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
      list: Effect.succeed([home]),
      totForThread: (threadId) =>
        Effect.succeed(threadId === homeThread ? Option.some(home) : Option.none()),
      noteOwnStop: (_id, env) => Effect.sync(() => void marks.push(`note:${env}`)),
      takeOwnStop: (_id, env) =>
        Effect.sync(() => {
          marks.push(`forget:${env}`);
          return true;
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
    }),
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      interruptThread: () =>
        Effect.suspend(() => {
          marks.push("interrupt");
          return outcome;
        }),
    }),
    Layer.mock(ThreadMetadataMcpService.ThreadMetadataMcpService)({}),
    Layer.mock(PeerForwarding.PeerForwarding)({
      call: () =>
        Effect.suspend(() => {
          marks.push("forward");
          return outcome as never;
        }),
    }),
    Layer.mock(PeerLinks.PeerLinks)({}),
    Layer.mock(PeerLinkRequests.PeerLinkRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
  );
  const interrupt = (params: Record<string, unknown>) =>
    Effect.gen(function* () {
      const toolkit = yield* OrchestratorToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer).pipe(
            Layer.provide(dependencies),
          ),
        ),
      );
      yield* toolkit
        .handle("t3_thread_interrupt", { threadId: worker, ...params } as never)
        .pipe(Stream.unwrap, Stream.runDrain, Effect.provide(dependencies));
    });
  return { marks, interrupt };
};

it.effect("a Tot's stop is noted before it is dispatched", () =>
  Effect.gen(function* () {
    const { marks, interrupt } = harness(homeThread, Effect.succeed(interrupted));
    yield* interrupt({});
    expect(marks).toEqual([`note:${environmentId}`, "interrupt"]);
  }),
);

it.effect("a Tot's stop that stopped nothing is forgotten", () =>
  Effect.gen(function* () {
    const { marks, interrupt } = harness(homeThread, Effect.succeed(nothingRunning));
    yield* interrupt({});
    expect(marks).toEqual([`note:${environmentId}`, "interrupt", `forget:${environmentId}`]);
  }),
);

it.effect("a Tot's stop that failed is forgotten", () =>
  Effect.gen(function* () {
    const { marks, interrupt } = harness(
      homeThread,
      Effect.fail(new OrchestratorMcpFailure({ code: "orchestration_error", message: "No." })),
    );
    yield* interrupt({});
    expect(marks).toEqual([`note:${environmentId}`, "interrupt", `forget:${environmentId}`]);
  }),
);

it.effect("a Tot's stop on a linked environment is noted for that environment", () =>
  Effect.gen(function* () {
    const { marks, interrupt } = harness(homeThread, Effect.succeed(interrupted));
    yield* interrupt({ environmentId: linked });
    expect(marks).toEqual(["forward", `note:${linked}`]);
  }),
);

it.effect("a stop by an ordinary thread notes nothing", () =>
  Effect.gen(function* () {
    const { marks, interrupt } = harness(
      ThreadId.make("thread:ordinary"),
      Effect.succeed(interrupted),
    );
    yield* interrupt({});
    expect(marks).toEqual(["interrupt"]);
  }),
);

const peerThread = ThreadId.make("tot:yui:current");

const sendHarness = (startedBy: {
  readonly id: string;
  readonly createdBy: "user" | "agent" | "system";
}) => {
  const added: Array<TotWatch> = [];
  const unattendedCalls: Array<boolean> = [];
  let allowed = true;
  const home = { ...DEFAULT_HOME_TOT, threadId: homeThread };
  const runId = RunId.make("caller-run");
  const sent = {
    threadId: peerThread,
    messageId: MessageId.make("sent-message"),
    runId: RunId.make("target-run"),
    status: "running",
    delivery: "started",
  } as const;
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "thread:send",
      thread: {
        threadId: homeThread,
        providerSessionId: "session",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(TotService.TotService)({
      list: Effect.succeed([home]),
      totForThread: (threadId) =>
        Effect.succeed(threadId === homeThread ? Option.some(home) : Option.none()),
      addWatch: (_id, watch) => Effect.sync(() => void added.push(watch)),
      allowPeerReport: (_id, _env, _thread, unattended) =>
        Effect.sync(() => {
          unattendedCalls.push(unattended);
          return allowed;
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed({ ...liveThreadShell(threadId), latestRunId: runId }),
      getThreadRecords: (() =>
        Effect.succeed({
          runs: [{ id: runId, userMessageId: startedBy.id }],
          messages: [{ id: startedBy.id, createdBy: startedBy.createdBy }],
        })) as never,
    }),
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      sendToThread: (_scope, input) => Effect.succeed({ ...sent, threadId: input.threadId }),
    }),
    Layer.mock(ThreadMetadataMcpService.ThreadMetadataMcpService)({}),
    Layer.mock(PeerForwarding.PeerForwarding)({}),
    Layer.mock(PeerLinks.PeerLinks)({}),
    Layer.mock(PeerLinkRequests.PeerLinkRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
  );
  const send = (threadId: ThreadId = peerThread) =>
    Effect.gen(function* () {
      const toolkit = yield* OrchestratorToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer).pipe(
            Layer.provide(dependencies),
          ),
        ),
      );
      const result = yield* toolkit
        .handle("t3_thread_send", { threadId, message: "Ping" } as never)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      return result.at(-1)?.result as { readonly reportsBack?: false };
    });
  return { added, unattendedCalls, send, refuse: () => void (allowed = false) };
};

it.effect("a person's message resets the Tot exchange, and the send is watched", () =>
  Effect.gen(function* () {
    const { added, unattendedCalls, send } = sendHarness({ id: "m1", createdBy: "user" });
    const result = yield* send();
    expect(unattendedCalls).toEqual([false]);
    expect(added).toMatchObject([{ reason: "sent", threadId: peerThread }]);
    expect(result).not.toHaveProperty("reportsBack");
  }),
);

it.effect.each([
  { name: "a watch report", id: "tot-report:r1", createdBy: "system" as const },
  { name: "another agent", id: "m2", createdBy: "agent" as const },
])("a run started by $name counts toward the Tot exchange limit", ({ id, createdBy }) =>
  Effect.gen(function* () {
    const { unattendedCalls, send } = sendHarness({ id, createdBy });
    yield* send();
    expect(unattendedCalls).toEqual([true]);
  }),
);

it.effect("past the limit a send is not watched and says no report will follow", () =>
  Effect.gen(function* () {
    const { added, send, refuse } = sendHarness({ id: "tot-report:r1", createdBy: "system" });
    refuse();
    const result = yield* send();
    expect(added).toEqual([]);
    expect(result).toMatchObject({ reportsBack: false });
  }),
);

it.effect("a send to an ordinary thread is always watched", () =>
  Effect.gen(function* () {
    const { added, unattendedCalls, send } = sendHarness({
      id: "tot-report:r1",
      createdBy: "system",
    });
    yield* send(ThreadId.make("tot-launched:home:worker"));
    expect(unattendedCalls).toEqual([]);
    expect(added).toHaveLength(1);
  }),
);
