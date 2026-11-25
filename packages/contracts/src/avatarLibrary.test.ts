import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  AvatarFigure,
  AvatarLibraryExport,
  AvatarTheme,
  TOT_BUILT_IN_THEMES,
} from "./avatarLibrary.ts";

const lighthouse = {
  version: 1,
  id: "lighthouse",
  name: "Lighthouse",
  body: { path: "M38 30 L62 30 L68 88 L32 88 Z" },
  eyes: { x: 50, y: 56, spacing: 14, scale: 1 },
} as const;

const decodeFigure = Schema.decodeUnknownSync(AvatarFigure);
const decodeTheme = Schema.decodeUnknownSync(AvatarTheme);
const decodeExport = Schema.decodeUnknownSync(AvatarLibraryExport);

describe("avatar library", () => {
  it("decodes a figure and a theme that refers to it by name", () => {
    expect(decodeFigure(lighthouse)).toEqual(lighthouse);
    const theme = {
      id: "beacon",
      name: "Beacon",
      avatar: {
        color: "#EA580C",
        style: "open-bot",
        openBot: { figure: "lighthouse", mood: "happy" },
      },
    };
    expect(decodeTheme(theme)).toEqual(theme);
    expect(decodeExport({ kind: "figure", figure: lighthouse })).toEqual({
      kind: "figure",
      figure: lighthouse,
    });
  });

  it("refuses an id that is not a slug, a version it does not know, or eyes off the box", () => {
    for (const figure of [
      { ...lighthouse, id: "Light House" },
      { ...lighthouse, version: 2 },
      { ...lighthouse, eyes: { ...lighthouse.eyes, x: 140 } },
      { ...lighthouse, body: { path: "" } },
    ]) {
      expect(() => decodeFigure(figure)).toThrow();
    }
  });

  it("ships built-in themes that decode and have distinct ids", () => {
    for (const theme of TOT_BUILT_IN_THEMES) expect(decodeTheme(theme)).toEqual(theme);
    expect(new Set(TOT_BUILT_IN_THEMES.map((theme) => theme.id)).size).toBe(
      TOT_BUILT_IN_THEMES.length,
    );
  });
});
