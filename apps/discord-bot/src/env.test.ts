// @effect-diagnostics nodeBuiltinImport:off - Asserts the cache path a plain Node service resolves.
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ConfigError, dryRunUserId, readConfig } from "./env.ts";

const complete = {
  DISCORD_TOKEN: "discord-token-value",
  DISCORD_ALLOWED_USER_IDS: "111, 222\n333",
  T3_MCP_URL: "http://127.0.0.1:3773/mcp",
  T3_MCP_TOKEN: "mcp-token-value",
};

const problemsOf = (
  env: Readonly<Record<string, string | undefined>>,
  mode: "serve" | "dry-run" | "mint-token" = "serve",
) => {
  try {
    readConfig(env, mode);
    return null;
  } catch (cause) {
    return cause instanceof ConfigError ? cause.problems : null;
  }
};

const multi = (entries: ReadonlyArray<unknown>): string => JSON.stringify(entries);

const alpha = { label: "alpha", mcpUrl: "http://alpha.test:3773/mcp", token: "alpha-token-value" };
const beta = { label: "beta", mcpUrl: "https://beta.test/mcp", token: "beta-token-value" };

describe("readConfig", () => {
  it("reads the four variables", () => {
    const config = readConfig(complete, "serve");

    expect(config.allowedUserIds).toEqual(new Set(["111", "222", "333"]));
    expect(config.environments).toEqual([
      {
        label: "127.0.0.1-3773",
        mcpUrl: "http://127.0.0.1:3773/mcp",
        token: "mcp-token-value",
        avatarCacheDir: NodePath.join(".webhook-avatars", "127.0.0.1-3773"),
      },
    ]);
    expect(config.multiEnvironment).toBe(false);
    expect(config.defaultTotName).toBe("Home");
  });

  it("reports every missing variable at once", () => {
    const problems = problemsOf({}) ?? [];

    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toContain("DISCORD_TOKEN");
    expect(problems.join(" ")).toContain("DISCORD_ALLOWED_USER_IDS");
    expect(problems.join(" ")).toContain("T3_MCP_URL");
    expect(problems.join(" ")).toContain("T3_MCP_TOKEN");
  });

  it("never puts a configured value in the error", () => {
    const problems = problemsOf({ T3_MCP_TOKEN: "super-secret-token" }) ?? [];

    expect(problems.join(" ")).not.toContain("super-secret-token");
  });

  it("requires an allowlist, so an empty one cannot mean everyone", () => {
    expect(problemsOf({ ...complete, DISCORD_ALLOWED_USER_IDS: " , " })).toEqual([
      expect.stringContaining("DISCORD_ALLOWED_USER_IDS"),
    ]);
  });

  it("accepts a non-http URL never", () => {
    expect(problemsOf({ ...complete, T3_MCP_URL: "file:///tmp/mcp" })).toEqual([
      expect.stringContaining("T3_MCP_URL"),
    ]);
  });

  it("runs a dry run without a Discord token", () => {
    const config = readConfig({ ...complete, DISCORD_TOKEN: undefined }, "dry-run");

    expect(config.discordToken).toBe("");
    expect(dryRunUserId(config)).toBe("111");
  });

  it("needs only the URL to mint a token", () => {
    const config = readConfig({ T3_MCP_URL: complete.T3_MCP_URL }, "mint-token");

    expect(config.mode).toBe("mint-token");
    expect(config.environments[0]?.mcpUrl).toBe(complete.T3_MCP_URL);
    expect(config.allowedUserIds.size).toBe(0);
  });

  it("moves the log file when asked", () => {
    const config = readConfig(
      { ...complete, DISCORD_BOT_LOG_FILE: "/var/log/tot-bridge.log" },
      "serve",
    );

    expect(config.logFile).toBe("/var/log/tot-bridge.log");
  });
});

describe("several machines", () => {
  const completeMulti = {
    ...complete,
    T3_MCP_URL: undefined,
    T3_MCP_TOKEN: undefined,
    T3_ENVIRONMENTS: multi([alpha, beta]),
  };

  it("reads one environment per machine, in order", () => {
    const config = readConfig(completeMulti, "serve");

    expect(config.multiEnvironment).toBe(true);
    expect(config.environments.map((environment) => environment.label)).toEqual(["alpha", "beta"]);
    expect(config.environments.map((environment) => environment.mcpUrl)).toEqual([
      alpha.mcpUrl,
      beta.mcpUrl,
    ]);
    expect(config.environments.map((environment) => environment.token)).toEqual([
      alpha.token,
      beta.token,
    ]);
  });

  it("keeps each machine's faces in their own directory", () => {
    const config = readConfig(
      { ...completeMulti, DISCORD_AVATAR_DIR: "/var/cache/faces" },
      "serve",
    );

    expect(config.environments.map((environment) => environment.avatarCacheDir)).toEqual([
      NodePath.join("/var/cache/faces", "alpha"),
      NodePath.join("/var/cache/faces", "beta"),
    ]);
    expect(config.webhookStatePath).toBe(NodePath.join("/var/cache/faces", "webhooks.json"));
  });

  it("refuses both forms instead of merging them", () => {
    expect(
      problemsOf(
        {
          ...complete,
          T3_ENVIRONMENTS: multi([alpha]),
        },
        "serve",
      ),
    ).toEqual([expect.stringContaining("not both")]);
  });

  it("refuses a single token beside the multi form", () => {
    expect(
      problemsOf(
        {
          ...completeMulti,
          T3_MCP_URL: undefined,
          T3_MCP_TOKEN: "stray-token",
        },
        "serve",
      ),
    ).toEqual([expect.stringContaining("not both")]);
  });

  it("does not take the multi form for mint-token", () => {
    expect(problemsOf({ ...completeMulti, DISCORD_TOKEN: undefined }, "mint-token")).toEqual([
      expect.stringContaining("--mint-token"),
    ]);
  });

  it("reports every bad entry at once", () => {
    const problems =
      problemsOf(
        {
          ...completeMulti,
          T3_ENVIRONMENTS: multi([
            { label: "alpha", mcpUrl: "ftp://nope", token: "" },
            { label: "bad label", mcpUrl: "not a url", token: "token-value" },
            { label: "alpha", mcpUrl: "http://alpha.test/mcp", token: "other-token" },
            "not an object",
          ]),
        },
        "serve",
      ) ?? [];

    expect(problems).toHaveLength(6);
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[0].token");
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[0].mcpUrl");
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[1].label");
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[1].mcpUrl");
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[2].label");
    expect(problems.join(" ")).toContain("T3_ENVIRONMENTS[3]");
  });

  it("reports a JSON array it cannot read", () => {
    expect(problemsOf({ ...completeMulti, T3_ENVIRONMENTS: "{" }, "serve")).toEqual([
      expect.stringContaining("JSON array"),
    ]);
    expect(problemsOf({ ...completeMulti, T3_ENVIRONMENTS: "[]" }, "serve")).toEqual([
      expect.stringContaining("non-empty JSON array"),
    ]);
  });

  it("refuses two labels that render to the same channel name", () => {
    const problems =
      problemsOf(
        {
          ...completeMulti,
          T3_ENVIRONMENTS: multi([
            { ...alpha, label: "work.laptop" },
            { ...beta, label: "work-laptop" },
          ]),
        },
        "serve",
      ) ?? [];

    expect(problems.join(" ")).toContain("channel-name form");
  });

  it("does not print a token in a problem", () => {
    const problems = problemsOf(
      {
        ...completeMulti,
        T3_ENVIRONMENTS: multi([{ ...alpha, mcpUrl: "nope" }]),
      },
      "serve",
    );

    expect(problems?.join(" ")).not.toContain(alpha.token);
  });
});

describe("guild mode", () => {
  it("stays off without DISCORD_GUILD_ID", () => {
    const config = readConfig(complete, "serve");

    expect(config.guildId).toBeNull();
    expect(config.channelTotMap.size).toBe(0);
  });

  it("reads the server id and the channels pinned to Tots", () => {
    const config = readConfig(
      {
        ...complete,
        DISCORD_GUILD_ID: "123456789012345678",
        CHANNEL_TOT_MAP: "1001=home, 1002=squirt",
      },
      "serve",
    );

    expect(config.guildId).toBe("123456789012345678");
    expect([...config.channelTotMap]).toEqual([
      ["1001", { environment: "127.0.0.1-3773", totId: "home" }],
      ["1002", { environment: "127.0.0.1-3773", totId: "squirt" }],
    ]);
  });

  it("reads a pin that names one machine", () => {
    const config = readConfig(
      {
        ...complete,
        T3_MCP_URL: undefined,
        T3_MCP_TOKEN: undefined,
        T3_ENVIRONMENTS: multi([alpha, beta]),
        DISCORD_GUILD_ID: "123456789012345678",
        CHANNEL_TOT_MAP: "1001=BETA:home 1002=alpha:squirt",
      },
      "serve",
    );

    expect([...config.channelTotMap]).toEqual([
      ["1001", { environment: "beta", totId: "home" }],
      ["1002", { environment: "alpha", totId: "squirt" }],
    ]);
  });

  it("refuses a pin to a machine that is not configured", () => {
    const problems =
      problemsOf(
        {
          ...complete,
          T3_MCP_URL: undefined,
          T3_MCP_TOKEN: undefined,
          T3_ENVIRONMENTS: multi([alpha, beta]),
          DISCORD_GUILD_ID: "123456789012345678",
          CHANNEL_TOT_MAP: "1001=gamma:home",
        },
        "serve",
      ) ?? [];

    expect(problems.join(" ")).toContain("gamma");
    expect(problems.join(" ")).toContain("alpha, beta");
  });

  it("refuses a machine-shaped pin in the single form", () => {
    expect(
      problemsOf(
        {
          ...complete,
          DISCORD_GUILD_ID: "123456789012345678",
          CHANNEL_TOT_MAP: "1001=alpha:home",
        },
        "serve",
      ),
    ).toEqual([expect.stringContaining("only T3_MCP_URL is set")]);
  });

  it("rejects a guild id that is not a server id", () => {
    expect(problemsOf({ ...complete, DISCORD_GUILD_ID: "my-server" })).toEqual([
      expect.stringContaining("DISCORD_GUILD_ID"),
    ]);
  });

  it("reports a channel map it cannot read", () => {
    expect(
      problemsOf({ ...complete, DISCORD_GUILD_ID: "123", CHANNEL_TOT_MAP: "general=home" }),
    ).toEqual([expect.stringContaining("CHANNEL_TOT_MAP")]);
  });

  it("does not let a channel map stand alone", () => {
    expect(problemsOf({ ...complete, CHANNEL_TOT_MAP: "1001=home" })).toEqual([
      expect.stringContaining("only applies when DISCORD_GUILD_ID"),
    ]);
  });

  it("caches faces under the environment and moves them when asked", () => {
    expect(readConfig(complete, "serve").environments[0]?.avatarCacheDir).toBe(
      NodePath.join(".webhook-avatars", "127.0.0.1-3773"),
    );

    expect(
      readConfig({ ...complete, DISCORD_AVATAR_DIR: "/var/cache/tot-faces" }, "serve")
        .environments[0]?.avatarCacheDir,
    ).toBe(NodePath.join("/var/cache/tot-faces", "127.0.0.1-3773"));
  });
});
