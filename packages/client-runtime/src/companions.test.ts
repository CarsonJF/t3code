import {
  EnvironmentId,
  type CompanionMessage,
  type ExternalCompanionChannelEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_CHANNEL_VIEW,
  companionAvatar,
  companionChannelChildId,
  companionChannelId,
  companionFaceState,
  companionLinkedThreadTarget,
  companionResolutionText,
  companionUnreadCount,
  reduceCompanionChannel,
  withOlderMessages,
} from "./companions.ts";

const message = (
  id: string,
  text = "",
  extra: Partial<CompanionMessage> = {},
): CompanionMessage => ({
  id,
  role: "assistant",
  createdAt: "2026-11-25T12:00:00.000Z",
  text,
  toolCalls: [],
  linkedThreads: [],
  needsYou: [],
  ...extra,
});

const fold = (events: ReadonlyArray<ExternalCompanionChannelEvent>) =>
  events.reduce(reduceCompanionChannel, EMPTY_CHANNEL_VIEW);

describe("reduceCompanionChannel", () => {
  it("streams a reply, updates its tool cards and links, then settles it", () => {
    const view = fold([
      { type: "snapshot", messages: [message("a", "hi")], nextCursor: "c1" },
      { type: "message.created", channel: "main", message: message("b") },
      { type: "message.delta", channel: "main", messageId: "b", delta: "Hel" },
      { type: "message.delta", channel: "main", messageId: "b", delta: "lo" },
      {
        type: "tool.state",
        channel: "main",
        messageId: "b",
        toolCall: { id: "t", name: "search", status: "running" },
      },
      {
        type: "tool.state",
        channel: "main",
        messageId: "b",
        toolCall: { id: "t", name: "search", status: "done", summary: "3 hits" },
      },
      {
        type: "thread.linked",
        channel: "main",
        messageId: "b",
        linkedThread: { threadId: "thread-1", title: "Fix it" },
      },
    ]);
    expect(view.nextCursor).toBe("c1");
    expect(view.streaming.has("b")).toBe(true);
    expect(view.messages[1]).toMatchObject({
      text: "Hello",
      toolCalls: [{ id: "t", status: "done", summary: "3 hits" }],
      linkedThreads: [{ threadId: "thread-1" }],
    });
    const done = reduceCompanionChannel(view, {
      type: "message.done",
      channel: "main",
      messageId: "b",
    });
    expect(done.streaming.size).toBe(0);
    expect(done.messages[1]?.text).toBe("Hello");
  });

  it("shows needs-you items on their message, loose ones apart, and resolves both", () => {
    const view = fold([
      { type: "snapshot", messages: [message("a")], nextCursor: null },
      {
        type: "needs_you.created",
        channel: "main",
        messageId: "a",
        needsYou: { id: "n1", kind: "approval", prompt: "Ship?", status: "pending" },
      },
      {
        type: "needs_you.created",
        channel: "main",
        needsYou: { id: "n2", kind: "question", prompt: "Which?", status: "pending" },
      },
      { type: "needs_you.resolved", needsYouId: "n1", resolution: { decision: "accept" } },
      { type: "needs_you.resolved", needsYouId: "n2" },
    ]);
    expect(view.messages[0]?.needsYou).toEqual([
      {
        id: "n1",
        kind: "approval",
        prompt: "Ship?",
        status: "resolved",
        resolution: { decision: "accept" },
      },
    ]);
    expect(view.looseNeedsYou).toEqual([]);
  });

  it("replaces the page on a resync and keeps older pages once each", () => {
    const view = fold([
      { type: "snapshot", messages: [message("b"), message("c")], nextCursor: "1" },
      { type: "snapshot", messages: [message("c"), message("d")], nextCursor: "2" },
    ]);
    expect(view.messages.map((entry) => entry.id)).toEqual(["c", "d"]);
    expect(withOlderMessages([message("a"), message("c")], view.messages).map((m) => m.id)).toEqual(
      ["a", "c", "d"],
    );
  });
});

describe("companionAvatar", () => {
  it("draws the descriptor it is given", () => {
    expect(
      companionAvatar(
        { style: "open-bot", figure: "rocket", color: "#0ea5e9", material: "soft", mood: "happy" },
        "x",
      ),
    ).toEqual({
      color: "#0ea5e9",
      style: "open-bot",
      openBot: { figure: "rocket", material: "soft", mood: "happy" },
    });
  });

  it("falls back for missing or malformed parts, the same way each time", () => {
    const fallback = companionAvatar(
      { figure: "<script>", color: "red", material: "lava" },
      "seed",
    );
    expect(fallback.openBot).toEqual({ figure: "chat" });
    expect(fallback.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(companionAvatar(undefined, "seed")).toEqual(fallback);
  });
});

describe("companionFaceState", () => {
  it("maps avatar.state values and sleeps while offline", () => {
    expect(companionFaceState("working", true)).toBe("working");
    expect(companionFaceState("waiting", true)).toBe("needs-you");
    expect(companionFaceState("blocked", true)).toBe("failure");
    expect(companionFaceState("dancing", true)).toBe("idle");
    expect(companionFaceState("working", false)).toBe("sleep");
  });
});

describe("channel helpers", () => {
  it("round-trips a child's channel id", () => {
    expect(companionChannelChildId(companionChannelId("scout"))).toBe("scout");
    expect(companionChannelChildId(companionChannelId(null))).toBeNull();
  });

  it("totals unread messages across children", () => {
    expect(companionUnreadCount(null)).toBe(0);
    expect(
      companionUnreadCount({
        protocol: "companion.v1",
        id: "yui",
        name: "Yui",
        capabilities: {},
        children: [
          { id: "a", name: "A", unreadCount: 2 },
          { id: "b", name: "B", unreadCount: 3 },
        ],
      }),
    ).toBe(5);
  });
});

describe("companionLinkedThreadTarget", () => {
  const home = EnvironmentId.make("env-home");

  it("prefers the link's own environment and falls back to the companion's", () => {
    expect(
      companionLinkedThreadTarget(
        { threadId: "ignored", link: "t3-thread://v2/env-1/thread-a" },
        home,
      ),
    ).toEqual({ environmentId: "env-1", threadId: "thread-a" });
    expect(
      companionLinkedThreadTarget({ threadId: "x", link: "t3-thread://v1/thread-b" }, home),
    ).toEqual({ environmentId: home, threadId: "thread-b" });
    expect(companionLinkedThreadTarget({ threadId: "thread:c" }, home)).toEqual({
      environmentId: home,
      threadId: "thread:c",
    });
  });
});

describe("companionResolutionText", () => {
  it("reads a plain or structured resolution", () => {
    expect(companionResolutionText(undefined)).toBeNull();
    expect(companionResolutionText(null)).toBeNull();
    expect(companionResolutionText("yes")).toBe("yes");
    expect(companionResolutionText({ answer: "blue" })).toBe("blue");
    expect(companionResolutionText({ decision: "decline" })).toBe("decline");
  });
});
