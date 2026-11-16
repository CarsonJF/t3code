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
  mode: "serve" | "dry-run",
) => {
  try {
    readConfig(env, mode);
    return null;
  } catch (cause) {
    return cause instanceof ConfigError ? cause.problems : null;
  }
};

describe("readConfig", () => {
  it("reads the four variables", () => {
    const config = readConfig(complete, "serve");

    expect(config.allowedUserIds).toEqual(new Set(["111", "222", "333"]));
    expect(config.t3McpUrl).toBe("http://127.0.0.1:3773/mcp");
    expect(config.defaultTotName).toBe("Home");
  });

  it("reports every missing variable at once", () => {
    const problems = problemsOf({}, "serve") ?? [];

    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toContain("DISCORD_TOKEN");
    expect(problems.join(" ")).toContain("DISCORD_ALLOWED_USER_IDS");
    expect(problems.join(" ")).toContain("T3_MCP_URL");
    expect(problems.join(" ")).toContain("T3_MCP_TOKEN");
  });

  it("never puts a configured value in the error", () => {
    const problems = problemsOf({ T3_MCP_TOKEN: "super-secret-token" }, "serve") ?? [];

    expect(problems.join(" ")).not.toContain("super-secret-token");
  });

  it("requires an allowlist, so an empty one cannot mean everyone", () => {
    expect(problemsOf({ ...complete, DISCORD_ALLOWED_USER_IDS: " , " }, "serve")).toEqual([
      expect.stringContaining("DISCORD_ALLOWED_USER_IDS"),
    ]);
  });

  it("accepts a non-http URL never", () => {
    expect(problemsOf({ ...complete, T3_MCP_URL: "file:///tmp/mcp" }, "serve")).toEqual([
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
