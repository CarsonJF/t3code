import {
  OrchestratorMcpFailure,
  parseTotThreadId,
  type ThreadId,
  type Tot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Where a send aimed at `threadId` goes. A fresh start settles a Tot's thread and gives it a new
 * one, so a former Tot thread resolves to its Tot's current thread; with the Tot off it fails.
 */
export const totSendTarget = (
  threadId: ThreadId,
  tots: ReadonlyArray<Tot>,
): Effect.Effect<ThreadId, OrchestratorMcpFailure> => {
  const totId = parseTotThreadId(threadId);
  const tot = totId === null ? undefined : tots.find((candidate) => candidate.id === totId);
  if (tot === undefined || tot.threadId === threadId) return Effect.succeed(threadId);
  return tot.threadId === null
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "thread_not_sendable",
          message: `Thread ${threadId} is a former thread of the Tot ${tot.name}, which is off. Turn it on, then send to its current thread.`,
        }),
      )
    : Effect.succeed(tot.threadId);
};
