// @effect-diagnostics extendsNativeError:off nodeBuiltinImport:off - Standalone Node service, not Effect code; the cache path is a plain path join.
import * as NodePath from "node:path";

import type { BridgeEnvironment } from "./environments.ts";
import { labelSlug, parseChannelTotMap, type TotPin } from "./guild.ts";

const DISCORD_TOKEN = "DISCORD_TOKEN";
const DISCORD_ALLOWED_USER_IDS = "DISCORD_ALLOWED_USER_IDS";
const DISCORD_BOT_LOG_FILE = "DISCORD_BOT_LOG_FILE";
const DISCORD_GUILD_ID = "DISCORD_GUILD_ID";
const CHANNEL_TOT_MAP = "CHANNEL_TOT_MAP";
const DISCORD_AVATAR_DIR = "DISCORD_AVATAR_DIR";
const T3_MCP_URL = "T3_MCP_URL";
const T3_MCP_TOKEN = "T3_MCP_TOKEN";
const T3_ENVIRONMENTS = "T3_ENVIRONMENTS";

const DEFAULT_TOT_NAME = "Home";
const DEFAULT_LOG_FILE = "discord-tot-bridge.log";
const DEFAULT_AVATAR_DIR = ".webhook-avatars";

/** A machine name that is safe in a channel, a pin and a log field. */
const ENVIRONMENT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;

export type BridgeMode = "serve" | "dry-run" | "mint-token";

export interface BridgeConfig {
  readonly mode: BridgeMode;
  readonly discordToken: string;
  readonly allowedUserIds: ReadonlySet<string>;
  /** One entry in the single form, one per machine in the multi form. */
  readonly environments: ReadonlyArray<BridgeEnvironment>;
  /** True only when T3_ENVIRONMENTS configured the machines. */
  readonly multiEnvironment: boolean;
  readonly logFile: string;
  readonly defaultTotName: string;
  /** The server guild mode runs in. Null keeps the bridge to DMs. */
  readonly guildId: string | null;
  /** Channels pinned to a Tot with CHANNEL_TOT_MAP. */
  readonly channelTotMap: ReadonlyMap<string, TotPin>;
  /** Where webhook ids are remembered; faces live beside it, one directory per machine. */
  readonly webhookStatePath: string;
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

/** A directory name for one machine's faces; the single form keeps its URL-derived one. */
const environmentSlug = (mcpUrl: string): string => {
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

const singleEnvironment = (
  mcpUrl: string,
  token: string,
  avatarBaseDir: string,
): BridgeEnvironment => {
  const label = environmentSlug(mcpUrl);
  return {
    label,
    mcpUrl,
    token,
    avatarCacheDir: NodePath.join(avatarBaseDir, label),
  };
};

interface ParsedEnvironments {
  readonly environments: ReadonlyArray<BridgeEnvironment>;
  readonly problems: ReadonlyArray<string>;
}

/** T3_ENVIRONMENTS as a JSON array of {label, mcpUrl, token}, every problem reported. */
const parseEnvironments = (raw: string, avatarBaseDir: string): ParsedEnvironments => {
  const problems: Array<string> = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      environments: [],
      problems: [`${T3_ENVIRONMENTS} must be a JSON array of {label, mcpUrl, token} objects.`],
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      environments: [],
      problems: [
        `${T3_ENVIRONMENTS} must be a non-empty JSON array of {label, mcpUrl, token} objects.`,
      ],
    };
  }

  const environments: Array<BridgeEnvironment> = [];
  const labels = new Map<string, number>();
  const slugs = new Map<string, number>();
  parsed.forEach((value: unknown, index) => {
    const at = `${T3_ENVIRONMENTS}[${index}]`;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      problems.push(`${at} must be an object with label, mcpUrl and token.`);
      return;
    }
    const record = value as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const rawUrl = typeof record.mcpUrl === "string" ? record.mcpUrl.trim() : "";
    const token = typeof record.token === "string" ? record.token.trim() : "";

    const labelProblem = !ENVIRONMENT_LABEL.test(label)
      ? `${at}.label must be 1-32 letters, digits, dots, dashes or underscores, starting with a letter or digit; it is the machine name people see.`
      : labels.has(label.toLowerCase())
        ? `${at}.label repeats an earlier machine: ${label}. Labels must be unique.`
        : null;
    if (labelProblem !== null) {
      problems.push(labelProblem);
    } else {
      labels.set(label.toLowerCase(), index);
      const slug = labelSlug(label);
      if (slugs.has(slug)) {
        problems.push(
          `${at}.label shares its channel-name form "${slug}" with ${T3_ENVIRONMENTS}[${slugs.get(slug)}]. Choose another label.`,
        );
      } else {
        slugs.set(slug, index);
      }
    }

    const url = rawUrl.length === 0 ? null : parseHttpUrl(rawUrl);
    if (url === null) problems.push(`${at}.mcpUrl must be an http:// or https:// URL.`);
    if (token.length === 0) {
      problems.push(`${at}.token is required. Mint one per machine with \`npm run mint-token\`.`);
    }

    if (labelProblem === null && url !== null && token.length > 0) {
      environments.push({
        label,
        mcpUrl: url,
        token,
        avatarCacheDir: NodePath.join(avatarBaseDir, labelSlug(label)),
      });
    }
  });

  return { environments, problems };
};

const guildConfigOf = (
  env: Environment,
  environments: ReadonlyArray<BridgeEnvironment>,
  multiEnvironment: boolean,
): {
  readonly guildId: string | null;
  readonly channelTotMap: ReadonlyMap<string, TotPin>;
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

  const channelTotMap = new Map<string, TotPin>();
  for (const [channelId, pin] of parsed.map) {
    if (pin.environment === null) {
      channelTotMap.set(
        channelId,
        multiEnvironment ? pin : { environment: environments[0]?.label ?? "", totId: pin.totId },
      );
      continue;
    }
    const known = environments.find(
      (environment) => environment.label.toLowerCase() === pin.environment!.toLowerCase(),
    );
    if (known !== undefined) {
      channelTotMap.set(channelId, { environment: known.label, totId: pin.totId });
      continue;
    }
    if (environments.length === 0) continue;
    problems.push(
      multiEnvironment
        ? `${CHANNEL_TOT_MAP} entry ${channelId}=${pin.environment}:${pin.totId} names a machine that is not in ${T3_ENVIRONMENTS}. Known machines: ${environments.map((environment) => environment.label).join(", ")}.`
        : `${CHANNEL_TOT_MAP} entry ${channelId}=${pin.environment}:${pin.totId} names a machine, but only ${T3_MCP_URL} is set.`,
    );
  }

  if (channelTotMap.size > 0 && guildId === null) {
    problems.push(`${CHANNEL_TOT_MAP} only applies when ${DISCORD_GUILD_ID} is set.`);
  }
  return { guildId, channelTotMap, problems };
};

/** Reads the documented variables and reports every problem at once, never a value. */
export function readConfig(env: Environment, mode: BridgeMode): BridgeConfig {
  const problems: Array<string> = [];
  const avatarBaseDir = present(env[DISCORD_AVATAR_DIR]) ?? DEFAULT_AVATAR_DIR;
  const rawEnvironments = present(env[T3_ENVIRONMENTS]);
  const rawUrl = present(env[T3_MCP_URL]);
  const rawToken = present(env[T3_MCP_TOKEN]);
  const multiEnvironment = rawEnvironments !== undefined;

  if (multiEnvironment && (rawUrl !== undefined || rawToken !== undefined)) {
    problems.push(
      `Set either ${T3_MCP_URL} and ${T3_MCP_TOKEN} for one machine, or ${T3_ENVIRONMENTS} for several, not both.`,
    );
  }

  let environments: ReadonlyArray<BridgeEnvironment> = [];
  if (multiEnvironment) {
    if (mode === "mint-token") {
      problems.push(
        `${T3_ENVIRONMENTS} is for npm start and npm run dry-run; --mint-token takes ${T3_MCP_URL} for one machine at a time.`,
      );
    } else {
      const parsed = parseEnvironments(rawEnvironments, avatarBaseDir);
      environments = parsed.environments;
      problems.push(...parsed.problems);
    }
  } else {
    const normalizedUrl = rawUrl === undefined ? null : parseHttpUrl(rawUrl);
    if (rawUrl === undefined) {
      problems.push(`${T3_MCP_URL} is required, for example http://127.0.0.1:3773/mcp.`);
    } else if (normalizedUrl === null) {
      problems.push(`${T3_MCP_URL} must be an http:// or https:// URL.`);
    }
    if (mode !== "mint-token" && rawToken === undefined) {
      problems.push(`${T3_MCP_TOKEN} is required. Mint one with \`npm run mint-token\`.`);
    }
    if (normalizedUrl !== null) {
      environments = [singleEnvironment(normalizedUrl, rawToken ?? "", avatarBaseDir)];
    }
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

  const guild = guildConfigOf(env, environments, multiEnvironment);
  problems.push(...guild.problems);

  if (problems.length > 0) throw new ConfigError(problems);
  const firstAvatarDir = environments[0]?.avatarCacheDir ?? avatarBaseDir;
  return {
    mode,
    discordToken: discordToken ?? "",
    allowedUserIds: new Set(allowed),
    environments,
    multiEnvironment,
    logFile: present(env[DISCORD_BOT_LOG_FILE]) ?? DEFAULT_LOG_FILE,
    defaultTotName: DEFAULT_TOT_NAME,
    guildId: guild.guildId,
    channelTotMap: guild.channelTotMap,
    webhookStatePath: multiEnvironment
      ? NodePath.join(avatarBaseDir, "webhooks.json")
      : NodePath.join(firstAvatarDir, "webhooks.json"),
  };
}

/** The DM author a dry run speaks as: the first allowlisted id, so routing matches the real bot. */
export const dryRunUserId = (config: BridgeConfig): string =>
  config.allowedUserIds.values().next().value ?? "dry-run-user";

export const isDryRunBypassingAllowlist = (config: BridgeConfig): boolean =>
  config.allowedUserIds.size === 0;
