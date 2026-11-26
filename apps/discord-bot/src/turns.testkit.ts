import type {
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadTimelineItem,
} from "@t3tools/contracts";

import type { Question } from "./answers.ts";
import type { T3CallOptions, T3Client } from "./t3Client.ts";
import type { ChannelMessage, ChannelPort } from "./turns.ts";

export interface ScriptFrame {
  readonly status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  /** The whole assistant answer as of this poll. */
  readonly text?: string;
  /** Whether this poll is the one that first shows the assistant message. */
  readonly appears?: boolean;
  readonly pending?: number;
}

export interface FakeActivityItem {
  readonly type: string;
  readonly itemId: string;
  readonly position: number;
  readonly status: string;
  readonly title?: string | null;
  readonly text?: string | null;
}

interface ItemOverrides {
  readonly position?: number;
  readonly itemId?: string;
  readonly type?: string;
  readonly status?: string;
  readonly title?: string | null;
  readonly text?: string | null;
  readonly nextTextOffset?: number | null;
}

export interface FakeT3Options {
  readonly frames: ReadonlyArray<ScriptFrame>;
  readonly tots?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly threadId: string | null;
    readonly link: string | null;
  }>;
  readonly activity?: ReadonlyArray<FakeActivityItem>;
  readonly questions?: ReadonlyArray<Question>;
  readonly pendingRequestIds?: ReadonlyArray<string>;
  readonly interruptStatus?: "interrupt_requested" | "no_active_run" | "completed";
}

export interface FakeT3 {
  readonly client: T3Client;
  readonly calls: Array<{
    readonly tool: string;
    readonly args: Record<string, unknown>;
    readonly options?: T3CallOptions | undefined;
  }>;
  readonly callsOf: (tool: string) => ReadonlyArray<Record<string, unknown>>;
  readonly polls: () => number;
}

const defaultTots = [
  {
    id: "tot-home",
    name: "Home",
    enabled: true,
    threadId: "thread-home",
    link: "https://app.t3.codes/threads/env/thread-home",
  },
];

const item = (text: string, overrides: ItemOverrides = {}): OrchestratorMcpThreadTimelineItem =>
  ({
    position: 1,
    visibility: "local",
    sourceThreadId: "thread-home",
    itemId: "item-1",
    runId: "run-1",
    messageId: "message-1",
    createdBy: "provider",
    creationSource: "provider",
    type: "assistant_message",
    status: "running",
    title: null,
    text,
    textTruncated: false,
    nextTextOffset: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as unknown as OrchestratorMcpThreadTimelineItem;

const page = (input: {
  readonly items?: ReadonlyArray<OrchestratorMcpThreadTimelineItem>;
  readonly status?: string;
  readonly pending?: number;
  readonly nextPosition?: number | null;
  readonly runStatus?: string;
}): OrchestratorMcpThreadReadResult =>
  ({
    thread: {
      threadId: "thread-home",
      link: "https://app.t3.codes/threads/env/thread-home",
      status: input.status ?? "running",
      pendingRequestCount: input.pending ?? 0,
      title: "Home",
      model: "claude-sonnet",
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    recentRuns: [
      {
        runId: "run-1",
        ordinal: 1,
        status: input.runStatus ?? input.status ?? "running",
        providerInstanceId: "claude",
        model: "claude-sonnet",
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
      },
    ],
    items: input.items ?? [],
    nextPosition: input.nextPosition ?? null,
    hasMore: false,
  }) as unknown as OrchestratorMcpThreadReadResult;

/**
 * A scripted T3 server: each cursor read advances one frame, and tail reads
 * return what the visible frame's answer gained since the offset.
 */
export const createFakeT3 = (options: FakeT3Options): FakeT3 => {
  const calls: FakeT3["calls"] = [];
  let frameIndex = 0;
  let visible: ScriptFrame = { status: "running" };
  let polls = 0;
  const frameAt = (index: number): ScriptFrame =>
    options.frames[Math.min(index, Math.max(0, options.frames.length - 1))] ?? {
      status: "running",
    };

  const call = async <A>(
    tool: string,
    args: Record<string, unknown>,
    callOptions?: T3CallOptions,
  ): Promise<A> => {
    calls.push({ tool, args, options: callOptions });
    switch (tool) {
      case "t3_tot_list":
        return { tots: options.tots ?? defaultTots } as A;
      case "t3_thread_send":
        return {
          threadId: String(args.threadId),
          messageId: "message-1",
          runId: "run-1",
          status: "running",
          delivery: "started",
        } as A;
      case "t3_thread_interrupt":
        return {
          threadId: String(args.threadId),
          runId: "run-1",
          status: options.interruptStatus ?? "interrupt_requested",
        } as A;
      case "t3_pending_request": {
        const action = args.action;
        if (action === "list") return { requestIds: options.pendingRequestIds ?? [] } as A;
        if (action === "read") {
          return {
            requestId: String(args.requestId),
            questions: options.questions ?? [],
          } as A;
        }
        return { sequence: 1 } as A;
      }
      case "t3_thread_read": {
        if (args.view === "activity") {
          return page({
            items: (options.activity ?? []).map((entry) =>
              item(entry.text ?? "", {
                itemId: entry.itemId,
                position: entry.position,
                type: entry.type,
                status: entry.status,
                title: entry.title ?? null,
              }),
            ),
            status: visible.status,
            runStatus: visible.status,
          }) as A;
        }
        if (typeof args.itemId === "string") {
          const offset = Number(args.textOffset ?? 0);
          const text = (visible.text ?? "").slice(offset);
          return page({
            items: [item(text, { nextTextOffset: null })],
            status: visible.status,
            runStatus: visible.status,
          }) as A;
        }
        if (args.beforePosition !== undefined) {
          return page({ nextPosition: -1 }) as A;
        }
        const frame = frameAt(frameIndex);
        frameIndex += 1;
        polls += 1;
        visible = frame;
        const showsMessage = frame.appears === true;
        return page({
          items: showsMessage ? [item(frame.text ?? "")] : [],
          status: frame.status,
          runStatus: frame.status,
          pending: frame.pending ?? 0,
          nextPosition: showsMessage ? 1 : null,
        }) as A;
      }
      default:
        throw new Error(`The fake T3 has no handler for ${tool}.`);
    }
  };

  return {
    client: { call, close: async () => undefined },
    calls,
    callsOf: (tool) => calls.filter((entry) => entry.tool === tool).map((entry) => entry.args),
    polls: () => polls,
  };
};

export interface FakeChannel {
  readonly port: ChannelPort;
  readonly sent: Array<string>;
  readonly edits: Array<{ readonly id: string; readonly text: string }>;
  readonly typingCount: () => number;
  /** Resolves with the first sent text that matches, now or later. */
  readonly waitForSend: (predicate: (text: string) => boolean) => Promise<string>;
}

export const createFakeChannel = (): FakeChannel => {
  const sent: Array<string> = [];
  const edits: Array<{ readonly id: string; readonly text: string }> = [];
  const waiters: Array<{
    readonly predicate: (text: string) => boolean;
    readonly resolve: (text: string) => void;
  }> = [];
  let typing = 0;
  let counter = 0;
  const port: ChannelPort = {
    send: async (text: string): Promise<ChannelMessage> => {
      sent.push(text);
      counter += 1;
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter === undefined || !waiter.predicate(text)) continue;
        waiters.splice(index, 1);
        waiter.resolve(text);
      }
      return { id: `message-${counter}` };
    },
    edit: async (message, text) => {
      edits.push({ id: message.id, text });
    },
    typing: async () => {
      typing += 1;
    },
  };
  return {
    port,
    sent,
    edits,
    typingCount: () => typing,
    waitForSend: (predicate) => {
      const already = sent.find(predicate);
      if (already !== undefined) return Promise.resolve(already);
      return new Promise((resolve) => {
        waiters.push({ predicate, resolve });
      });
    },
  };
};

/** A clock the fake sleep advances, so no test reads or waits on wall time. */
export const createFakeClock = () => {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
};
