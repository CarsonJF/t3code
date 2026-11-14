import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  selectGroupChats,
  selectTots,
  totHostOrder,
  withoutTotProjects,
  type EnvironmentGroupChat,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import {
  HOME_TOT_ID,
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerSettings,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useProjects } from "./entities";
import { environmentPresentations, environmentSummaries } from "./presentation";
import { serverEnvironment } from "./server";

/** Every Tot on every known environment, Home first; kept through a reconnect like its threads. */
const totsAtom = Atom.make((get): ReadonlyArray<EnvironmentTot> => {
  const settingsByEnvironment = new Map<EnvironmentId, ServerSettings>();
  for (const environmentId of get(environmentSummaries.environmentIdsAtom)) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings !== null) settingsByEnvironment.set(environmentId, settings);
  }
  return selectTots(settingsByEnvironment);
}).pipe(Atom.withLabel("web-tots"));

const groupChatsAtom = Atom.make((get): ReadonlyArray<EnvironmentGroupChat> => {
  const settingsByEnvironment = new Map<EnvironmentId, ServerSettings>();
  for (const environmentId of get(environmentSummaries.environmentIdsAtom)) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings !== null) settingsByEnvironment.set(environmentId, settings);
  }
  return selectGroupChats(settingsByEnvironment);
}).pipe(Atom.withLabel("web-group-chats"));

export function useGroupChats(): ReadonlyArray<EnvironmentGroupChat> {
  return useAtomValue(groupChatsAtom);
}

export function useTots(): ReadonlyArray<EnvironmentTot> {
  return useAtomValue(totsAtom);
}

export interface TotHost {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/** Connected machines a Tot can live on, the one already hosting Tots first. */
export function useTotHosts(): ReadonlyArray<TotHost> {
  const connected = useAtomValue(environmentSummaries.connectedEnvironmentIdsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  return totHostOrder(connected, useTots()).map((environmentId) => ({
    environmentId,
    label: presentations.get(environmentId)?.entry.target.label ?? "This machine",
  }));
}

/** Projects offered for new work: everything but the Tots' own projects. */
export function usePickableProjects() {
  return withoutTotProjects(useProjects(), useTots(), useGroupChats());
}

/** Home's current thread, for the shortcut and palette; null while Home is off. */
export function readHomeTotThread(): ScopedThreadRef | null {
  const home = appAtomRegistry
    .get(totsAtom)
    .find((entry) => entry.tot.id === HOME_TOT_ID && entry.tot.threadId !== null);
  return home?.tot.threadId == null ? null : scopeThreadRef(home.environmentId, home.tot.threadId);
}
