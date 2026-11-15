import { parseTotThreadId, type ThreadId, type TotId } from "@t3tools/contracts";

/**
 * The attributes on a conversation's root. A Tot thread gets `data-tot-id` from
 * its own id, so CSS can scope to it even in a thread with no messages.
 */
export function totConversationAttributes(threadId: ThreadId): {
  readonly "data-thread-id": ThreadId;
  readonly "data-tot-id"?: TotId;
} {
  const totId = parseTotThreadId(threadId);
  return {
    "data-thread-id": threadId,
    ...(totId === null ? {} : { "data-tot-id": totId }),
  };
}
