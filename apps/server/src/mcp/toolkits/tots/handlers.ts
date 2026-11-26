import {
  DEFAULT_HOME_TOT,
  HOME_TOT_ID,
  OrchestratorMcpFailure,
  type Tot,
  type TotObjective,
  type TotThemePatch,
} from "@t3tools/contracts";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import { totThemeProblem } from "@t3tools/shared/totTheme";
import { findTotTemplate } from "@t3tools/shared/totTemplates";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
import { defaultWebhookWakePrompt } from "../../../scheduledTasks/webhookListener.ts";
import * as NeedsYou from "../../../needsYou/NeedsYou.ts";
import * as GroupChatService from "../../../tots/GroupChatService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as TotWorkService from "../../../tots/TotWorkService.ts";
import { workListOrder } from "../../../tots/totWork.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readTotCaller, requireTotChange } from "../../totCaller.ts";
import { assertFullAccess, readCaller } from "../../threadAccess.ts";
import { TotToolkit } from "./tools.ts";

/** Sizes and a summary only: the stored CSS and opaque effect text are never echoed. */
const themeResult = (tot: Tot) => {
  const cssLength = tot.theme?.css?.length ?? 0;
  const effectLength = tot.theme?.effect?.length ?? 0;
  return {
    totId: tot.id,
    cssLength,
    effectLength,
    summary: [
      cssLength === 0 ? "No CSS" : `${cssLength} characters of CSS`,
      effectLength === 0 ? "no effect" : `an effect of ${effectLength} characters`,
    ].join(", "),
  };
};

/**
 * Who may reach Tot instructions: a Tot here, its own or (Home) any, or a person
 * at a client outside any thread. Agents in other threads may not.
 */
const instructionsCaller = Effect.fn("mcp.totInstructionsCaller")(function* (writing: boolean) {
  const tot = yield* readTotCaller();
  if (Option.isSome(tot)) {
    const caller = writing ? yield* requireTotChange() : tot.value;
    if (caller.via !== "local")
      return yield* new OrchestratorMcpFailure({
        code: "capability_denied",
        message: "Your instructions live with you here; change them from your own environment.",
      });
    return Option.some(caller.totId);
  }
  const context = yield* readCaller();
  if (context.scope.thread !== undefined || context.scope.client?.linked === true)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Only a Tot or the user can read or change Tot instructions.",
    });
  if (writing)
    yield* assertFullAccess(context, "Changing Tot instructions needs a full-access client.");
  return Option.none<Tot["id"]>();
});

/** Most objectives a listing returns, open ones first. */
const WORK_LIST_LIMIT = 20;

/** Whether a person started the calling Tot's current run, which is what may lift a retry cap. */
const runStartedByPerson = Effect.fn("mcp.runStartedByPerson")(function* () {
  const { scope, threads } = yield* readCaller();
  if (scope.thread === undefined) return false;
  const threadId = scope.thread.threadId;
  const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  const runId = shell?.activeRunId ?? shell?.latestRunId;
  if (runId == null) return false;
  const { runs, messages } = yield* threads
    .getThreadRecords(threadId, ["runs", "messages"], {
      messageRoles: ["user"],
      messageRunIds: [runId],
    })
    .pipe(Effect.orElseSucceed(() => ({ runs: [], messages: [] })));
  const startedBy = runs.find((run) => run.id === runId)?.userMessageId;
  return messages.some((message) => message.id === startedBy && message.createdBy === "user");
});

export const layer = McpToolAccess.toLayer(TotToolkit, {
  t3_tot_work: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const action = input.action ?? "list";
      const tot =
        action === "list" ? yield* readTotCaller() : Option.some(yield* requireTotChange());
      if (Option.isNone(tot) || tot.value.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only a Tot has a work list, and it lives with the Tot's own environment.",
        });
      const totId = tot.value.totId;
      const work = Option.getOrUndefined(
        yield* Effect.serviceOption(TotWorkService.TotWorkService),
      );
      if (work === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "This server keeps no Tot work list.",
        });
      const invalid = (error: { readonly message: string }) =>
        new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
      if (action !== "list") {
        if (input.objectiveId === undefined)
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "This action needs `objectiveId`.",
          });
        const objectiveId = input.objectiveId;
        if (action === "reset") {
          const current = (yield* work.list(totId).pipe(Effect.mapError(invalid))).objectives.find(
            (objective) => objective.id === objectiveId,
          );
          const capped =
            current !== undefined &&
            current.retryCap > 0 &&
            current.failedAttempts >= current.retryCap;
          if (capped && !(yield* runStartedByPerson()))
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                "This objective hit its retry cap, so only a person can reset it: ask the user. They can reset it in your Work panel, or tell you to.",
            });
        }
        yield* work.update({ id: totId, objectiveId, action }).pipe(Effect.mapError(invalid));
      }
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { objectives } = yield* work.list(totId).pipe(Effect.mapError(invalid));
      const shown =
        action === "list"
          ? workListOrder(objectives).slice(0, WORK_LIST_LIMIT)
          : objectives.filter((objective) => objective.id === input.objectiveId);
      return { objectives: shown.map((objective) => workSummary(scope, objective)) };
    }),
  ),
  t3_tot_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      yield* readCaller();
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const tots = yield* (yield* TotService.TotService).list;
      return {
        tots: tots.map((tot) => ({
          id: tot.id,
          name: tot.name,
          enabled: tot.threadId !== null,
          threadId: tot.threadId,
          link:
            tot.threadId === null
              ? null
              : McpInvocationContext.threadLinkFor(scope, tot.threadId, tot.name),
          scope: tot.scope,
          watchAll: tot.watchAll,
          avatar: tot.avatar,
        })),
      };
    }),
  ),
  t3_group_chat_say: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const tot = yield* requireTotChange();
      if (tot.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Group chats live with the Tots here; speak from your own environment.",
        });
      yield* (yield* GroupChatService.GroupChatService)
        .say(tot.totId, input.room, input.text)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return { ok: true as const };
    }),
  ),
  t3_tot_design_avatar: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const tot = yield* requireTotChange();
      if (tot.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Design your face from your own environment.",
        });
      yield* (yield* TotService.TotService)
        .saveDesign(tot.totId, input)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return { ok: true as const };
    }),
  ),
  t3_tot_theme_set: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const caller = yield* requireTotChange();
      if (caller.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Your theme lives with you here; set it from your own environment.",
        });
      // The caller's own Tot is the only target: this tool takes no Tot id.
      const patch: TotThemePatch = {
        ...(input.css === undefined ? {} : { css: input.css }),
        ...(input.effect === undefined ? {} : { effect: input.effect }),
      };
      const problem = totThemeProblem(patch);
      if (problem !== null)
        return yield* new OrchestratorMcpFailure({ code: "invalid_request", message: problem });
      const tot = yield* (yield* TotService.TotService)
        .setTheme(caller.totId, patch)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return themeResult(tot);
    }),
  ),
  t3_tot_theme_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const caller = yield* requireTotChange();
      if (caller.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Your theme lives with you here; read it from your own environment.",
        });
      const self = (yield* (yield* TotService.TotService).list).find(
        (tot) => tot.id === caller.totId,
      );
      if (self === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This thread is no longer a Tot's current thread.",
        });
      return themeResult(self);
    }),
  ),
  t3_tot_webhook_listener: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const caller = yield* requireTotChange();
      if (caller.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message:
            "Webhook listeners live with the Tots here; create one from your own environment.",
        });
      const tots = yield* TotService.TotService;
      const all = yield* tots.list;
      const self = all.find((tot) => tot.id === caller.totId);
      if (self === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This thread is no longer a Tot's current thread.",
        });
      const target = input.tot === undefined ? self : all.find((tot) => tot.id === input.tot);
      if (target === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `There is no Tot "${input.tot}".`,
        });
      if (target.id !== self.id && self.scope !== "all")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only a Tot whose scope is all can listen for another Tot.",
        });
      if (target.threadId === null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `Turn ${target.name} on first: a listener posts into its thread.`,
        });
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const shell = yield* threads.getThreadShell(target.threadId).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: `Could not read ${target.name}'s thread: ${error.message}`,
            }),
        ),
      );
      if (shell === null || shell.deletedAt !== null || shell.archivedAt !== null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `${target.name}'s thread is not open. Start it again and retry.`,
        });
      const mode = input.mode ?? "notify";
      const template = input.messageTemplate;
      const prompt =
        mode === "wake" ? (template ?? defaultWebhookWakePrompt(input.name)) : input.name;
      const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* scheduledTasks
        .upsert({
          title: input.name,
          prompt,
          enabled: true,
          schedule: {
            type: "webhook",
            ...(input.filters === undefined ? {} : { filters: input.filters }),
            listener: {
              mode,
              ...(template === undefined ? {} : { messageTemplate: template }),
              ...(input.cooldownSeconds === undefined
                ? {}
                : { cooldownSeconds: input.cooldownSeconds }),
              ...(input.notify === true ? { notify: true } : {}),
            },
          },
          projectId: shell.projectId,
          threadId: target.threadId,
          threadMode: "continue",
          workspaceStrategy: { type: "root" },
          modelSelection: target.modelSelection ?? shell.modelSelection,
          runtimeMode: shell.runtimeMode,
          interactionMode: shell.interactionMode,
          createdBy: "agent",
          creationSource: "mcp",
          createdByTotId: caller.totId,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: `Could not create the listener: ${error.message}`,
              }),
          ),
        );
      if (task.webhook === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "The listener was saved without a webhook URL.",
        });
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return {
        listenerId: task.id,
        name: task.title,
        mode,
        webhookUrl: task.webhook.url,
        webhookPath: task.webhook.path,
        link: McpInvocationContext.threadLinkFor(scope, target.threadId, target.name),
      };
    }),
  ),
  t3_tot_create: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const caller = yield* requireTotChange();
      const tots = yield* TotService.TotService;
      // A linked caller is held to the Tot of its id here, which must also own everything.
      const self = (yield* tots.list).find((tot) => tot.id === caller.totId);
      if (self?.scope !== "all")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Only a Tot whose scope is all can create Tots.",
        });
      const modelSelection = input.modelSelection ?? self.modelSelection;
      if (modelSelection === null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass `modelSelection`; you have none to copy.",
        });
      const invalid = (error: { readonly message: string }) =>
        new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
      const template = input.template === undefined ? undefined : findTotTemplate(input.template);
      const created = yield* tots
        .create({
          name: input.name,
          avatar: input.avatar ?? template?.avatar ?? DEFAULT_HOME_TOT.avatar,
          scope: input.scope,
          instructions: input.instructions ?? template?.instructions ?? "",
          modelSelection,
          ...(input.template === undefined ? {} : { template: input.template }),
        })
        .pipe(Effect.mapError(invalid));
      const { threadId } = yield* tots.enable(created.id, modelSelection).pipe(
        // Without a thread it would only be a Tot the user has to turn on.
        Effect.tapError(() => tots.remove(created.id).pipe(Effect.ignore)),
        Effect.mapError(invalid),
      );
      const projectId = (yield* tots.list).find((tot) => tot.id === created.id)?.projectId;
      const project =
        projectId === null || projectId === undefined
          ? Option.none()
          : yield* (yield* ProjectService.ProjectService)
              .getById(projectId)
              .pipe(Effect.orElseSucceed(Option.none));
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return {
        id: created.id,
        link: McpInvocationContext.threadLinkFor(scope, threadId, created.name),
        folder: Option.match(project, {
          onNone: () => "",
          onSome: (found) => found.workspaceRoot,
        }),
        scope: created.scope,
      };
    }),
  ),
  t3_tot_instructions: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const writing = input.instructions !== undefined;
      const caller = yield* instructionsCaller(writing);
      const targetId = input.tot ?? Option.getOrUndefined(caller);
      if (targetId === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass `tot`: you are not a Tot.",
        });
      if (Option.isSome(caller) && caller.value !== targetId && caller.value !== HOME_TOT_ID)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "A Tot can reach only its own instructions; Home and the user can reach any.",
        });
      const tots = yield* TotService.TotService;
      const invalid = (error: { readonly message: string }) =>
        new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
      const tot =
        input.instructions === undefined
          ? (yield* tots.list).find((candidate) => candidate.id === targetId)
          : yield* tots
              .update({ id: targetId, instructions: input.instructions })
              .pipe(Effect.mapError(invalid));
      if (tot === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `There is no Tot "${targetId}".`,
        });
      return {
        totId: tot.id,
        name: tot.name,
        instructions: tot.instructions,
        updated: writing,
        whoCanAsk: tot.whoCanAsk ?? [],
      };
    }),
  ),
  t3_tot_watch: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const tot = yield* requireTotChange();
      if (tot.via !== "local")
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Watch threads from your own environment; the watch lives with you.",
        });
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const tots = yield* TotService.TotService;
      const environmentId = input.environmentId ?? scope.environmentId;
      const threadId = input.threadId;
      if ((input.action === "watch" || input.action === "unwatch") && threadId === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "This action needs `threadId`.",
        });
      const change =
        input.action === "watch" && threadId !== undefined
          ? tots.addWatch(tot.totId, { environmentId, threadId, reason: "requested" })
          : input.action === "unwatch" && threadId !== undefined
            ? tots.removeWatch(tot.totId, environmentId, threadId)
            : tots.setWatchAll(tot.totId, input.action === "watch_all");
      yield* change.pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
        ),
      );
      return { ok: true as const };
    }),
  ),
  t3_needs_you: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const inbox = yield* (yield* NeedsYou.NeedsYou)
        .list({
          linked: input.linked !== false,
          includeHidden: input.includeHidden === true,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      return {
        environments: inbox.environments.map((entry) => ({
          ...entry,
          items: entry.items.map((item) =>
            item.threadId === null
              ? item
              : {
                  ...item,
                  link:
                    entry.environmentId === scope.environmentId
                      ? McpInvocationContext.threadLinkFor(scope, item.threadId, item.title)
                      : formatThreadLink(
                          { environmentId: entry.environmentId, threadId: item.threadId },
                          item.title,
                        ),
                },
          ),
        })),
      };
    }),
  ),
});

const workSummary = (scope: McpInvocationContext.McpInvocationScope, objective: TotObjective) => ({
  id: objective.id,
  title: objective.title,
  status: objective.status,
  attempts: objective.attempts.length,
  failedAttempts: objective.failedAttempts,
  threads: [
    ...new Set(
      objective.attempts.map((attempt) =>
        McpInvocationContext.threadLinkFor(
          { ...scope, environmentId: attempt.environmentId },
          attempt.threadId,
        ),
      ),
    ),
  ].slice(-3),
  outcome: objective.attempts.findLast((attempt) => attempt.outcome !== null)?.outcome ?? null,
  updatedAt: objective.updatedAt,
});
