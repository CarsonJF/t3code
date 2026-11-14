import {
  CommandId,
  GROUP_CHAT_DEFAULT_HOP_LIMIT,
  GroupChatError,
  GroupChatId,
  MessageId,
  groupChatThreadId,
  parseGroupChatThreadId,
  parseTotThreadId,
  totSlug,
  type GroupChat,
  type GroupChatCreateInput,
  type GroupChatUpdateInput,
  type OrchestrationV2DomainEvent,
  type ThreadId,
  type Tot,
  type TotId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  decideRoomTurn,
  trailingTotMessages,
  type RoomMember,
  type RoomSpeaker,
} from "./groupChatTurns.ts";

/** How much of the room a woken Tot is shown. */
const TRANSCRIPT_LINES = 20;
const USER_LABEL = "User";

export class GroupChatService extends Context.Service<
  GroupChatService,
  {
    readonly list: Effect.Effect<ReadonlyArray<GroupChat>>;
    readonly create: (input: GroupChatCreateInput) => Effect.Effect<GroupChat, GroupChatError>;
    readonly update: (input: GroupChatUpdateInput) => Effect.Effect<GroupChat, GroupChatError>;
    readonly remove: (id: GroupChatId) => Effect.Effect<void, GroupChatError>;
    /** A Tot speaks in a room it belongs to; the message appears under its name. */
    readonly say: (
      totId: TotId,
      roomId: GroupChatId,
      text: string,
    ) => Effect.Effect<void, GroupChatError>;
    /** Wakes the right members for each message that reaches a room, until the scope closes. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/tots/GroupChatService") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const random = yield* SecureRandom.SecureRandom;
  const lock = yield* Semaphore.make(1);

  const fail = (message: string) => new GroupChatError({ message });
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect);
  const newId = random.uuidV4().pipe(Effect.orDie);

  const list = settings.getSettings.pipe(
    Effect.map((current) => current.groupChats),
    Effect.orElseSucceed((): ReadonlyArray<GroupChat> => []),
  );
  const readState = settings.getSettings.pipe(
    Effect.map((current) => ({ rooms: current.groupChats, tots: current.tots })),
    Effect.mapError(() => fail("Group chat settings could not be read.")),
  );
  const writeRooms = (update: (rooms: ReadonlyArray<GroupChat>) => ReadonlyArray<GroupChat>) =>
    settings.updateGroupChats(update).pipe(
      Effect.asVoid,
      Effect.mapError(() => fail("Group chat settings could not be saved.")),
    );
  const requireRoom = Effect.fn("GroupChatService.requireRoom")(function* (id: GroupChatId) {
    const room = (yield* readState).rooms.find((candidate) => candidate.id === id);
    if (room === undefined) return yield* fail(`There is no group chat "${id}".`);
    return room;
  });

  const checkMembers = (
    tots: ReadonlyArray<Tot>,
    memberIds: ReadonlyArray<TotId>,
    moderatorId: TotId,
  ) => {
    if (new Set(memberIds).size !== memberIds.length) return fail("Each Tot can join once.");
    const unknown = memberIds.find((id) => !tots.some((tot) => tot.id === id));
    if (unknown !== undefined) return fail(`There is no Tot "${unknown}".`);
    if (!memberIds.includes(moderatorId)) return fail("The moderator must be in the group chat.");
    return null;
  };

  const create = Effect.fn("GroupChatService.create")(function* (input: GroupChatCreateInput) {
    const { rooms, tots } = yield* readState;
    const slug = totSlug(input.name);
    if (slug === null) return yield* fail("Give the group chat a name with a letter or number.");
    const id = GroupChatId.make(slug);
    if (rooms.some((room) => room.id === id)) {
      return yield* fail("A group chat named like this already exists.");
    }
    const moderatorId = input.moderatorId ?? input.memberIds[0]!;
    const invalid = checkMembers(tots, input.memberIds, moderatorId);
    if (invalid !== null) return yield* invalid;
    const { projectId } = yield* folders
      .ensureRoomProject({ id, name: input.name })
      .pipe(Effect.mapError((error) => fail(error.message)));
    const threadId = groupChatThreadId(id);
    yield* launches
      .launch({
        commandId: CommandId.make(threadId),
        threadId,
        projectId,
        title: input.name,
        modelSelection: input.modelSelection,
        // The room never runs; the narrowest mode keeps that true if it somehow did.
        runtimeMode: "approval-required",
        interactionMode: "default",
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError((error) => fail(error.message)));
    const room: GroupChat = {
      id,
      name: input.name,
      memberIds: input.memberIds,
      moderatorId,
      hopLimit: input.hopLimit ?? GROUP_CHAT_DEFAULT_HOP_LIMIT,
      projectId,
      threadId,
    };
    yield* writeRooms((current) => [...current, room]);
    return room;
  }, locked);

  const update = Effect.fn("GroupChatService.update")(function* (input: GroupChatUpdateInput) {
    const room = yield* requireRoom(input.id);
    const { tots } = yield* readState;
    const next: GroupChat = {
      ...room,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
      ...(input.moderatorId === undefined ? {} : { moderatorId: input.moderatorId }),
      ...(input.hopLimit === undefined ? {} : { hopLimit: input.hopLimit }),
    };
    const invalid = checkMembers(tots, next.memberIds, next.moderatorId);
    if (invalid !== null) return yield* invalid;
    yield* writeRooms((current) => current.map((entry) => (entry.id === next.id ? next : entry)));
    if (next.name !== room.name && next.threadId !== null) {
      yield* threads
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`room-rename:${yield* newId}`),
          threadId: next.threadId,
          title: next.name,
        })
        .pipe(Effect.ignore);
    }
    return next;
  }, locked);

  const removeUnlocked = Effect.fn("GroupChatService.removeUnlocked")(function* (room: GroupChat) {
    yield* writeRooms((current) => current.filter((entry) => entry.id !== room.id));
    if (room.threadId !== null) {
      yield* threads
        .dispatch({
          type: "thread.delete",
          commandId: CommandId.make(`room-delete:${yield* newId}`),
          threadId: room.threadId,
        })
        .pipe(Effect.ignore);
    }
  });

  const remove = Effect.fn("GroupChatService.remove")(function* (id: GroupChatId) {
    yield* removeUnlocked(yield* requireRoom(id));
  }, locked);

  /** Appends a message to a room as `speaker`; the orchestrator records it without a run. */
  const post = Effect.fn("GroupChatService.post")(function* (
    room: GroupChat,
    input: { readonly text: string } & (
      | { readonly speakerThreadId: ThreadId }
      | { readonly system: true }
    ),
  ) {
    if (room.threadId === null) return yield* fail("This group chat is not set up.");
    const messageId = `room-message:${yield* newId}`;
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(messageId),
        threadId: room.threadId,
        messageId: MessageId.make(messageId),
        text: input.text,
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "speakerThreadId" in input ? "agent" : "system",
        creationSource: "server",
        ...("speakerThreadId" in input ? { senderThreadId: input.speakerThreadId } : {}),
      })
      .pipe(Effect.mapError(() => fail("The message could not be posted.")));
  });

  const say = Effect.fn("GroupChatService.say")(function* (
    totId: TotId,
    roomId: GroupChatId,
    text: string,
  ) {
    const room = yield* requireRoom(roomId);
    if (!room.memberIds.includes(totId)) {
      return yield* fail("You are not in this group chat.");
    }
    const tot = (yield* readState).tots.find((candidate) => candidate.id === totId);
    if (tot === undefined || tot.threadId === null) return yield* fail("Turn this Tot on first.");
    yield* post(room, { text, speakerThreadId: tot.threadId });
  });

  const speakerOf = (message: {
    readonly createdBy: string;
    readonly senderThreadId?: ThreadId | undefined;
  }): RoomSpeaker => {
    if (message.createdBy === "system") return { kind: "system" };
    const totId =
      message.senderThreadId === undefined ? null : parseTotThreadId(message.senderThreadId);
    return totId === null ? { kind: "user" } : { kind: "tot", id: totId };
  };

  const labelOf = (speaker: RoomSpeaker, tots: ReadonlyArray<Tot>) =>
    speaker.kind === "tot"
      ? (tots.find((tot) => tot.id === speaker.id)?.name ?? speaker.id)
      : speaker.kind === "user"
        ? USER_LABEL
        : "Notice";

  const wakeText = (input: {
    readonly room: GroupChat;
    readonly member: Tot;
    readonly members: ReadonlyArray<RoomMember>;
    readonly transcript: ReadonlyArray<string>;
    readonly addressedBy: string;
  }) =>
    [
      `Group chat "${input.room.name}" (room: ${input.room.id}). Members: ${input.members
        .map((member) => member.name)
        .join(", ")}. You are ${input.member.name}.`,
      "",
      "Recent messages:",
      ...input.transcript,
      "",
      `${input.addressedBy} is talking to you. Answer with the t3_group_chat_say tool (room: "${input.room.id}"). Write one short chat message, in your own voice. Mention another member as @Name only when you need their answer. Anything you write outside that tool is not seen by the room.`,
    ].join("\n");

  const wake = Effect.fn("GroupChatService.wake")(function* (input: {
    readonly room: GroupChat;
    readonly member: Tot;
    readonly members: ReadonlyArray<RoomMember>;
    readonly transcript: ReadonlyArray<string>;
    readonly addressedBy: string;
  }) {
    const { member } = input;
    if (member.threadId === null) {
      yield* post(input.room, { text: `${member.name} is off.`, system: true });
      return;
    }
    const shell = yield* threads
      .getThreadShell(member.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null || shell.deletedAt !== null || shell.archivedAt !== null) return;
    const messageId = `room-wake:${yield* newId}`;
    yield* threads
      .sendToThread({
        projectId: shell.projectId,
        commandId: CommandId.make(messageId),
        threadId: member.threadId,
        messageId: MessageId.make(messageId),
        text: wakeText(input),
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(Effect.ignore);
  });

  /** Decides who answers the message that just reached a room, and wakes them. */
  const react = Effect.fn("GroupChatService.react")(function* (roomThread: ThreadId) {
    const roomId = parseGroupChatThreadId(roomThread);
    if (roomId === null) return;
    const { rooms, tots } = yield* readState;
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) return;
    const records = yield* threads
      .getThreadRecords(roomThread, ["messages"])
      .pipe(Effect.orElseSucceed(() => null));
    if (records === null) return;
    const messages = records.messages
      .filter((message) => message.role === "user")
      .toSorted(
        (left, right) =>
          left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds ||
          left.id.localeCompare(right.id),
      );
    const latest = messages.at(-1);
    if (latest === undefined) return;
    const speakers = messages.map(speakerOf);
    const members: ReadonlyArray<RoomMember> = room.memberIds.flatMap((id) => {
      const tot = tots.find((candidate) => candidate.id === id);
      return tot === undefined ? [] : [{ id, name: tot.name }];
    });
    const speaker = speakerOf(latest);
    const decision = decideRoomTurn({
      speaker,
      text: latest.text,
      members,
      moderatorId: room.moderatorId,
      totMessagesInARow: trailingTotMessages(speakers),
      hopLimit: room.hopLimit,
    });
    if (decision.paused) {
      yield* post(room, {
        text: `Paused after ${room.hopLimit} replies from Tots in a row. Write a message or @mention a Tot to continue.`,
        system: true,
      });
      return;
    }
    const transcript = messages
      .slice(-TRANSCRIPT_LINES)
      .map((message) => `${labelOf(speakerOf(message), tots)}: ${message.text}`);
    const addressedBy = labelOf(speaker, tots);
    for (const memberId of decision.wake) {
      const member = tots.find((candidate) => candidate.id === memberId);
      if (member === undefined) continue;
      yield* wake({ room, member, members, transcript, addressedBy });
    }
  });

  const isRoomMessage = (event: OrchestrationV2DomainEvent) =>
    event.type === "message.updated" &&
    parseGroupChatThreadId(event.threadId) !== null &&
    event.payload.role === "user" &&
    event.payload.runId === null;

  /** Members who no longer exist leave their rooms; a room left with one Tot closes. */
  const prune = Effect.fn("GroupChatService.prune")(function* () {
    const { rooms, tots } = yield* readState;
    for (const room of rooms) {
      const present = room.memberIds.filter((id) => tots.some((tot) => tot.id === id));
      if (present.length === room.memberIds.length) continue;
      if (present.length < 2) {
        yield* removeUnlocked(room);
        continue;
      }
      const moderatorId = present.includes(room.moderatorId) ? room.moderatorId : present[0]!;
      yield* writeRooms((current) =>
        current.map((entry) =>
          entry.id === room.id ? { ...entry, memberIds: present, moderatorId } : entry,
        ),
      );
    }
  }, locked);

  const start = Effect.gen(function* () {
    yield* prune().pipe(Effect.ignore);
    yield* settings.streamChanges.pipe(
      Stream.runForEach(() => prune().pipe(Effect.ignore)),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* threads.streamDomainEvents.pipe(
      Stream.filter(isRoomMessage),
      Stream.runForEach((event) => react(event.threadId).pipe(Effect.ignore)),
      Effect.ignore,
      Effect.forkScoped,
    );
  });

  return GroupChatService.of({ list, create, update, remove, say, start });
});

export const layer = Layer.effect(GroupChatService, make);
