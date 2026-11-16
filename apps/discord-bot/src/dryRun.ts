import * as NodeReadlinePromises from "node:readline/promises";

import { type Logger, describeError } from "./log.ts";
import type { SlashCommand } from "./routing.ts";
import { type BridgeService, createBridgeService } from "./service.ts";
import type { T3Client } from "./t3Client.ts";
import type { ChannelPort } from "./turns.ts";

export interface DryRunOptions {
  readonly t3: T3Client;
  readonly logger: Logger;
  readonly userId: string;
  readonly defaultTotName: string;
  readonly input: NodeJS.ReadableStream;
  readonly output: (line: string) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly allowlistBypassed: boolean;
}

const USAGE = [
  "Commands: /tot list, /tot use <name>, /tot new, /tot stop.",
  "Anything else is sent to the Tot this DM talks to.",
].join("\n");

export const parseDryRunCommand = (line: string): SlashCommand | "help" | null => {
  const parts = line.trim().split(/\s+/u);
  if (parts[0] !== "/tot") return null;
  const sub = parts[1];
  if (sub === undefined) return "help";
  if (sub === "list") return { kind: "list" };
  if (sub === "new") return { kind: "new" };
  if (sub === "stop") return { kind: "stop" };
  if (sub === "use") {
    const name = parts.slice(2).join(" ").trim();
    return name.length === 0 ? "help" : { kind: "use", name };
  }
  return "help";
};

/**
 * The service without Discord: reads DMs from stdin and prints every message it
 * would send or edit, so routing, streaming and settling can be exercised on a
 * live T3 server without a bot token.
 */
export const runDryRun = async (options: DryRunOptions): Promise<void> => {
  let counter = 0;
  const port: ChannelPort = {
    send: async (text) => {
      options.output(`\n--- would send ---\n${text}`);
      counter += 1;
      return { id: `dry-run-${counter}` };
    },
    edit: async (message, text) => {
      options.output(`\n--- would edit ${message.id} ---\n${text}`);
    },
    typing: async () => undefined,
  };
  const service: BridgeService = createBridgeService({
    t3: options.t3,
    channelFor: () => port,
    logger: options.logger,
    now: options.now,
    sleep: options.sleep,
    defaultTotName: options.defaultTotName,
  });

  options.output(
    [
      "Dry run: nothing is sent to Discord.",
      options.allowlistBypassed
        ? `No DISCORD_ALLOWED_USER_IDS, so this reads as ${options.userId}.`
        : `Reading as ${options.userId}.`,
      USAGE,
    ].join("\n"),
  );

  const readline = NodeReadlinePromises.createInterface({ input: options.input, terminal: false });
  for await (const line of readline) {
    if (line.trim().length === 0) continue;
    const command = parseDryRunCommand(line);
    try {
      if (command === "help") {
        options.output(USAGE);
      } else if (command !== null) {
        const reply = await service.handleCommand(options.userId, command);
        options.output(`\n--- would reply ---\n${reply.text}`);
      } else {
        await service.handleText(options.userId, line);
      }
    } catch (cause) {
      options.output(`\n--- failed ---\n${describeError(cause)}`);
    }
  }
};
