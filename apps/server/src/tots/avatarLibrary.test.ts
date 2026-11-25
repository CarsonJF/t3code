import { expect, it } from "@effect/vitest";
import type { AvatarFigure, AvatarTheme } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  DEFAULT_FIGURE_ID,
  avatarPreviewHtml,
  exportAvatarLibraryItem,
  importAvatarLibraryItem,
  readAvatarLibrary,
  removeAvatarLibraryItem,
  resolveFigure,
  saveAvatarFigure,
  saveAvatarTheme,
} from "./avatarLibrary.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-avatar-library-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const lighthouse: AvatarFigure = {
  version: 1,
  id: "lighthouse",
  name: "Lighthouse",
  body: { path: "M38 30 L62 30 L68 88 L32 88 Z M42 14 L58 14 L60 30 L40 30 Z" },
  eyes: { x: 50, y: 56, spacing: 14, scale: 1 },
};
const beacon: AvatarTheme = {
  id: "beacon",
  name: "Beacon",
  avatar: { color: "#EA580C", style: "open-bot", openBot: { figure: "lighthouse" } },
};

it.layer(layer)("avatar library", (it) => {
  it.effect("saves a figure and a theme, lists them, and deletes them again", () =>
    Effect.gen(function* () {
      yield* saveAvatarFigure(lighthouse);
      yield* saveAvatarTheme(beacon);
      const library = yield* readAvatarLibrary();
      expect(library.figures.map((figure) => figure.id)).toContain("lighthouse");
      expect(library.themes).toContainEqual(beacon);

      yield* removeAvatarLibraryItem("theme", "beacon");
      expect((yield* readAvatarLibrary()).themes).toEqual([]);
      const missing = yield* removeAvatarLibraryItem("theme", "beacon").pipe(Effect.flip);
      expect(missing.message).toBe('No theme named "beacon".');
    }),
  );

  it.effect("refuses a figure the renderer would not draw, or one that takes a built-in id", () =>
    Effect.gen(function* () {
      const eyesOutside = yield* saveAvatarFigure({
        ...lighthouse,
        id: "blind",
        eyes: { x: 5, y: 5, spacing: 14, scale: 1 },
      }).pipe(Effect.flip);
      expect(eyesOutside.message.length).toBeGreaterThan(0);
      const taken = yield* saveAvatarFigure({ ...lighthouse, id: "mug" }).pipe(Effect.flip);
      expect(taken.message).toBe('"mug" is a built-in figure; pick another id.');
      expect((yield* readAvatarLibrary()).figures.map((figure) => figure.id)).not.toContain(
        "blind",
      );
    }),
  );

  it.effect("skips a hand-edited file that no longer decodes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const folder = path.join(config.baseDir, "avatars", "figures");
      yield* fileSystem.makeDirectory(folder, { recursive: true });
      yield* fileSystem.writeFileString(path.join(folder, "broken.json"), "{ not json");
      yield* fileSystem.writeFileString(path.join(folder, "wrong.json"), '{"id":"wrong"}');
      const ids = (yield* readAvatarLibrary()).figures.map((figure) => figure.id);
      expect(ids).not.toContain("broken");
      expect(ids).not.toContain("wrong");
    }),
  );

  it.effect("exports an item to a file and imports it back", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      yield* saveAvatarFigure(lighthouse);
      const file = path.join(config.baseDir, "shared", "lighthouse.json");
      expect(yield* exportAvatarLibraryItem("figure", "lighthouse", file)).toBe(file);
      yield* removeAvatarLibraryItem("figure", "lighthouse");
      expect(yield* importAvatarLibraryItem(file)).toEqual({ kind: "figure", id: "lighthouse" });
      expect((yield* readAvatarLibrary()).figures).toContainEqual(lighthouse);

      const notExport = yield* importAvatarLibraryItem(
        path.join(config.baseDir, "nowhere.json"),
      ).pipe(Effect.flip);
      expect(notExport.message).toContain("is not an avatar library export");
    }),
  );
});

it("resolves a figure by name, and draws the default figure for a name nobody has", () => {
  expect(resolveFigure("mug", []).id).toBe("mug");
  expect(resolveFigure("lighthouse", [lighthouse]).id).toBe("lighthouse");
  expect(resolveFigure("deleted-long-ago", [lighthouse]).id).toBe(DEFAULT_FIGURE_ID);
});

it("previews a figure on light and dark, large and at sidebar size", () => {
  const html = avatarPreviewHtml(lighthouse, beacon.avatar);
  expect(html.match(/<svg/g)).toHaveLength(4);
  expect(html).toContain("#0b0d12");
});
