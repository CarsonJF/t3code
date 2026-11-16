// @effect-diagnostics extendsNativeError:off - discord.js error classes are matched, not thrown.
import {
  ApplicationIntegrationType,
  ChannelType,
  Client,
  DiscordjsError,
  DiscordjsErrorCodes,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  Partials,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type DMChannel,
  type Interaction,
  type Message,
} from "discord.js";

import { isAllowedDmAuthor } from "./allowlist.ts";
import { planLoginRetry } from "./backoff.ts";
import { type Logger, describeError } from "./log.ts";
import type { BridgeService } from "./service.ts";
import type { SlashCommand } from "./routing.ts";
import { splitMessage } from "./split.ts";
import type { ChannelPort } from "./turns.ts";

const COMMAND_NAME = "tot";
const STOP_COMMAND_NAME = "stop";
const ATTACHMENTS_UNSUPPORTED = "Send text for now; the bridge does not forward attachments yet.";

export interface DiscordBridgeOptions {
  readonly token: string;
  readonly allowedUserIds: ReadonlySet<string>;
  readonly logger: Logger;
  readonly sleep: (ms: number) => Promise<void>;
  /** Built here because the service writes through the DM channel of each user. */
  readonly createService: (channelFor: (userId: string) => ChannelPort) => BridgeService;
  readonly registerCommands?: boolean;
}

export interface RunningDiscordBridge {
  readonly stop: () => Promise<void>;
}

/** `/tot` for a bot's DMs, and for a server if it is invited to one. */
const totCommand = (): ReturnType<SlashCommandBuilder["toJSON"]> =>
  new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Talk to one of your Tots from this DM")
    .setContexts(InteractionContextType.BotDM, InteractionContextType.Guild)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List your Tots"))
    .addSubcommand((sub) =>
      sub
        .setName("use")
        .setDescription("Choose the Tot this DM keeps talking to")
        .addStringOption((option) =>
          option.setName("name").setDescription("Tot name").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("new").setDescription("Start the next message with a fresh session"),
    )
    .addSubcommand((sub) => sub.setName("stop").setDescription("Interrupt the Tot's current turn"))
    .toJSON();

/** `/stop` is the short form of `/tot stop`, and works in a bot DM too. */
const stopCommand = (): ReturnType<SlashCommandBuilder["toJSON"]> =>
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Interrupt your Tot's current turn")
    .setContexts(InteractionContextType.BotDM, InteractionContextType.Guild)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .toJSON();

/** A bad token or bad options never fix themselves; a network failure does. */
const isFatalLoginError = (cause: unknown): boolean =>
  cause instanceof DiscordjsError &&
  (cause.code === DiscordjsErrorCodes.TokenInvalid ||
    cause.code === DiscordjsErrorCodes.TokenMissing);

const commandFrom = (interaction: ChatInputCommandInteraction): SlashCommand | null => {
  if (interaction.commandName === "stop") return { kind: "stop" };
  const sub = interaction.options.getSubcommand(true);
  if (sub === "list") return { kind: "list" };
  if (sub === "new") return { kind: "new" };
  if (sub === "stop") return { kind: "stop" };
  if (sub === "use") {
    return { kind: "use", name: interaction.options.getString("name", true) };
  }
  return null;
};

export const startDiscordBridge = async (
  options: DiscordBridgeOptions,
): Promise<RunningDiscordBridge> => {
  const { logger } = options;
  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });

  const channels = new Map<string, DMChannel>();
  const dmChannel = async (userId: string): Promise<DMChannel> => {
    const cached = channels.get(userId);
    if (cached !== undefined) return cached;
    const channel = await client.users.createDM(userId);
    channels.set(userId, channel);
    return channel;
  };
  const portFor = (userId: string): ChannelPort => ({
    send: async (text) => {
      const channel = await dmChannel(userId);
      const sent = await channel.send(text);
      return { id: sent.id };
    },
    edit: async (message, text) => {
      const channel = await dmChannel(userId);
      await channel.messages.edit(message.id, text);
    },
    typing: async () => {
      const channel = await dmChannel(userId);
      await channel.sendTyping();
    },
  });
  const service = options.createService(portFor);

  const handleMessage = async (message: Message): Promise<void> => {
    // A bot DM, not a group DM and not a server channel: one Tot, one person.
    if (message.channel.type !== ChannelType.DM) return;
    const allowed = isAllowedDmAuthor(
      { userId: message.author.id, bot: message.author.bot },
      options.allowedUserIds,
    );
    if (!allowed) {
      logger.warn("discord.ignored_author", { userId: message.author.id });
      return;
    }
    const text = message.content.trim();
    if (text.length === 0) {
      if (message.attachments.size > 0) {
        await message.author.send(ATTACHMENTS_UNSUPPORTED).catch(() => undefined);
      }
      return;
    }
    await service.handleText(message.author.id, text);
  };

  const handleInteraction = async (interaction: Interaction): Promise<void> => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== COMMAND_NAME) return;
      const allowed = isAllowedDmAuthor(
        { userId: interaction.user.id, bot: interaction.user.bot },
        options.allowedUserIds,
      );
      if (!allowed) {
        await interaction.respond([]).catch(() => undefined);
        return;
      }
      const query = interaction.options.getFocused(true).value;
      try {
        const choices = await service.autocomplete(String(query));
        await interaction.respond(
          choices.map((choice) => ({ name: choice.name, value: choice.value })),
        );
      } catch (cause) {
        logger.warn("discord.autocomplete_failed", { reason: describeError(cause) });
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }
    if (
      !interaction.isChatInputCommand() ||
      (interaction.commandName !== COMMAND_NAME && interaction.commandName !== STOP_COMMAND_NAME)
    ) {
      return;
    }
    const allowed = isAllowedDmAuthor(
      { userId: interaction.user.id, bot: interaction.user.bot },
      options.allowedUserIds,
    );
    if (!allowed) {
      logger.warn("discord.ignored_author", { userId: interaction.user.id });
      return;
    }
    if (interaction.channel !== null && !interaction.channel.isDMBased()) {
      await interaction.reply({
        content: "Send me a direct message to talk to a Tot from there.",
      });
      return;
    }
    const command = commandFrom(interaction);
    if (command === null) {
      await interaction.reply({ content: "That subcommand is not supported." });
      return;
    }
    await interaction.deferReply();
    try {
      const reply = await service.handleCommand(interaction.user.id, command);
      const chunks = splitMessage(reply.text);
      await interaction.editReply(chunks[0] ?? "…");
      for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
    } catch (cause) {
      logger.error("discord.command_failed", {
        userId: interaction.user.id,
        command: command.kind,
        reason: describeError(cause),
      });
      await interaction.editReply(`T3 did not answer: ${describeError(cause)}`);
    }
  };

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message).catch((cause: unknown) => {
      logger.error("discord.message_failed", {
        userId: message.author.id,
        reason: describeError(cause),
      });
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction).catch((cause: unknown) => {
      logger.error("discord.interaction_failed", { reason: describeError(cause) });
    });
  });

  client.on(Events.ClientReady, (ready) => {
    logger.info("discord.ready", { user: ready.user.tag, userId: ready.user.id });
    if (options.registerCommands === false) return;
    void ready.application.commands
      .set([totCommand(), stopCommand()])
      .then((commands) => {
        logger.info("discord.commands_registered", { count: commands.size });
      })
      .catch((cause: unknown) => {
        logger.error("discord.commands_failed", { reason: describeError(cause) });
      });
  });

  // discord.js resumes and reconnects on its own; these record what happened.
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn("discord.disconnected", { shardId, code: event.code });
  });
  client.on(Events.ShardResume, (_replayed, shardId) => {
    logger.info("discord.resumed", { shardId });
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error("discord.shard_error", { shardId, reason: describeError(error) });
  });
  client.on(Events.Error, (error) => {
    logger.error("discord.error", { reason: describeError(error) });
  });

  let attempt = 0;
  for (;;) {
    try {
      await client.login(options.token);
      break;
    } catch (cause) {
      const plan = planLoginRetry({ attempt, fatal: isFatalLoginError(cause) });
      if (!plan.retry) throw cause;
      logger.error("discord.login_failed", {
        attempt,
        retryInMs: plan.delayMs,
        reason: describeError(cause),
      });
      await options.sleep(plan.delayMs);
      attempt += 1;
    }
  }

  logger.info("discord.started", { commands: options.registerCommands !== false });
  return {
    stop: async () => {
      await client.destroy();
    },
  };
};
