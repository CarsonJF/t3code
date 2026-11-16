import {
  answerQuestion,
  currentQuestion,
  describeQuestion,
  type PendingQuestion,
} from "./answers.ts";
import type { EnvironmentCatalog } from "./environments.ts";
import { type Logger, describeError } from "./log.ts";
import {
  type EnvironmentFailure,
  type RouteContext,
  type SlashCommand,
  type StickyTots,
  type TotRef,
  type TotView,
  autocompleteTots,
  createStickyTots,
  describeTot,
  resolveTot,
  routeCommand,
  routeText,
  routeToTot,
  sameTot,
  totKey,
} from "./routing.ts";
import { respondToPendingRequest, stopThread } from "./tots.ts";
import { type ChannelPort, type TurnOutcome, createTurnRunner } from "./turns.ts";

export interface BridgeServiceOptions {
  readonly catalog: EnvironmentCatalog;
  readonly channelFor: (userId: string) => ChannelPort;
  readonly logger: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly defaultTotName: string;
  /** Name the machine in replies. Off for the single-environment form. */
  readonly multiEnvironment?: boolean;
  readonly pollIntervalMs?: number;
}

export interface CommandReply {
  readonly text: string;
}

export interface BridgeService {
  readonly handleText: (userId: string, text: string) => Promise<void>;
  /** A guild channel, whose Tot the channel fixes instead of the sticky pick. */
  readonly handleChannelText: (channelId: string, tot: TotRef, text: string) => Promise<void>;
  readonly handleChannelStop: (channelId: string, tot: TotRef) => Promise<CommandReply>;
  readonly handleCommand: (userId: string, command: SlashCommand) => Promise<CommandReply>;
  readonly autocomplete: (
    query: string,
  ) => Promise<ReadonlyArray<{ readonly name: string; readonly value: string }>>;
  readonly describeTots: (userId: string) => Promise<string>;
}

const offSuffix = (tot: TotView): string => (tot.threadId === null ? " (off)" : "");

export interface TotListOptions {
  readonly multiEnvironment?: boolean;
  readonly failures?: ReadonlyArray<EnvironmentFailure>;
}

const failureLines = (
  failures: ReadonlyArray<EnvironmentFailure>,
  multiEnvironment: boolean,
): ReadonlyArray<string> => {
  if (failures.length === 0) return [];
  const heading = multiEnvironment ? "Could not load:" : "Could not reach T3:";
  return [heading, ...failures.map((failure) => `• ${failure.environment}: ${failure.reason}`)];
};

export const formatTotList = (
  tots: ReadonlyArray<TotView>,
  current: TotView | undefined,
  options: TotListOptions = {},
): string => {
  const multiEnvironment = options.multiEnvironment === true;
  const failures = options.failures ?? [];
  if (tots.length === 0) {
    if (failures.length > 0) {
      return [
        multiEnvironment
          ? "No Tots could be loaded from these machines."
          : "No Tots could be loaded from this T3 server.",
        "",
        ...failureLines(failures, multiEnvironment),
      ].join("\n");
    }
    return multiEnvironment
      ? "No Tots are set up on these machines yet. Create one in the app first."
      : "No Tots are set up on this T3 server yet. Create one in the app first.";
  }

  const line = (tot: TotView): string => {
    const marker = current !== undefined && totKey(current) === totKey(tot) ? " ← this DM" : "";
    return `• ${tot.name}${offSuffix(tot)}${marker}`;
  };
  const lines: Array<string> = [
    multiEnvironment ? "Tots on these machines:" : "Tots on this machine:",
  ];
  if (multiEnvironment) {
    const groups = new Map<string, Array<TotView>>();
    for (const tot of tots) {
      const group = groups.get(tot.environment);
      if (group === undefined) groups.set(tot.environment, [tot]);
      else group.push(tot);
    }
    let first = true;
    for (const [environment, group] of groups) {
      if (!first) lines.push("");
      first = false;
      lines.push(environment);
      for (const tot of group) lines.push(line(tot));
    }
  } else {
    for (const tot of tots) lines.push(line(tot));
  }

  const failed = failureLines(failures, multiEnvironment);
  if (failed.length > 0) lines.push("", ...failed);
  lines.push(
    "",
    multiEnvironment
      ? "Use /tot use <name>, or <machine>:<name> when two machines share a name."
      : "Use /tot use <name> to switch.",
  );
  return lines.join("\n");
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

interface PendingAnswer {
  readonly pending: PendingQuestion;
  readonly environment: string;
}

export const createBridgeService = (options: BridgeServiceOptions): BridgeService => {
  const { catalog, logger } = options;
  const multiEnvironment = options.multiEnvironment === true;
  const sticky: StickyTots = createStickyTots();
  const armedFresh = new Map<string, Set<string>>();
  const pendingByConversation = new Map<string, PendingAnswer>();

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
      t3For: (environment) => catalog.clientFor(environment),
      channel,
      logger,
      now: options.now,
      sleep: options.sleep,
      onQuestion: (pending, tot) => {
        pendingByConversation.set(conversation, { pending, environment: tot.environment });
      },
      onSettled: (threadId) => {
        const pending = pendingByConversation.get(conversation);
        if (pending?.pending.threadId === threadId) pendingByConversation.delete(conversation);
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
    runners.set(conversation, created);
    return created;
  };

  const contextFor = async (conversation: string): Promise<RouteContext> => {
    const snapshot = await catalog.refresh();
    return {
      tots: snapshot.tots,
      sticky,
      defaultName: options.defaultTotName,
      userId: conversation,
      failures: snapshot.failures,
      multiEnvironment,
    };
  };

  const answerPending = async (
    conversation: string,
    channel: ChannelPort,
    text: string,
  ): Promise<boolean> => {
    const stored = pendingByConversation.get(conversation);
    if (stored === undefined) return false;
    const outcome = answerQuestion(stored.pending, text);
    if (outcome.kind === "rejected") {
      await channel.send(outcome.note);
      return true;
    }
    pendingByConversation.set(conversation, {
      pending: outcome.pending,
      environment: stored.environment,
    });
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
      await respondToPendingRequest(catalog.clientFor(stored.environment), {
        threadId: outcome.pending.threadId,
        requestId: outcome.pending.requestId,
        answers: outcome.answers,
      });
      await channel.send(`Answered ${outcome.note}.`);
      logger.info("bridge.answer", {
        userId: conversation,
        environment: stored.environment,
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
    readonly tot: TotRef | null;
  }): Promise<void> => {
    const { conversation, channel, text } = input;
    try {
      if (await answerPending(conversation, channel, text)) return;
      const context = await contextFor(conversation);
      if (input.tot !== null) {
        const failure = context.failures?.find(
          (candidate) => candidate.environment === input.tot!.environment,
        );
        if (failure !== undefined) {
          await channel.send(`Could not reach ${failure.environment}: ${failure.reason}`);
          return;
        }
      }
      const fresh = freshFor(conversation);
      const decision =
        input.tot === null
          ? routeText(context, text, { freshTotKeys: fresh })
          : routeToTot(context.tots, input.tot, text, {
              freshTotKeys: fresh,
              multiEnvironment,
            });
      if (decision.kind === "unavailable") {
        await channel.send(decision.message);
        return;
      }
      if (decision.kind !== "send") {
        await channel.send("Only plain messages and /tot commands are understood here.");
        return;
      }
      if (decision.fresh) fresh.delete(totKey(decision.tot));
      const outcome = await runnerFor(conversation, channel).run({
        userId: conversation,
        tot: decision.tot,
        text: decision.text,
        fresh: decision.fresh,
      });
      const message = outcomeMessage(outcome, decision.tot.name);
      if (message !== null) await channel.send(message);
    } catch (cause) {
      logger.error("bridge.text_failed", {
        userId: conversation,
        ...(input.tot === null ? {} : { environment: input.tot.environment }),
        reason: describeError(cause),
      });
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
    const result = await stopThread(catalog.clientFor(tot.environment), tot.threadId).catch(
      (cause: unknown) => {
        logger.warn("bridge.stop_failed", {
          userId: conversation,
          environment: tot.environment,
          reason: describeError(cause),
        });
        return null;
      },
    );
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
      tot: null,
    });
  };

  const handleChannelText = async (channelId: string, tot: TotRef, text: string): Promise<void> => {
    await deliver({
      conversation: channelConversation(channelId),
      channel: options.channelFor(channelId),
      text,
      tot,
    });
  };

  const handleChannelStop = async (channelId: string, ref: TotRef): Promise<CommandReply> => {
    const context = await contextFor(channelConversation(channelId));
    const failure = context.failures?.find(
      (candidate) => candidate.environment === ref.environment,
    );
    if (failure !== undefined) {
      return { text: `Could not reach ${failure.environment}: ${failure.reason}` };
    }
    const tot = context.tots.find((candidate) => sameTot(candidate, ref));
    if (tot === undefined) {
      return {
        text: `There is no Tot ${ref.totId} ${multiEnvironment ? `on ${ref.environment}` : "on this T3 server"}.`,
      };
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
        text: formatTotList(context.tots, resolution.kind === "tot" ? resolution.tot : undefined, {
          multiEnvironment,
          ...(context.failures === undefined ? {} : { failures: context.failures }),
        }),
      };
    }
    if (decision.kind === "unavailable") return { text: decision.message };
    if (decision.kind === "use") {
      sticky.set(userId, totKey(decision.tot));
      logger.info("bridge.use", {
        userId,
        environment: decision.tot.environment,
        totId: decision.tot.id,
      });
      const alsoOn = decision.alsoOn ?? [];
      const note =
        alsoOn.length === 0
          ? ""
          : ` The same name is also on ${alsoOn.join(", ")}; use /tot use ${alsoOn[0]}:${decision.tot.name} for that machine.`;
      return {
        text: `This DM now talks to ${describeTot(decision.tot, multiEnvironment)}.${decision.tot.threadId === null ? " Turn it on in the app before messaging it." : ""}${note}`,
      };
    }
    if (decision.kind === "new") {
      freshFor(userId).add(totKey(decision.tot));
      return {
        text: `The next message to ${describeTot(decision.tot, multiEnvironment)} starts a fresh session: a new provider context in its thread. T3's Start fresh, which moves the Tot to a new thread, is only in the app.`,
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
      const snapshot = await catalog.refresh();
      return autocompleteTots(snapshot.tots, query).map((tot) => ({
        name: `${multiEnvironment ? `${tot.name} (${tot.environment})` : tot.name}${offSuffix(tot)}`.slice(
          0,
          100,
        ),
        value: multiEnvironment ? `${tot.environment}:${tot.id}` : tot.id,
      }));
    },
    describeTots: async (userId) => {
      const context = await contextFor(userId);
      const resolution = resolveTot(context);
      return formatTotList(context.tots, resolution.kind === "tot" ? resolution.tot : undefined, {
        multiEnvironment,
        ...(context.failures === undefined ? {} : { failures: context.failures }),
      });
    },
  };
};
