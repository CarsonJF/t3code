import type { OrchestratorMcpThreadReadResult } from "@t3tools/contracts";

import { describeQuestion, type PendingQuestion } from "./answers.ts";
import { type Logger, describeError } from "./log.ts";
import type { TotView } from "./routing.ts";
import { splitMessage } from "./split.ts";
import { StreamEditor } from "./stream.ts";
import type { T3Client } from "./t3Client.ts";
import {
  listPendingRequests,
  newestMessagePosition,
  readPendingRequest,
  readThreadActivity,
  readThreadMessages,
  sendToThread,
} from "./tots.ts";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted", "rolled_back"]);
const STOPPED = "Stopped.";
const EMPTY_REPLY = "(The turn finished without a message.)";
const DEFAULT_POLL_MS = 900;
const ACTIVITY_EVERY_TICKS = 3;
const TYPING_EVERY_TICKS = 8;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_TURN_MS = 30 * 60 * 1_000;
const TAIL_PAGE_CHARS = 20_000;

export interface ChannelMessage {
  readonly id: string;
}

/** The DM the bridge writes into: one channel per user. */
export interface ChannelPort {
  readonly send: (text: string) => Promise<ChannelMessage>;
  readonly edit: (message: ChannelMessage, text: string) => Promise<void>;
  readonly typing: () => Promise<void>;
}

export interface TurnDependencies {
  /** The client for the machine a turn's Tot lives on. */
  readonly t3For: (environment: string) => T3Client;
  readonly channel: ChannelPort;
  readonly logger: Logger;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Records a question the user now owes an answer to. */
  readonly onQuestion: (pending: PendingQuestion, tot: TotView) => void;
  /** The turn ended, so no question from it is still pending. */
  readonly onSettled: (threadId: string) => void;
  readonly pollIntervalMs?: number;
}

export interface TurnRequest {
  readonly userId: string;
  readonly tot: TotView;
  readonly text: string;
  readonly fresh: boolean;
}

export type TurnOutcome =
  | { readonly kind: "replied"; readonly text: string }
  | { readonly kind: "busy" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export interface TurnRunner {
  readonly run: (request: TurnRequest) => Promise<TurnOutcome>;
  readonly isBusy: (userId: string, totId: string) => boolean;
}

const workingText = (tot: TotView, queued: boolean, label: string | null): string => {
  const state = queued ? "is busy in the app, so this message is queued." : "is working…";
  return [`${tot.name} ${state}`, ...(label === null ? [] : [label])].join("\n");
};

const firstLine = (text: string | null, max = 140): string | null => {
  if (text === null) return null;
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0);
  if (line === undefined) return null;
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

/** What the bridge reads off an activity item to describe the work in progress. */
export interface ActivityItem {
  readonly type: string;
  readonly status: string;
  readonly title: string | null;
  readonly text: string | null;
}

/** What the agent is doing right now, from the activity timeline the app shows. */
export const activityLabel = (items: ReadonlyArray<ActivityItem>): string | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    const text = firstLine(item.text);
    switch (item.type) {
      case "command_execution":
        return text === null ? "Running a command" : `Running ${text.replace(/^\$\s*/u, "")}`;
      case "file_change":
        return text === null ? "Editing files" : `Editing ${text}`;
      case "file_search":
        return "Searching files";
      case "web_search":
        return "Searching the web";
      case "dynamic_tool":
        return item.title === null ? "Using a tool" : `Using ${item.title}`;
      case "subagent":
        return item.title === null ? "Working through a subagent" : item.title;
      case "error":
        return "Hit an error";
      default:
        continue;
    }
  }
  return null;
};

const renderLive = (
  live: ReadonlyMap<string, { readonly position: number; readonly text: string }>,
): string =>
  [...live.values()]
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

const failuresWith = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : describeError(cause);

/** Appends whatever the item's text gained since the length already shown. */
const readItemTail = async (
  t3: T3Client,
  threadId: string,
  itemId: string,
  shown: number,
): Promise<string> => {
  let appended = "";
  let offset = shown;
  for (let page = 0; page < 50; page += 1) {
    const read = await readThreadMessages(t3, {
      threadId,
      itemId,
      textOffset: offset,
      limit: 1,
      maxCharsPerItem: TAIL_PAGE_CHARS,
    });
    const item = read.items.find((candidate) => candidate.itemId === itemId);
    if (item === undefined) break;
    const text = item.text ?? "";
    appended += text;
    const next = item.nextTextOffset;
    if (next === null || next === undefined || text.length === 0) break;
    offset = next;
  }
  return appended;
};

const runStatusOf = (read: OrchestratorMcpThreadReadResult, runId: string): string =>
  read.recentRuns.find((run) => run.runId === runId)?.status ?? read.thread.status;

const runTurn = async (deps: TurnDependencies, request: TurnRequest): Promise<TurnOutcome> => {
  const threadId = request.tot.threadId;
  if (threadId === null) {
    return { kind: "unavailable", message: `${request.tot.name} has no thread yet.` };
  }
  const { channel, logger } = deps;
  const t3 = deps.t3For(request.tot.environment);
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;

  const baseline = await newestMessagePosition(t3, threadId);
  const sent = await sendToThread(t3, {
    threadId,
    message: request.text,
    ...(request.fresh ? { fresh: true } : {}),
  });
  logger.info("turn.started", {
    userId: request.userId,
    totId: request.tot.id,
    threadId,
    runId: sent.runId,
    delivery: sent.delivery,
    fresh: request.fresh,
  });

  const placeholder = await channel.send(
    workingText(request.tot, sent.delivery === "queued", null),
  );
  const editor = new StreamEditor({ now: deps.now });
  editor.seed(workingText(request.tot, sent.delivery === "queued", null));

  const live = new Map<string, { position: number; text: string }>();
  const offeredQuestions = new Set<string>();
  const announcedApprovals = new Set<string>();
  let cursor = baseline;
  let status: string = sent.status;
  let ticks = 0;
  let failures = 0;
  const startedAt = deps.now();

  const surfaceQuestions = async () => {
    const pending = await listPendingRequests(t3, threadId);
    for (const requestId of pending.requestIds) {
      if (offeredQuestions.has(requestId)) continue;
      offeredQuestions.add(requestId);
      const pendingRequest = await readPendingRequest(t3, threadId, requestId);
      const first = pendingRequest.questions[0];
      if (first === undefined) continue;
      const state: PendingQuestion = {
        threadId,
        requestId,
        questions: pendingRequest.questions,
        answers: {},
        nextIndex: 0,
      };
      deps.onQuestion(state, request.tot);
      await channel.send(
        describeQuestion(first, { index: 0, total: pendingRequest.questions.length }),
      );
      logger.info("turn.question", {
        threadId,
        requestId,
        questions: pendingRequest.questions.length,
      });
    }
  };

  const surfaceApprovals = async (activity: OrchestratorMcpThreadReadResult) => {
    for (const item of activity.items) {
      if (item.type !== "approval_request" || item.status !== "pending") continue;
      if (announcedApprovals.has(item.itemId)) continue;
      announcedApprovals.add(item.itemId);
      const prompt = firstLine(item.text, 400) ?? "A permission request is waiting.";
      await channel.send(
        [
          `${request.tot.name} needs your approval:`,
          prompt,
          "",
          "Only a Tot can approve, so answer in T3:",
          request.tot.link ?? threadId,
        ].join("\n"),
      );
      logger.info("turn.approval", { threadId });
    }
  };

  try {
    while (true) {
      if (deps.now() - startedAt > MAX_TURN_MS) {
        status = "failed";
        break;
      }
      try {
        const read = await readThreadMessages(t3, {
          threadId,
          afterPosition: cursor,
          limit: 50,
        });
        for (const item of read.items) {
          if (item.position > cursor) cursor = item.position;
          if (
            item.type === "assistant_message" &&
            item.runId === sent.runId &&
            !live.has(item.itemId)
          ) {
            live.set(item.itemId, { position: item.position, text: item.text ?? "" });
          }
        }
        // Only the newest assistant message can still grow: a later one starts after it.
        const growing = [...live.entries()].reduce<
          [string, { position: number; text: string }] | undefined
        >(
          (newest, entry) =>
            newest === undefined || entry[1].position > newest[1].position ? entry : newest,
          undefined,
        );
        if (growing !== undefined) {
          const appended = await readItemTail(t3, threadId, growing[0], growing[1].text.length);
          if (appended.length > 0) growing[1].text += appended;
        }

        const activity =
          ticks % ACTIVITY_EVERY_TICKS === 0 ? await readThreadActivity(t3, { threadId }) : null;
        if (activity !== null) await surfaceApprovals(activity);

        const body = renderLive(live);
        const label =
          body.length > 0 ? null : activity === null ? null : activityLabel(activity.items);
        const visible =
          body.length > 0 ? body : workingText(request.tot, sent.delivery === "queued", label);
        const next = editor.next(visible);
        if (next !== null) await channel.edit(placeholder, next);

        if (read.thread.pendingRequestCount > 0) await surfaceQuestions();

        status = runStatusOf(read, sent.runId);
        if (TERMINAL.has(status)) break;
        failures = 0;
      } catch (cause) {
        failures += 1;
        logger.warn("turn.poll_failed", {
          threadId,
          runId: sent.runId,
          failures,
          reason: failuresWith(cause),
        });
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          status = "failed";
          break;
        }
      }
      ticks += 1;
      if (ticks % TYPING_EVERY_TICKS === 0) await channel.typing().catch(() => undefined);
      await deps.sleep(pollIntervalMs);
    }
  } finally {
    deps.onSettled(threadId);
  }

  let settled = renderLive(live);
  if (settled.length === 0) {
    if (status === "failed") {
      const activity = await readThreadActivity(t3, {
        threadId,
        limit: 20,
        maxCharsPerItem: 2_000,
      }).catch(() => null);
      const failure = activity?.items.findLast((item) => item.type === "error");
      settled = firstLine(failure?.text ?? null, 1_500) ?? "The turn failed.";
    } else if (status === "interrupted" || status === "cancelled") {
      settled = STOPPED;
    } else {
      settled = EMPTY_REPLY;
    }
  }

  const chunks = splitMessage(settled);
  const head = chunks[0] ?? EMPTY_REPLY;
  if (!editor.matches(head)) await channel.edit(placeholder, head);
  for (const chunk of chunks.slice(1)) await channel.send(chunk);

  logger.info("turn.settled", {
    userId: request.userId,
    totId: request.tot.id,
    threadId,
    runId: sent.runId,
    status,
    characters: settled.length,
    chunks: Math.max(1, chunks.length),
  });

  return status === "failed" && renderLive(live).length === 0
    ? { kind: "failed", message: settled }
    : { kind: "replied", text: settled };
};

/** One in-flight turn per user and Tot, so a second DM cannot queue behind a hidden wait. */
export const createTurnRunner = (deps: TurnDependencies): TurnRunner => {
  const inFlight = new Set<string>();
  return {
    isBusy: (userId, totId) => inFlight.has(`${userId}:${totId}`),
    run: async (request) => {
      const key = `${request.userId}:${request.tot.id}`;
      if (inFlight.has(key)) return { kind: "busy" };
      inFlight.add(key);
      try {
        return await runTurn(deps, request);
      } catch (cause) {
        deps.logger.error("turn.failed", {
          userId: request.userId,
          totId: request.tot.id,
          reason: failuresWith(cause),
        });
        return { kind: "failed", message: failuresWith(cause) };
      } finally {
        inFlight.delete(key);
      }
    },
  };
};
