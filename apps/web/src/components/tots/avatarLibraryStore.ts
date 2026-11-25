import type { AvatarLibrary, EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

const EMPTY: AvatarLibrary = { figures: [], themes: [] };
const byEnvironment = new Map<EnvironmentId, AvatarLibrary>();
const listeners = new Set<() => void>();
let merged: AvatarLibrary = EMPTY;

/** Every connected environment's library in one list; an id two of them share shows once. */
const merge = (): AvatarLibrary => {
  const figures = new Map<string, AvatarLibrary["figures"][number]>();
  const themes = new Map<string, AvatarLibrary["themes"][number]>();
  for (const library of byEnvironment.values()) {
    for (const figure of library.figures)
      if (!figures.has(figure.id)) figures.set(figure.id, figure);
    for (const theme of library.themes) if (!themes.has(theme.id)) themes.set(theme.id, theme);
  }
  return { figures: [...figures.values()], themes: [...themes.values()] };
};

export function setAvatarLibrary(environmentId: EnvironmentId, library: AvatarLibrary) {
  byEnvironment.set(environmentId, library);
  merged = merge();
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The avatar libraries of the environments read so far; empty until the first one answers. */
export function useAvatarLibrary(): AvatarLibrary {
  return useSyncExternalStore(
    subscribe,
    () => merged,
    () => EMPTY,
  );
}
