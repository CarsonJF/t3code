import { DEFAULT_HOME_TOT, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as GroupChatService from "../../../tots/GroupChatService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { requireTotChange } from "../../totCaller.ts";
import { readCaller } from "../../threadAccess.ts";
import { TotToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(TotToolkit, {
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
      const created = yield* tots
        .create({
          name: input.name,
          avatar: input.avatar ?? DEFAULT_HOME_TOT.avatar,
          scope: input.scope,
          instructions: input.instructions ?? "",
          modelSelection,
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
});
