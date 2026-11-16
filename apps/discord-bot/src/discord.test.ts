import { GatewayIntentBits } from "discord.js";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentCatalog } from "./environments.ts";
import { type DiscordGuildOptions, intentsFor } from "./discord.ts";

const catalog: EnvironmentCatalog = {
  environments: [],
  clientFor: () => {
    throw new Error("unused");
  },
  refresh: async () => ({ tots: [], failures: [] }),
  subscribe: () => () => undefined,
  close: async () => undefined,
};

const guild: DiscordGuildOptions = {
  guildId: "123456789012345678",
  channelTotMap: new Map(),
  avatarCacheDirFor: () => ".webhook-avatars/127.0.0.1-3773",
  webhookStatePath: ".webhook-avatars/127.0.0.1-3773/webhooks.json",
  catalog,
};

describe("intentsFor", () => {
  it("asks for DMs only while guild mode is off, so an existing bot connects unchanged", () => {
    expect(intentsFor(undefined)).toEqual([GatewayIntentBits.DirectMessages]);
  });

  it("adds the guild intents and Message Content in guild mode", () => {
    expect(intentsFor(guild)).toEqual([
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]);
  });
});
