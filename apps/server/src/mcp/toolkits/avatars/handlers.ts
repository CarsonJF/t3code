import {
  AvatarTheme,
  OrchestratorMcpFailure,
  TOT_BUILT_IN_THEMES,
  type AvatarFigure,
  type AvatarLibrary,
  type TotAvatar,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import { avatarPreviewHtml, resolveFigure } from "../../../tots/avatarLibrary.ts";
import * as TotService from "../../../tots/TotService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { AvatarLibraryToolkit } from "./tools.ts";

const decodeTheme = Schema.decodeUnknownOption(AvatarTheme);
const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const fromTot = (error: { readonly message: string }) => invalid(error.message);

const required = <A>(value: A | undefined, what: string) =>
  value === undefined ? Effect.fail(invalid(`Pass ${what}.`)) : Effect.succeed(value);

const listing = (library: AvatarLibrary) => ({
  figures: library.figures.map(({ id, name }) => ({ id, name })),
  themes: [...library.themes, ...TOT_BUILT_IN_THEMES].map(({ id, name }) => ({ id, name })),
});

/** A PNG of the figure in the face's look, or a note when there is nothing this host can draw. */
const preview = Effect.fn("AvatarLibraryToolkit.preview")(function* (
  library: AvatarLibrary,
  target: { readonly figure: AvatarFigure } | { readonly face: TotAvatar },
) {
  const face = "face" in target ? target.face : undefined;
  if (face !== undefined && face.style !== "open-bot") {
    return { note: "BoopFace looks are drawn by the app; this theme has no PNG preview." };
  }
  const figure =
    "figure" in target
      ? target.figure
      : resolveFigure(face?.openBot?.figure ?? "", library.figures);
  const rendered = yield* (yield* HtmlRender.HtmlRender)
    .preview({ html: avatarPreviewHtml(figure, face), width: 480, appearance: "light" })
    .pipe(Effect.option);
  if (rendered._tag === "None") {
    return { note: "Saved, but this host could not draw a preview." };
  }
  const { png, width, capturedHeight } = rendered.value;
  return {
    screenshot: { mimeType: "image/png" as const, data: png, width, height: capturedHeight },
  };
});

/** Only a thread that may read and write files without asking names a path on this machine. */
const requireFullAccess = Effect.gen(function* () {
  const { limits } = yield* loadCaller();
  if (limits.runtimeMode !== "full-access") {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Only a full-access thread may export or import a file.",
    });
  }
});

export const layer = McpToolAccess.toLayer(AvatarLibraryToolkit, {
  t3_avatar_library: McpToolAccess.writes(
    (input) =>
      Effect.gen(function* () {
        const tots = yield* TotService.TotService;
        const library = yield* tots.avatarLibrary.pipe(Effect.mapError(fromTot));
        switch (input.action) {
          case "list":
            return listing(library);
          case "save_figure": {
            const figure = yield* required(input.figure, "`figure`");
            yield* tots.saveFigure(figure).pipe(Effect.mapError(fromTot));
            return yield* preview(library, { figure });
          }
          case "save_theme": {
            const decoded = decodeTheme(yield* required(input.theme, "`theme`"));
            if (decoded._tag === "None") {
              return yield* invalid("`theme.avatar` needs the fields t3_tot_design_avatar takes.");
            }
            const theme = decoded.value;
            yield* tots.saveTheme(theme).pipe(Effect.mapError(fromTot));
            return yield* preview(library, { face: theme.avatar });
          }
          case "delete": {
            const kind = yield* required(input.kind, "`kind`");
            const id = yield* required(input.id, "`id`");
            yield* tots.removeLibraryItem(kind, id).pipe(Effect.mapError(fromTot));
            return listing(yield* tots.avatarLibrary.pipe(Effect.mapError(fromTot)));
          }
          case "preview": {
            const id = yield* required(input.id, "`id`");
            if (input.kind === "theme") {
              const theme = [...library.themes, ...TOT_BUILT_IN_THEMES].find(
                (entry) => entry.id === id,
              );
              if (theme === undefined) return yield* invalid(`No theme named "${id}".`);
              return yield* preview(library, { face: theme.avatar });
            }
            const figure = library.figures.find((entry) => entry.id === id);
            if (figure === undefined) return yield* invalid(`No library figure named "${id}".`);
            return yield* preview(library, { figure });
          }
          case "apply": {
            const totId = yield* required(input.totId, "`totId`");
            const id = yield* required(input.id, "the theme's `id`");
            const tot = yield* tots.applyTheme(totId, id).pipe(Effect.mapError(fromTot));
            return yield* preview(library, { face: tot.avatar });
          }
          case "export": {
            yield* requireFullAccess;
            const kind = yield* required(input.kind, "`kind`");
            const id = yield* required(input.id, "`id`");
            const file = yield* required(input.path, "`path`");
            const path = yield* tots
              .exportLibraryItem(kind, id, file)
              .pipe(Effect.mapError(fromTot));
            return { path };
          }
          case "import": {
            yield* requireFullAccess;
            const file = yield* required(input.path, "`path`");
            const item = yield* tots.importLibraryItem(file).pipe(Effect.mapError(fromTot));
            return {
              ...listing(yield* tots.avatarLibrary.pipe(Effect.mapError(fromTot))),
              note: `Imported ${item.kind} "${item.id}".`,
            };
          }
        }
      }),
    { linkedCallers: "allowed" },
  ),
});
