// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - A plain Node service entry point with no Effect runtime.
import * as NodeReadlinePromises from "node:readline/promises";

import { startDiscordBridge } from "./discord.ts";
import { runDryRun } from "./dryRun.ts";
import { ConfigError, dryRunUserId, isDryRunBypassingAllowlist, readConfig } from "./env.ts";
import { createEnvironmentCatalog } from "./environments.ts";
import { createFileLogger, describeError } from "./log.ts";
import { extractPairingCode, formatMintedToken, mintMcpToken } from "./mintToken.ts";
import { createBridgeService } from "./service.ts";

const HELP = `Discord bridge for T3 Code Tots.

Usage:
  npm start                 Run the bridge (DISCORD_TOKEN required)
  npm run dry-run           Read DMs from stdin and print what would be sent
  npm run mint-token        Exchange a pairing code for a 30-day T3_MCP_TOKEN

Environment:
  DISCORD_TOKEN             Bot token from the Discord application
  DISCORD_ALLOWED_USER_IDS  Comma-separated Discord user ids; everyone else is ignored
  T3_MCP_URL                One machine's MCP endpoint, such as http://127.0.0.1:3773/mcp
  T3_MCP_TOKEN              Bearer token from \`npm run mint-token\`
  T3_ENVIRONMENTS           Several machines as JSON: [{"label","mcpUrl","token"}]
                            Set this or T3_MCP_URL + T3_MCP_TOKEN, never both.

Guild mode (optional):
  DISCORD_GUILD_ID          A server id: one text channel per Tot, each with its own webhook
  CHANNEL_TOT_MAP           Pin channels that already exist: channelId=totId or channelId=label:totId
  DISCORD_AVATAR_DIR        Where rendered Tot faces are cached (default .webhook-avatars)

Runbook: docs/discord-tot-bridge.md`;

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const writeError = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const mintToken = async (mcpUrl: string): Promise<number> => {
  const readline = NodeReadlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question("Pairing code from `t3 auth pairing create`: ");
    const code = extractPairingCode(answer);
    if (code === null) {
      writeError("That does not look like a pairing code.");
      return 2;
    }
    write("Approving the sign-in as a full-access MCP client...");
    const minted = await mintMcpToken({ mcpUrl, pairingCode: code });
    write(formatMintedToken(minted));
    return 0;
  } catch (cause) {
    writeError(`Could not mint a token: ${describeError(cause)}`);
    return 1;
  } finally {
    readline.close();
  }
};

const serve = async (dryRun: boolean): Promise<number | null> => {
  const config = readConfig(process.env, dryRun ? "dry-run" : "serve");
  const logger = createFileLogger(config.logFile, [
    ...config.environments.map((environment) => environment.token),
    config.discordToken,
  ]);
  const catalog = createEnvironmentCatalog({
    environments: config.environments,
    logger,
  });
  logger.info("bridge.starting", {
    mode: config.mode,
    environments: config.environments.map((environment) => environment.label),
    mcpUrls: config.environments.map((environment) => environment.mcpUrl),
    allowedUsers: config.allowedUserIds.size,
    logFile: config.logFile,
    guildId: config.guildId,
    pinnedChannels: config.channelTotMap.size,
  });

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  if (dryRun) {
    write(`Dry run. Logging to ${config.logFile}.`);
    await runDryRun({
      catalog,
      logger,
      userId: dryRunUserId(config),
      defaultTotName: config.defaultTotName,
      multiEnvironment: config.multiEnvironment,
      input: process.stdin,
      output: write,
      now: Date.now,
      sleep,
      allowlistBypassed: isDryRunBypassingAllowlist(config),
    });
    await catalog.close();
    return 0;
  }

  const bridge = await startDiscordBridge({
    token: config.discordToken,
    allowedUserIds: config.allowedUserIds,
    logger,
    sleep,
    createService: (channelFor) =>
      createBridgeService({
        catalog,
        channelFor,
        logger,
        now: Date.now,
        sleep,
        defaultTotName: config.defaultTotName,
        multiEnvironment: config.multiEnvironment,
      }),
    ...(config.guildId === null
      ? {}
      : {
          guild: {
            guildId: config.guildId,
            channelTotMap: config.channelTotMap,
            avatarCacheDirFor: (environment) =>
              config.environments.find((candidate) => candidate.label === environment)
                ?.avatarCacheDir ??
              config.environments[0]?.avatarCacheDir ??
              ".webhook-avatars",
            webhookStatePath: config.webhookStatePath,
            catalog,
          },
        }),
  });

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("bridge.stopping", { signal });
    await bridge.stop().catch(() => undefined);
    await catalog.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void stop("SIGINT");
  });
  process.on("SIGTERM", () => {
    void stop("SIGTERM");
  });
  process.on("unhandledRejection", (cause) => {
    logger.error("bridge.unhandled_rejection", { reason: describeError(cause) });
  });
  return null;
};

const main = async (): Promise<number | null> => {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    write(HELP);
    return 0;
  }
  try {
    if (argv.includes("--mint-token")) {
      return await mintToken(readConfig(process.env, "mint-token").environments[0]?.mcpUrl ?? "");
    }
    return await serve(argv.includes("--dry-run"));
  } catch (cause) {
    if (cause instanceof ConfigError) {
      writeError(cause.message);
      return 2;
    }
    writeError(`The bridge stopped: ${describeError(cause)}`);
    return 1;
  }
};

const code = await main();
if (code !== null) process.exitCode = code;
