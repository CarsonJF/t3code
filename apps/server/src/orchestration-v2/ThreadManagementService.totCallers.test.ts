import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_HOME_TOT,
  EnvironmentId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type Tot,
  TotId,
  totLaunchedThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as LegacyV1ThreadImporter from "./legacy/LegacyV1ThreadImporter.ts";
import { ThreadWorktreeRestore } from "../workspace/restoreMissingWorktree.ts";

const projectId = ProjectId.make("project:tot-home");
const homeThread = ThreadId.make("tot:home:1");
const otherTotThread = ThreadId.make("tot:helper:1");

const home = (whoCanAsk: Tot["whoCanAsk"]): Tot => ({
  ...DEFAULT_HOME_TOT,
  projectId,
  threadId: homeThread,
  ...(whoCanAsk === undefined ? {} : { whoCanAsk }),
});
const helper: Tot = {
  ...DEFAULT_HOME_TOT,
  id: TotId.make("helper"),
  name: "Helper",
  projectId: ProjectId.make("project:tot-helper"),
  threadId: otherTotThread,
};

type Dispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const layerFor = (tot: Tot, dispatched: Array<Dispatch>, running = false) =>
  ThreadManagementService.layerWithLegacyImporter.pipe(
    Layer.provide(
      Layer.succeed(ThreadWorktreeRestore, {
        takeRecreated: () => Effect.undefined,
        restore: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.mock(LegacyV1ThreadImporter.LegacyV1ThreadImporter)({
        ensureTranscript: () => Effect.succeed({ importedThreadCount: 0, importedMessageCount: 0 }),
      }),
    ),
    Layer.provide(Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({})),
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        getThreadRecords: () =>
          Effect.succeed({
            thread: {
              id: homeThread,
              projectId,
              deletedAt: null,
              archivedAt: null,
              worktreePath: null,
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            },
            runs: running
              ? [{ id: RunId.make("run:busy"), status: "running", activeAttemptId: "attempt:busy" }]
              : [],
            providerTurns: running ? [{ runAttemptId: "attempt:busy", status: "running" }] : [],
            messages: [],
            turnItems: [],
          } as unknown as OrchestrationV2ThreadProjection),
        dispatch: (command) =>
          Effect.sync(() => {
            if (command.type === "message.dispatch") dispatched.push(command);
            return { sequence: 1, storedEvents: [] } as never;
          }),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({ tots: [tot, helper] })),
    Layer.provideMerge(
      CommandReceiptStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
    ),
  );

const send = (input: Partial<ThreadManagementService.ThreadManagementSendInput>) =>
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService.ThreadManagementService;
    // The mock records no message, so an accepted send ends in the projection read.
    return yield* Effect.flip(
      threads.sendToThread({
        projectId,
        threadId: homeThread,
        commandId: CommandId.make("command:tot-caller"),
        messageId: MessageId.make("message:tot-caller"),
        text: "Please do it.",
        attachments: [],
        mode: "auto",
        createdBy: "agent",
        creationSource: "mcp",
        ...input,
      }),
    );
  });

const discordUser = { origin: "discord", id: "111" } as const;

describe("a Tot's Who can ask list", () => {
  it.effect.each([
    { label: "the local user", input: { createdBy: "user", creationSource: "web" } },
    { label: "T3 Code itself", input: { createdBy: "system", creationSource: "server" } },
    { label: "its own scheduled task", input: { scheduledTaskId: ScheduledTaskId.make("t") } },
    {
      label: "a thread it launched",
      input: { senderThreadId: totLaunchedThreadId(DEFAULT_HOME_TOT.id, "c") },
    },
  ] as const)("lets $label in with no limit and no list", ({ input }) => {
    const dispatched: Array<Dispatch> = [];
    return send(input).pipe(
      Effect.map((error) => {
        expect(error._tag).toBe("ThreadManagementDurableRunProjectionError");
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).not.toHaveProperty("caller");
        expect(dispatched[0]).not.toHaveProperty("restriction");
      }),
      Effect.provide(layerFor(home(undefined), dispatched)),
    );
  });

  it.effect.each([
    { origin: "tot", input: { senderThreadId: otherTotThread }, caller: 'Tot "helper"' },
    {
      origin: "agent",
      input: { senderThreadId: ThreadId.make("thread:x") },
      caller: "agent thread",
    },
    {
      origin: "linked",
      input: {
        linkedSender: {
          environmentId: EnvironmentId.make("env:far"),
          threadId: ThreadId.make("thread:far"),
          title: "Far",
        },
      },
      caller: 'linked environment "env:far"',
    },
    {
      origin: "webhook",
      input: {
        scheduledTaskId: ScheduledTaskId.make("hook"),
        caller: { origin: "webhook", id: "hook" },
      },
      caller: 'webhook "hook"',
    },
    { origin: "discord", input: { caller: discordUser }, caller: 'Discord user "111"' },
    { origin: "companion", input: {}, caller: 'outside client "unknown"' },
  ] as const)("refuses $origin when it is not listed, and starts no turn", ({ input, caller }) => {
    const dispatched: Array<Dispatch> = [];
    return send(input).pipe(
      Effect.map((error) => {
        expect(error._tag).toBe("ThreadManagementCallerRefusedError");
        expect(error.message).toContain(caller);
        expect(error.message).toContain("Who can ask");
        expect(dispatched).toEqual([]);
      }),
      Effect.provide(layerFor(home([{ origin: "discord", id: "999", mode: "full" }]), dispatched)),
    );
  });

  it.effect.each([
    { mode: "full", restriction: undefined },
    { mode: "ask", restriction: "ask" },
    { mode: "read-only", restriction: "read-only" },
  ] as const)("runs a listed caller's turn as $mode", ({ mode, restriction }) => {
    const dispatched: Array<Dispatch> = [];
    return send({ caller: discordUser }).pipe(
      Effect.map(() => {
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.caller).toEqual(discordUser);
        expect(dispatched[0]?.restriction).toBe(restriction);
      }),
      Effect.provide(layerFor(home([{ origin: "discord", id: "111", mode }]), dispatched)),
    );
  });

  it.effect("prefers an exact entry over * for the same origin", () => {
    const dispatched: Array<Dispatch> = [];
    return send({ senderThreadId: otherTotThread }).pipe(
      Effect.map(() => expect(dispatched[0]?.restriction).toBe("ask")),
      Effect.provide(
        layerFor(
          home([
            { origin: "tot", id: "*", mode: "full" },
            { origin: "tot", id: "helper", mode: "ask" },
          ]),
          dispatched,
        ),
      ),
    );
  });

  it.effect("never lets an outside caller's message steer the running turn", () => {
    const dispatched: Array<Dispatch> = [];
    return send({ caller: discordUser, mode: "steer" }).pipe(
      Effect.map(() => expect(dispatched[0]?.dispatchMode).toEqual({ type: "queue_after_active" })),
      Effect.provide(
        layerFor(home([{ origin: "discord", id: "111", mode: "full" }]), dispatched, true),
      ),
    );
  });

  it.effect("leaves a thread that is not a current Tot thread alone", () => {
    const dispatched: Array<Dispatch> = [];
    return send({ caller: discordUser }).pipe(
      Effect.map(() => expect(dispatched[0]).not.toHaveProperty("restriction")),
      // Home is off: its old thread is an ordinary thread now.
      Effect.provide(layerFor({ ...home(undefined), threadId: null }, dispatched)),
    );
  });
});

it("strips a caller and restriction a client puts on its own message", () => {
  const stamped = ThreadManagementService.withCreationProvenance(
    {
      type: "message.dispatch",
      commandId: CommandId.make("c"),
      threadId: homeThread,
      messageId: MessageId.make("m"),
      text: "hi",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      caller: discordUser,
      restriction: "read-only",
      createdBy: "user",
      creationSource: "web",
    },
    { createdBy: "user", creationSource: "web" },
  );
  expect(stamped).not.toHaveProperty("caller");
  expect(stamped).not.toHaveProperty("restriction");
});
