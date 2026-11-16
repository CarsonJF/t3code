// @effect-diagnostics extendsNativeError:off nodeBuiltinImport:off - Standalone Node service, not Effect code; the cache path is a plain path join.
import * as NodePath from "node:path";

import { parseChannelTotMap } from "./guild.ts";

const DISCORD_TOKEN = "DISCORD_TOKEN";
const DISCORD_ALLOWED_USER_IDS = "DISCORD_ALLOWED_USER_IDS";
const DISCORD_BOT_LOG_FILE = "DISCORD_BOT_LOG_FILE";
const DISCORD_GUILD_ID = "DISCORD_GUILD_ID";
const CHANNEL_TOT_MAP = "CHANNEL_TOT_MAP";
const DISCORD_AVATAR_DIR = "DISCORD_AVATAR_DIR";
const T3_MCP_URL = "T3_MCP_URL";
const T3_MCP_TOKEN = "T3_MCP_TOKEN";

const DEFAULT_TOT_NAME = "Home";
const DEFAULT_LOG_FILE = "discord-tot-bridge.log";
const DEFAULT_AVATAR_DIR = ".webhook-avatars";

export type BridgeMode = "serve" | "dry-run" | "mint-token";

export interface BridgeConfig {
  readonly mode: BridgeMode;
  readonly discordToken: string;
  readonly allowedUserIds: ReadonlySet<string>;
  readonly t3McpUrl: string;
  readonly t3McpToken: string;
  readonly logFile: string;
  readonly defaultTotName: string;
  /** The server guild mode runs in. Null keeps the bridge to DMs. */
  readonly guildId: string | null;
  /** Channels pinned to a Tot with CHANNEL_TOT_MAP, bypassing the `tot-<id>` names. */
  readonly channelTotMap: ReadonlyMap<string, string>;
  /** Where rendered faces and webhook ids are cached; one directory per environment. */
  readonly avatarCacheDir: string;
}

export class ConfigError extends Error {
  readonly problems: ReadonlyArray<string>;

  constructor(problems: ReadonlyArray<string>) {
    super(`The bridge cannot start:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export type Environment = Readonly<Record<string, string | undefined>>;

const present = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const parseUserIds = (value: string): ReadonlyArray<string> =>
  value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const parseHttpUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

/** A directory name for the environment the token belongs to, so two never share a face. */
export const environmentSlug = (mcpUrl: string): string => {
  try {
    const url = new URL(mcpUrl);
    const host = `${url.hostname}${url.port.length === 0 ? "" : `-${url.port}`}`;
    const slug = host
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return slug.length === 0 ? "default" : slug;
  } catch {
    return "default";
  }
};

const avatarCacheDirFor = (env: Environment, mcpUrl: string | null): string =>
  NodePath.join(
    present(env[DISCORD_AVATAR_DIR]) ?? DEFAULT_AVATAR_DIR,
    environmentSlug(mcpUrl ?? ""),
  );

const guildConfigOf = (
  env: Environment,
): {
  readonly guildId: string | null;
  readonly channelTotMap: ReadonlyMap<string, string>;
  readonly problems: ReadonlyArray<string>;
} => {
  const problems: Array<string> = [];
  const rawGuildId = present(env[DISCORD_GUILD_ID]);
  const guildId = rawGuildId !== undefined && /^\d+$/u.test(rawGuildId) ? rawGuildId : null;
  if (rawGuildId !== undefined && guildId === null) {
    problems.push(`${DISCORD_GUILD_ID} must be a Discord server id: digits only.`);
  }
  const parsed = parseChannelTotMap(present(env[CHANNEL_TOT_MAP]));
  problems.push(...parsed.problems);
  if (parsed.map.size > 0 && guildId === null) {
    problems.push(`${CHANNEL_TOT_MAP} only applies when ${DISCORD_GUILD_ID} is set.`);
  }
  return { guildId, channelTotMap: parsed.map, problems };
};

/** Reads the documented variables and reports every problem at once, never a value. */
export function readConfig(env: Environment, mode: BridgeMode): BridgeConfig {
  const problems: Array<string> = [];
  const t3McpUrl = present(env[T3_MCP_URL]);
  const normalizedUrl = t3McpUrl === undefined ? null : parseHttpUrl(t3McpUrl);
  if (t3McpUrl === undefined) {
    problems.push(`${T3_MCP_URL} is required, for example http://127.0.0.1:3773/mcp.`);
  } else if (normalizedUrl === null) {
    problems.push(`${T3_MCP_URL} must be an http:// or https:// URL.`);
  }

  if (mode === "mint-token") {
    if (problems.length > 0) throw new ConfigError(problems);
    return {
      mode,
      discordToken: "",
      allowedUserIds: new Set(),
      t3McpUrl: normalizedUrl ?? "",
      t3McpToken: present(env[T3_MCP_TOKEN]) ?? "",
      logFile: present(env[DISCORD_BOT_LOG_FILE]) ?? DEFAULT_LOG_FILE,
      defaultTotName: DEFAULT_TOT_NAME,
      guildId: null,
      channelTotMap: new Map(),
      avatarCacheDir: avatarCacheDirFor(env, normalizedUrl),
    };
  }

  const t3McpToken = present(env[T3_MCP_TOKEN]);
  if (t3McpToken === undefined) {
    problems.push(`${T3_MCP_TOKEN} is required. Mint one with \`npm run mint-token\`.`);
  }

  const discordToken = present(env[DISCORD_TOKEN]);
  if (mode === "serve" && discordToken === undefined) {
    problems.push(`${DISCORD_TOKEN} is required to sign in to Discord.`);
  }

  const allowed = parseUserIds(present(env[DISCORD_ALLOWED_USER_IDS]) ?? "");
  if (allowed.length === 0 && mode === "serve") {
    problems.push(
      `${DISCORD_ALLOWED_USER_IDS} must list at least one Discord user id. Without it every DM is ignored.`,
    );
  }

  const guild = guildConfigOf(env);
  problems.push(...guild.problems);

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    mode,
    discordToken: discordToken ?? "",
    allowedUserIds: new Set(allowed),
    t3McpUrl: normalizedUrl ?? "",
    t3McpToken: t3McpToken ?? "",
    logFile: present(env[DISCORD_BOT_LOG_FILE]) ?? DEFAULT_LOG_FILE,
    defaultTotName: DEFAULT_TOT_NAME,
    guildId: guild.guildId,
    channelTotMap: guild.channelTotMap,
    avatarCacheDir: avatarCacheDirFor(env, normalizedUrl),
  };
}

/** The DM author a dry run speaks as: the first allowlisted id, so routing matches the real bot. */
export const dryRunUserId = (config: BridgeConfig): string =>
  config.allowedUserIds.values().next().value ?? "dry-run-user";

export const isDryRunBypassingAllowlist = (config: BridgeConfig): boolean =>
  config.allowedUserIds.size === 0;
