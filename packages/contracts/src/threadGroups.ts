import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProjectColor, ProjectIconOverride, ReceivedProjectIcon } from "./project.ts";

export const ThreadGroupId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ThreadGroupId = typeof ThreadGroupId.Type;

export const ThreadGroupGradient = Schema.Struct({
  from: ProjectColor,
  to: ProjectColor,
});
export type ThreadGroupGradient = typeof ThreadGroupGradient.Type;

export const ThreadGroup = Schema.Struct({
  id: ThreadGroupId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  // With a gradient, `color` is its `from` stop, so clients without gradients still show a color.
  color: Schema.optional(Schema.NullOr(ProjectColor)),
  gradient: Schema.optional(Schema.NullOr(ThreadGroupGradient)),
  // Forward-compatible so a future icon kind drops the icon instead of failing the whole state.
  icon: Schema.optional(Schema.NullOr(ReceivedProjectIcon)),
});
export type ThreadGroup = typeof ThreadGroup.Type;

export const ThreadGroupProjectDefault = Schema.Struct({
  groupId: Schema.NullOr(ThreadGroupId),
  since: IsoDateTime,
});
export type ThreadGroupProjectDefault = typeof ThreadGroupProjectDefault.Type;

export const ThreadGroupsState = Schema.Struct({
  groups: Schema.Array(ThreadGroup).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  // Sorted by `since`, so a new default never moves threads created before it.
  projectDefaults: Schema.Record(ProjectId, Schema.Array(ThreadGroupProjectDefault)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  // `null` pins a thread outside every group, overriding its project default.
  threadOverrides: Schema.Record(ThreadId, Schema.NullOr(ThreadGroupId)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type ThreadGroupsState = typeof ThreadGroupsState.Type;

export const EMPTY_THREAD_GROUPS_STATE: ThreadGroupsState = {
  groups: [],
  projectDefaults: {},
  threadOverrides: {},
};

/** Applied in order under the settings write lock; ops naming a missing group are dropped. */
export const ThreadGroupOp = Schema.Union([
  /** Keeps an existing group with the same id, so clients can send it to ensure the group exists. */
  Schema.Struct({ type: Schema.Literal("createGroup"), group: ThreadGroup }),
  /** Only the fields present change. */
  Schema.Struct({
    type: Schema.Literal("updateGroup"),
    groupId: ThreadGroupId,
    name: Schema.optionalKey(ThreadGroup.fields.name),
    color: Schema.optionalKey(Schema.NullOr(ProjectColor)),
    gradient: Schema.optionalKey(Schema.NullOr(ThreadGroupGradient)),
    icon: Schema.optionalKey(Schema.NullOr(ProjectIconOverride)),
  }),
  Schema.Struct({ type: Schema.Literal("deleteGroup"), groupId: ThreadGroupId }),
  /** Listed groups take this order; unlisted ones keep their relative order after them. */
  Schema.Struct({ type: Schema.Literal("reorderGroups"), groupIds: Schema.Array(ThreadGroupId) }),
  Schema.Struct({
    type: Schema.Literal("setProjectDefault"),
    projectIds: Schema.Array(ProjectId),
    groupId: Schema.NullOr(ThreadGroupId),
    since: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("setThreadGroup"),
    threadId: ThreadId,
    groupId: Schema.NullOr(ThreadGroupId),
  }),
  /** One-time upload of client-local groups; adds only groups, projects and threads not yet set. */
  Schema.Struct({ type: Schema.Literal("import"), state: ThreadGroupsState }),
]);
export type ThreadGroupOp = typeof ThreadGroupOp.Type;
