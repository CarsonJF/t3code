import {
  EnvironmentId,
  GroupChatId,
  ModelSelection,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ThreadId,
  Tot,
  TotAvatar,
  TotId,
  TotScope,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as GroupChatService from "../../../tots/GroupChatService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SecureRandom.SecureRandom,
    ProjectService.ProjectService,
    TotService.TotService,
    GroupChatService.GroupChatService,
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

const GroupChatSayTool = Tool.make("t3_group_chat_say", {
  ...shared,
  description:
    "As a Tot, post one short chat message in a group chat you belong to. Group chat messages reach you as a prompt that names the room; this is the only way the room sees your answer.",
  parameters: Schema.Struct({
    room: GroupChatId.annotate({ description: "The room id from the prompt." }),
    text: Schema.String.annotate({ description: "The message, as you would say it in a chat." }),
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
}).annotate(Tool.Destructive, false);

const TotDesignAvatarTool = Tool.make("t3_tot_design_avatar", {
  ...shared,
  description:
    "As a Tot, set your own face when the user asks you to design it. It becomes your face and one of your saved options.",
  parameters: TotAvatar,
  success: Schema.Struct({ ok: Schema.Literal(true) }),
}).annotate(Tool.Destructive, false);

const TotCreateTool = Tool.make("t3_tot_create", {
  ...shared,
  description:
    "As a Tot with scope `all`, create and turn on a new Tot, same as the app does. Its scope is set explicitly. It defaults to your model.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    name: Tot.fields.name,
    scope: TotScope,
    instructions: Schema.optional(
      Schema.String.annotate({ description: "Personality for its AGENTS.md, in Markdown." }),
    ),
    avatar: Schema.optional(TotAvatar),
    modelSelection: Schema.optional(ModelSelection),
  }),
  success: Schema.Struct({
    id: TotId,
    link: Schema.String,
    folder: Schema.String,
    scope: TotScope,
  }),
}).annotate(Tool.Destructive, false);

export const TotToolkit = Toolkit.make(
  TotListTool,
  TotWatchTool,
  GroupChatSayTool,
  TotDesignAvatarTool,
  TotCreateTool,
);
