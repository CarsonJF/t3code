import type { TotId } from "@t3tools/contracts";

import { stripFetches } from "../../themeCss";

// A Tot's CSS is written by an agent, so it gets both theme guards: the server
// refuses files a sheet could load, and here stripFetches drops them anyway.
// Selectors are then scoped, so one Tot's CSS cannot reach the sidebar or another
// thread even while its sheet is adopted by the whole document.

const WHITESPACE = /[ \t\n\r\f]/;
const WHITESPACE_PREFIX = /^[ \t\n\r\f]*/;
const ROOT_STEP = /^(?::root|html|body)(?![-\w])/i;

/** Where the current compound selector ends: whitespace or a combinator. */
function stepEnd(selector: string): number {
  let index = 0;
  while (index < selector.length) {
    const character = selector[index]!;
    if (WHITESPACE.test(character) || ">+~".includes(character)) break;
    index++;
  }
  return index;
}

/** Splits a selector list on its top-level commas, leaving :is(a, b) whole. */
export function splitSelectors(selectorText: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < selectorText.length; index++) {
    const character = selectorText[index]!;
    if (quote !== null) {
      if (character === quote && selectorText[index - 1] !== "\\") quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth++;
    } else if (character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
    } else if (character === "," && depth === 0) {
      selectors.push(selectorText.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorText.slice(start).trim());
  return selectors.filter((selector) => selector !== "");
}

/**
 * One selector, rewritten to match only inside the Tot's conversation. A bare
 * `:root`, `html` or `body` step becomes the scope itself; a qualified one such
 * as `:root.dark` stays as ancestor context around the scope, so appearance
 * rules keep working.
 */
export function scopeSelectorToTot(selector: string, totId: TotId): string {
  const scope = `[data-tot-id="${CSS.escape(totId)}"]`;
  let rest = selector.trim();
  // A selector that already starts at the hook is the author's own scoping; keep it.
  if (/^\[data-tot-id(?=[\]=])/.test(rest)) return rest;
  let context = "";
  for (;;) {
    const root = ROOT_STEP.exec(rest);
    if (root === null) break;
    const compound = rest.slice(0, stepEnd(rest));
    rest = rest.slice(compound.length).replace(WHITESPACE_PREFIX, "");
    if (compound === root[0]) continue;
    context = compound;
    break;
  }
  // `html body .row` names the scope twice; only the scope is left.
  for (;;) {
    const root = ROOT_STEP.exec(rest);
    if (root === null) break;
    const compound = rest.slice(0, stepEnd(rest));
    if (compound !== root[0]) break;
    rest = rest.slice(compound.length).replace(WHITESPACE_PREFIX, "");
  }
  const scoped = rest === "" ? scope : `${scope} ${rest}`;
  return context === "" ? scoped : `${context} ${scoped}`;
}

type RuleParent = Pick<CSSStyleSheet, "cssRules">;

/** Rewrites rule selectors in place; at-rules that group rules are followed. */
function scopeTotThemeSheet(sheet: CSSStyleSheet, totId: TotId): void {
  const scope = (parent: RuleParent) => {
    for (let index = 0; index < parent.cssRules.length; index++) {
      const rule = parent.cssRules[index];
      if (rule === undefined) continue;
      if (rule instanceof CSSStyleRule) {
        rule.selectorText = splitSelectors(rule.selectorText)
          .map((selector) => scopeSelectorToTot(selector, totId))
          .join(", ");
      } else if (
        "cssRules" in rule &&
        // @keyframes and @font-face stay global: they name animations and faces.
        !(rule instanceof CSSKeyframesRule)
      ) {
        scope(rule as unknown as RuleParent);
      }
    }
  };
  scope(sheet);
}

/**
 * Mounts one Tot's theme CSS for as long as the returned function is not
 * called. Only the open Tot thread renders this, so navigating away removes it.
 */
export function applyTotThemeCss(totId: TotId, css: string): () => void {
  if (typeof document === "undefined" || typeof CSSStyleSheet === "undefined") return () => {};
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  stripFetches(sheet);
  scopeTotThemeSheet(sheet, totId);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((other) => other !== sheet);
  };
}
