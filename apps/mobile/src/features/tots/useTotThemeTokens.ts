import { parseTotThreadId, type EnvironmentId } from "@t3tools/contracts";
import {
  parseTotThemeTokens,
  type TotThemeTokenName,
  type TotThemeTokens,
} from "@t3tools/shared/totThemeTokens";
import { useMemo } from "react";

import { useTots } from "../../state/tots";

const NO_TOKENS: TotThemeTokens = {};

/** A token's value when the Tot set it, otherwise the colour the app already paints there. */
export function totThemeColor(
  tokens: TotThemeTokens,
  name: TotThemeTokenName,
  fallback: string,
): string {
  return tokens[name] ?? fallback;
}

/**
 * The colour tokens a Tot thread wears on mobile, found by the thread's Tot id
 * as on web. Surfaces keep their own fallback: Android's `--tot-bg` falls back
 * to the thread canvas while iOS uses the screen colour.
 */
export function useTotThemeTokens(
  environmentId: EnvironmentId,
  threadId: string | null,
): TotThemeTokens {
  const tots = useTots();
  const totId = threadId === null ? null : parseTotThreadId(threadId);
  const tot =
    totId === null
      ? undefined
      : tots.find((entry) => entry.environmentId === environmentId && entry.tot.id === totId);
  const css = tot?.tot.theme?.css;
  return useMemo(() => (css === undefined ? NO_TOKENS : parseTotThemeTokens(css).tokens), [css]);
}
