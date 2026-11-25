import {
  AvatarFigure,
  AvatarLibraryExport,
  AvatarTheme,
  TotError,
  type AvatarLibrary,
  type AvatarLibraryKind,
  type TotAvatar,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { examples, renderAvatarSvg, validateAvatar, type AvatarDefinition } from "open-bot-avatar";
import { gallery } from "open-bot-avatar/gallery";

import * as ServerConfig from "../config.ts";

/** Figures every build ships; a library figure may not take one of their ids. */
export const BUILT_IN_FIGURE_IDS: ReadonlySet<string> = new Set(
  [...examples, ...gallery].map((figure) => figure.id),
);

const MAX_ITEMS = 200;
const FOLDERS = { figure: "figures", theme: "themes" } as const;

const decodeFigure = Schema.decodeUnknownOption(AvatarFigure);
const decodeTheme = Schema.decodeUnknownOption(AvatarTheme);
const decodeExport = Schema.decodeUnknownOption(AvatarLibraryExport);
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
/** Indented so a person can read and edit a library file by hand. */
const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const libraryRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  return path.resolve(config.baseDir, "avatars");
});

const itemPath = Effect.fn("avatarLibrary.itemPath")(function* (
  kind: AvatarLibraryKind,
  id: string,
) {
  const path = yield* Path.Path;
  return path.join(yield* libraryRoot, FOLDERS[kind], `${id}.json`);
});

const readJson = Effect.fn("avatarLibrary.readJson")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const text = yield* fileSystem.readFileString(file).pipe(Effect.option);
  if (text._tag === "None") return undefined;
  const parsed = parseJson(text.value);
  return parsed._tag === "Some" ? parsed.value : undefined;
});

const readFolder = Effect.fn("avatarLibrary.readFolder")(function* <A>(
  kind: AvatarLibraryKind,
  decode: (
    input: unknown,
  ) => { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" },
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(yield* libraryRoot, FOLDERS[kind]);
  const names = yield* fileSystem
    .readDirectory(folder)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  const items: A[] = [];
  for (const name of [...names].filter((entry) => entry.endsWith(".json")).sort()) {
    if (items.length >= MAX_ITEMS) break;
    const decoded = decode(yield* readJson(path.join(folder, name)));
    // A hand-edited file that no longer decodes is skipped, never fatal.
    if (decoded._tag === "Some") items.push(decoded.value);
  }
  return items;
});

/** The environment's figures and themes. Unreadable files are left out. */
export const readAvatarLibrary = Effect.fn("avatarLibrary.read")(function* () {
  const figures = (yield* readFolder("figure", decodeFigure)).filter(
    (figure) => validateAvatar(figure).ok,
  );
  const themes = yield* readFolder("theme", decodeTheme);
  return { figures, themes } satisfies AvatarLibrary;
});

/** Why the renderer would refuse a figure, or null when it draws. */
const figureProblem = (figure: AvatarFigure): string | null => {
  if (BUILT_IN_FIGURE_IDS.has(figure.id)) {
    return `"${figure.id}" is a built-in figure; pick another id.`;
  }
  const result = validateAvatar(figure);
  return result.ok ? null : result.errors.slice(0, 5).join(" ");
};

const writeItem = Effect.fn("avatarLibrary.writeItem")(function* (
  kind: AvatarLibraryKind,
  id: string,
  item: unknown,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = yield* itemPath(kind, id);
  yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFileString(target, prettyJson(item))),
    Effect.mapError(() => new TotError({ message: `The ${kind} could not be saved.` })),
  );
});

export const saveAvatarFigure = Effect.fn("avatarLibrary.saveFigure")(function* (
  figure: AvatarFigure,
) {
  const problem = figureProblem(figure);
  if (problem !== null) return yield* new TotError({ message: problem });
  yield* writeItem("figure", figure.id, figure);
  return figure;
});

export const saveAvatarTheme = Effect.fn("avatarLibrary.saveTheme")(function* (theme: AvatarTheme) {
  yield* writeItem("theme", theme.id, theme);
  return theme;
});

export const removeAvatarLibraryItem = Effect.fn("avatarLibrary.remove")(function* (
  kind: AvatarLibraryKind,
  id: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const target = yield* itemPath(kind, id);
  const exists = yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return yield* new TotError({ message: `No ${kind} named "${id}".` });
  yield* fileSystem
    .remove(target)
    .pipe(Effect.mapError(() => new TotError({ message: `The ${kind} could not be deleted.` })));
});

/** Writes one item to `file` as an export another environment can import. */
export const exportAvatarLibraryItem = Effect.fn("avatarLibrary.export")(function* (
  kind: AvatarLibraryKind,
  id: string,
  file: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const library = yield* readAvatarLibrary();
  const item: AvatarLibraryExport | undefined =
    kind === "figure"
      ? (() => {
          const figure = library.figures.find((entry) => entry.id === id);
          return figure === undefined ? undefined : { kind, figure };
        })()
      : (() => {
          const theme = library.themes.find((entry) => entry.id === id);
          return theme === undefined ? undefined : { kind, theme };
        })();
  if (item === undefined) return yield* new TotError({ message: `No ${kind} named "${id}".` });
  const target = path.resolve(file);
  yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(
    Effect.andThen(fileSystem.writeFileString(target, prettyJson(item))),
    Effect.mapError(() => new TotError({ message: `Could not write ${target}.` })),
  );
  return target;
});

/** Reads an export file and saves its item here, replacing one with the same id. */
export const importAvatarLibraryItem = Effect.fn("avatarLibrary.import")(function* (file: string) {
  const path = yield* Path.Path;
  const decoded = decodeExport(yield* readJson(path.resolve(file)));
  if (decoded._tag === "None") {
    return yield* new TotError({ message: `${file} is not an avatar library export.` });
  }
  const item = decoded.value;
  if (item.kind === "figure") {
    yield* saveAvatarFigure(item.figure);
    return { kind: item.kind, id: item.figure.id };
  }
  yield* saveAvatarTheme(item.theme);
  return { kind: item.kind, id: item.theme.id };
});

const BUILT_IN_FIGURES: ReadonlyArray<AvatarDefinition> = [...examples, ...gallery];
/** The figure a missing name draws, here and in every client. */
export const DEFAULT_FIGURE_ID = "chat";

/** A figure by id from the built-ins or the library; the default figure when neither has it. */
export const resolveFigure = (
  id: string,
  library: ReadonlyArray<AvatarDefinition>,
): AvatarDefinition =>
  BUILT_IN_FIGURES.find((figure) => figure.id === id) ??
  library.find((figure) => figure.id === id) ??
  (BUILT_IN_FIGURES.find((figure) => figure.id === DEFAULT_FIGURE_ID) as AvatarDefinition);

/**
 * A page showing a figure in a face's colors on light and dark, large and at sidebar size, for
 * an agent to check its work. The finish is drawn flat (soft as its depth ramp): fluffy and
 * glass need WebGL, which the app has and this preview does not.
 */
export const avatarPreviewHtml = (figure: AvatarDefinition, face?: TotAvatar): string => {
  const look = face?.openBot;
  const svg = (size: number) =>
    renderAvatarSvg(figure, {
      color: face?.color ?? "#0A7EA4",
      size,
      ...(look?.eyeColor === undefined ? {} : { eyeColor: look.eyeColor }),
      ...(look?.depth === undefined ? {} : { depth: look.depth }),
      ...(look?.mood === undefined ? {} : { mood: look.mood }),
      ...(look?.material === "soft" ? { soft: {} } : {}),
    });
  const tile = (background: string) =>
    `<div style="background:${background};padding:16px;display:flex;gap:16px;align-items:flex-end">${svg(160)}${svg(32)}</div>`;
  return `<!doctype html><html><body style="margin:0;display:flex">${tile("#ffffff")}${tile("#0b0d12")}</body></html>`;
};
