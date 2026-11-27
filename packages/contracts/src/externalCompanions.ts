/**
 * External Companion Protocol v1: an agent service the user runs elsewhere that T3 shows in its
 * own sidebar section. The server is the only side that talks to a companion, so its token never
 * reaches a client. Everything a companion sends is untrusted: decoded here, rendered as text.
 * See docs/user/external-companion-protocol.md.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AuthMcpClientAccess } from "./auth.ts";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SettingsSecretValue } from "./settingsSecretValue.ts";
import { TotTheme } from "./tots.ts";

const COMPANION_PROTOCOL = "companion.v1";

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max));
const Id = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9._:-]+$/),
);
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const list = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));
const defaultList = <S extends Schema.Top>(item: S, max: number) =>
  list(item, max).pipe(Schema.withDecodingDefault(Effect.succeed([])));

// ── Settings ────────────────────────────────────────────────────────────────

export const ExternalCompanionId = Schema.String.check(
  Schema.isMaxLength(48),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);
export type ExternalCompanionId = typeof ExternalCompanionId.Type;

export const ExternalCompanionConfig = Schema.Struct({
  id: ExternalCompanionId,
  /** Shown until the companion answers; the manifest's name replaces it. */
  label: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  /** Where `/companion/v1/...` lives, such as http://127.0.0.1:4790. */
  baseUrl: TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\/[^\s]+$/)),
  /** The bearer token T3 sends the companion. Kept in the secret store. */
  token: SettingsSecretValue.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("")),
    Schema.annotateKey({ settingsSecret: true }),
  ),
  /**
   * The companion view's look, a Tot theme scoped to `[data-companion-id="<id>"]`. Set on
   * this server only (settings or `t3_companion_theme_set`); the manifest and events never
   * carry one, since everything the companion sends is untrusted.
   */
  theme: Schema.optional(TotTheme),
});
export type ExternalCompanionConfig = typeof ExternalCompanionConfig.Type;

export const ExternalCompanionConfigs = Schema.Array(ExternalCompanionConfig).check(
  Schema.makeFilter(
    (companions: ReadonlyArray<{ readonly id: string }>) =>
      new Set(companions.map((companion) => companion.id)).size === companions.length ||
      "Companion ids must be unique.",
  ),
);

// ── Protocol v1 payloads ─────────────────────────────────────────────────────

/** An open-bot face. Fields are loose on purpose: clients draw a fallback for what they lack. */
export const CompanionAvatar = Schema.Struct({
  style: Schema.optional(Text(32)),
  figure: Schema.optional(Text(64)),
  color: Schema.optional(Text(32)),
  material: Schema.optional(Text(32)),
  mood: Schema.optional(Text(32)),
});
export type CompanionAvatar = typeof CompanionAvatar.Type;

export const CompanionChild = Schema.Struct({
  id: Id,
  name: Text(120),
  role: Schema.optional(Text(200)),
  avatar: Schema.optional(CompanionAvatar),
  unreadCount: Count.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
});
export type CompanionChild = typeof CompanionChild.Type;

export const CompanionManifest = Schema.Struct({
  protocol: Schema.Literal(COMPANION_PROTOCOL),
  id: Id,
  name: Text(120).check(Schema.isMinLength(1)),
  tagline: Schema.optional(Text(300)),
  avatar: Schema.optional(CompanionAvatar),
  capabilities: Schema.Struct({
    streaming: Schema.optional(Schema.Boolean),
    needsYou: Schema.optional(Schema.Boolean),
    linkedThreads: Schema.optional(Schema.Boolean),
    children: Schema.optional(Schema.Boolean),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  childrenLabel: Schema.optional(Text(60)),
  children: defaultList(CompanionChild, 200),
});
export type CompanionManifest = typeof CompanionManifest.Type;

/** `main`, or `child:<id>` for one of the manifest's children. */
export const CompanionChannelId = Schema.String.check(
  Schema.isMaxLength(140),
  Schema.isPattern(/^(?:main|child:[A-Za-z0-9._:-]{1,128})$/),
);
export type CompanionChannelId = typeof CompanionChannelId.Type;

export const CompanionToolCall = Schema.Struct({
  id: Id,
  name: Text(200),
  /** running, done or error; anything else shows as given. */
  status: Text(32),
  summary: Schema.optional(Text(2_000)),
});
export type CompanionToolCall = typeof CompanionToolCall.Type;

export const CompanionLinkedThread = Schema.Struct({
  threadId: Text(200).check(Schema.isMinLength(1)),
  title: Schema.optional(Text(300)),
  status: Schema.optional(Text(32)),
  /** A T3 thread link, such as one `t3_thread_launch` returned. */
  link: Schema.optional(Text(2_000)),
});
export type CompanionLinkedThread = typeof CompanionLinkedThread.Type;

export const CompanionDecision = Schema.Literals(["accept", "decline"]);
export type CompanionDecision = typeof CompanionDecision.Type;

export const CompanionNeedsYouResolution = Schema.Union([
  Text(2_000),
  Schema.Struct({
    decision: Schema.optional(CompanionDecision),
    answer: Schema.optional(Text(2_000)),
  }),
]);

export const CompanionNeedsYou = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["question", "approval"]),
  prompt: Text(4_000),
  options: Schema.optional(list(Text(200), 20)),
  /** pending until answered; anything else counts as resolved. */
  status: Text(32),
  resolution: Schema.optional(Schema.NullOr(CompanionNeedsYouResolution)),
});
export type CompanionNeedsYou = typeof CompanionNeedsYou.Type;

export const CompanionMessage = Schema.Struct({
  id: Id,
  role: Schema.Literals(["user", "assistant", "system"]),
  createdAt: IsoDateTime,
  /** Where the message was written, such as t3, discord or voice. */
  sourceSurface: Schema.optional(Text(40)),
  /** Markdown. Rendered without raw HTML. */
  text: Text(200_000).pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  toolCalls: defaultList(CompanionToolCall, 100),
  linkedThreads: defaultList(CompanionLinkedThread, 50),
  needsYou: defaultList(CompanionNeedsYou, 20),
});
export type CompanionMessage = typeof CompanionMessage.Type;

export const CompanionHistoryPage = Schema.Struct({
  messages: list(CompanionMessage, 200),
  /** Pass as `before` for older messages; null or absent at the start. */
  nextCursor: Schema.optional(Schema.NullOr(Text(500))),
});
export type CompanionHistoryPage = typeof CompanionHistoryPage.Type;

export const CompanionPostResult = Schema.Struct({ messageId: Id });
export type CompanionPostResult = typeof CompanionPostResult.Type;

/** What `/companion/v1/events` sends; one JSON object per WebSocket text frame. */
export const CompanionEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("message.created"),
    channel: CompanionChannelId,
    message: CompanionMessage,
  }),
  Schema.Struct({
    type: Schema.Literal("message.delta"),
    channel: CompanionChannelId,
    messageId: Id,
    /** Appended to the message's text. */
    delta: Text(64_000),
  }),
  Schema.Struct({
    type: Schema.Literal("message.done"),
    channel: CompanionChannelId,
    messageId: Id,
    /** The final message; replaces the streamed one when present. */
    message: Schema.optional(CompanionMessage),
  }),
  Schema.Struct({
    type: Schema.Literal("tool.state"),
    channel: CompanionChannelId,
    messageId: Id,
    toolCall: CompanionToolCall,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.linked"),
    channel: CompanionChannelId,
    messageId: Id,
    linkedThread: CompanionLinkedThread,
  }),
  Schema.Struct({
    type: Schema.Literal("needs_you.created"),
    channel: CompanionChannelId,
    messageId: Schema.optional(Id),
    needsYou: CompanionNeedsYou,
  }),
  Schema.Struct({
    type: Schema.Literal("needs_you.resolved"),
    channel: Schema.optional(CompanionChannelId),
    needsYouId: Id,
    resolution: Schema.optional(Schema.NullOr(CompanionNeedsYouResolution)),
  }),
  Schema.Struct({
    type: Schema.Literal("avatar.state"),
    /** Absent for the companion itself. */
    childId: Schema.optional(Id),
    /** idle, working, waiting, done, blocked or sleep. */
    state: Text(32),
  }),
  Schema.Struct({
    type: Schema.Literal("child.updated"),
    child: CompanionChild,
  }),
]);
export type CompanionEvent = typeof CompanionEvent.Type;

// ── What T3 clients see ──────────────────────────────────────────────────────

export const ExternalCompanionConnection = Schema.Literals(["connecting", "connected", "offline"]);
export type ExternalCompanionConnection = typeof ExternalCompanionConnection.Type;

/** A companion's MCP grant, without any token. */
export const ExternalCompanionGrant = Schema.Struct({
  access: AuthMcpClientAccess,
  issuedAt: IsoDateTime,
  /** Null until the setup code is exchanged. */
  connectedAt: Schema.NullOr(IsoDateTime),
  lastRefreshedAt: Schema.NullOr(IsoDateTime),
  /** When the setup code, or else the refresh token, lapses unless used. */
  expiresAt: IsoDateTime,
});
export type ExternalCompanionGrant = typeof ExternalCompanionGrant.Type;

export const ExternalCompanionStatus = Schema.Struct({
  id: ExternalCompanionId,
  label: Schema.String,
  connection: ExternalCompanionConnection,
  /** Why it is offline, in T3's words. */
  error: Schema.NullOr(Schema.String),
  manifest: Schema.NullOr(CompanionManifest),
  /** The face state of the companion ("main") and of each child by id. */
  avatarStates: Schema.Record(Schema.String, Schema.String),
  grant: Schema.NullOr(ExternalCompanionGrant),
});
export type ExternalCompanionStatus = typeof ExternalCompanionStatus.Type;

export const ExternalCompanionsState = Schema.Struct({
  companions: Schema.Array(ExternalCompanionStatus),
});
export type ExternalCompanionsState = typeof ExternalCompanionsState.Type;

export const ExternalCompanionRef = Schema.Struct({ companionId: ExternalCompanionId });
export type ExternalCompanionRef = typeof ExternalCompanionRef.Type;

export const ExternalCompanionChannelRef = Schema.Struct({
  companionId: ExternalCompanionId,
  channel: CompanionChannelId,
});
export type ExternalCompanionChannelRef = typeof ExternalCompanionChannelRef.Type;

/** A channel's stream: its newest page (again after every reconnect), then its events. */
export const ExternalCompanionChannelEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    messages: Schema.Array(CompanionMessage),
    nextCursor: Schema.NullOr(Schema.String),
  }),
  CompanionEvent,
]);
export type ExternalCompanionChannelEvent = typeof ExternalCompanionChannelEvent.Type;

export const ExternalCompanionTestInput = Schema.Struct({
  baseUrl: Schema.String,
  /** Absent or the redacted marker: use the saved companion's token. */
  token: Schema.optional(SettingsSecretValue),
  companionId: Schema.optional(ExternalCompanionId),
});
export type ExternalCompanionTestInput = typeof ExternalCompanionTestInput.Type;

export const ExternalCompanionHistoryInput = Schema.Struct({
  ...ExternalCompanionChannelRef.fields,
  before: Schema.optional(Text(500)),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type ExternalCompanionHistoryInput = typeof ExternalCompanionHistoryInput.Type;

export const ExternalCompanionHistoryResult = Schema.Struct({
  messages: Schema.Array(CompanionMessage),
  nextCursor: Schema.NullOr(Schema.String),
});
export type ExternalCompanionHistoryResult = typeof ExternalCompanionHistoryResult.Type;

export const ExternalCompanionSendInput = Schema.Struct({
  ...ExternalCompanionChannelRef.fields,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
  /** The same id on a retry lets the companion drop the duplicate. */
  clientMessageId: Id,
});
export type ExternalCompanionSendInput = typeof ExternalCompanionSendInput.Type;

export const ExternalCompanionRespondInput = Schema.Struct({
  companionId: ExternalCompanionId,
  needsYouId: Id,
  decision: CompanionDecision,
  answer: Schema.optional(Text(4_000)),
});
export type ExternalCompanionRespondInput = typeof ExternalCompanionRespondInput.Type;

export const ExternalCompanionGrantIssueInput = Schema.Struct({
  companionId: ExternalCompanionId,
  access: AuthMcpClientAccess,
});
export type ExternalCompanionGrantIssueInput = typeof ExternalCompanionGrantIssueInput.Type;

/** Shown once: the companion exchanges it at the grant endpoint within its lifetime. */
export const ExternalCompanionGrantIssueResult = Schema.Struct({
  setupCode: Schema.String,
  expiresAt: IsoDateTime,
  /** The endpoint, as this server's loopback address sees it. */
  tokenEndpoint: Schema.String,
});
export type ExternalCompanionGrantIssueResult = typeof ExternalCompanionGrantIssueResult.Type;

export class ExternalCompanionError extends Schema.TaggedError<ExternalCompanionError>()(
  "ExternalCompanionError",
  { message: Schema.String },
) {}
