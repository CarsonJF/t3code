import { describe, expect, it } from "vite-plus/test";

import { parseTotThemeTokens, totThemeTokenIsColor } from "./totThemeTokens.ts";

const THEME = `
:root {
  --tot-bg: #0b0a10;
  --tot-surface: #1b1724;
  --tot-accent: #e8679f;
  --tot-text: #f4eef7;
  --tot-muted: hsl(280, 12%, 62%);
  --tot-code-bg: rgba(255, 255, 255, 0.06);
  --tot-border: #342c40;
}
`;

describe("parseTotThemeTokens", () => {
  it("reads the whole token set", () => {
    expect(parseTotThemeTokens(THEME)).toEqual({
      tokens: {
        "--tot-bg": "#0b0a10",
        "--tot-surface": "#1b1724",
        "--tot-accent": "#e8679f",
        "--tot-text": "#f4eef7",
        "--tot-muted": "hsl(280, 12%, 62%)",
        "--tot-code-bg": "rgba(255, 255, 255, 0.06)",
        "--tot-border": "#342c40",
      },
      ignored: [],
    });
  });

  it("returns a partial map when a theme sets only some tokens", () => {
    expect(parseTotThemeTokens(":root { --tot-bg: #101010; }")).toEqual({
      tokens: { "--tot-bg": "#101010" },
      ignored: [],
    });
  });

  it("sets nothing for CSS without tokens", () => {
    expect(parseTotThemeTokens(".messages-timeline-scroll { background: #101820; }")).toEqual({
      tokens: {},
      ignored: [],
    });
  });

  it("keeps the last duplicate declaration", () => {
    expect(
      parseTotThemeTokens(":root { --tot-accent: #111111; --tot-accent: #222222; }").tokens,
    ).toEqual({ "--tot-accent": "#222222" });
  });

  it("ignores tokens inside comments", () => {
    const scan = parseTotThemeTokens(`
      /* --tot-bg: #ff0000; */
      :root {
        /* --tot-accent: #00ff00; */
        --tot-text: #eeeeee;
      }
    `);
    expect(scan.tokens).toEqual({ "--tot-text": "#eeeeee" });
  });

  it("does not let a comment hide a token from the scan", () => {
    expect(
      parseTotThemeTokens(":root /* note */ { --tot-bg /* c */ : /* c */ #0b0a10 /* c */; }")
        .tokens,
    ).toEqual({ "--tot-bg": "#0b0a10" });
  });

  it.each([
    ["url()", "--tot-bg: url(https://example.com/a.png);"],
    ["var()", "--tot-surface: var(--app-surface);"],
    ["expression()", "--tot-text: expression(alert(1));"],
    ["!important", "--tot-accent: #e8679f !important;"],
    ["a CSS escape", "--tot-code-bg: \\75 rl(https://example.com/a);"],
    ["junk", "--tot-muted: definitely not a colour;"],
    ["an empty value", "--tot-border: ;"],
  ])("ignores %s and still reads the valid tokens", (_name, declaration) => {
    const scan = parseTotThemeTokens(`:root { ${declaration} --tot-text: #f4eef7; }`);
    expect(scan.tokens).toEqual({ "--tot-text": "#f4eef7" });
    expect(scan.ignored).toHaveLength(1);
    expect(scan.ignored[0]?.property).toBe(/^--tot-[a-z-]+/.exec(declaration)?.[0] ?? "--tot");
    expect(scan.ignored[0]?.reason).not.toBe("");
  });

  it("names an unknown --tot- token as ignored", () => {
    const scan = parseTotThemeTokens(":root { --tot-shadow: #00000080; --tot-bg: #101010; }");
    expect(scan.tokens).toEqual({ "--tot-bg": "#101010" });
    expect(scan.ignored).toEqual([
      { property: "--tot-shadow", reason: "is not a mobile Tot theme token" },
    ]);
  });

  it("does not treat another custom property as a Tot token", () => {
    expect(parseTotThemeTokens(":root { --totality: #101010; }").ignored).toEqual([]);
  });

  it("reads declarations outside :root too, and does not care about appearance", () => {
    expect(
      parseTotThemeTokens("@media (prefers-color-scheme: dark) { :root { --tot-bg: #000; } }")
        .tokens,
    ).toEqual({ "--tot-bg": "#000" });
  });
});

describe("totThemeTokenIsColor", () => {
  it.each([
    "#abc",
    "#abcd",
    "#aabbcc",
    "#aabbccdd",
    "rgb(1, 2, 3)",
    "rgba(1, 2, 3, 0.5)",
    "rgba(1, 2, 3)",
    "rgb(100%, 0%, 0%)",
    "hsl(120, 50%, 50%)",
    "hsla(120, 50%, 50%)",
    "hsla(120, 50%, 50%, 40%)",
    "hsl(120deg, 50%, 50%)",
    "Red",
    "transparent",
  ])("accepts %s", (value) => {
    expect(totThemeTokenIsColor(value)).toBe(true);
  });

  it.each([
    "#ab",
    "#abcde",
    "#gggggg",
    "rgb(256, 0, 0)",
    "rgb(1, 2)",
    "rgb(1 2 3)",
    "rgb(1, 2, 3, 0.5)",
    "rgba(1, 2, 3, 2)",
    "hsl(120, 50, 50)",
    "hsl(120, 50%, 50%, 0.5)",
    "hsl(120, 120%, 50%)",
    "hsl(1turn, 50%, 50%)",
    "currentcolor",
    "rebeccapurple",
  ])("rejects %s", (value) => {
    expect(totThemeTokenIsColor(value)).toBe(false);
  });
});
