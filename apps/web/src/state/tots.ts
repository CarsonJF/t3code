import { useAtomValue } from "@effect/atom-react";
import { selectTots, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ServerSettings } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentSummaries } from "./presentation";
import { serverEnvironment } from "./server";

/** Every Tot on every connected environment, Home first. */
const totsAtom = Atom.make((get): ReadonlyArray<EnvironmentTot> => {
  const settingsByEnvironment = new Map<EnvironmentId, ServerSettings>();
  for (const environmentId of get(environmentSummaries.connectedEnvironmentIdsAtom)) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings !== null) settingsByEnvironment.set(environmentId, settings);
  }
  return selectTots(settingsByEnvironment);
}).pipe(Atom.withLabel("web-tots"));

export function useTots(): ReadonlyArray<EnvironmentTot> {
  return useAtomValue(totsAtom);
}
