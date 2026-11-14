import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ThreadId,
  TotId,
  TotScope,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SecureRandom.SecureRandom,
    TotService.TotService,
  ],
};

const TotListTool = Tool.make("t3_tot_list", {
  ...shared,
  description: "List the user's Tots here: each one's scope and a `link` to its thread.",
  success: Schema.Struct({
    tots: Schema.Array(
      Schema.Struct({
        id: TotId,
        name: Schema.String,
        enabled: Schema.Boolean,
        threadId: Schema.NullOr(ThreadId),
        link: Schema.NullOr(Schema.String),
        scope: TotScope,
        watchAll: Schema.Boolean,
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const TotWatchTool = Tool.make("t3_tot_watch", {
  ...shared,
  description:
    "As a Tot, choose which threads wake you with a watch report. watch/unwatch one thread, or watch_all/unwatch_all in your scope here.",
  parameters: Schema.Struct({
    action: Schema.Literals(["watch", "unwatch", "watch_all", "unwatch_all"]),
    // Not a linked-environment target: the watch lives with the Tot, here.
    environmentId: Schema.optional(
      EnvironmentId.annotate({ description: "Where the thread lives. Default: here." }),
    ),
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
}).annotate(Tool.Destructive, false);

export const TotToolkit = Toolkit.make(TotListTool, TotWatchTool);
