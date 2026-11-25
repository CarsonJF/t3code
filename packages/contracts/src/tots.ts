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

export const TOT_SHAPES = [
  "round",
  "squircle",
  "blob",
  "flower",
  "clover",
  "burst",
  "cloud",
  "drop",
  "gem",
] as const;
export const TotShape = Schema.Literals(TOT_SHAPES);
export type TotShape = typeof TotShape.Type;

const TOT_ACCESSORY_ID_MAX_LENGTH = 64;

/**
 * A BoopFace accessory id: lowercase alphanumeric segments joined by dots or
 * hyphens, such as `cardinal.top-hat`. Bare legacy ids (`top-hat`) still
 * decode; an id this build does not know passes through and is skipped when
 * drawn, so a newer catalog needs no T3 release.
 */
export const TotAccessoryId = Schema.String.check(
  Schema.isMaxLength(TOT_ACCESSORY_ID_MAX_LENGTH),
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
);
export type TotAccessoryId = typeof TotAccessoryId.Type;

/** One accessory on a Tot's face. */
export const TotAccessory = Schema.Struct({
  kind: TotAccessoryId.annotate({
    description: "A BoopFace accessory id from its catalog, such as cardinal.top-hat.",
  }),
  /** Any hex color; the accessory's own color when absent. */
  color: Schema.optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
});
export type TotAccessory = typeof TotAccessory.Type;

const TOT_MAX_ACCESSORIES = 3;

export const TotAvatar = Schema.Struct({
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  /** A BoopFace skin number; the flat color when absent. */
  skin: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 }))),
  /** The head outline; BoopFace's own rounded head when absent. */
  shape: Schema.optional(TotShape),
  /** BoopFace's antenna dot; hidden when absent. */
  antenna: Schema.optional(Schema.Boolean),
  /** The accessories it wears, at most three; absent for older Tots, which wear none. */
  accessories: Schema.optional(
    Schema.Array(TotAccessory).check(Schema.isMaxLength(TOT_MAX_ACCESSORIES)),
  ),
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

/**
 * Which findings reach this Tot: `launched` only threads it started, `explicit`
 * every stored watch too, `off` none. Absent means `launched`.
 */
export const TOT_WATCH_REPORTS = ["launched", "explicit", "off"] as const;
export const TotWatchReports = Schema.Literals(TOT_WATCH_REPORTS);
export type TotWatchReports = typeof TotWatchReports.Type;

export const TotWatch = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  reason: TotWatchReason,
  runId: Schema.optional(RunId),
});
export type TotWatch = typeof TotWatch.Type;

export const TOT_MAX_DESIGNS = 12;

export const TOT_THEME_MAX_LENGTH = 20_000;

/** A Tot's own theme. The app applies `css` to that Tot's conversation only. */
export const TotTheme = Schema.Struct({
  css: Schema.optional(Schema.String.check(Schema.isMaxLength(TOT_THEME_MAX_LENGTH))),
  /**
   * Opaque text for the effect layer: it reads this string. T3 Code stores and
   * returns it only; nothing here runs, parses or executes it, and the settings
   * editor is its only view.
   */
  effect: Schema.optional(Schema.String.check(Schema.isMaxLength(TOT_THEME_MAX_LENGTH))),
});
export type TotTheme = typeof TotTheme.Type;

/** A theme write: an absent field keeps its stored value; `""` or null clears it. */
export const TotThemePatch = Schema.Struct({
  css: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(TOT_THEME_MAX_LENGTH))),
  ),
  effect: Schema.optional(
    Schema.NullOr(Schema.String.check(Schema.isMaxLength(TOT_THEME_MAX_LENGTH))),
  ),
});
export type TotThemePatch = typeof TotThemePatch.Type;

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
  /** Persisted; absent means `launched`, so older Tots decode unchanged. */
  watchReports: Schema.optional(TotWatchReports),
  /** Faces the Tot designed for itself, newest first, kept as options. */
  designs: Schema.optional(Schema.Array(TotAvatar).check(Schema.isMaxLength(TOT_MAX_DESIGNS))),
  theme: Schema.optional(TotTheme),
  /** Opt-in: absent or false keeps the Tot's own thread out of automatic settlement. */
  autoSettle: Schema.optional(Schema.Boolean),
  /** Replaces the environment's usage-limit fallback list for this Tot's work; `[]` turns it off. */
  usageLimitFallbackModels: Schema.optional(Schema.Array(ModelSelection)),
});
export type Tot = typeof Tot.Type;

/** The mode in effect for a Tot: `launched` until it is set. */
export const totWatchReportsOf = (tot: Pick<Tot, "watchReports">): TotWatchReports =>
  tot.watchReports ?? "launched";

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
const TOT_THREAD_ID_PREFIX = "tot:";
/** Every thread a Tot launches; clients leave those to the Tot instead of notifying. */
const TOT_LAUNCHED_THREAD_ID_PREFIX = "tot-launched:";
/** Watch reports T3 Code sends into a Tot's thread. */
export const TOT_REPORT_MESSAGE_ID_PREFIX = "tot-report:";

export const totThreadId = (totId: TotId, nonce: string): ThreadId =>
  ThreadId.make(`${TOT_THREAD_ID_PREFIX}${totId}:${nonce}`);

export const parseTotThreadId = (threadId: string): TotId | null =>
  parsePrefixed(TOT_THREAD_ID_PREFIX, threadId);

export const totLaunchedThreadId = (totId: TotId, commandId: string): ThreadId =>
  ThreadId.make(`${TOT_LAUNCHED_THREAD_ID_PREFIX}${totId}:${commandId}`);

/** Told to a thread a Tot launched, on each turn that Tot's message starts. */
export const TOT_WORKER_NOTE =
  "[T3 Code: a Tot is waiting on this thread's result. Do not end your turn while a check you own is still running, unless you mark it with a background-wait tool if you have one. End with a plain statement: done, blocked, or the decision you need.]";

/** A launch over a peer link records no sender, so an MCP message with none counts as the Tot's. */
export const isTotWorkerMessage = (
  threadId: string,
  message: {
    readonly createdBy: string;
    readonly creationSource: string;
    readonly senderThreadId?: string | undefined;
    readonly linkedSender?: { readonly threadId: string } | undefined;
  },
): boolean => {
  if (message.createdBy !== "agent" || message.creationSource !== "mcp") return false;
  const owner = parseTotLaunchedThreadId(threadId);
  if (owner === null) return false;
  const sender = message.linkedSender?.threadId ?? message.senderThreadId;
  return sender === undefined || parseTotThreadId(sender) === owner;
};

export const parseTotLaunchedThreadId = (threadId: string): TotId | null =>
  parsePrefixed(TOT_LAUNCHED_THREAD_ID_PREFIX, threadId);

/** A Tot's own thread settles automatically only when its Tot opted in. */
export const totThreadAutoSettles = (threadId: string, tots: ReadonlyArray<Tot>): boolean => {
  const owner = parseTotThreadId(threadId);
  return owner === null || tots.some((tot) => tot.id === owner && tot.autoSettle === true);
};

/**
 * Whether a thread a Tot launched should stay quiet. Where no Tot settings
 * name its owner (a linked environment, or `tots` null), the Tot lives on
 * another host: a launched thread only exists while its Tot was on.
 */
export const isQuietTotThread = (threadId: string, tots: ReadonlyArray<Tot> | null): boolean => {
  const owner = parseTotLaunchedThreadId(threadId);
  if (owner === null) return false;
  // A Tot never turned on here (every server decodes a default Home) is hosted elsewhere.
  const tot = tots?.find((candidate) => candidate.id === owner && candidate.projectId !== null);
  return tot === undefined || tot.threadId !== null;
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
  theme: Schema.optional(TotThemePatch),
  watchReports: Schema.optional(TotWatchReports),
  autoSettle: Schema.optional(Schema.Boolean),
  /** Null goes back to the environment's list. */
  usageLimitFallbackModels: Schema.optional(Schema.NullOr(Schema.Array(ModelSelection))),
});
export type TotUpdateInput = typeof TotUpdateInput.Type;

export const TotDesignAvatarInput = Schema.Struct({
  id: TotId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
});
export type TotDesignAvatarInput = typeof TotDesignAvatarInput.Type;

export const TotIdInput = Schema.Struct({ id: TotId });
export type TotIdInput = typeof TotIdInput.Type;

export const TotEnableInput = Schema.Struct({
  id: TotId,
  /** Defaults to the model the Tot last ran with. */
  modelSelection: Schema.optional(ModelSelection),
});
export type TotEnableInput = typeof TotEnableInput.Type;

export const TotThreadResult = Schema.Struct({ threadId: ThreadId });
export type TotThreadResult = typeof TotThreadResult.Type;

/** A text file in a Tot's memory, by path under its folder: `MEMORY.md` or `memory/...`. */
export const TotMemoryFile = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(200)),
  content: Schema.String.check(Schema.isMaxLength(262_144)),
});
export type TotMemoryFile = typeof TotMemoryFile.Type;

/** `id: null` reads the memory every Tot shares. */
export const TotMemoryReadInput = Schema.Struct({ id: Schema.NullOr(TotId) });
export type TotMemoryReadInput = typeof TotMemoryReadInput.Type;

export const TotMemory = Schema.Struct({ files: Schema.Array(TotMemoryFile) });
export type TotMemory = typeof TotMemory.Type;

export const TOT_MEMORY_MAX_FILES = 200;

export const TotMemoryWriteInput = Schema.Struct({
  id: TotId,
  files: Schema.Array(TotMemoryFile).check(Schema.isMaxLength(TOT_MEMORY_MAX_FILES)),
});
export type TotMemoryWriteInput = typeof TotMemoryWriteInput.Type;

export class TotError extends Schema.TaggedError<TotError>()("TotError", {
  message: Schema.String,
}) {}
