/**
 * The avatar library: open-bot figures and named looks (themes) an environment keeps as files
 * under its T3 home, so any agent can add one and every Tot there can use it. Materials are
 * shader code in the vendored renderer, not library data.
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { TotAvatar } from "./tots.ts";

export const AvatarLibraryId = Schema.String.check(
  Schema.isMaxLength(48),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);
export type AvatarLibraryId = typeof AvatarLibraryId.Type;

const Coordinate = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

/** An open-bot-avatar definition (contract v1); the server also runs the renderer's own validation. */
export const AvatarFigure = Schema.Struct({
  version: Schema.Literal(1),
  id: AvatarLibraryId,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  body: Schema.Struct({
    path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000)).annotate({
      description: "One filled SVG path in a 0 0 100 100 box, kept within about 8..92.",
    }),
  }),
  eyes: Schema.Struct({
    x: Coordinate,
    y: Coordinate,
    spacing: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 60 })),
    scale: Schema.Number.check(Schema.isBetween({ minimum: 0.2, maximum: 3 })),
  }).annotate({
    description: "Pair center, spacing, size (1 = 4×11).",
  }),
});
export type AvatarFigure = typeof AvatarFigure.Type;

/** A named look: every face field a Tot takes, applied all at once. */
export const AvatarTheme = Schema.Struct({
  id: AvatarLibraryId,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  avatar: TotAvatar,
});
export type AvatarTheme = typeof AvatarTheme.Type;

export const AvatarLibrary = Schema.Struct({
  figures: Schema.Array(AvatarFigure),
  themes: Schema.Array(AvatarTheme),
});
export type AvatarLibrary = typeof AvatarLibrary.Type;

export const AvatarLibraryKind = Schema.Literals(["figure", "theme"]);
export type AvatarLibraryKind = typeof AvatarLibraryKind.Type;

/** What `export` writes and `import` reads: one library item in a portable file. */
export const AvatarLibraryExport = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("figure"), figure: AvatarFigure }),
  Schema.Struct({ kind: Schema.Literal("theme"), theme: AvatarTheme }),
]);
export type AvatarLibraryExport = typeof AvatarLibraryExport.Type;

export const AvatarLibraryRemoveInput = Schema.Struct({
  kind: AvatarLibraryKind,
  id: AvatarLibraryId,
});
export type AvatarLibraryRemoveInput = typeof AvatarLibraryRemoveInput.Type;

export const AvatarFigureDescribeInput = Schema.Struct({
  description: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
});
export type AvatarFigureDescribeInput = typeof AvatarFigureDescribeInput.Type;

/** A figure generated from a description and validated; not saved until the user saves it. */
export const AvatarFigureDescribeResult = Schema.Struct({
  figure: AvatarFigure,
  /** The figure drawn flat, as SVG markup, for a client without the renderer. */
  previewSvg: Schema.String,
});
export type AvatarFigureDescribeResult = typeof AvatarFigureDescribeResult.Type;

/** Looks every build offers next to the library's themes: BoopFace faces and a few open-bot ones. */
export const TOT_BUILT_IN_THEMES: ReadonlyArray<AvatarTheme> = [
  { id: "classic", name: "Classic", avatar: { color: "#0A7EA4" } },
  { id: "blossom", name: "Blossom", avatar: { color: "#DB2777", shape: "flower", antenna: true } },
  { id: "starburst", name: "Starburst", avatar: { color: "#7C3AED", shape: "burst" } },
  {
    id: "gentleman",
    name: "Gentleman",
    avatar: { color: "#475569", shape: "gem", accessories: [{ kind: "cardinal.top-hat" }] },
  },
  {
    id: "chatterbox",
    name: "Chatterbox",
    avatar: {
      color: "#0A7EA4",
      style: "open-bot",
      openBot: { figure: "chat", material: "fluffy", mood: "happy" },
    },
  },
  {
    id: "glass-rocket",
    name: "Glass rocket",
    avatar: {
      color: "#EA580C",
      style: "open-bot",
      openBot: { figure: "rocket", material: "glass" },
    },
  },
];
