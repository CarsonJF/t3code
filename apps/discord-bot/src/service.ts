import {
  answerQuestion,
  currentQuestion,
  describeQuestion,
  type PendingQuestion,
} from "./answers.ts";
import { type Logger, describeError } from "./log.ts";
import {
  type RouteContext,
  type SlashCommand,
  type StickyTots,
  type TotView,
  autocompleteTots,
  createStickyTots,
  resolveTot,
  routeCommand,
  routeText,
  routeToTot,
} from "./routing.ts";
import type { T3Client } from "./t3Client.ts";
import { listTots, respondToPendingRequest, stopThread } from "./tots.ts";
import { type ChannelPort, type TurnOutcome, createTurnRunner } from "./turns.ts";

export interface BridgeServiceOptions {
  readonly t3: T3Client;
  readonly channelFor: (userId: string) => ChannelPort;
  readonly logger: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly defaultTotName: string;
  readonly pollIntervalMs?: number;
}

export interface CommandReply {
  readonly text: string;
}

export interface BridgeService {
  readonly handleText: (userId: string, text: string) => Promise<void>;
  /** A guild channel, whose Tot the channel fixes instead of the sticky pick. */
  readonly handleChannelText: (channelId: string, totId: string, text: string) => Promise<void>;
  readonly handleChannelStop: (channelId: string, totId: string) => Promise<CommandReply>;
  readonly handleCommand: (userId: string, command: SlashCommand) => Promise<CommandReply>;
  readonly autocomplete: (
    query: string,
  ) => Promise<ReadonlyArray<{ readonly name: string; readonly value: string }>>;
  readonly describeTots: (userId: string) => Promise<string>;
}

const offSuffix = (tot: TotView): string => (tot.threadId === null ? " (off)" : "");

export const formatTotList = (
  tots: ReadonlyArray<TotView>,
  current: TotView | undefined,
): string => {
  if (tots.length === 0) {
    return "No Tots are set up on this T3 server yet. Create one in the app first.";
  }
  const lines = tots.map((tot) => {
    const marker = current?.id === tot.id ? " ← this DM" : "";
    return `• ${tot.name}${offSuffix(tot)}${marker}`;
  });
  return [`Tots on this machine:`, ...lines, "", "Use /tot use <name> to switch."].join("\n");
};

const outcomeMessage = (outcome: TurnOutcome, name: string): string | null => {
  switch (outcome.kind) {
    case "busy":
      return `${name} is still working. Wait for it, or send /tot stop.`;
    case "failed":
    case "unavailable":
      return outcome.message;
    case "replied":
      return null;
  }
};

/** A guild channel is one conversation, keyed apart from any DM user id. */
const channelConversation = (channelId: string): string => `channel:${channelId}`;

export const createBridgeService = (options: BridgeServiceOptions): BridgeService => {
  const { t3, logger } = options;
  const sticky: StickyTots = createStickyTots();
  const armedFresh = new Map<string, Set<string>>();
  const pendingByConversation = new Map<string, PendingQuestion>();

  const freshFor = (conversation: string): Set<string> => {
    const existing = armedFresh.get(conversation);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    armedFresh.set(conversation, created);
    return created;
  };

  const runners = new Map<string, ReturnType<typeof createTurnRunner>>();
  const runnerFor = (conversation: string, channel: ChannelPort) => {
    const existing = runners.get(conversation);
    if (existing !== undefined) return existing;
    const created = createTurnRunner({
      t3,
      channel,
      logger,
      now: options.now,
      sleep: options.sleep,
      onQuestion: (pending) => {
        pendingByConversation.set(conversation, pending);
      },
      onSettled: (threadId) => {
        const pending = pendingByConversation.get(conversation);
        if (pending?.threadId === threadId) pendingByConversation.delete(conversation);
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
    runners.set(conversation, created);
    return created;
  };

  const contextFor = async (conversation: string): Promise<RouteContext> => ({
    tots: await listTots(t3),
    sticky,
    defaultName: options.defaultTotName,
    userId: conversation,
  });

  const answerPending = async (
    conversation: string,
    channel: ChannelPort,
    text: string,
  ): Promise<boolean> => {
    const pending = pendingByConversation.get(conversation);
    if (pending === undefined) return false;
    const outcome = answerQuestion(pending, text);
    if (outcome.kind === "rejected") {
      await channel.send(outcome.note);
      return true;
    }
    pendingByConversation.set(conversation, outcome.pending);
    if (outcome.kind === "partial") {
      const next = currentQuestion(outcome.pending);
      await channel.send(
        next === undefined
          ? outcome.note
          : `${outcome.note}\n\n${describeQuestion(next, {
              index: outcome.pending.nextIndex,
              total: outcome.pending.questions.length,
            })}`,
      );
      return true;
    }
    pendingByConversation.delete(conversation);
    try {
      await respondToPendingRequest(t3, {
        threadId: outcome.pending.threadId,
        requestId: outcome.pending.requestId,
        answers: outcome.answers,
      });
      await channel.send(`Answered ${outcome.note}.`);
      logger.info("bridge.answer", {
        userId: conversation,
        threadId: outcome.pending.threadId,
        requestId: outcome.pending.requestId,
      });
    } catch (cause) {
      await channel.send(
        `That question is no longer waiting (${describeError(cause)}). T3 may have answered it in the app.`,
      );
    }
    return true;
  };

  /** One path for DMs and channels: a DM resolves its sticky Tot, a channel has one. */
  const deliver = async (input: {
    readonly conversation: string;
    readonly channel: ChannelPort;
    readonly text: string;
    readonly totId: string | null;
  }): Promise<void> => {
    const { conversation, channel, text } = input;
    try {
      if (await answerPending(conversation, channel, text)) return;
      const context = await contextFor(conversation);
      const fresh = freshFor(conversation);
      const decision =
        input.totId === null
          ? routeText(context, text, { freshTotIds: fresh })
          : routeToTot(context.tots, input.totId, text, { freshTotIds: fresh });
      if (decision.kind === "unavailable") {
        await channel.send(decision.message);
        return;
      }
      if (decision.kind !== "send") {
        await channel.send("Only plain messages and /tot commands are understood here.");
        return;
      }
      if (decision.fresh) fresh.delete(decision.tot.id);
      const outcome = await runnerFor(conversation, channel).run({
        userId: conversation,
        tot: decision.tot,
        text: decision.text,
        fresh: decision.fresh,
      });
      const message = outcomeMessage(outcome, decision.tot.name);
      if (message !== null) await channel.send(message);
    } catch (cause) {
      logger.error("bridge.text_failed", { userId: conversation, reason: describeError(cause) });
      await channel.send(`T3 did not answer: ${describeError(cause)}`);
    }
  };

  const stopReply = async (
    conversation: string,
    channel: ChannelPort,
    tot: TotView,
  ): Promise<CommandReply> => {
    if (tot.threadId === null) {
      return { text: `${tot.name} is not running. Turn it on in the app first.` };
    }
    const result = await stopThread(t3, tot.threadId).catch((cause: unknown) => {
      logger.warn("bridge.stop_failed", { userId: conversation, reason: describeError(cause) });
      return null;
    });
    if (result === null) return { text: `Could not stop ${tot.name}.` };
    await channel.typing().catch(() => undefined);
    return {
      text:
        result.status === "no_active_run"
          ? `${tot.name} has nothing running.`
          : `Stopped ${tot.name}.`,
    };
  };

  const handleText = async (userId: string, text: string): Promise<void> => {
    await deliver({
      conversation: userId,
      channel: options.channelFor(userId),
      text,
      totId: null,
    });
  };

  const handleChannelText = async (
    channelId: string,
    totId: string,
    text: string,
  ): Promise<void> => {
    await deliver({
      conversation: channelConversation(channelId),
      channel: options.channelFor(channelId),
      text,
      totId,
    });
  };

  const handleChannelStop = async (channelId: string, totId: string): Promise<CommandReply> => {
    const tots = await listTots(t3);
    const tot = tots.find((candidate) => candidate.id === totId);
    if (tot === undefined) {
      return { text: `There is no Tot ${totId} on this T3 server.` };
    }
    return stopReply(channelConversation(channelId), options.channelFor(channelId), tot);
  };

  const handleCommand = async (userId: string, command: SlashCommand): Promise<CommandReply> => {
    const channel = options.channelFor(userId);
    const context = await contextFor(userId);
    const decision = routeCommand(context, command);
    if (decision.kind === "list") {
      const resolution = resolveTot(context);
      return {
        text: formatTotList(context.tots, resolution.kind === "tot" ? resolution.tot : undefined),
      };
    }
    if (decision.kind === "unavailable") return { text: decision.message };
    if (decision.kind === "use") {
      sticky.set(userId, decision.tot.id);
      logger.info("bridge.use", { userId, totId: decision.tot.id });
      return {
        text: `This DM now talks to ${decision.tot.name}.${decision.tot.threadId === null ? " Turn it on in the app before messaging it." : ""}`,
      };
    }
    if (decision.kind === "new") {
      freshFor(userId).add(decision.tot.id);
      return {
        text: `The next message to ${decision.tot.name} starts a fresh session: a new provider context in its thread. T3's Start fresh, which moves the Tot to a new thread, is only in the app.`,
      };
    }
    return stopReply(userId, channel, decision.tot);
  };

  return {
    handleText,
    handleChannelText,
    handleChannelStop,
    handleCommand,
    autocomplete: async (query) => {
      const tots = await listTots(t3);
      return autocompleteTots(tots, query).map((tot) => ({
        name: `${tot.name}${offSuffix(tot)}`.slice(0, 100),
        value: tot.id,
      }));
    },
    describeTots: async (userId) => {
      const tots = await listTots(t3);
      const resolution = resolveTot({
        tots,
        sticky,
        defaultName: options.defaultTotName,
        userId,
      });
      return formatTotList(tots, resolution.kind === "tot" ? resolution.tot : undefined);
    },
  };
};
