import {
  type EnvironmentId,
  OrchestratorMcpFailure,
  parseTotThreadId,
  type RunId,
  type ThreadId,
  TOT_REPORT_MESSAGE_ID_PREFIX,
} from "@t3tools/contracts";
import { readTotCaller, refuseTots } from "../../totCaller.ts";
import { checkObjective, forwardedObjectiveTarget, recordAttempt } from "../../totWork.ts";
import * as TotService from "../../../tots/TotService.ts";
import { OrchestratorToolkit } from "./tools.ts";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";

import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as PeerLinkRequests from "../../../peer/PeerLinkRequests.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as RemoteDelegation from "../../../peer/RemoteDelegation.ts";
import { readCaller } from "../../threadAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../../ThreadMetadataMcpService.ts";

/** A Tot here and what it owns, so its default task listing covers its projects. */
const scheduledTaskListTot = Effect.fnUntraced(function* (
  scope: McpInvocationContext.McpInvocationScope,
) {
  const caller = yield* readTotCaller();
  if (Option.isNone(caller) || caller.value.via !== "local") return undefined;
  const tot = (yield* (yield* TotService.TotService).list).find(
    (candidate) => candidate.id === caller.value.totId,
  );
  if (tot === undefined) return undefined;
  return {
    totId: tot.id,
    projects:
      tot.scope === "all"
        ? ("all" as const)
        : new Set(
            tot.scope.projects
              .filter((project) => project.environmentId === scope.environmentId)
              .map((project) => project.projectId),
          ),
    hasGroups: tot.scope !== "all" && tot.scope.groups.length > 0,
  } satisfies OrchestratorMcpService.ScheduledTaskListTot;
});

const handlers = {
  orchestrator_capabilities: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.capabilities(scope, input);
    }),
  ),
  delegate_task: McpToolAccess.actsAsCaller(({ objective, ...input }) =>
    Effect.gen(function* () {
      const target = yield* checkObjective(objective);
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      const task = yield* service.delegateTask(scope, input);
      const child =
        task.remoteChild ??
        (task.childThreadId === null
          ? undefined
          : { environmentId: scope.environmentId, threadId: task.childThreadId });
      if (child === undefined) return task;
      const recorded = yield* recordAttempt(target, {
        kind: "delegate",
        environmentId: child.environmentId,
        threadId: child.threadId,
        runId: task.childRunId,
        taskId: task.taskId,
      });
      return { ...task, ...recorded };
    }),
  ),
  task_status: McpToolAccess.actsAsCaller(({ taskId }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.taskStatus(scope, taskId);
    }),
  ),
  task_cancel: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.cancelTask(scope, input);
    }),
  ),
  t3_workflow_stop: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { threads } = yield* readCaller();
        return yield* threads.stopWorkflow(input).pipe(
          Effect.as({}),
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code:
                  cause.reason === "unavailable" || cause.reason === "stop-failed"
                    ? "orchestration_error"
                    : "invalid_request",
                message: cause.message,
              }),
          ),
        );
      }),
  ),
  // Claude can start a turn by itself before T3 starts its run, so a live-run check would refuse the mark.
  t3_background_wait: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, threads } = yield* readCaller();
      const caller = yield* McpInvocationContext.requireThreadScope(scope, "t3_background_wait");
      return yield* threads
        .awaitBackgroundTasks({
          threadId: caller.thread.threadId,
          taskIds: input.taskIds,
          awaited: input.waiting ?? true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code:
                  cause.reason === "unsupported" || cause.reason === "unmatched"
                    ? "invalid_request"
                    : "orchestration_error",
                message: cause.message,
              }),
          ),
        );
    }),
  ),
  schedule_task: McpToolAccess.either(
    (input) => input.scheduledTaskId === undefined,
    McpToolAccess.startsThreads(
      () => ({}),
      ({ prompt, schedule, ...input }) =>
        Effect.gen(function* () {
          if (prompt === undefined || schedule === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "A new scheduled task needs `prompt` and `schedule`.",
            });
          }
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          const tot = yield* readTotCaller();
          return yield* service.scheduleTask(
            scope,
            { ...input, prompt, schedule },
            Option.getOrUndefined(Option.map(tot, (caller) => caller.totId)),
          );
        }),
      // A scheduled run starts long after its caller, with nothing to carry the link.
      { refused: "schedule tasks in this environment" },
    ),
    McpToolAccess.writes(
      ({
        scheduledTaskId,
        prompt,
        title,
        schedule,
        enabled,
        freshSession,
        bindToCurrentThread,
        modelSelection,
        precheck,
        missedRunGraceMinutes,
        readOnly,
      }) =>
        Effect.gen(function* () {
          if (scheduledTaskId === undefined) return yield* Effect.die("unreachable");
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          return yield* service.updateScheduledTask(scope, {
            scheduledTaskId,
            prompt,
            title,
            schedule,
            enabled,
            freshSession,
            bindToCurrentThread,
            modelSelection,
            precheck,
            missedRunGraceMinutes,
            readOnly,
          });
        }),
    ),
  ),
  list_scheduled_tasks: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.listScheduledTasks(scope, input, yield* scheduledTaskListTot(scope));
    }),
  ),
  delete_scheduled_task: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.deleteScheduledTask(scope, input);
    }),
  ),
  request_secret: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.requestSecret(scope, input);
    }),
  ),
  create_threads: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      // Threads here would start in the Tot's own folder and act as that Tot.
      yield* refuseTots("A Tot launches each thread with t3_thread_launch and a projectId.");
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.createThreads(scope, input);
    }),
  ),
  t3_thread_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.listThreads(scope, input);
    }),
  ),
  t3_thread_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.readThread(scope, input);
    }),
  ),
  t3_thread_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
        return yield* service.update(scope, input);
      }),
  ),
  t3_thread_send: McpToolAccess.afterForwarding(
    McpToolAccess.writesThreads(
      (input) => [input.threadId],
      ({ objective, ...input }) =>
        Effect.gen(function* () {
          const target = yield* checkObjective(objective);
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          const sent = yield* service.sendToThread(scope, input);
          // A Tot hears when the run its message started ends.
          const watched = yield* watchSentRun(scope.environmentId, sent.threadId, sent.runId);
          // A steer joins a run already counted, so only a send that starts a run is an attempt.
          const recorded =
            sent.delivery === "steered"
              ? {}
              : yield* recordAttempt(target, {
                  kind: "send",
                  environmentId: scope.environmentId,
                  threadId: sent.threadId,
                  runId: sent.runId,
                  taskId: sent.taskId,
                });
          return { ...sent, ...watched, ...recorded };
        }),
    ),
    // There the thread's parent is here, so only this side can make a follow-up a task.
    (input, environmentId, sent) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const remote = yield* RemoteDelegation.RemoteDelegation;
        const followed = yield* remote.followUp(scope, environmentId, input, sent);
        const watched = yield* watchSentRun(environmentId, input.threadId, followed.runId);
        const recorded =
          followed.delivery === "steered"
            ? {}
            : yield* recordAttempt(yield* forwardedObjectiveTarget(input.objective), {
                kind: "send",
                environmentId,
                threadId: input.threadId,
                runId: followed.runId,
                taskId: followed.taskId,
              });
        return { ...followed, ...watched, ...recorded };
      }),
    (input) => checkObjective(input.objective),
  ),
  t3_thread_wait: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.waitForThread(scope, input);
    }),
  ),
  t3_environment_links: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const forwarding = yield* PeerForwarding.PeerForwarding;
      return yield* forwarding.links(scope);
    }),
  ),
  // A link lets every agent here reach the other environment, so it is an
  // environment setting: full access, and never for linked work.
  t3_environment_link: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const requests = yield* PeerLinkRequests.PeerLinkRequests;
      return yield* requests.request(scope, input);
    }),
  ),
  t3_environment_unlink: McpToolAccess.writesEnvironment(({ environmentId }) =>
    Effect.gen(function* () {
      const links = yield* PeerLinks.PeerLinks;
      const result = yield* links
        .unlink(environmentId)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      return { environmentId, ...result };
    }),
  ),
  t3_thread_interrupt: McpToolAccess.afterForwarding(
    McpToolAccess.writesThreads(
      (input) => [input.threadId],
      (input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          // Noted first: the stop's own events can reach the watcher before this call returns.
          yield* noteOwnStop(scope.environmentId, input.threadId);
          const forget = forgetOwnStop(scope.environmentId, input.threadId);
          const result = yield* service
            .interruptThread(scope, input)
            .pipe(Effect.tapError(() => forget));
          if (result.status === "no_active_run") yield* forget;
          return result;
        }),
    ),
    (input, environmentId, result) =>
      result.status === "no_active_run"
        ? Effect.succeed(result)
        : noteOwnStop(environmentId, input.threadId).pipe(Effect.as(result)),
  ),
} satisfies McpToolAccess.Handlers<typeof OrchestratorToolkit.tools>;

/** A Tot that stops a thread already knows, so its watch report skips that stop. */
const noteOwnStop = Effect.fn("mcp.noteOwnStop")(function* (
  environmentId: EnvironmentId,
  threadId: ThreadId,
) {
  const tot = yield* readTotCaller();
  if (Option.isNone(tot) || tot.value.via !== "local") return;
  yield* (yield* TotService.TotService).noteOwnStop(tot.value.totId, environmentId, threadId);
});

/** A stop that stopped nothing must not hide a later stop by someone else. */
const forgetOwnStop = Effect.fn("mcp.forgetOwnStop")(function* (
  environmentId: EnvironmentId,
  threadId: ThreadId,
) {
  const tot = yield* readTotCaller();
  if (Option.isNone(tot) || tot.value.via !== "local") return;
  yield* (yield* TotService.TotService).takeOwnStop(tot.value.totId, environmentId, threadId);
});

/**
 * What the calling Tot's run means for its exchange with a target Tot: a person or schedule
 * starts over, and only a wake from that target's own report continues the exchange.
 */
const peerExchangeStep = Effect.fn("mcp.peerExchangeStep")(function* (
  environmentId: EnvironmentId,
  target: ThreadId,
) {
  const { scope, threads } = yield* readCaller();
  if (scope.thread === undefined) return "unrelated" as const;
  const threadId = scope.thread.threadId;
  const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  // The latest run can be a queued one; the caller is the run that is active.
  const runId = shell?.activeRunId ?? shell?.latestRunId;
  if (runId == null) return "unrelated" as const;
  const { runs, messages } = yield* threads
    .getThreadRecords(threadId, ["runs", "messages"], {
      messageRoles: ["user"],
      messageRunIds: [runId],
    })
    .pipe(Effect.orElseSucceed(() => ({ runs: [], messages: [] })));
  const startedBy = runs.find((run) => run.id === runId)?.userMessageId;
  if (startedBy === undefined) return "unrelated" as const;
  const message = messages.find((candidate) => candidate.id === startedBy);
  if (message?.createdBy === "user" || message?.scheduledTaskId !== undefined) {
    return "reset" as const;
  }
  if (!startedBy.startsWith(TOT_REPORT_MESSAGE_ID_PREFIX)) return "unrelated" as const;
  const fromTarget = yield* (yield* TotService.TotService).reportCameFrom(
    startedBy,
    environmentId,
    target,
  );
  return fromTarget ? ("hop" as const) : ("unrelated" as const);
});

/**
 * Watches the run a local Tot's message started, so the Tot hears when it ends. Between two Tots
 * each report can wake a reply, so that exchange is capped until someone else steps in.
 */
const watchSentRun = Effect.fn("mcp.watchSentRun")(function* (
  environmentId: EnvironmentId,
  threadId: ThreadId,
  runId: RunId,
) {
  const tot = yield* readTotCaller();
  if (Option.isNone(tot) || tot.value.via !== "local") return {};
  const tots = yield* TotService.TotService;
  if (parseTotThreadId(threadId) !== null) {
    const step = yield* peerExchangeStep(environmentId, threadId);
    const allowed = yield* tots.allowPeerReport(tot.value.totId, environmentId, threadId, step);
    if (!allowed) return { reportsBack: false as const };
  }
  yield* tots
    .addWatch(tot.value.totId, { environmentId, threadId, reason: "sent", runId })
    .pipe(Effect.ignore);
  return {};
});

export const layer = McpToolAccess.toLayer(OrchestratorToolkit, handlers);
