import { TOT_THEME_MAX_LENGTH, type TotThemePatch } from "@t3tools/contracts";

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
