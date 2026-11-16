import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  selectTots,
  totFaceInputFromShell,
  totFaceState,
  totHostOrder,
  totOwningThread,
  withoutTotProjects,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";
import type {
  EnvironmentId,
  ProjectId,
  ServerSettings,
  ThreadId,
  TotFaceState,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { useProjects, useThreadShell } from "./entities";
import { mobilePreferencesAtom } from "./preferences";
import { connectedEnvironmentIdsAtom, environmentPresentations } from "./presentation";
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

/** The Tot whose thread this is, while it runs or after it was turned off. */
export function useThreadTot(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId?: ProjectId;
  } | null,
): EnvironmentTot | null {
  return totOwningThread(useTots(), thread);
}

/** The face a Tot shows: its status light, or "sleep" while it has no thread here. */
export function useTotFace(entry: EnvironmentTot | null): TotFaceState {
  const ref =
    entry === null || entry.tot.threadId === null
      ? null
      : scopeThreadRef(entry.environmentId, entry.tot.threadId);
  const shell = useThreadShell(ref);
  return entry === null ? "sleep" : totFaceState(totFaceInputFromShell(entry.tot, shell));
}

export interface TotHost {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/** Connected machines a Tot can live on, the one already hosting Tots first. */
export function useTotHosts(): ReadonlyArray<TotHost> {
  const connected = useAtomValue(connectedEnvironmentIdsAtom);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  return totHostOrder(connected, useTots()).map((environmentId) => ({
    environmentId,
    label: presentations.get(environmentId)?.entry.target.label ?? "This machine",
  }));
}

/** Projects offered for new work: everything but the Tots' own projects. */
export function usePickableProjects() {
  return withoutTotProjects(useProjects(), useTots());
}

/** This device's choice; faces move unless the user turned it off. */
export function useAnimateTotAvatars(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences) ? preferences.value.animateTotAvatars !== false : true;
}
