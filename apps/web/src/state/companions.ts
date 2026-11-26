import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ExternalCompanionStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useConnectedEnvironmentIds } from "./environments";
import { serverEnvironment } from "./server";

export interface EnvironmentCompanion {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
}

const companionsAtoms = environmentAtomList("web-companions", (environmentId) =>
  serverEnvironment.companionsLive({ environmentId, input: {} }),
);

/** Every companion each connected environment proxies, in its settings order. */
export function useCompanions(): ReadonlyArray<EnvironmentCompanion> {
  const connected = useConnectedEnvironmentIds();
  const results = useAtomValue(companionsAtoms(environmentIdsKey(connected)));
  return connected.flatMap((environmentId, index) => {
    const result = results[index];
    const state =
      result === undefined ? undefined : Option.getOrUndefined(AsyncResult.value(result));
    return (state?.companions ?? []).map((companion) => ({ environmentId, companion }));
  });
}

export function useCompanion(
  environmentId: EnvironmentId,
  companionId: string,
): ExternalCompanionStatus | undefined {
  return useCompanions().find(
    (entry) => entry.environmentId === environmentId && entry.companion.id === companionId,
  )?.companion;
}
