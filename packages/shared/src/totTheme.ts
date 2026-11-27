import { TOT_THEME_MAX_LENGTH, type TotTheme, type TotThemePatch } from "@t3tools/contracts";

import { themeCssLoadsRemoteFiles } from "./themeCss.ts";

/** Why a Tot theme write cannot be stored, or null. */
export function totThemeProblem(theme: TotThemePatch): string | null {
  for (const field of ["css", "effect"] as const) {
    const value = theme[field];
    if (typeof value === "string" && value.length > TOT_THEME_MAX_LENGTH) {
      return `theme.${field} is ${value.length} characters; the limit is ${TOT_THEME_MAX_LENGTH}.`;
    }
  }
  // A Tot's CSS is applied like a theme's, so it gets the same server-side check;
  // the client's stripFetches stays the guard that cannot be dodged by CSS escapes.
  if (typeof theme.css === "string" && themeCssLoadsRemoteFiles(theme.css)) {
    return "theme.css cannot load files. Remove @import, image-set(), and url() that is not data: or #id.";
  }
  return null;
}

/**
 * A theme write merged onto a stored theme: an absent field keeps its value, and
 * `""` or null clears that field alone. Undefined when nothing is left.
 */
export function mergeTheme(
  theme: TotTheme | undefined,
  patch: TotThemePatch,
): TotTheme | undefined {
  const css = patch.css === undefined ? theme?.css : (patch.css ?? "");
  const effect = patch.effect === undefined ? theme?.effect : (patch.effect ?? "");
  const next = {
    ...(css === undefined || css === "" ? {} : { css }),
    ...(effect === undefined || effect === "" ? {} : { effect }),
  };
  return Object.keys(next).length === 0 ? undefined : next;
}

/** The element a companion's theme CSS is scoped to; its ids are slugs, so no escaping. */
export const companionThemeSelector = (companionId: string) =>
  `[data-companion-id="${companionId}"]`;
