/**
 * Tots: agent threads that act for the user across projects and linked
 * environments, each with its own scope, instructions and face. Home is the
 * default Tot. The host server owns them in `ServerSettings.tots`; clients
 * cannot patch that field, only the Tot RPCs and tools write it.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const TotId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/),
).pipe(Schema.brand("TotId"));
export type TotId = typeof TotId.Type;

export const HOME_TOT_ID = TotId.make("home");

export const TotAvatar = Schema.Struct({
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  /** A BoopFace skin number; the flat color when absent. */
  skin: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }))),
});
export type TotAvatar = typeof TotAvatar.Type;

export const TotScopeProject = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type TotScopeProject = typeof TotScopeProject.Type;

/** What a Tot owns. Focus, not a fence: tools do not refuse calls outside it. */
export const TotScope = Schema.Union([
  Schema.Literal("all"),
  Schema.Struct({
    projects: Schema.Array(TotScopeProject),
    /** Sidebar thread group names, resolved when read. */
    groups: Schema.Array(TrimmedNonEmptyString),
  }),
]);
export type TotScope = typeof TotScope.Type;

/** `sent`: a run one Tot started in another Tot's thread; reported once that run ends. */
export const TotWatchReason = Schema.Literals(["launched", "requested", "sent"]);
export type TotWatchReason = typeof TotWatchReason.Type;

export const TotWatch = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  reason: TotWatchReason,
  runId: Schema.optional(RunId),
});
export type TotWatch = typeof TotWatch.Type;

export const Tot = Schema.Struct({
  id: TotId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(40)),
  avatar: TotAvatar,
  scope: TotScope,
  instructions: Schema.String.check(Schema.isMaxLength(20_000)),
  /** The Tot's managed project; null until it is first enabled. */
  projectId: Schema.NullOr(ProjectId),
  /** The current Tot thread. Null when the Tot is off. */
  threadId: Schema.NullOr(ThreadId),
  modelSelection: Schema.NullOr(ModelSelection),
  watchAll: Schema.Boolean,
  watches: Schema.Array(TotWatch),
});
export type Tot = typeof Tot.Type;

export const DEFAULT_HOME_TOT: Tot = {
  id: HOME_TOT_ID,
  name: "Home",
  avatar: { color: "#0A7EA4" },
  scope: "all",
  instructions: "",
  projectId: null,
  threadId: null,
  modelSelection: null,
  watchAll: false,
  watches: [],
};

export const TotsSetting = Schema.Array(Tot).pipe(
  Schema.withDecodingDefault(Effect.succeed([DEFAULT_HOME_TOT])),
);

export const totSlug = (name: string): TotId | null => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return slug === "" ? null : TotId.make(slug);
};

const isTotId = Schema.is(TotId);

const parsePrefixed = (prefix: string, id: string): TotId | null => {
  if (!id.startsWith(prefix)) return null;
  const totId = id.slice(prefix.length).split(":", 1)[0];
  return totId !== undefined && isTotId(totId) ? totId : null;
};

/** Every Tot thread, current or left behind by a fresh start. */
export const TOT_THREAD_ID_PREFIX = "tot:";
/** Every thread a Tot launches; clients leave those to the Tot instead of notifying. */
export const TOT_LAUNCHED_THREAD_ID_PREFIX = "tot-launched:";
/** Watch reports T3 Code sends into a Tot's thread. */
export const TOT_REPORT_MESSAGE_ID_PREFIX = "tot-report:";

export const totThreadId = (totId: TotId, nonce: string): ThreadId =>
  ThreadId.make(`${TOT_THREAD_ID_PREFIX}${totId}:${nonce}`);

export const parseTotThreadId = (threadId: string): TotId | null =>
  parsePrefixed(TOT_THREAD_ID_PREFIX, threadId);

export const totLaunchedThreadId = (totId: TotId, commandId: string): ThreadId =>
  ThreadId.make(`${TOT_LAUNCHED_THREAD_ID_PREFIX}${totId}:${commandId}`);

export const parseTotLaunchedThreadId = (threadId: string): TotId | null =>
  parsePrefixed(TOT_LAUNCHED_THREAD_ID_PREFIX, threadId);

/**
 * Whether a thread a Tot launched should stay quiet. `tots` is null where no
 * Tot settings name its owner (a linked environment): the host decides there,
 * and a launched thread only exists while its Tot was on.
 */
export const isQuietTotThread = (threadId: string, tots: ReadonlyArray<Tot> | null): boolean => {
  const owner = parseTotLaunchedThreadId(threadId);
  if (owner === null) return false;
  if (tots === null) return true;
  return tots.some((tot) => tot.id === owner && tot.threadId !== null);
};

export const TotFaceState = Schema.Literals([
  "idle",
  "working",
  "needs-you",
  "success",
  "failure",
  "sleep",
]);
export type TotFaceState = typeof TotFaceState.Type;

/** The BoopFace action that shows each state. */
export const TOT_FACE_ACTION: Record<TotFaceState, string> = {
  idle: "idle",
  working: "waiting-spin",
  "needs-you": "wary",
  success: "success",
  failure: "failure",
  sleep: "sleep",
};

export const TotCreateInput = Schema.Struct({
  name: Tot.fields.name,
  avatar: TotAvatar,
  scope: TotScope,
  instructions: Tot.fields.instructions,
  modelSelection: ModelSelection,
});
export type TotCreateInput = typeof TotCreateInput.Type;

export const TotUpdateInput = Schema.Struct({
  id: TotId,
  name: Schema.optional(Tot.fields.name),
  avatar: Schema.optional(TotAvatar),
  scope: Schema.optional(TotScope),
  instructions: Schema.optional(Tot.fields.instructions),
  modelSelection: Schema.optional(ModelSelection),
});
export type TotUpdateInput = typeof TotUpdateInput.Type;

export const TotIdInput = Schema.Struct({ id: TotId });
export type TotIdInput = typeof TotIdInput.Type;

export const TotThreadResult = Schema.Struct({ threadId: ThreadId });
export type TotThreadResult = typeof TotThreadResult.Type;

export class TotError extends Schema.TaggedError<TotError>()("TotError", {
  message: Schema.String,
}) {}
