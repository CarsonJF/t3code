import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  groupChatThreadId,
  GroupChatId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("A group chat room never opens a provider session"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "group-chat-room" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

it.layer(layerTest)("group chat room", (it) => {
  it.effect("records a room message with no run, and opens no provider session", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = groupChatThreadId(GroupChatId.make("hello-room"));
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create-room"),
        threadId,
        projectId: ProjectId.make("project:room"),
        title: "Hello Room",
        modelSelection: { instanceId, model: "gpt-5" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      const brainThread = ThreadId.make("tot:brain:one");
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("user-says"),
        threadId,
        messageId: MessageId.make("user-message"),
        text: "hi room",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("brain-says"),
        threadId,
        messageId: MessageId.make("brain-message"),
        text: "hey",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
        senderThreadId: brainThread,
      });

      const records = yield* orchestrator.getThreadRecords(threadId, [
        "messages",
        "runs",
        "turnItems",
      ]);
      assert.deepStrictEqual(
        records.messages.map((message) => [message.id, message.runId, message.senderThreadId]),
        [
          ["user-message", null, undefined],
          ["brain-message", null, brainThread],
        ],
      );
      assert.equal(records.runs.length, 0);
      assert.deepStrictEqual(
        records.turnItems.map((item) => item.type),
        ["user_message", "user_message"],
      );
    }),
  );
});
