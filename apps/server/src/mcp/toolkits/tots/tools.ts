import {
  EnvironmentId,
  GroupChatId,
  MAX_WEBHOOK_FILTERS,
  ModelSelection,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ScheduledTaskId,
  ScheduledTaskWebhookFilter,
  ThreadId,
  Tot,
  TotAvatar,
  TotId,
  TotScope,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { TOT_TEMPLATES } from "@t3tools/shared/totTemplates";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
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
        /** The Tot's face, so an outside client can draw it. */
        avatar: TotAvatar,
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
    "As a Tot, set your own face when the user asks you to design it; it joins your saved faces. Two styles: boopface (default) and open-bot, an object with eyes: `openBot` takes a figure, a finish (flat, fluffy, glass, soft), a depth and an eye color. Built-in figures: mug, cat, rocket, controller, barbell, lightbulb, chat, sprout, watering-can, book, brain, bull, bunny, camera, cloud, egg, ghost, magnifier, paint-brush, palette, shield, star, witch-hat. Send your BoopFace fields too; they are kept for switching back. For a new figure or a reusable theme, use t3_avatar_library first, then apply it.",
  parameters: TotAvatar,
  success: Schema.Struct({ ok: Schema.Literal(true) }),
}).annotate(Tool.Destructive, false);

const TotThemeSetTool = Tool.make("t3_tot_theme_set", {
  ...shared,
  description:
    "As a Tot, set the theme of your own thread; another Tot's is out of reach. `css` restyles your conversation and follows theme rules (no @import, no remote url()). `effect` is opaque text for the effect layer; T3 Code never runs or shows it. Empty string or null clears one field, not the other. Live full-access Tot thread only.",
  parameters: Schema.Struct({
    css: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "CSS for your conversation, up to 20,000 characters. Scoped to it.",
    }),
    effect: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "Opaque text for the effect layer, up to 20,000 characters. Not run here.",
    }),
  }),
  success: Schema.Struct({
    totId: TotId,
    cssLength: Schema.Number,
    effectLength: Schema.Number,
    summary: Schema.String,
  }),
}).annotate(Tool.Destructive, false);

const TotThemeReadTool = Tool.make("t3_tot_theme_read", {
  ...shared,
  description:
    "As a Tot, read your own thread theme's sizes and whether each part is set. The stored text is not returned.",
  success: Schema.Struct({
    totId: TotId,
    cssLength: Schema.Number,
    effectLength: Schema.Number,
    summary: Schema.String,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const TotWebhookListenerTool = Tool.make("t3_tot_webhook_listener", {
  ...shared,
  dependencies: [...shared.dependencies, ScheduledTaskService.ScheduledTaskService],
  description:
    "As a Tot, create a webhook listener that posts into a Tot's chat. `notify` (default) posts a compact line with no model call; `wake` starts a turn with the payload framed as untrusted data. Filters and a cooldown keep noisy sensors quiet. Returns the webhook URL, which is a secret: give it to the user and never log or repeat it elsewhere.",
  parameters: Schema.Struct({
    name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)).annotate({
      description: "Shown in chat, such as 'front-door-motion'.",
    }),
    tot: Schema.optional(TotId).annotate({ description: "Default: you." }),
    mode: Schema.optional(Schema.Literals(["notify", "wake"])).annotate({
      description: "Default: notify.",
    }),
    messageTemplate: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
    ).annotate({
      description:
        "Notify: the whole line. Wake: the prompt. Uses {{body.path}}, {{headers.name}}, {{query.name}}, {{body}}, {{request}}, {{listener.name}}, {{time}}.",
    }),
    filters: Schema.optional(
      Schema.Array(ScheduledTaskWebhookFilter).check(Schema.isMaxLength(MAX_WEBHOOK_FILTERS)),
    ).annotate({
      description: "All must match, such as {path:'body.action',op:'equals',value:'on'}.",
    }),
    cooldownSeconds: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 86_400 })),
    ).annotate({ description: "Drops repeats inside this window and logs them as cooldown." }),
    notify: Schema.optional(Schema.Boolean).annotate({
      description: "Also mark the thread unread so clients badge it.",
    }),
  }),
  success: Schema.Struct({
    listenerId: ScheduledTaskId,
    name: Schema.String,
    mode: Schema.Literals(["notify", "wake"]),
    webhookUrl: Schema.NullOr(Schema.String),
    webhookPath: Schema.String,
    link: Schema.String,
  }),
}).annotate(Tool.Destructive, false);

const TotCreateTool = Tool.make("t3_tot_create", {
  ...shared,
  description:
    "As a Tot with scope `all`, create and turn on a new Tot, same as the app does. Its scope is set explicitly. It defaults to your model.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    name: Tot.fields.name,
    scope: TotScope,
    template: Schema.optional(
      Schema.Literals(TOT_TEMPLATES.map((template) => template.id)).annotate({
        description:
          "Starts from a built-in template: its instructions and face unless you pass your own, and its routines, paused.",
      }),
    ),
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

const TotInstructionsTool = Tool.make("t3_tot_instructions", {
  ...shared,
  description:
    "Read a Tot's personality and instructions, or replace them by passing `instructions`. They render into its AGENTS.md, so edit them here, not by hand. A Tot reaches only its own, unless it is Home.",
  parameters: Schema.Struct({
    tot: Schema.optional(TotId).annotate({ description: "Default: you." }),
    instructions: Schema.optional(
      Tot.fields.instructions.annotate({
        description: "The whole new text, in Markdown, up to 20,000 characters. Omit to read.",
      }),
    ),
  }),
  success: Schema.Struct({
    totId: TotId,
    name: Schema.String,
    instructions: Schema.String,
    updated: Schema.Boolean,
  }),
}).annotate(Tool.Destructive, false);

export const TotToolkit = Toolkit.make(
  TotListTool,
  TotWatchTool,
  GroupChatSayTool,
  TotDesignAvatarTool,
  TotThemeSetTool,
  TotThemeReadTool,
  TotWebhookListenerTool,
  TotCreateTool,
  TotInstructionsTool,
);
