import { GatewayIntentBits } from "discord.js";
import { describe, expect, it } from "vite-plus/test";

import { type DiscordGuildOptions, intentsFor } from "./discord.ts";

const guild: DiscordGuildOptions = {
  guildId: "123456789012345678",
  channelTotMap: new Map(),
  avatarCacheDir: ".webhook-avatars/127.0.0.1-3773",
  listTots: async () => [],
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
