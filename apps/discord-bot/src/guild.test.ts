// @effect-diagnostics nodeBuiltinImport:off - The webhook state is tested against a real temporary file.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  type GuildChannelView,
  type GuildTot,
  channelNameFor,
  createWebhookState,
  ensureGuildChannels,
  parseChannelTotMap,
  planGuildChannels,
  routeGuildMessage,
} from "./guild.ts";
import { createFakeAvatars, createFakeGuild, createFakeWebhookState } from "./guild.testkit.ts";
import { createLogger } from "./log.ts";

const home: GuildTot = { id: "home", name: "Home", avatar: { color: "#0a7ea4" } };
const squirt: GuildTot = { id: "squirt", name: "Squirt", avatar: { color: "#e879f9" } };

const textChannel = (id: string, name: string): GuildChannelView => ({ id, name, textual: true });

const eventsOf = (lines: ReadonlyArray<string>): ReadonlyArray<Record<string, unknown>> =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>);

const setup = (options: {
  readonly tots?: ReadonlyArray<GuildTot>;
  readonly channels?: ReadonlyArray<GuildChannelView>;
  readonly pinned?: ReadonlyMap<string, string>;
}) => {
  const guild = createFakeGuild(options.channels ?? []);
  const avatars = createFakeAvatars();
  const state = createFakeWebhookState();
  const lines: Array<string> = [];
  const logger = createLogger({ write: (line) => lines.push(line), now: () => 0 });
  return {
    guild,
    lines,
    run: (tots: ReadonlyArray<GuildTot> = options.tots ?? [home, squirt]) =>
      ensureGuildChannels({
        tots,
        pinned: options.pinned ?? new Map(),
        port: guild.port,
        avatars: avatars.store,
        state,
        logger,
      }),
  };
};

describe("channelNameFor", () => {
  it("names a channel after the Tot id, the way Discord lowercases names", () => {
    expect(channelNameFor("home")).toBe("tot-home");
    expect(channelNameFor("t3bot")).toBe("tot-t3bot");
  });
});

describe("parseChannelTotMap", () => {
  it("reads channelId=totId pairs across commas and newlines", () => {
    const parsed = parseChannelTotMap("1001=home, 1002=squirt\n1003=build");

    expect([...parsed.map]).toEqual([
      ["1001", "home"],
      ["1002", "squirt"],
      ["1003", "build"],
    ]);
    expect(parsed.problems).toEqual([]);
  });

  it("reports every entry it cannot read", () => {
    const parsed = parseChannelTotMap("1001=home 1002 nope=home 1003=Home! 1004=home=extra");

    expect([...parsed.map]).toEqual([["1001", "home"]]);
    expect(parsed.problems).toHaveLength(4);
  });

  it("refuses a channel listed twice", () => {
    const parsed = parseChannelTotMap("1001=home,1001=squirt");

    expect([...parsed.map]).toEqual([["1001", "home"]]);
    expect(parsed.problems.join(" ")).toContain("more than once");
  });

  it("is empty when unset", () => {
    expect(parseChannelTotMap(undefined)).toEqual({ map: new Map(), problems: [] });
  });
});

describe("planGuildChannels", () => {
  it("creates one channel per Tot when the server has none", () => {
    const plan = planGuildChannels({ tots: [home, squirt], channels: [], pinned: new Map() });

    expect(plan).toEqual([
      { kind: "create", totId: "home", name: "tot-home" },
      { kind: "create", totId: "squirt", name: "tot-squirt" },
    ]);
  });

  it("reuses a channel that already has the Tot's name instead of creating one", () => {
    const plan = planGuildChannels({
      tots: [home, squirt],
      channels: [textChannel("1001", "tot-home")],
      pinned: new Map(),
    });

    expect(plan).toEqual([
      { kind: "bind", totId: "home", channelId: "1001", via: "name" },
      { kind: "create", totId: "squirt", name: "tot-squirt" },
    ]);
  });

  it("never reuses a voice channel that happens to have the name", () => {
    const plan = planGuildChannels({
      tots: [home],
      channels: [{ id: "9", name: "tot-home", textual: false }],
      pinned: new Map(),
    });

    expect(plan).toEqual([{ kind: "create", totId: "home", name: "tot-home" }]);
  });

  it("lets a pin win over the default name", () => {
    const plan = planGuildChannels({
      tots: [home, squirt],
      channels: [textChannel("1001", "tot-home"), textChannel("2002", "general")],
      pinned: new Map([["2002", "home"]]),
    });

    expect(plan).toEqual([
      { kind: "bind", totId: "home", channelId: "2002", via: "pin" },
      { kind: "create", totId: "squirt", name: "tot-squirt" },
    ]);
  });

  it("skips a pin to a channel or Tot that is not there", () => {
    const plan = planGuildChannels({
      tots: [home],
      channels: [textChannel("1001", "tot-home")],
      pinned: new Map([
        ["9999", "home"],
        ["1001", "nobody"],
      ]),
    });

    expect(plan).toEqual([
      { kind: "skip", totId: "home", channelId: "9999", reason: "unknown-channel" },
      { kind: "skip", totId: "nobody", channelId: "1001", reason: "unknown-tot" },
      { kind: "bind", totId: "home", channelId: "1001", via: "name" },
    ]);
  });

  it("binds a Tot to one channel only", () => {
    const plan = planGuildChannels({
      tots: [home],
      channels: [textChannel("1001", "general"), textChannel("1002", "other")],
      pinned: new Map([
        ["1001", "home"],
        ["1002", "home"],
      ]),
    });

    expect(plan).toEqual([
      { kind: "bind", totId: "home", channelId: "1001", via: "pin" },
      { kind: "skip", totId: "home", channelId: "1002", reason: "already-bound" },
    ]);
  });

  it("never binds a pinned channel to a second Tot by its name", () => {
    const plan = planGuildChannels({
      tots: [home, squirt],
      channels: [textChannel("1001", "tot-home")],
      pinned: new Map([["1001", "squirt"]]),
    });

    expect(plan).toEqual([
      { kind: "bind", totId: "squirt", channelId: "1001", via: "pin" },
      { kind: "create", totId: "home", name: "tot-home" },
    ]);
  });
});

describe("ensureGuildChannels", () => {
  it("creates a text channel and a webhook for every Tot", async () => {
    const { guild, run } = setup({});

    const bindings = await run();

    expect(bindings.map((binding) => [binding.channelId, binding.totId])).toEqual([
      ["1001", "home"],
      ["1002", "squirt"],
    ]);
    expect(guild.channels.map((channel) => channel.name)).toEqual(["tot-home", "tot-squirt"]);
    expect(guild.calls).toEqual([
      "createChannel:tot-home",
      "createWebhook:1001",
      "createChannel:tot-squirt",
      "createWebhook:1002",
    ]);
    expect(guild.webhooksIn("1001")[0]).toMatchObject({ name: "Home", token: "webhook-token-1" });
  });

  it("makes no calls on a second run with the same Tots", async () => {
    const { guild, run } = setup({});
    const first = await run();

    const callsAfterFirst = [...guild.calls];
    const second = await run();

    expect(guild.calls).toEqual(callsAfterFirst);
    expect(second).toEqual(first);
  });

  it("edits the webhook when the Tot's face changed", async () => {
    const { guild, run } = setup({});
    await run();

    await run([{ ...home, avatar: { color: "#ff0000" } }, squirt]);

    expect(guild.calls.filter((call) => call.startsWith("editWebhook"))).toEqual([
      "editWebhook:1001",
    ]);
    expect(guild.calls.filter((call) => call.startsWith("createWebhook"))).toHaveLength(2);
  });

  it("renames the webhook, not the channel, when the Tot is renamed", async () => {
    const { guild, run } = setup({});
    await run();

    await run([{ ...home, name: "Homie" }, squirt]);

    expect(guild.calls.filter((call) => call.startsWith("createChannel"))).toHaveLength(2);
    expect(guild.webhooksIn("1001")[0]?.name).toBe("Homie");
  });

  it("keeps a pinned channel's name and webhook", async () => {
    const { guild, run } = setup({
      channels: [textChannel("2002", "general")],
      pinned: new Map([["2002", "home"]]),
    });

    const bindings = await run();

    expect(bindings.map((binding) => [binding.channelId, binding.totId])).toEqual([
      ["2002", "home"],
      ["1001", "squirt"],
    ]);
    expect(guild.channels.find((channel) => channel.id === "2002")?.name).toBe("general");
    expect(guild.calls).not.toContain("createChannel:tot-home");
  });

  it("replaces a webhook it cannot post through", async () => {
    const { guild, run } = setup({});
    guild.addWebhook("1001", { id: "someone-else", name: "Home", token: null });

    const bindings = await run();

    expect(bindings[0]?.webhookId).not.toBe("someone-else");
    expect(guild.calls).toContain("createWebhook:1001");
  });

  it("keeps the other Tots when one channel cannot be created", async () => {
    const { guild, lines } = setup({});
    const failing = {
      ...guild.port,
      createTextChannel: async (name: string) => {
        if (name === "tot-home") throw new Error("Missing Access");
        return guild.port.createTextChannel(name);
      },
    };
    const bindings = await ensureGuildChannels({
      tots: [home, squirt],
      pinned: new Map(),
      port: failing,
      avatars: createFakeAvatars().store,
      state: createFakeWebhookState(),
      logger: createLogger({ write: (line) => lines.push(line), now: () => 0 }),
    });

    expect(bindings.map((binding) => binding.totId)).toEqual(["squirt"]);
    const failed = eventsOf(lines).find((event) => event.event === "guild.channel_failed");
    expect(failed).toMatchObject({ totId: "home", reason: "Missing Access" });
  });
});

describe("routeGuildMessage", () => {
  const channelTots = new Map([["1001", "home"]]);
  const allowedUserIds = new Set(["42"]);

  it("sends an allowlisted author's text to the channel's Tot", () => {
    const decision = routeGuildMessage({
      channelId: "1001",
      author: { userId: "42", bot: false },
      content: "  Hi Home  ",
      channelTots,
      allowedUserIds,
    });

    expect(decision).toEqual({ kind: "route", totId: "home", text: "Hi Home" });
  });

  it("ignores a channel that is not mapped", () => {
    expect(
      routeGuildMessage({
        channelId: "9999",
        author: { userId: "42", bot: false },
        content: "Hi",
        channelTots,
        allowedUserIds,
      }),
    ).toEqual({ kind: "ignore", reason: "unmapped" });
  });

  it("never routes a message from an author who is not allowlisted", () => {
    expect(
      routeGuildMessage({
        channelId: "1001",
        author: { userId: "43", bot: false },
        content: "Hi",
        channelTots,
        allowedUserIds,
      }),
    ).toEqual({ kind: "ignore", reason: "not-allowed" });
  });

  it("ignores bots and webhooks, including the Tot's own messages", () => {
    expect(
      routeGuildMessage({
        channelId: "1001",
        author: { userId: "42", bot: true },
        content: "Home is working…",
        channelTots,
        allowedUserIds,
      }),
    ).toEqual({ kind: "ignore", reason: "bot-author" });
  });

  it("ignores a message with no text, which is what no Message Content intent looks like", () => {
    expect(
      routeGuildMessage({
        channelId: "1001",
        author: { userId: "42", bot: false },
        content: "   ",
        channelTots,
        allowedUserIds,
      }),
    ).toEqual({ kind: "ignore", reason: "empty" });
  });
});

describe("createWebhookState", () => {
  it("remembers which webhook and face a channel already has after a restart", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tot-webhooks-"));
    const path = NodePath.join(dir, "webhooks.json");
    try {
      const first = createWebhookState(path);
      first.set("1001", { webhookId: "webhook-1", avatarKey: "key-1" });
      first.save();

      const restarted = createWebhookState(path);

      expect(restarted.get("1001")).toEqual({ webhookId: "webhook-1", avatarKey: "key-1" });
      expect(restarted.get("1002")).toBeUndefined();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts from nothing when the file is missing or broken", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tot-webhooks-"));
    try {
      expect(createWebhookState(NodePath.join(dir, "missing.json")).get("1001")).toBeUndefined();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
