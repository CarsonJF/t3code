import {
  CommandId,
  IDLE_COMPACTION_TEXT,
  MessageId,
  parseTotThreadId,
  resolveProjectProviderInstanceEnabled,
  resolveThreadIdleCompaction,
  type ProviderInstanceId,
  type RunId,
  type ServerSettings as ServerSettingsShape,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  IDLE_COMPACTION_MESSAGE_ID_PREFIX,
  IDLE_COMPACTION_SAVE_MESSAGE_ID_PREFIX,
  idleCompactionStep,
  idleCompactionWindow,
  isIdleCompactionDriver,
  TOT_PRE_COMPACTION_NOTE,
} from "./IdleCompaction.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// A built-in instance id doubles as its driver, matching settings decoding.
const driverOf = (
  settings: Pick<ServerSettingsShape, "providerInstances">,
  instanceId: ProviderInstanceId,
) =>
  Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId]?.driver
    : instanceId;

/**
 * Beta: before an eligible idle thread's prompt cache expires, sends `/compact` as a visible
 * T3 Code turn; a Tot first gets a turn to save its working state. Timers live in memory, so
 * a server restart skips compactions that were still waiting.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const compactWhenDue = Effect.fn("IdleCompactionService.compactWhenDue")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      let runId = completedRunId;
      // Loops after the wait or a retarget: the thread may have moved on.
      while (true) {
        const current = yield* settings.getSettings;
        const thread = yield* projections.getThread(threadId);
        if (
          !isIdleCompactionDriver(driverOf(current, thread.providerInstanceId)) ||
          resolveThreadIdleCompaction(current, threadId, thread.providerInstanceId) !==
            "beforeCacheExpires" ||
          !resolveProjectProviderInstanceEnabled(
            current,
            thread.projectId,
            thread.providerInstanceId,
          )
        )
          return;
        const activeProviderThreadIds =
          thread.activeProviderThreadId === null ? [] : [thread.activeProviderThreadId];
        const records = yield* projections.getThreadRecords(
          threadId,
          [
            "runs",
            "messages",
            "providerThreads",
            "providerTurns",
            "runtimeRequests",
            "turnItems",
            "contextTransfers",
          ],
          {
            messageRunIds: [runId],
            turnItemStatuses: ["pending", "running", "waiting"],
            // The latest run, active runs that hold background work, and rolled-back runs whose
            // items it ignores.
            runStatuses: ["preparing", "starting", "running", "rolled_back"],
            includeLatestRun: true,
            // Without an active provider thread there is no session to compact.
            providerThreadIds: activeProviderThreadIds,
            providerTurnThreadIds: activeProviderThreadIds,
            latestProviderTurnUsageOnly: true,
            runtimeRequestStatuses: ["pending"],
            contextTransferStatuses: ["pending"],
          },
        );
        if (
          !isIdleCompactionDriver(driverOf(current, records.thread.providerInstanceId)) ||
          resolveThreadIdleCompaction(current, threadId, records.thread.providerInstanceId) !==
            "beforeCacheExpires" ||
          !resolveProjectProviderInstanceEnabled(
            current,
            records.thread.projectId,
            records.thread.providerInstanceId,
          )
        )
          return;
        const latestRun = records.runs
          .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
          .reduce<(typeof records.runs)[number] | undefined>(
            (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
            undefined,
          );
        // A late update for an earlier run replaced the latest run's timer, so take it over.
        if (latestRun?.status === "completed" && latestRun.id !== runId) {
          runId = latestRun.id;
          continue;
        }
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const window = idleCompactionWindow(records, nowMs);
        if (window?.runId !== runId || latestRun === undefined) return;
        const step = idleCompactionStep({
          totThread: parseTotThreadId(threadId) !== null,
          latestUserMessageId: latestRun.userMessageId,
          window,
          nowMs,
        });
        if (step === "wait") {
          yield* Effect.sleep(Duration.millis(window.startMs - nowMs));
          continue;
        }
        if (step === "save") {
          // Its end is a completed run, which brings this service back to compact.
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(
              `server:${IDLE_COMPACTION_SAVE_MESSAGE_ID_PREFIX}${threadId}:${runId}`,
            ),
            messageId: MessageId.make(
              `${IDLE_COMPACTION_SAVE_MESSAGE_ID_PREFIX}${threadId}:${runId}`,
            ),
            threadId,
            text: TOT_PRE_COMPACTION_NOTE,
            attachments: [],
            createdBy: "system",
            creationSource: "server",
            dispatchMode: { type: "start_immediately" },
          });
          return;
        }
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          // One compaction per completed run, even across duplicate events.
          commandId: CommandId.make(
            `server:${IDLE_COMPACTION_MESSAGE_ID_PREFIX}${threadId}:${runId}`,
          ),
          messageId: MessageId.make(`${IDLE_COMPACTION_MESSAGE_ID_PREFIX}${threadId}:${runId}`),
          threadId,
          text: IDLE_COMPACTION_TEXT,
          attachments: [],
          createdBy: "agent",
          creationSource: "server",
          idleCompaction: "beforeCacheExpires",
          dispatchMode: { type: "start_immediately" },
        });
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("idle compaction skipped", { threadId, cause })),
      ),
  );

  const start = Effect.fn("IdleCompactionService.start")(function* () {
    // Keyed by thread: a newer completed run replaces the waiting timer.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? FiberMap.run(timers, event.threadId, compactWhenDue(event.threadId, event.payload.id))
          : Effect.void,
      ),
    );
  });
  return { start };
});
