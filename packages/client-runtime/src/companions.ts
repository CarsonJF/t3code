import {
  ThreadId,
  type CompanionAvatar,
  type CompanionLinkedThread,
  type CompanionManifest,
  type CompanionMessage,
  type CompanionNeedsYou,
  type EnvironmentId,
  type ExternalCompanionChannelEvent,
  type TotAvatar,
  type TotFaceState,
  type TotOpenBotMaterial,
} from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A channel as its viewer sees it: the newest page plus everything since, in order. */
export interface CompanionChannelView {
  readonly messages: ReadonlyArray<CompanionMessage>;
  readonly nextCursor: string | null;
  /** Messages still streaming; `message.done` ends them. */
  readonly streaming: ReadonlySet<string>;
  /** Items that named no message. */
  readonly looseNeedsYou: ReadonlyArray<CompanionNeedsYou>;
}

export const EMPTY_CHANNEL_VIEW: CompanionChannelView = {
  messages: [],
  nextCursor: null,
  streaming: new Set(),
  looseNeedsYou: [],
};

const updateMessage = (
  view: CompanionChannelView,
  messageId: string,
  change: (message: CompanionMessage) => CompanionMessage,
): CompanionChannelView => {
  const index = view.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return view;
  const messages = view.messages.slice();
  messages[index] = change(messages[index] as CompanionMessage);
  return { ...view, messages };
};

const upsertBy = <A>(items: ReadonlyArray<A>, item: A, same: (left: A, right: A) => boolean) =>
  items.some((existing) => same(existing, item))
    ? items.map((existing) => (same(existing, item) ? item : existing))
    : [...items, item];

const upsertMessage = (view: CompanionChannelView, message: CompanionMessage) => ({
  ...view,
  messages: upsertBy(view.messages, message, (left, right) => left.id === right.id),
});

const resolve = (
  needsYou: CompanionNeedsYou,
  id: string,
  resolution: CompanionNeedsYou["resolution"],
): CompanionNeedsYou =>
  needsYou.id === id
    ? { ...needsYou, status: "resolved", ...(resolution === undefined ? {} : { resolution }) }
    : needsYou;

/** Folds one event from `companions.channel` into the view. */
export function reduceCompanionChannel(
  view: CompanionChannelView,
  event: ExternalCompanionChannelEvent,
): CompanionChannelView {
  switch (event.type) {
    case "snapshot":
      return {
        messages: event.messages,
        nextCursor: event.nextCursor,
        streaming: new Set(),
        looseNeedsYou: view.looseNeedsYou,
      };
    case "message.created":
      return upsertMessage(view, event.message);
    case "message.delta":
      return {
        ...updateMessage(view, event.messageId, (message) => ({
          ...message,
          text: message.text + event.delta,
        })),
        streaming: new Set(view.streaming).add(event.messageId),
      };
    case "message.done": {
      const streaming = new Set(view.streaming);
      streaming.delete(event.messageId);
      const next = event.message === undefined ? view : upsertMessage(view, event.message);
      return { ...next, streaming };
    }
    case "tool.state":
      return updateMessage(view, event.messageId, (message) => ({
        ...message,
        toolCalls: upsertBy(
          message.toolCalls,
          event.toolCall,
          (left, right) => left.id === right.id,
        ),
      }));
    case "thread.linked":
      return updateMessage(view, event.messageId, (message) => ({
        ...message,
        linkedThreads: upsertBy(
          message.linkedThreads,
          event.linkedThread,
          (left, right) => left.threadId === right.threadId,
        ),
      }));
    case "needs_you.created": {
      const same = (left: CompanionNeedsYou, right: CompanionNeedsYou) => left.id === right.id;
      if (event.messageId !== undefined && view.messages.some((m) => m.id === event.messageId)) {
        return updateMessage(view, event.messageId, (message) => ({
          ...message,
          needsYou: upsertBy(message.needsYou, event.needsYou, same),
        }));
      }
      return { ...view, looseNeedsYou: upsertBy(view.looseNeedsYou, event.needsYou, same) };
    }
    case "needs_you.resolved":
      return {
        ...view,
        messages: view.messages.map((message) =>
          message.needsYou.some((needsYou) => needsYou.id === event.needsYouId)
            ? {
                ...message,
                needsYou: message.needsYou.map((needsYou) =>
                  resolve(needsYou, event.needsYouId, event.resolution),
                ),
              }
            : message,
        ),
        looseNeedsYou: view.looseNeedsYou.filter((needsYou) => needsYou.id !== event.needsYouId),
      };
    default:
      return view;
  }
}

/** Older pages before the live ones, each message once. */
export function withOlderMessages(
  older: ReadonlyArray<CompanionMessage>,
  live: ReadonlyArray<CompanionMessage>,
): ReadonlyArray<CompanionMessage> {
  const seen = new Set(live.map((message) => message.id));
  return [...older.filter((message) => !seen.has(message.id)), ...live];
}

export const companionChannelId = (childId: string | null) =>
  childId === null ? "main" : `child:${childId}`;

/** The child a channel belongs to, or null for `main`. */
export const companionChannelChildId = (channel: string): string | null =>
  channel.startsWith("child:") ? channel.slice("child:".length) : null;

/** Unread messages across a companion's children, as its collapsed row shows them. */
export const companionUnreadCount = (manifest: CompanionManifest | null): number =>
  (manifest?.children ?? []).reduce((total, child) => total + child.unreadCount, 0);

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);

/** The thread a linked-thread card names: its link's environment if it has one, else the companion's. */
export function companionLinkedThreadTarget(
  thread: CompanionLinkedThread,
  environmentId: EnvironmentId,
): { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null {
  const parsed = thread.link === undefined ? null : parseThreadLinkHref(thread.link);
  if (parsed !== null)
    return { environmentId: parsed.environmentId ?? environmentId, threadId: parsed.threadId };
  const threadId = Option.getOrNull(decodeThreadId(thread.threadId));
  return threadId === null ? null : { environmentId, threadId };
}

/** What a resolved needs-you item was answered with, when the companion said. */
export const companionResolutionText = (
  resolution: CompanionNeedsYou["resolution"],
): string | null => {
  if (resolution === undefined || resolution === null) return null;
  if (typeof resolution === "string") return resolution;
  return resolution.answer ?? resolution.decision ?? null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MATERIALS: ReadonlyArray<TotOpenBotMaterial> = ["flat", "fluffy", "glass", "soft"];
const FALLBACK_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
const FIGURE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fallbackColor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length] as string;
};

/**
 * A companion's open-bot descriptor as a face T3 can draw. Anything missing or malformed falls
 * back: the default figure, flat, and a color picked from `seed`.
 */
export function companionAvatar(avatar: CompanionAvatar | undefined, seed: string): TotAvatar {
  const color =
    avatar?.color !== undefined && HEX.test(avatar.color) ? avatar.color : fallbackColor(seed);
  const material = MATERIALS.find((candidate) => candidate === avatar?.material);
  const figure =
    avatar?.figure !== undefined && FIGURE.test(avatar.figure) && avatar.figure.length <= 48
      ? avatar.figure
      : "chat";
  return {
    color,
    style: "open-bot",
    openBot: {
      figure,
      ...(material === undefined ? {} : { material }),
      ...(avatar?.mood === "happy" ? { mood: "happy" as const } : {}),
    },
  };
}

const FACE_STATES: Readonly<Record<string, TotFaceState>> = {
  idle: "idle",
  working: "working",
  thinking: "working",
  waiting: "needs-you",
  "needs-you": "needs-you",
  done: "success",
  success: "success",
  blocked: "failure",
  error: "failure",
  failure: "failure",
  sleep: "sleep",
};

/** An `avatar.state` value as a face state; unknown ones show idle. */
export const companionFaceState = (state: string | undefined, online: boolean): TotFaceState =>
  !online ? "sleep" : ((state === undefined ? undefined : FACE_STATES[state]) ?? "idle");
