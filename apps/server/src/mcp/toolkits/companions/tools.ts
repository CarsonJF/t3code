import { ExternalCompanionId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as Settings from "../../../serverSettings.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Settings.ServerSettingsService,
  ],
};

const companionId = ExternalCompanionId.annotate({
  description: "The companion's id in Settings → External Companions.",
});

const ThemeResult = Schema.Struct({
  companionId: ExternalCompanionId,
  /** What the CSS is scoped to; child channels also carry `data-companion-channel`. */
  selector: Schema.String,
  cssLength: Schema.Number,
  effectLength: Schema.Number,
  summary: Schema.String,
});

const CompanionThemeReadTool = Tool.make("t3_companion_theme_read", {
  ...shared,
  description:
    "Read an External Companion's theme sizes and its CSS scope selector. The stored text is not returned.",
  parameters: Schema.Struct({ companionId }),
  success: ThemeResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CompanionThemeSetTool = Tool.make("t3_companion_theme_set", {
  ...shared,
  description:
    "Set an External Companion's theme in this T3, only when the user asks; it styles that companion's conversation and its children's. Same rules as t3_tot_theme_set; Tot theme CSS applies as-is. Live full-access or default caller thread only.",
  parameters: Schema.Struct({
    companionId,
    css: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "CSS, up to 20,000 characters. Scoped to the companion.",
    }),
    effect: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "Effect script, up to 20,000 characters, run in the sandboxed effect layer.",
    }),
  }),
  success: ThemeResult,
}).annotate(Tool.Destructive, false);

export const CompanionThemeToolkit = Toolkit.make(CompanionThemeReadTool, CompanionThemeSetTool);
