// @effect-diagnostics extendsNativeError:off - Standalone Node service, not Effect code.
const DISCORD_TOKEN = "DISCORD_TOKEN";
const DISCORD_ALLOWED_USER_IDS = "DISCORD_ALLOWED_USER_IDS";
const DISCORD_BOT_LOG_FILE = "DISCORD_BOT_LOG_FILE";
const T3_MCP_URL = "T3_MCP_URL";
const T3_MCP_TOKEN = "T3_MCP_TOKEN";

const DEFAULT_TOT_NAME = "Home";
const DEFAULT_LOG_FILE = "discord-tot-bridge.log";

export type BridgeMode = "serve" | "dry-run" | "mint-token";

export interface BridgeConfig {
  readonly mode: BridgeMode;
  readonly discordToken: string;
  readonly allowedUserIds: ReadonlySet<string>;
  readonly t3McpUrl: string;
  readonly t3McpToken: string;
  readonly logFile: string;
  readonly defaultTotName: string;
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

/** Reads the four documented variables and reports every problem at once, never a value. */
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

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    mode,
    discordToken: discordToken ?? "",
    allowedUserIds: new Set(allowed),
    t3McpUrl: normalizedUrl ?? "",
    t3McpToken: t3McpToken ?? "",
    logFile: present(env[DISCORD_BOT_LOG_FILE]) ?? DEFAULT_LOG_FILE,
    defaultTotName: DEFAULT_TOT_NAME,
  };
}

/** The DM author a dry run speaks as: the first allowlisted id, so routing matches the real bot. */
export const dryRunUserId = (config: BridgeConfig): string =>
  config.allowedUserIds.values().next().value ?? "dry-run-user";

export const isDryRunBypassingAllowlist = (config: BridgeConfig): boolean =>
  config.allowedUserIds.size === 0;
