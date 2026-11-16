import type {
  OrchestratorMcpThreadInterruptResult,
  OrchestratorMcpThreadReadResult,
  OrchestratorMcpThreadSendResult,
  TotAvatar,
} from "@t3tools/contracts";

import type { Question } from "./answers.ts";
import type { TotView } from "./routing.ts";
import type { T3Client } from "./t3Client.ts";

export interface TotListResult {
  readonly tots: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly threadId: string | null;
    readonly link: string | null;
  }>;
}

/** The Tots on the host server, in the order the app lists them. */
export const listTots = async (t3: T3Client): Promise<ReadonlyArray<TotView>> => {
  const result = await t3.call<TotListResult>("t3_tot_list", {});
  return result.tots.map((tot) => ({
    id: tot.id,
    name: tot.name,
    enabled: tot.enabled,
    threadId: tot.threadId,
    link: tot.link,
  }));
};

export interface TotFaceView {
  readonly id: string;
  readonly name: string;
  readonly avatar: TotAvatar;
}

/** Home's colour, for a server older than the `avatar` field. */
const FALLBACK_FACE: TotAvatar = { color: "#0a7ea4" };

/**
 * The Tots with the face a channel webhook speaks as. A server that predates
 * `avatar` on `t3_tot_list` still works, wearing Home's colour.
 */
export const listTotFaces = async (t3: T3Client): Promise<ReadonlyArray<TotFaceView>> => {
  const result = await t3.call<{
    readonly tots: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly avatar?: TotAvatar;
    }>;
  }>("t3_tot_list", {});
  return result.tots.map((tot) => ({
    id: tot.id,
    name: tot.name,
    avatar: tot.avatar ?? FALLBACK_FACE,
  }));
};

export interface ReadMessagesInput {
  readonly threadId: string;
  readonly afterPosition?: number;
  readonly beforePosition?: number;
  readonly itemId?: string;
  readonly textOffset?: number;
  readonly limit?: number;
  readonly maxCharsPerItem?: number;
}

export const readThreadMessages = (
  t3: T3Client,
  input: ReadMessagesInput,
): Promise<OrchestratorMcpThreadReadResult> =>
  t3.call<OrchestratorMcpThreadReadResult>("t3_thread_read", {
    threadId: input.threadId,
    view: "messages",
    ...(input.afterPosition === undefined ? {} : { afterPosition: input.afterPosition }),
    ...(input.beforePosition === undefined ? {} : { beforePosition: input.beforePosition }),
    ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
    ...(input.textOffset === undefined ? {} : { textOffset: input.textOffset }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.maxCharsPerItem === undefined ? {} : { maxCharsPerItem: input.maxCharsPerItem }),
  });

export const readThreadActivity = (
  t3: T3Client,
  input: {
    readonly threadId: string;
    readonly limit?: number;
    readonly maxCharsPerItem?: number;
    readonly afterPosition?: number;
  },
): Promise<OrchestratorMcpThreadReadResult> =>
  t3.call<OrchestratorMcpThreadReadResult>("t3_thread_read", {
    threadId: input.threadId,
    view: "activity",
    limit: input.limit ?? 8,
    maxCharsPerItem: input.maxCharsPerItem ?? 400,
    ...(input.afterPosition === undefined ? {} : { afterPosition: input.afterPosition }),
  });

/**
 * The newest visible message position, used as the cursor a turn reads after.
 * An empty thread has no position, and its first message is position 0.
 */
export const newestMessagePosition = async (t3: T3Client, threadId: string): Promise<number> => {
  const page = await readThreadMessages(t3, {
    threadId,
    beforePosition: Number.MAX_SAFE_INTEGER,
    limit: 1,
  });
  return page.nextPosition ?? -1;
};

export interface SendToThreadInput {
  readonly threadId: string;
  readonly message: string;
  readonly fresh?: boolean;
  readonly clientRequestId?: string;
}

export const sendToThread = (
  t3: T3Client,
  input: SendToThreadInput,
): Promise<OrchestratorMcpThreadSendResult> =>
  t3.call<OrchestratorMcpThreadSendResult>("t3_thread_send", {
    threadId: input.threadId,
    message: input.message,
    mode: "auto",
    ...(input.fresh === true ? { freshContext: true } : {}),
    ...(input.clientRequestId === undefined ? {} : { clientRequestId: input.clientRequestId }),
  });

/** The app's Stop: interrupt the running turn and hold its queued messages. */
export const stopThread = (
  t3: T3Client,
  threadId: string,
): Promise<OrchestratorMcpThreadInterruptResult> =>
  t3.call<OrchestratorMcpThreadInterruptResult>("t3_thread_interrupt", {
    threadId,
    stop: true,
  });

export interface PendingRequestList {
  readonly requestIds: ReadonlyArray<string>;
}

/** User-input requests only: approvals are readable and answerable by a Tot alone. */
export const listPendingRequests = (t3: T3Client, threadId: string): Promise<PendingRequestList> =>
  t3.call<PendingRequestList>("t3_pending_request", {
    action: "list",
    threadId,
  });

export interface PendingRequestRead {
  readonly requestId: string;
  readonly questions: ReadonlyArray<Question>;
}

export const readPendingRequest = async (
  t3: T3Client,
  threadId: string,
  requestId: string,
): Promise<PendingRequestRead> => {
  const result = await t3.call<PendingRequestRead & { readonly approval?: unknown }>(
    "t3_pending_request",
    { action: "read", threadId, requestId },
  );
  if (!Array.isArray(result.questions)) {
    throw new Error("That request is an approval, which only a Tot can read.");
  }
  return { requestId: result.requestId, questions: result.questions };
};

export const respondToPendingRequest = (
  t3: T3Client,
  input: {
    readonly threadId: string;
    readonly requestId: string;
    readonly answers: Readonly<Record<string, string | ReadonlyArray<string>>>;
  },
): Promise<{ readonly sequence: number }> =>
  t3.call<{ readonly sequence: number }>("t3_pending_request", {
    action: "respond",
    threadId: input.threadId,
    requestId: input.requestId,
    answers: input.answers,
  });
