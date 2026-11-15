/**
 * The colour subset of a Tot's `theme.css` that mobile can wear: web applies the
 * whole sheet, mobile reads only these declarations. A declaration counts
 * anywhere in the sheet and the last one wins; the layer has no selector or
 * appearance awareness.
 */

export const TOT_THEME_TOKEN_NAMES = [
  "--tot-bg",
  "--tot-surface",
  "--tot-accent",
  "--tot-text",
  "--tot-muted",
  "--tot-code-bg",
  "--tot-border",
] as const;

export type TotThemeTokenName = (typeof TOT_THEME_TOKEN_NAMES)[number];

export type TotThemeTokens = Partial<Record<TotThemeTokenName, string>>;

/** A `--tot-*` declaration the mobile token layer left out, and why. */
export interface TotThemeTokenIssue {
  readonly property: string;
  readonly reason: string;
}

export interface TotThemeTokenScan {
  readonly tokens: TotThemeTokens;
  readonly ignored: ReadonlyArray<TotThemeTokenIssue>;
}

const TOKEN_NAME = new Set<string>(TOT_THEME_TOKEN_NAMES);

/**
 * Named colours React Native resolves. The functional forms and hex carry
 * everything else; this set keeps a value small enough to read in a diff.
 */
const NAMED_COLORS = new Set([
  "black",
  "silver",
  "gray",
  "grey",
  "white",
  "maroon",
  "red",
  "purple",
  "fuchsia",
  "magenta",
  "green",
  "lime",
  "olive",
  "yellow",
  "navy",
  "blue",
  "teal",
  "aqua",
  "cyan",
  "orange",
  "pink",
  "transparent",
]);

const HEX = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const PERCENT = /^(\d+(?:\.\d+)?|\.\d+)%$/;
const HUE = /^(\d+(?:\.\d+)?|\.\d+)(?:deg)?$/;

const IDENTIFIER_CHARACTER = /[-\w]/;
const WHITESPACE = /[ \t\n\r\f]/;

function skipComment(css: string, start: number): number {
  const end = css.indexOf("*/", start + 2);
  return end === -1 ? css.length : end + 2;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const character = css[index]!;
    if (character === "\\") {
      index += 2;
      continue;
    }
    index++;
    if (character === quote) break;
  }
  return index;
}

/** Whitespace and comments between a property and its colon are not part of either. */
function skipTrivia(css: string, start: number): number {
  let index = start;
  for (;;) {
    while (index < css.length && WHITESPACE.test(css[index]!)) index++;
    if (css[index] === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    return index;
  }
}

/** Where a declaration's value ends: a top-level `;`, `}`, or the end of the text. */
function valueEnd(css: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < css.length) {
    const character = css[index]!;
    if (character === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipString(css, index);
      continue;
    }
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (character === ";" || character === "}")) {
      return index;
    }
    index++;
  }
  return css.length;
}

/** `rgb(1, 2, 3)`, `rgba(1, 2, 3, 0.5)`; the token layer accepts the comma form only. */
function isRgbColor(body: string, allowsAlpha: boolean): boolean {
  const parts = body.split(",").map((part) => part.trim());
  if (parts.length !== 3 && !(allowsAlpha && parts.length === 4)) return false;
  if (parts.some((part) => part === "")) return false;
  for (const channel of parts.slice(0, 3)) {
    if (NUMBER.test(channel)) {
      const value = Number(channel);
      if (value < 0 || value > 255) return false;
    } else {
      const percent = PERCENT.exec(channel);
      if (percent === null || Number(percent[1]) > 100) return false;
    }
  }
  if (parts.length === 4) return isAlpha(parts[3]!);
  return true;
}

function isAlpha(value: string): boolean {
  if (NUMBER.test(value)) {
    const alpha = Number(value);
    return alpha >= 0 && alpha <= 1;
  }
  const percent = PERCENT.exec(value);
  return percent !== null && Number(percent[1]) <= 100;
}

/** `hsl(120, 50%, 50%)`, `hsla(120, 50%, 50%, 0.5)`; a hue may carry `deg`. */
function isHslColor(body: string, allowsAlpha: boolean): boolean {
  const parts = body.split(",").map((part) => part.trim());
  if (parts.length !== 3 && !(allowsAlpha && parts.length === 4)) return false;
  if (parts.some((part) => part === "")) return false;
  if (HUE.exec(parts[0]!) === null) return false;
  const saturation = PERCENT.exec(parts[1]!);
  const lightness = PERCENT.exec(parts[2]!);
  if (saturation === null || lightness === null) return false;
  if (Number(saturation[1]) > 100 || Number(lightness[1]) > 100) return false;
  if (parts.length === 4) return isAlpha(parts[3]!);
  return true;
}

/** Whether a value is one colour React Native can paint, and nothing else. */
export function totThemeTokenIsColor(value: string): boolean {
  const trimmed = value.trim();
  if (HEX.test(trimmed)) return true;
  if (NAMED_COLORS.has(trimmed.toLowerCase())) return true;
  const rgb = /^(rgba?)\(([^()]*)\)$/i.exec(trimmed);
  if (rgb !== null) return isRgbColor(rgb[2]!, rgb[1]!.toLowerCase() === "rgba");
  const hsl = /^(hsla?)\(([^()]*)\)$/i.exec(trimmed);
  if (hsl !== null) return isHslColor(hsl[2]!, hsl[1]!.toLowerCase() === "hsla");
  return false;
}

function tokenProblem(value: string): string | null {
  if (value === "") return "has no value";
  if (value.includes("!")) return "does not accept !important";
  if (value.includes("\\")) return "does not accept CSS escapes";
  if (/var\(/i.test(value)) return "does not accept var()";
  if (/url\(/i.test(value)) return "does not accept url()";
  if (/expression\(/i.test(value)) return "does not accept expression()";
  if (!totThemeTokenIsColor(value)) return "is not a colour the mobile app understands";
  return null;
}

/**
 * Reads the allowlisted colour tokens out of a Tot's theme CSS. Comments are
 * skipped, values must be plain colours, and the last declaration wins.
 */
export function parseTotThemeTokens(css: string): TotThemeTokenScan {
  const tokens: TotThemeTokens = {};
  const ignored: TotThemeTokenIssue[] = [];
  let index = 0;
  while (index < css.length) {
    const character = css[index]!;
    if (character === "/" && css[index + 1] === "*") {
      index = skipComment(css, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipString(css, index);
      continue;
    }
    if (character !== "-" || !css.startsWith("--tot-", index)) {
      index++;
      continue;
    }
    const previous = css[index - 1];
    if (previous !== undefined && IDENTIFIER_CHARACTER.test(previous)) {
      index++;
      continue;
    }
    const nameStart = index;
    index++;
    while (index < css.length && IDENTIFIER_CHARACTER.test(css[index]!)) index++;
    const property = css.slice(nameStart, index);
    const colon = skipTrivia(css, index);
    if (css[colon] !== ":") continue;
    const end = valueEnd(css, colon + 1);
    const raw = css.slice(colon + 1, end);
    // A comment may sit among the value's whitespace; it is not part of it.
    const value = raw.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
    index = end + (end < css.length ? 1 : 0);
    if (!TOKEN_NAME.has(property)) {
      ignored.push({ property, reason: "is not a mobile Tot theme token" });
      continue;
    }
    const problem = tokenProblem(value);
    if (problem !== null) {
      ignored.push({ property, reason: problem });
      continue;
    }
    tokens[property as TotThemeTokenName] = value;
  }
  return { tokens, ignored };
}
