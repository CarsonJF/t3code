import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ExternalCompanionStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { mobilePreferencesAtom, saveMobilePreferences } from "./preferences";
import { connectedEnvironmentIdsAtom } from "./presentation";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export interface EnvironmentCompanion {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
}

/** Every companion each connected environment proxies, in its settings order. */
const companionsAtom = Atom.make((get): ReadonlyArray<EnvironmentCompanion> =>
  get(connectedEnvironmentIdsAtom).flatMap((environmentId) => {
    const result = get(serverEnvironment.companionsLive({ environmentId, input: {} }));
    const state = Option.getOrUndefined(AsyncResult.value(result));
    return (state?.companions ?? []).map((companion) => ({ environmentId, companion }));
  }),
).pipe(Atom.withLabel("mobile-companions"));

export function useCompanions(): ReadonlyArray<EnvironmentCompanion> {
  return useAtomValue(companionsAtom);
}

export function useCompanion(
  environmentId: EnvironmentId,
  companionId: string,
): ExternalCompanionStatus | undefined {
  return useCompanions().find(
    (entry) => entry.environmentId === environmentId && entry.companion.id === companionId,
  )?.companion;
}

export const companionKey = (entry: EnvironmentCompanion) =>
  `${entry.environmentId}:${entry.companion.id}`;

export type TotsTabSection = "tots" | "companions";

const NONE: ReadonlyArray<string> = [];

const toggled = (ids: ReadonlyArray<string>, id: string) =>
  ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

/** Which Tots tab sections and companion child lists this device keeps open. */
export function useTotsTabDisclosure() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const update = useAtomCommand(saveMobilePreferences);
  const value = AsyncResult.isSuccess(preferences) ? preferences.value : null;
  const collapsed = value?.collapsedTotsTabSections ?? NONE;
  const childrenOpen = value?.expandedCompanionChildren ?? NONE;
  return {
    sectionExpanded: (section: TotsTabSection) => !collapsed.includes(section),
    toggleSection: (section: TotsTabSection) =>
      void update({
        transform: (current) => ({
          collapsedTotsTabSections: toggled(current.collapsedTotsTabSections ?? [], section),
        }),
      }),
    childrenExpanded: (key: string) => childrenOpen.includes(key),
    toggleChildren: (key: string) =>
      void update({
        transform: (current) => ({
          expandedCompanionChildren: toggled(current.expandedCompanionChildren ?? [], key),
        }),
      }),
  };
}
