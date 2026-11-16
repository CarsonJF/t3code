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

export const createBridgeService = (options: BridgeServiceOptions): BridgeService => {
  const { t3, logger } = options;
  const sticky: StickyTots = createStickyTots();
  const armedFresh = new Map<string, Set<string>>();
  const pendingByUser = new Map<string, PendingQuestion>();

  const freshFor = (userId: string): Set<string> => {
    const existing = armedFresh.get(userId);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    armedFresh.set(userId, created);
    return created;
  };

  const runners = new Map<string, ReturnType<typeof createTurnRunner>>();
  const runnerFor = (userId: string) => {
    const existing = runners.get(userId);
    if (existing !== undefined) return existing;
    const created = createTurnRunner({
      t3,
      channel: options.channelFor(userId),
      logger,
      now: options.now,
      sleep: options.sleep,
      onQuestion: (pending) => {
        pendingByUser.set(userId, pending);
      },
      onSettled: (threadId) => {
        const pending = pendingByUser.get(userId);
        if (pending?.threadId === threadId) pendingByUser.delete(userId);
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    });
    runners.set(userId, created);
    return created;
  };

  const contextFor = async (userId: string): Promise<RouteContext> => ({
    tots: await listTots(t3),
    sticky,
    defaultName: options.defaultTotName,
    userId,
  });

  const answerPending = async (userId: string, text: string): Promise<boolean> => {
    const pending = pendingByUser.get(userId);
    if (pending === undefined) return false;
    const channel = options.channelFor(userId);
    const outcome = answerQuestion(pending, text);
    if (outcome.kind === "rejected") {
      await channel.send(outcome.note);
      return true;
    }
    pendingByUser.set(userId, outcome.pending);
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
    pendingByUser.delete(userId);
    try {
      await respondToPendingRequest(t3, {
        threadId: outcome.pending.threadId,
        requestId: outcome.pending.requestId,
        answers: outcome.answers,
      });
      await channel.send(`Answered ${outcome.note}.`);
      logger.info("bridge.answer", {
        userId,
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

  const handleText = async (userId: string, text: string): Promise<void> => {
    const channel = options.channelFor(userId);
    try {
      if (await answerPending(userId, text)) return;
      const context = await contextFor(userId);
      const decision = routeText(context, text, { freshTotIds: freshFor(userId) });
      if (decision.kind === "unavailable") {
        await channel.send(decision.message);
        return;
      }
      if (decision.kind !== "send") {
        await channel.send("Only plain messages and /tot commands are understood here.");
        return;
      }
      if (decision.fresh) freshFor(userId).delete(decision.tot.id);
      const outcome = await runnerFor(userId).run({
        userId,
        tot: decision.tot,
        text: decision.text,
        fresh: decision.fresh,
      });
      const message = outcomeMessage(outcome, decision.tot.name);
      if (message !== null) await channel.send(message);
    } catch (cause) {
      logger.error("bridge.text_failed", { userId, reason: describeError(cause) });
      await channel.send(`T3 did not answer: ${describeError(cause)}`);
    }
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
    if (decision.tot.threadId === null) {
      return { text: `${decision.tot.name} is not running. Turn it on in the app first.` };
    }
    const result = await stopThread(t3, decision.tot.threadId).catch((cause: unknown) => {
      logger.warn("bridge.stop_failed", { userId, reason: describeError(cause) });
      return null;
    });
    if (result === null) return { text: `Could not stop ${decision.tot.name}.` };
    await channel.typing().catch(() => undefined);
    return {
      text:
        result.status === "no_active_run"
          ? `${decision.tot.name} has nothing running.`
          : `Stopped ${decision.tot.name}.`,
    };
  };

  return {
    handleText,
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
