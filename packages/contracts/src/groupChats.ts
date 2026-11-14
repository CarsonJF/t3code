/**
 * Group chats: one shared thread several Tots talk in with the user. The room
 * thread never runs an agent of its own. Messages in it are appended without a
 * run, and each member answers from its own Tot thread. The host server owns
 * them in `ServerSettings.groupChats`; only `GroupChatService` writes them.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { TotId } from "./tots.ts";

export const GroupChatId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/),
).pipe(Schema.brand("GroupChatId"));
export type GroupChatId = typeof GroupChatId.Type;

export const GROUP_CHAT_DEFAULT_HOP_LIMIT = 4;
const GROUP_CHAT_MAX_HOP_LIMIT = 12;
const GROUP_CHAT_MIN_MEMBERS = 2;
const GROUP_CHAT_MAX_MEMBERS = 8;

const GroupChatMembers = Schema.Array(TotId).check(
  Schema.isMinLength(GROUP_CHAT_MIN_MEMBERS),
  Schema.isMaxLength(GROUP_CHAT_MAX_MEMBERS),
);

const GroupChatHopLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: GROUP_CHAT_MAX_HOP_LIMIT }),
);

export const GroupChat = Schema.Struct({
  id: GroupChatId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  memberIds: GroupChatMembers,
  /** Answers when the user writes without naming anyone. */
  moderatorId: TotId,
  /** Replies Tots may chain among themselves after one user message. */
  hopLimit: GroupChatHopLimit,
  /** The room's project and thread; null until the room is set up. */
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
});
export type GroupChat = typeof GroupChat.Type;

export const GroupChatsSetting = Schema.Array(GroupChat).pipe(
  Schema.withDecodingDefault(Effect.succeed([])),
);

const ROOM_THREAD_ID_PREFIX = "tot-room:";
const isGroupChatId = Schema.is(GroupChatId);

export const groupChatThreadId = (id: GroupChatId): ThreadId =>
  ThreadId.make(`${ROOM_THREAD_ID_PREFIX}${id}`);

export const isGroupChatThreadId = (threadId: string): boolean =>
  threadId.startsWith(ROOM_THREAD_ID_PREFIX);

export const parseGroupChatThreadId = (threadId: string): GroupChatId | null => {
  if (!isGroupChatThreadId(threadId)) return null;
  const id = threadId.slice(ROOM_THREAD_ID_PREFIX.length);
  return isGroupChatId(id) ? id : null;
};

export const GroupChatCreateInput = Schema.Struct({
  name: GroupChat.fields.name,
  memberIds: GroupChatMembers,
  moderatorId: Schema.optional(TotId),
  hopLimit: Schema.optional(GroupChatHopLimit),
  /** The room thread's model; it never runs, but every thread has one. */
  modelSelection: ModelSelection,
});
export type GroupChatCreateInput = typeof GroupChatCreateInput.Type;

export const GroupChatUpdateInput = Schema.Struct({
  id: GroupChatId,
  name: Schema.optional(GroupChat.fields.name),
  memberIds: Schema.optional(GroupChatMembers),
  moderatorId: Schema.optional(TotId),
  hopLimit: Schema.optional(GroupChatHopLimit),
});
export type GroupChatUpdateInput = typeof GroupChatUpdateInput.Type;

export const GroupChatIdInput = Schema.Struct({ id: GroupChatId });
export type GroupChatIdInput = typeof GroupChatIdInput.Type;

export class GroupChatError extends Schema.TaggedError<GroupChatError>()("GroupChatError", {
  message: Schema.String,
}) {}
