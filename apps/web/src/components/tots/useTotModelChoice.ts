import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "~/modelSelection";
import {
  isProviderInstancePickerReady,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import { serverEnvironment } from "~/state/server";

const NO_PROVIDERS = [] as const;

/** The first provider that is ready and reports a model; a broken one ahead of it is skipped. */
export function firstReadyModel(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  resolveModel: (instanceId: ProviderInstanceEntry["instanceId"]) => string | null,
): ModelSelection | null {
  for (const entry of entries) {
    if (!isProviderInstancePickerReady(entry)) continue;
    const model = resolveModel(entry.instanceId);
    if (model !== null) return createModelSelection(entry.instanceId, model);
  }
  return null;
}

/**
 * The model a Tot runs with on one environment: the user's pick, else the
 * environment's default for new threads, else its first usable provider.
 */
export function useTotModelChoice(environmentId: EnvironmentId, initial: ModelSelection | null) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? NO_PROVIDERS;
  const [picked, setPicked] = useState<ModelSelection | null>(initial);
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const usable = (instanceId: string) =>
    entries.some(
      (entry) => entry.instanceId === instanceId && isProviderInstancePickerReady(entry),
    );
  const selection =
    picked ??
    (settings.defaultModelSelection && usable(settings.defaultModelSelection.instanceId)
      ? settings.defaultModelSelection
      : firstReadyModel(entries, (instanceId) =>
          resolveAppModelSelectionForInstance(instanceId, settings, providers, null),
        ));
  return {
    selection,
    entries,
    settings,
    providers,
    pick: (instanceId: ModelSelection["instanceId"], model: string) =>
      setPicked(createModelSelection(instanceId, model)),
  };
}
