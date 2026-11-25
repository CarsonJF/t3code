import {
  AvatarFigure,
  AvatarLibraryId,
  AvatarLibraryKind,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  TotId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const LibraryEntry = Schema.Struct({ id: Schema.String, name: Schema.String });

export const AvatarLibraryTool = Tool.make("t3_avatar_library", {
  description:
    "Avatar library every Tot here shares: open-bot figures (SVG outline + eyes) and themes (named faces). save_* upserts by id and returns a PNG; check it and save again until it reads small. apply puts a theme on a Tot.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    action: Schema.Literals([
      "list",
      "save_figure",
      "save_theme",
      "delete",
      "preview",
      "apply",
      "export",
      "import",
    ]),
    figure: Schema.optional(AvatarFigure),
    theme: Schema.optional(
      Schema.Struct({
        id: AvatarLibraryId,
        name: Schema.String,
        // Checked against AvatarTheme in the handler, so the face schema is not repeated here.
        avatar: Schema.Unknown.annotate({ description: "The fields t3_tot_design_avatar takes." }),
      }),
    ),
    kind: Schema.optional(AvatarLibraryKind).annotate({
      description: "For delete, preview, export.",
    }),
    id: Schema.optional(AvatarLibraryId).annotate({
      description: "Item id; a theme id for apply.",
    }),
    totId: Schema.optional(TotId).annotate({ description: "For apply." }),
    path: Schema.optional(Schema.String).annotate({ description: "JSON file for export/import." }),
  }),
  success: Schema.Struct({
    figures: Schema.optional(Schema.Array(LibraryEntry)),
    themes: Schema.optional(Schema.Array(LibraryEntry)),
    path: Schema.optional(Schema.String),
    note: Schema.optional(Schema.String),
    screenshot: Schema.optional(
      Schema.Struct({
        mimeType: Schema.Literal("image/png"),
        data: Schema.String,
        width: Schema.Int,
        height: Schema.Int,
      }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    TotService.TotService,
    HtmlRender.HtmlRender,
  ],
})
  .annotate(Tool.Title, "Avatar library")
  .annotate(Tool.Destructive, false);

export const AvatarLibraryToolkit = Toolkit.make(AvatarLibraryTool);
