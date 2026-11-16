// @effect-diagnostics extendsNativeError:off nodeBuiltinImport:off - discord.js error classes are matched, not thrown; the avatar cache lives at a path.
import * as NodePath from "node:path";
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
  WebhookClient,
  type ChatInputCommandInteraction,
  type DMChannel,
  type Interaction,
  type Message,
  type TextChannel,
} from "discord.js";

import { isAllowedAuthor } from "./allowlist.ts";
import { createAvatarStore } from "./avatar.ts";
import { planLoginRetry } from "./backoff.ts";
import {
  createWebhookState,
  ensureGuildChannels,
  routeGuildMessage,
  type GuildPort,
  type GuildTot,
} from "./guild.ts";
import { type Logger, describeError } from "./log.ts";
import type { BridgeService } from "./service.ts";
import type { SlashCommand } from "./routing.ts";
import { splitMessage } from "./split.ts";
import type { ChannelPort } from "./turns.ts";
import { createWebhookChannelPort } from "./webhook.ts";

const COMMAND_NAME = "tot";
const STOP_COMMAND_NAME = "stop";
const ATTACHMENTS_UNSUPPORTED = "Send text for now; the bridge does not forward attachments yet.";

export interface DiscordGuildOptions {
  readonly guildId: string;
  /** Channels pinned to a Tot, so a channel with another name still reaches it. */
  readonly channelTotMap: ReadonlyMap<string, string>;
  /** Where rendered faces and webhook ids are cached. */
  readonly avatarCacheDir: string;
  /** The Tots to give a channel; read from the environment once the bot is ready. */
  readonly listTots: () => Promise<ReadonlyArray<GuildTot>>;
}

export interface DiscordBridgeOptions {
  readonly token: string;
  readonly allowedUserIds: ReadonlySet<string>;
  readonly logger: Logger;
  readonly sleep: (ms: number) => Promise<void>;
  /** Built here because the service writes through the DM channel of each user. */
  readonly createService: (channelFor: (userId: string) => ChannelPort) => BridgeService;
  readonly registerCommands?: boolean;
  /** Opt in to one channel per Tot in this server. Absent leaves the bridge to DMs. */
  readonly guild?: DiscordGuildOptions;
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
    .setName(STOP_COMMAND_NAME)
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
    cause.code === DiscordjsErrorCodes.TokenMissing ||
    // Guild mode asks for Message Content; Discord refuses to connect until it is enabled in the Bot tab.
    cause.code === DiscordjsErrorCodes.DisallowedIntents);

const commandFrom = (interaction: ChatInputCommandInteraction): SlashCommand | null => {
  if (interaction.commandName === STOP_COMMAND_NAME) return { kind: "stop" };
  const sub = interaction.options.getSubcommand(true);
  if (sub === "list") return { kind: "list" };
  if (sub === "new") return { kind: "new" };
  if (sub === "stop") return { kind: "stop" };
  if (sub === "use") {
    return { kind: "use", name: interaction.options.getString("name", true) };
  }
  return null;
};

/** Message Content is privileged, so guild intents are only requested in guild mode. */
export const intentsFor = (
  guild: DiscordGuildOptions | undefined,
): ReadonlyArray<GatewayIntentBits> =>
  guild === undefined
    ? [GatewayIntentBits.DirectMessages]
    : [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ];

export const startDiscordBridge = async (
  options: DiscordBridgeOptions,
): Promise<RunningDiscordBridge> => {
  const { logger } = options;
  const client = new Client({
    intents: intentsFor(options.guild),
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

  /** A Tot's channel id to its Tot, and to the port that speaks as that Tot. */
  const channelTots = new Map<string, string>();
  const channelPorts = new Map<string, ChannelPort>();

  const portFor = (key: string): ChannelPort => {
    const channelPort = channelPorts.get(key);
    if (channelPort !== undefined) return channelPort;
    return {
      send: async (text) => {
        const channel = await dmChannel(key);
        const sent = await channel.send(text);
        return { id: sent.id };
      },
      edit: async (message, text) => {
        const channel = await dmChannel(key);
        await channel.messages.edit(message.id, text);
      },
      typing: async () => {
        const channel = await dmChannel(key);
        await channel.sendTyping();
      },
    };
  };
  const service = options.createService(portFor);

  const fetchTextChannel = async (channelId: string): Promise<TextChannel> => {
    const channel = await client.channels.fetch(channelId);
    if (channel === null || channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel ${channelId} is not a text channel the bot can see.`);
    }
    return channel;
  };

  const guildPort = (guildId: string): GuildPort => {
    const guild = async () => client.guilds.fetch(guildId);
    return {
      listChannels: async () => {
        const channelsInGuild = await (await guild()).channels.fetch();
        return [...channelsInGuild.values()].flatMap((channel) =>
          channel === null
            ? []
            : [
                {
                  id: channel.id,
                  name: channel.name,
                  textual: channel.type === ChannelType.GuildText,
                },
              ],
        );
      },
      createTextChannel: async (name) => {
        const channel = await (
          await guild()
        ).channels.create({
          name,
          type: ChannelType.GuildText,
          reason: "T3 Tot channel",
        });
        return { id: channel.id, name: channel.name, textual: true };
      },
      listWebhooks: async (channelId) => {
        const hooks = await (await fetchTextChannel(channelId)).fetchWebhooks();
        return [...hooks.values()].map((hook) => ({
          id: hook.id,
          name: hook.name,
          token: hook.token,
        }));
      },
      createWebhook: async (channelId, input) => {
        const hook = await (
          await fetchTextChannel(channelId)
        ).createWebhook({
          name: input.name,
          avatar: input.avatar,
          reason: "T3 Tot face",
        });
        return { id: hook.id, name: hook.name, token: hook.token };
      },
      editWebhook: async (webhook, input) => {
        if (webhook.token === null) throw new Error("That webhook has no token to edit it with.");
        const client = new WebhookClient({ id: webhook.id, token: webhook.token });
        await client.edit({ name: input.name, avatar: input.avatar });
        return { id: webhook.id, name: input.name, token: webhook.token };
      },
    };
  };

  let guildSetup: Promise<void> | null = null;

  const setupGuild = async (guildOptions: DiscordGuildOptions): Promise<void> => {
    const tots = await guildOptions.listTots();
    const bindings = await ensureGuildChannels({
      tots,
      pinned: guildOptions.channelTotMap,
      port: guildPort(guildOptions.guildId),
      avatars: createAvatarStore({ dir: guildOptions.avatarCacheDir }),
      state: createWebhookState(NodePath.join(guildOptions.avatarCacheDir, "webhooks.json")),
      logger,
    });
    for (const binding of bindings) {
      const webhook = new WebhookClient({ id: binding.webhookId, token: binding.webhookToken });
      channelTots.set(binding.channelId, binding.totId);
      channelPorts.set(
        binding.channelId,
        createWebhookChannelPort({
          send: async (text) => {
            // Webhook output is agent text: never let it ping a role or @everyone.
            const sent = await webhook.send({ content: text, allowedMentions: { parse: [] } });
            return { id: sent.id };
          },
          edit: async (messageId, text) => {
            await webhook.editMessage(messageId, { content: text });
          },
        }),
      );
    }
    logger.info("guild.ready", {
      guildId: guildOptions.guildId,
      channels: channelTots.size,
    });
  };

  /** One attempt per ready event: a failed setup is retried on the next one. */
  const runGuildSetup = (): void => {
    const guildOptions = options.guild;
    if (guildOptions === undefined || guildSetup !== null) return;
    guildSetup = setupGuild(guildOptions).catch((cause: unknown) => {
      guildSetup = null;
      logger.error("guild.setup_failed", {
        guildId: guildOptions.guildId,
        reason: describeError(cause),
      });
    });
  };

  const handleDm = async (message: Message): Promise<void> => {
    const allowed = isAllowedAuthor(
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

  const handleMessage = async (message: Message): Promise<void> => {
    // A bot DM: one Tot, one person. Guild channels are a Tot each, below.
    if (message.channel.type === ChannelType.DM) {
      await handleDm(message);
      return;
    }
    const guildOptions = options.guild;
    if (guildOptions === undefined || message.guildId !== guildOptions.guildId) return;
    const decision = routeGuildMessage({
      channelId: message.channelId,
      author: { userId: message.author.id, bot: message.author.bot },
      content: message.content,
      channelTots,
      allowedUserIds: options.allowedUserIds,
    });
    if (decision.kind === "ignore") {
      if (decision.reason === "not-allowed") {
        logger.warn("discord.ignored_author", {
          userId: message.author.id,
          channelId: message.channelId,
        });
      } else if (decision.reason === "empty" && message.attachments.size > 0) {
        await channelPorts.get(message.channelId)?.send(ATTACHMENTS_UNSUPPORTED);
      }
      return;
    }
    await service.handleChannelText(message.channelId, decision.totId, decision.text);
  };

  const handleInteraction = async (interaction: Interaction): Promise<void> => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== COMMAND_NAME) return;
      const allowed = isAllowedAuthor(
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
    const allowed = isAllowedAuthor(
      { userId: interaction.user.id, bot: interaction.user.bot },
      options.allowedUserIds,
    );
    if (!allowed) {
      logger.warn("discord.ignored_author", { userId: interaction.user.id });
      return;
    }
    const command = commandFrom(interaction);
    if (interaction.channel !== null && !interaction.channel.isDMBased()) {
      const totId = command === null ? undefined : channelTots.get(interaction.channelId);
      if (command?.kind === "stop" && totId !== undefined) {
        await interaction.deferReply();
        try {
          const reply = await service.handleChannelStop(interaction.channelId, totId);
          await interaction.editReply(reply.text);
        } catch (cause) {
          logger.error("discord.command_failed", {
            channelId: interaction.channelId,
            command: command.kind,
            reason: describeError(cause),
          });
          await interaction.editReply(`T3 did not answer: ${describeError(cause)}`);
        }
        return;
      }
      if (totId !== undefined) {
        await interaction.reply({
          content:
            "This channel always talks to its Tot. /stop works here; use a DM for /tot list, /tot use and /tot new.",
        });
        return;
      }
      await interaction.reply({
        content: "Send me a direct message to talk to a Tot from there.",
      });
      return;
    }
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
    runGuildSetup();
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
