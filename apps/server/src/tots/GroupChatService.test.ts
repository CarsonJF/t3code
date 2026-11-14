import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  DEFAULT_HOME_TOT,
  GroupChatId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TotId,
  groupChatThreadId,
  type GroupChat,
  type OrchestrationV2DomainEvent,
  type Tot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GroupChatService from "./GroupChatService.ts";

const projectId = ProjectId.make("room-project");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
const tot = (id: string, name: string): Tot => ({
  ...DEFAULT_HOME_TOT,
  id: TotId.make(id),
  name,
  projectId: ProjectId.make(`project-${id}`),
  threadId: ThreadId.make(`tot:${id}:now`),
  modelSelection,
});
const brain = tot("brain", "Brain");
const ledger = tot("ledger", "Ledger");
const roomId = GroupChatId.make("hello-room");
const room: GroupChat = {
  id: roomId,
  name: "Hello Room",
  memberIds: [brain.id, ledger.id],
  moderatorId: brain.id,
  hopLimit: 2,
  projectId,
  threadId: groupChatThreadId(roomId),
};

type RoomMessage = {
  readonly id: string;
  readonly createdBy: "user" | "agent" | "system";
  readonly senderThreadId?: ThreadId;
  readonly text: string;
};

/** A room whose messages are `messages`, where the last one has just arrived. */
const makeRoom = (messages: ReadonlyArray<RoomMessage>) => {
  const sent: Array<ThreadManagement.ThreadManagementSendInput> = [];
  const posted: Array<{ readonly text: string; readonly createdBy: string }> = [];
  return Effect.gen(function* () {
    const reacted = yield* Deferred.make<void>();
    const event = {
      type: "message.updated",
      threadId: room.threadId,
      payload: { role: "user", runId: null },
    } as unknown as OrchestrationV2DomainEvent;
    const layer = GroupChatService.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          NodeCrypto.layer,
          ServerSettings.layerTest({ tots: [brain, ledger], groupChats: [room] }),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
          }),
          Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            streamDomainEvents: Stream.make(event),
            getThreadRecords: () =>
              Effect.succeed({
                messages: messages.map((message, index) => ({
                  ...message,
                  role: "user",
                  runId: null,
                  createdAt: DateTime.makeUnsafe(index),
                })),
              } as never),
            getThreadShell: () =>
              Effect.succeed({ projectId, deletedAt: null, archivedAt: null } as never),
            sendToThread: (input) => {
              sent.push(input);
              return Deferred.succeed(reacted, undefined).pipe(Effect.as({} as never));
            },
            dispatch: (command) => {
              if (command.type === "message.dispatch") {
                posted.push({ text: command.text, createdBy: command.createdBy });
              }
              return Deferred.succeed(reacted, undefined).pipe(Effect.as({} as never));
            },
          }),
        ),
      ),
    );
    return { layer, reacted, sent, posted };
  });
};

const start = GroupChatService.GroupChatService.pipe(Effect.flatMap((rooms) => rooms.start));

it.effect("wakes the moderator for a user message that names no one", () =>
  Effect.gen(function* () {
    const { layer, reacted, sent } = yield* makeRoom([
      { id: "m1", createdBy: "user", text: "hello everyone" },
    ]);
    yield* Effect.gen(function* () {
      yield* start;
      yield* Deferred.await(reacted);
    }).pipe(Effect.provide(layer));
    expect(sent.map((input) => input.threadId)).toEqual([brain.threadId]);
    expect(sent[0]?.text).toContain("room: hello-room");
    expect(sent[0]?.text).toContain("User: hello everyone");
  }),
);

it.effect("wakes the Tot another Tot names, and not the speaker", () =>
  Effect.gen(function* () {
    const { layer, reacted, sent } = yield* makeRoom([
      { id: "m1", createdBy: "user", text: "hi" },
      { id: "m2", createdBy: "agent", senderThreadId: brain.threadId!, text: "@Ledger @Brain?" },
    ]);
    yield* Effect.gen(function* () {
      yield* start;
      yield* Deferred.await(reacted);
    }).pipe(Effect.provide(layer));
    expect(sent.map((input) => input.threadId)).toEqual([ledger.threadId]);
    expect(sent[0]?.text).toContain("Brain: @Ledger @Brain?");
  }),
);

it.effect("pauses a chain of Tot replies at the room's limit with a notice", () =>
  Effect.gen(function* () {
    const { layer, reacted, sent, posted } = yield* makeRoom([
      { id: "m1", createdBy: "user", text: "hi" },
      { id: "m2", createdBy: "agent", senderThreadId: brain.threadId!, text: "@Ledger go" },
      { id: "m3", createdBy: "agent", senderThreadId: ledger.threadId!, text: "@Brain back" },
    ]);
    yield* Effect.gen(function* () {
      yield* start;
      yield* Deferred.await(reacted);
    }).pipe(Effect.provide(layer));
    expect(sent).toEqual([]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.createdBy).toBe("system");
    expect(posted[0]?.text).toContain("Paused after 2 replies");
  }),
);
