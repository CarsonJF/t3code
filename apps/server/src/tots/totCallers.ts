import {
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2LinkedSender,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  type ScheduledTaskId,
  type ThreadId,
  type Tot,
  type TurnCaller,
} from "@t3tools/contracts";

export interface TotSendOrigin {
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId | undefined;
  readonly senderThreadId?: ThreadId | undefined;
  readonly linkedSender?: OrchestrationV2LinkedSender | undefined;
  /** Named by the entry point that knows it: a webhook, an outside client, the Discord bridge. */
  readonly caller?: TurnCaller | undefined;
}

/** The Tot whose current thread this is, if any. A former Tot thread is an ordinary thread. */
export const totOwningThread = (threadId: ThreadId, tots: ReadonlyArray<Tot>): Tot | undefined => {
  const totId = parseTotThreadId(threadId);
  return totId === null
    ? undefined
    : tots.find((tot) => tot.id === totId && tot.threadId === threadId);
};

/**
 * The outside caller of a send into `tot`'s thread, or undefined for the local user, T3 Code
 * itself, the Tot and the threads it launched. An MCP send that names nobody is an unknown
 * outside client, so a new entry point that forgets to name its caller is refused, not trusted.
 */
export const outsideCallerOf = (
  tot: Tot,
  input: TotSendOrigin,
  tots: ReadonlyArray<Tot>,
): TurnCaller | undefined => {
  if (input.caller !== undefined) {
    return input.caller.origin === "tot" && input.caller.id === tot.id ? undefined : input.caller;
  }
  if (input.createdBy === "system") return undefined;
  if (input.linkedSender !== undefined) {
    return {
      origin: "linked",
      id: input.linkedSender.environmentId,
      label: input.linkedSender.title.slice(0, 200),
    };
  }
  const sender = input.senderThreadId;
  if (sender !== undefined) {
    if (sender === tot.threadId || parseTotLaunchedThreadId(sender) === tot.id) return undefined;
    const other = totOwningThread(sender, tots);
    return other === undefined
      ? { origin: "agent", id: sender }
      : { origin: "tot", id: other.id, label: other.name };
  }
  // Scheduled tasks name a webhook or another Tot themselves; the rest are the user's.
  if (input.scheduledTaskId !== undefined) return undefined;
  if (input.createdBy === "agent" && input.creationSource === "mcp") {
    return { origin: "companion", id: "unknown" };
  }
  return undefined;
};

const ORIGIN_NAMES: Record<TurnCaller["origin"], string> = {
  tot: "Tot",
  agent: "agent thread",
  linked: "linked environment",
  webhook: "webhook",
  discord: "Discord user",
  companion: "outside client",
};

export const describeCaller = (caller: TurnCaller): string =>
  `${ORIGIN_NAMES[caller.origin]} ${JSON.stringify(caller.id)}${
    caller.label === undefined || caller.label === caller.id
      ? ""
      : ` (${JSON.stringify(caller.label)})`
  }`;
