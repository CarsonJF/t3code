import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { serverEnvironment } from "~/state/server";

const NO_PROVIDERS = [] as const;

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
    entries.some((entry) => entry.instanceId === instanceId && entry.enabled && entry.isAvailable);
  const fallbackEntry = entries.find((entry) => entry.enabled && entry.isAvailable);
  const fallbackModel = fallbackEntry
    ? resolveAppModelSelectionForInstance(fallbackEntry.instanceId, settings, providers, null)
    : null;
  const selection =
    picked ??
    (settings.defaultModelSelection && usable(settings.defaultModelSelection.instanceId)
      ? settings.defaultModelSelection
      : fallbackEntry && fallbackModel
        ? createModelSelection(fallbackEntry.instanceId, fallbackModel)
        : null);
  return {
    selection,
    entries,
    settings,
    providers,
    pick: (instanceId: ModelSelection["instanceId"], model: string) =>
      setPicked(createModelSelection(instanceId, model)),
  };
}
