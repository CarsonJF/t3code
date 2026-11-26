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
  TotError,
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
import * as TotWorkService from "../../../tots/TotWorkService.ts";
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

type StartedBy = {
  readonly id: string;
  readonly createdBy: "user" | "agent" | "system";
  readonly scheduledTaskId?: string;
  /** The threads the report that started this run came from. */
  readonly reportFrom?: ReadonlyArray<ThreadId>;
};

const sendHarness = (startedBy: StartedBy) => {
  const added: Array<TotWatch> = [];
  const steps: Array<string> = [];
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
      allowPeerReport: (_id, _env, _thread, step) =>
        Effect.sync(() => {
          steps.push(String(step));
          return allowed;
        }),
      reportCameFrom: (_messageId, _env, threadId) =>
        Effect.succeed(startedBy.reportFrom?.includes(threadId) === true),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed({ ...liveThreadShell(threadId), activeRunId: runId, latestRunId: runId }),
      getThreadRecords: (() =>
        Effect.succeed({
          runs: [{ id: runId, userMessageId: startedBy.id }],
          messages: [
            {
              id: startedBy.id,
              createdBy: startedBy.createdBy,
              ...(startedBy.scheduledTaskId === undefined
                ? {}
                : { scheduledTaskId: startedBy.scheduledTaskId }),
            },
          ],
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
  return { added, steps, send, refuse: () => void (allowed = false) };
};

it.effect.each([
  { name: "a person", started: { id: "m1", createdBy: "user" }, step: "reset" },
  {
    name: "a Tot's own schedule",
    started: { id: "m2", createdBy: "agent", scheduledTaskId: "task-1" },
    step: "reset",
  },
  {
    name: "this target's report",
    started: { id: "tot-report:r1", createdBy: "system", reportFrom: [peerThread] },
    step: "hop",
  },
  {
    name: "an unrelated worker's report",
    started: {
      id: "tot-report:r2",
      createdBy: "system",
      reportFrom: [ThreadId.make("tot-launched:home:worker")],
    },
    step: "unrelated",
  },
  { name: "another agent's message", started: { id: "m3", createdBy: "agent" }, step: "unrelated" },
] satisfies ReadonlyArray<{ name: string; started: StartedBy; step: string }>)(
  "a run started by $name is a $step for the Tot exchange",
  ({ started, step }) =>
    Effect.gen(function* () {
      const { added, steps, send } = sendHarness(started);
      const result = yield* send();
      expect(steps).toEqual([step]);
      expect(added).toMatchObject([{ reason: "sent", threadId: peerThread }]);
      expect(result).not.toHaveProperty("reportsBack");
    }),
);

it.effect("past the limit a send is not watched and says no report will follow", () =>
  Effect.gen(function* () {
    const { added, send, refuse } = sendHarness({
      id: "tot-report:r1",
      createdBy: "system",
      reportFrom: [peerThread],
    });
    refuse();
    const result = yield* send();
    expect(added).toEqual([]);
    expect(result).toMatchObject({ reportsBack: false });
  }),
);

it.effect("a send to an ordinary thread is always watched", () =>
  Effect.gen(function* () {
    const { added, steps, send } = sendHarness({ id: "tot-report:r1", createdBy: "system" });
    yield* send(ThreadId.make("tot-launched:home:worker"));
    expect(steps).toEqual([]);
    expect(added).toHaveLength(1);
  }),
);

const objectiveHarness = (capped: boolean) => {
  const calls: Array<string> = [];
  const forwarded: Array<Record<string, unknown>> = [];
  const attached: Array<{ readonly kind: string; readonly environmentId: string }> = [];
  const home = { ...DEFAULT_HOME_TOT, threadId: homeThread };
  const sent = {
    threadId: worker,
    messageId: MessageId.make("sent-message"),
    runId: RunId.make("target-run"),
    status: "running",
    delivery: "started",
  } as const;
  const target = { totId: home.id, objectiveId: null, title: "Repair CI" };
  const dependencies = Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId,
      requestNamespace: "thread:objective",
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
      addWatch: () => Effect.void,
    }),
    Layer.mock(TotWorkService.TotWorkService)({
      tracks: () => false,
      check: () =>
        capped
          ? Effect.fail(new TotError({ message: 'Objective "Repair CI" needs a person.' }))
          : Effect.succeed(target),
      attach: (_target, attempt) =>
        Effect.sync(() => {
          attached.push({ kind: attempt.kind, environmentId: attempt.environmentId });
          return { id: "obj-abc123def456" } as never;
        }),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(liveThreadShell(threadId)),
    }),
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      sendToThread: () => Effect.sync(() => (calls.push("send"), sent)),
    }),
    Layer.mock(ThreadMetadataMcpService.ThreadMetadataMcpService)({}),
    Layer.mock(PeerForwarding.PeerForwarding)({
      call: (_scope, _tool, _target, params) =>
        Effect.sync(() => {
          calls.push("forward");
          forwarded.push(params as Record<string, unknown>);
          return sent as never;
        }),
    }),
    Layer.mock(PeerLinks.PeerLinks)({}),
    Layer.mock(PeerLinkRequests.PeerLinkRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({
      followUp: (_scope, _environmentId, _input, result) => Effect.succeed(result as never),
    }),
  );
  const send = (params: Record<string, unknown>) =>
    Effect.gen(function* () {
      const toolkit = yield* OrchestratorToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(OrchestratorHandlers.layer).pipe(
            Layer.provide(dependencies),
          ),
        ),
      );
      const result = yield* toolkit
        .handle("t3_thread_send", {
          threadId: worker,
          message: "Try again",
          objective: "Repair CI",
          ...params,
        } as never)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      return result.at(-1)?.result as Record<string, unknown>;
    });
  return { calls, forwarded, attached, send };
};

it.effect("a Tot's send for an objective is recorded as an attempt, here or linked", () =>
  Effect.gen(function* () {
    const { calls, forwarded, attached, send } = objectiveHarness(false);
    expect(yield* send({})).toMatchObject({ objectiveId: "obj-abc123def456" });
    expect(yield* send({ environmentId: linked })).toMatchObject({
      objectiveId: "obj-abc123def456",
    });
    expect(calls).toEqual(["send", "forward"]);
    // The objective belongs to this side's work list, so it never crosses the link.
    expect(forwarded[0]).not.toHaveProperty("objective");
    expect(attached).toEqual([
      { kind: "send", environmentId },
      { kind: "send", environmentId: linked },
    ]);
  }),
);

it.effect("an objective past its retry cap refuses the send before anything starts", () =>
  Effect.gen(function* () {
    const { calls, attached, send } = objectiveHarness(true);
    expect(yield* send({})).toMatchObject({ code: "invalid_request" });
    expect(yield* send({ environmentId: linked })).toMatchObject({ code: "invalid_request" });
    expect(calls).toEqual([]);
    expect(attached).toEqual([]);
  }),
);
