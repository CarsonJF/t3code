import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { selectTots, type EnvironmentTot } from "@t3tools/client-runtime/tots";
import {
  HOME_TOT_ID,
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerSettings,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
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

/** Home's current thread, for the shortcut and palette; null while Home is off. */
export function readHomeTotThread(): ScopedThreadRef | null {
  const home = appAtomRegistry
    .get(totsAtom)
    .find((entry) => entry.tot.id === HOME_TOT_ID && entry.tot.threadId !== null);
  return home?.tot.threadId == null ? null : scopeThreadRef(home.environmentId, home.tot.threadId);
}
