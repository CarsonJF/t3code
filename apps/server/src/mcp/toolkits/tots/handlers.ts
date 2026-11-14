import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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
