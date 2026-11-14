import type { TotAvatar } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { loadBoopFace } from "./TotAvatar";

/**
 * A face's main color: its flat color, or for a skin the middle of BoopFace's
 * own colors for that skin, once the component has loaded.
 */
export function useTotAccent(avatar: TotAvatar): string {
  const [skinColor, setSkinColor] = useState<{ skin: number; color: string } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the skin's colors from the lazily loaded BoopFace catalog
  useEffect(() => {
    const skin = avatar.skin;
    if (skin === undefined) return;
    let cancelled = false;
    void loadBoopFace().then((module) => {
      const base = (module.SKINS as Record<string, { base: ReadonlyArray<string> } | undefined>)[
        String(skin)
      ]?.base;
      const color = base?.[Math.floor(base.length / 2)];
      if (!cancelled && color !== undefined) setSkinColor({ skin, color });
    });
    return () => {
      cancelled = true;
    };
  }, [avatar.skin]);
  return avatar.skin !== undefined && skinColor?.skin === avatar.skin
    ? skinColor.color
    : avatar.color;
}

/** A dim wash of a Tot's color, for the top of its thread. */
export const totTint = (color: string, percent: number) =>
  `color-mix(in oklab, ${color} ${percent}%, transparent)`;
