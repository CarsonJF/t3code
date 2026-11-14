import { useAtomValue } from "@effect/atom-react";
import { selectTots, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { mobilePreferencesAtom } from "./preferences";
import { connectedEnvironmentIdsAtom } from "./presentation";
import { serverEnvironment } from "./server";

/** Every Tot on every connected environment, Home first. */
const totsAtom = Atom.make((get): ReadonlyArray<EnvironmentTot> => {
  const settingsByEnvironment = new Map<EnvironmentId, ServerSettings>();
  for (const environmentId of get(connectedEnvironmentIdsAtom)) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings !== null) settingsByEnvironment.set(environmentId, settings);
  }
  return selectTots(settingsByEnvironment);
}).pipe(Atom.withLabel("mobile-tots"));

export function useTots(): ReadonlyArray<EnvironmentTot> {
  return useAtomValue(totsAtom);
}

/** This device's choice; faces move unless the user turned it off. */
export function useAnimateTotAvatars(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) ? preferences.value.animateTotAvatars !== false : true;
}
